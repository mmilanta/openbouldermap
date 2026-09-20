import { EditGraph, canonical, isBoulder, keyOf, type Element, type Key } from './model'

const API = 'https://api.openstreetmap.org/api/0.6'
async function elements(url: string, init?: RequestInit): Promise<Element[]> {
  const response = await fetch(url, { cache: 'no-store', ...init, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`OSM request failed (${response.status}). Nothing has been published.`)
  const data = await response.json()
  if (!Array.isArray(data.elements)) throw new Error('Invalid response from OSM')
  return data.elements.map((e: Element) => ({ ...e, tags: e.tags ?? {}, ...(e.members ? { members: e.members.map(m => ({ ...m, role: m.role ?? '' })) } : {}) }))
}

/** Reads only. Versions are pinned in the graph; all publishing remains in JOSM. */
export class OsmReader {
  private requests = new Map<string, Promise<void>>()
  private refSnapshots = new Map<string, string>()
  constructor(readonly graph: EditGraph) {}
  reset(): void { this.requests.clear(); this.refSnapshots.clear() }
  serializeReferences(): [string, string][] { return [...this.refSnapshots] }
  restoreReferences(data: [string, string][]): void {
    if (!Array.isArray(data)) throw new Error('Invalid draft reference data')
    this.refSnapshots = new Map(data)
  }
  private cached(path: string, task: () => Promise<void>): Promise<void> {
    let pending = this.requests.get(path)
    if (!pending) { pending = task(); this.requests.set(path, pending); pending.catch(() => this.requests.delete(path)) }
    return pending
  }
  async load(key: Key, full = false): Promise<void> {
    if (Number(key.split('/')[1]) < 0) { this.graph.require(key); return }
    const path = `${key}${full && !key.startsWith('node/') ? '/full' : ''}.json`
    await this.cached(path, async () => this.graph.ingest(await elements(`${API}/${path}`)))
    this.graph.require(key)
  }
  async references(key: Key): Promise<void> {
    if (Number(key.split('/')[1]) < 0) return
    const paths = [`${key}/relations.json`, ...(key.startsWith('node/') ? [`${key}/ways.json`] : [])]
    await Promise.all(paths.map(path => this.cached(path, async () => {
      const es = await elements(`${API}/${path}`)
      const refs = es.map(keyOf).sort().join(',')
      if (this.refSnapshots.has(path) && this.refSnapshots.get(path) !== refs) throw new Error(`OSM references changed for ${key}. The restored draft needs conflict review in JOSM, or discard and reload.`)
      this.refSnapshots.set(path, refs)
      this.graph.ingest(es)
    })))
  }
  async select(key: Key): Promise<void> {
    await this.load(key, true)
    await this.references(key)
    const e = this.graph.require(key)
    if (e.type === 'node') {
      for (const parent of this.graph.parents(key).filter(p => p.type === 'way')) {
        await this.load(keyOf(parent), true)
        await this.references(keyOf(parent))
        for (const r of this.graph.parents(keyOf(parent)).filter(isBoulder)) await this.load(keyOf(r), true)
      }
    }
    if (isBoulder(e) && e.type === 'relation') {
      for (const m of e.members ?? []) if (m.type === 'way') await this.load(`way/${m.ref}`, true)
    }
  }
  /** Before geometry changes load every referrer, including non-climbing objects. */
  async geometry(keys: Key[]): Promise<void> {
    for (const key of [...new Set(keys)]) {
      await this.references(key)
      for (const parent of this.graph.parents(key)) {
        if (parent.type === 'way') {
          await this.load(keyOf(parent), true)
          await this.references(keyOf(parent))
        }
      }
    }
    // Moving a shared vertex in unrelated geometry must be explicit in a full OSM editor.
    const allowed = new Set(this.graph.boulderWays().map(keyOf))
    for (const key of keys) {
      const ways = this.graph.parents(key).filter(e => e.type === 'way')
      if (ways.some(w => !allowed.has(keyOf(w)))) throw new Error(`${key} is shared with non-boulder geometry. Edit it in JOSM to avoid moving unrelated map features.`)
    }
  }
  async prepareDelete(key: Key): Promise<void> {
    await this.select(key)
    const e = this.graph.require(key)
    if (isBoulder(e)) {
      const rings = this.graph.rings(key)
      for (const ring of rings) await this.references(keyOf(ring))
      for (const id of new Set(rings.flatMap(w => w.nodes!))) await this.references(`node/${id}`)
    }
  }
  /** Optimistic checks cover edited elements and all loaded geometry dependencies.
   * Parent-list checks catch newly added references before a destructive export. */
  async preflight(): Promise<void> {
    const changes = this.graph.changes(), needed = new Set<Key>()
    for (const c of changes) {
      if (c.before) needed.add(c.key)
      const e = c.after ?? c.before!
      if (e.type === 'way') for (const id of [...(c.before?.nodes ?? []), ...(c.after?.nodes ?? [])]) if (id > 0) needed.add(`node/${id}`)
      if (e.type === 'relation') for (const m of e.members ?? []) {
        const key: Key = `${m.type}/${m.ref}`
        if (m.ref > 0 && this.graph.base[key]) needed.add(key)
      }
      if (e.type === 'node' && c.after) for (const p of this.graph.parents(c.key).filter(p => p.id > 0)) needed.add(keyOf(p))
    }
    // Deleted nodes are absent from parents(), but their original referrers were
    // recorded when preparing the action and are checked below.
    const checks: (() => Promise<void>)[] = []
    for (const path of this.refSnapshots.keys()) {
      const key = path.split('/').slice(0, 2).join('/') as Key
      if (!needed.has(key)) continue
      checks.push(async () => {
        const es = await elements(`${API}/${path}`)
        if (es.map(keyOf).sort().join(',') !== this.refSnapshots.get(path)) throw new Error(`OSM references changed for ${key}. Review conflicts in JOSM or discard and reload before exporting.`)
      })
    }
    for (const key of needed) checks.push(async () => {
      const original = this.graph.base[key]
      if (!original) throw new Error(`Missing original data for ${key}`)
      const live = (await elements(`${API}/${key}.json`)).find(e => keyOf(e) === key)
      if (!live || live.version !== original.version || canonical(live) !== canonical(original)) throw new Error(`${key} changed on OpenStreetMap. Review the conflict in JOSM or discard and reload. Export has been blocked; your draft is retained.`)
    })
    let next = 0
    let failure: unknown
    // Bound request concurrency, and wait for all workers before releasing the UI.
    await Promise.all(Array.from({ length: Math.min(3, checks.length) }, async () => {
      while (!failure && next < checks.length) {
        const check = checks[next++]
        try { await check() } catch (error) { failure = error }
      }
    }))
    if (failure) throw failure
  }
}
