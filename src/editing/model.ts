// Pure OSM editing graph. History stores local overrides, never downloaded data.
export type OsmType = 'node' | 'way' | 'relation'
export interface Member { type: OsmType; ref: number; role: string }
export interface Element {
  type: OsmType; id: number; version?: number; tags: Record<string, string>
  lon?: number; lat?: number; nodes?: number[]; members?: Member[]
}
export type Key = `${OsmType}/${number}`
export type Position = [number, number]
export const keyOf = (e: Pick<Element, 'type' | 'id'>): Key => `${e.type}/${e.id}`
export const isRoute = (e?: Element): boolean => e?.type === 'node' && e.tags.climbing === 'route_bottom'
export const isBoulder = (e?: Element): boolean => e?.tags.climbing === 'boulder' && ['stone', 'bare_rock'].includes(e.tags.natural)
export const groupKind = (e?: Element): 'sector' | 'area' | undefined => e?.type === 'relation' && e.tags.type === 'site' && e.tags['climbing:boulder'] === 'yes'
  ? e.tags.climbing === 'area' ? 'area' : e.tags.climbing === 'crag' ? 'sector' : undefined : undefined

export type FatherKind = 'sector' | 'area'

/** The single kind of parent an object may have: a rock and a route belong to a
 * boulder (crag); a boulder and an area belong to an area (areas nest). */
export const fatherKind = (e?: Element): FatherKind | undefined => {
  if (!e) return undefined
  if (isRoute(e) || isBoulder(e)) return 'sector'
  return groupKind(e) === undefined ? undefined : 'area'
}

/** Nested areas deeper than this are rejected by scripts/build-hierarchy.py. */
export const MAX_AREA_RANK = 5
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
export function canonical(e: Element): string {
  return JSON.stringify({ type: e.type, id: e.id, lon: e.lon, lat: e.lat, nodes: e.nodes, members: e.members,
    tags: Object.entries(e.tags).sort(([a], [b]) => a.localeCompare(b)) })
}
interface State { overrides: Record<Key, Element | null>; nextId: number }
interface History { label: string; before: State; after: State; mergeKey?: string; time?: number }
export interface Change { key: Key; action: 'create' | 'modify' | 'delete'; before?: Element; after?: Element }

export class EditGraph {
  base: Record<Key, Element> = {}
  private state: State = { overrides: {}, nextId: -1 }
  private past: History[] = []
  private future: History[] = []
  onChange: () => void = () => {}
  ingest(elements: Element[]): void {
    for (const raw of elements) {
      const e: Element = { type: raw.type, id: raw.id, version: raw.version, tags: { ...raw.tags } }
      if (e.type === 'node') { e.lon = raw.lon; e.lat = raw.lat }
      if (e.type === 'way') e.nodes = [...(raw.nodes ?? [])]
      if (e.type === 'relation') e.members = (raw.members ?? []).map(m => ({ ...m, role: m.role ?? '' }))
      const key = keyOf(e)
      // A local session's original versions are immutable, including after draft recovery.
      if (!this.base[key]) this.base[key] = e
    }
  }
  get(key: Key): Element | undefined {
    return key in this.state.overrides ? this.state.overrides[key] ?? undefined : this.base[key]
  }
  require(key: Key): Element {
    const e = this.get(key)
    if (!e) throw new Error(`Required OSM data is missing: ${key}`)
    return e
  }
  all(): Element[] { return [...new Set([...Object.keys(this.base), ...Object.keys(this.state.overrides)])].flatMap(k => this.get(k as Key) ?? []) }
  put(e: Element): void { this.state.overrides[keyOf(e)] = clone(e) }
  update(key: Key, fn: (e: Element) => void): void { const e = clone(this.require(key)); fn(e); this.put(e) }
  remove(key: Key): void { this.state.overrides[key] = null }
  create(type: OsmType, data: Partial<Element>): Element {
    const e = { ...data, type, id: this.state.nextId--, tags: data.tags ?? {} } as Element
    if (type === 'node') { e.lon = precision(e.lon!); e.lat = precision(e.lat!) }
    this.put(e); return e
  }
  transaction(label: string, fn: () => void, mergeKey?: string): void {
    const before = clone(this.state)
    try {
      fn()
      const issues = this.validate()
      if (issues.length) throw new Error(issues.join('\n'))
      if (JSON.stringify(before) !== JSON.stringify(this.state)) {
        const last = this.past[this.past.length - 1], time = Date.now()
        if (mergeKey && last?.mergeKey === mergeKey && !this.future.length && time - (last.time ?? 0) < 1500) {
          last.after = clone(this.state); last.time = time
        } else this.past.push({ label, before, after: clone(this.state), mergeKey, time })
        this.future = []
        this.onChange()
      }
    } catch (error) { this.state = before; throw error }
  }
  get undoLabel(): string | undefined { return this.past[this.past.length - 1]?.label }
  get redoLabel(): string | undefined { return this.future[this.future.length - 1]?.label }
  undo(): void { const h = this.past.pop(); if (h) { this.future.push(h); this.state = clone(h.before); this.onChange() } }
  redo(): void { const h = this.future.pop(); if (h) { this.past.push(h); this.state = clone(h.after); this.onChange() } }
  discard(): void { this.state = { overrides: {}, nextId: -1 }; this.past = []; this.future = []; this.onChange() }
  serialize(): string { return JSON.stringify({ format: 1, base: this.base, state: this.state, past: this.past, future: this.future }) }
  restore(text: string): void {
    const data = JSON.parse(text)
    if (data.format !== 1 || !data.base || !data.state || !Array.isArray(data.past) || !Array.isArray(data.future)) throw new Error('Unsupported or damaged draft')
    const previous = this.serialize()
    try {
      this.base = data.base; this.state = data.state; this.past = data.past; this.future = data.future
      if (this.validate().length) throw new Error('Draft contains invalid or missing geometry')
    } catch (error) {
      const old = JSON.parse(previous); this.base = old.base; this.state = old.state; this.past = old.past; this.future = old.future; throw error
    }
    this.onChange()
  }
  changes(): Change[] {
    return Object.entries(this.state.overrides).flatMap(([k, after]) => {
      const key = k as Key, before = this.base[key]
      if (!before && !after || before && after && canonical(before) === canonical(after)) return []
      return [{ key, action: !before ? 'create' : !after ? 'delete' : 'modify', before, after: after ?? undefined } as Change]
    })
  }
  parents(key: Key): Element[] {
    const child = this.require(key)
    return this.all().filter(e => e.type === 'way' && child.type === 'node' && e.nodes?.includes(child.id) ||
      e.type === 'relation' && e.members?.some(m => m.type === child.type && m.ref === child.id))
  }
  sectors(route: Key): Element[] { return this.parents(route).filter(e => groupKind(e) === 'sector') }
  areas(key: Key): Element[] { return this.parents(key).filter(e => groupKind(e) === 'area') }
  /** Current parents of the object's own father kind (at most one is allowed). */
  parentGroups(key: Key): Element[] {
    const kind = fatherKind(this.get(key))
    return kind ? this.parents(key).filter(e => groupKind(e) === kind) : []
  }
  boulderWays(): Element[] {
    const ringIds = new Set(this.all().filter(e => isBoulder(e) && e.type === 'relation').flatMap(e => (e.members ?? []).filter(m => m.type === 'way').map(m => m.ref)))
    return this.all().filter(e => e.type === 'way' && (isBoulder(e) || ringIds.has(e.id)))
  }
  attached(node: Key): Element[] { const id = this.require(node).id; return this.boulderWays().filter(w => w.nodes?.includes(id)) }
  rings(boulder: Key): Element[] {
    const b = this.require(boulder)
    const rings = b.type === 'way' ? [b] : b.type === 'relation' && b.tags.type === 'multipolygon'
      ? (b.members ?? []).filter(m => m.type === 'way').map(m => this.require(`way/${m.ref}`)) : []
    if (!rings.length || rings.some(w => !w.nodes || w.nodes.length < 4 || w.nodes[0] !== w.nodes[w.nodes.length - 1]))
      throw new Error('Geometry editing requires closed boulder rings. Point boulders and fragmented multipolygons are not supported; use JOSM.')
    return rings
  }
  position(id: number): Position { const n = this.require(`node/${id}`); return [n.lon!, n.lat!] }
  setTags(key: Key, values: Record<string, string>): void {
    this.update(key, e => { for (const [k, v] of Object.entries(values)) { if (v.trim()) e.tags[k] = v.trim(); else delete e.tags[k] } })
  }
  addRoute(p: Position): Element { return this.create('node', { lon: p[0], lat: p[1], tags: { climbing: 'route_bottom', 'climbing:boulder': 'yes', sport: 'climbing' } }) }
  addBoulder(points: Position[]): Element {
    const ids = points.map(p => this.create('node', { lon: p[0], lat: p[1] }).id)
    return this.create('way', { nodes: [...ids, ids[0]], tags: { climbing: 'boulder', natural: 'stone', sport: 'climbing' } })
  }
  moveNode(key: Key, p: Position): void { this.update(key, e => { e.lon = precision(p[0]); e.lat = precision(p[1]) }) }
  moveBoulder(key: Key, dx: number, dy: number): void {
    const ids = new Set(this.rings(key).flatMap(w => w.nodes!))
    for (const id of ids) { const p = this.position(id); this.moveNode(`node/${id}`, [p[0] + dx, p[1] + dy]) }
  }
  insertVertex(way: Key, segment: number, p: Position, id?: number): number {
    const nodeId = id ?? this.create('node', { lon: p[0], lat: p[1] }).id
    this.update(way, e => e.nodes!.splice(segment + 1, 0, nodeId))
    return nodeId
  }
  detach(route: Key): void {
    const n = this.require(route), ways = this.attached(route)
    if (!ways.length) throw new Error('This route is already independent')
    const vertex = this.create('node', { lon: n.lon, lat: n.lat })
    for (const w of ways) this.update(keyOf(w), e => { e.nodes = e.nodes!.map(id => id === n.id ? vertex.id : id) })
  }
  attach(route: Key, way: Key, segment: number, p: Position, vertexId?: number): void {
    const n = this.require(route)
    if (!isRoute(n) || this.attached(route).length) throw new Error('Detach the route before attaching it elsewhere')
    if (vertexId !== undefined) {
      const vertex = this.require(`node/${vertexId}`)
      if (isRoute(vertex)) throw new Error('That vertex already represents another route. Distinct routes cannot be joined.')
      // Keep the route identity (and all its relation references). Only an ordinary,
      // exclusively owned vertex may be replaced; never merge arbitrary OSM data.
      if (Object.keys(vertex.tags).length || this.parents(keyOf(vertex)).some(e => keyOf(e) !== way))
        throw new Error('This vertex has other tags or references. Joining it could damage unrelated data; use JOSM.')
      this.moveNode(route, [vertex.lon!, vertex.lat!])
      this.update(way, e => { e.nodes = e.nodes!.map(id => id === vertexId ? n.id : id) })
      this.remove(keyOf(vertex))
    } else {
      this.moveNode(route, p); this.insertVertex(way, segment, p, n.id)
    }
  }
  removeVertex(way: Key, node: Key): void {
    const n = this.require(node)
    if (isRoute(n)) throw new Error('Detach or delete the route before removing this perimeter vertex')
    this.update(way, e => {
      const ids = e.nodes!.slice(0, -1).filter(id => id !== n.id); e.nodes = [...ids, ids[0]]
    })
    if (!this.parents(node).length && !Object.keys(n.tags).length) this.remove(node)
  }
  assign(child: Key, parent?: Key): void {
    const c = this.require(child), kind = fatherKind(c)
    if (!kind) throw new Error('This object cannot have a parent')
    if (parent && groupKind(this.require(parent)) !== kind) throw new Error(`Choose a ${kind === 'sector' ? 'boulder' : 'area'}`)
    if (parent) { this.assertAssignable(child, parent); this.assertDepth(child, parent) }
    for (const p of this.parents(child).filter(e => groupKind(e) === kind)) {
      if (keyOf(p) === parent) continue
      this.update(keyOf(p), e => { e.members = e.members!.filter(m => !(m.type === c.type && m.ref === c.id)) })
    }
    if (parent) this.update(parent, e => {
      if (!e.members!.some(m => m.type === c.type && m.ref === c.id)) e.members!.push({ type: c.type, ref: c.id, role: '' })
    })
  }
  /** Refuse a parent that is the child itself or one of its descendants. */
  private assertAssignable(child: Key, parent: Key): void {
    const stack: Key[] = [parent], seen = new Set<Key>()
    while (stack.length) {
      const key = stack.pop()!
      if (key === child) throw new Error('This would create a cycle in the hierarchy')
      if (seen.has(key)) continue
      seen.add(key)
      for (const p of this.parentGroups(key)) stack.push(keyOf(p))
    }
  }
  /** Keep area nesting within the build-time rank cap. */
  private assertDepth(child: Key, parent: Key): void {
    if (groupKind(this.get(child)) !== 'area') return
    const deepest = this.areaRank(parent) + 1 + this.areaHeight(child)
    if (deepest > MAX_AREA_RANK) throw new Error(`This would nest areas ${deepest + 1} levels deep, above the build limit of ${MAX_AREA_RANK + 1}. Flatten the hierarchy or edit it in JOSM.`)
  }
  private areaRank(area: Key): number {
    let rank = 0, key = area
    const seen = new Set<Key>()
    while (true) {
      const parent = this.parentGroups(key).find(e => groupKind(e) === 'area')
      if (!parent) break
      const pk = keyOf(parent)
      if (seen.has(pk)) break
      seen.add(pk); key = pk; rank++
    }
    return rank
  }
  private areaHeight(area: Key): number {
    const children = this.all().filter(e => groupKind(e) === 'area' && this.parentGroups(keyOf(e)).some(p => keyOf(p) === area))
    return children.length ? 1 + Math.max(...children.map(c => this.areaHeight(keyOf(c)))) : 0
  }
  createGroup(kind: 'sector' | 'area', name: string, description: string): Element {
    return this.create('relation', { members: [], tags: { type: 'site', site: 'climbing', sport: 'climbing', climbing: kind === 'sector' ? 'crag' : 'area', 'climbing:boulder': 'yes', ...(name.trim() ? { name: name.trim() } : {}), ...(description.trim() ? { description: description.trim() } : {}) } })
  }
  deleteFeature(key: Key): void {
    const e = this.require(key)
    if (isRoute(e)) {
      this.assign(key)
      const routeKeys = new Set(['name', 'description', 'sport', 'wikimedia_commons', 'wikimedia_commons:path', 'image', 'url', 'website', 'fa'])
      this.update(key, n => {
        for (const k of Object.keys(n.tags)) if (k === 'climbing' || k.startsWith('climbing:') || routeKeys.has(k)) delete n.tags[k]
      })
      if (!this.parents(key).length && !Object.keys(this.require(key).tags).length) this.remove(key)
    } else if (groupKind(e)) {
      for (const p of this.parents(key)) {
        if (groupKind(p) !== 'area') throw new Error(`Referenced by ${keyOf(p)}. Remove unrelated references in JOSM before deleting.`)
        this.update(keyOf(p), r => { r.members = r.members!.filter(m => !(m.type === e.type && m.ref === e.id)) })
      }
      this.remove(key)
    } else if (isBoulder(e)) {
      for (const p of this.parents(key)) {
        if (!groupKind(p)) throw new Error('This rock has parent references other than its boulder. Review them in JOSM before deleting.')
        this.update(keyOf(p), r => { r.members = r.members!.filter(m => !(m.type === e.type && m.ref === e.id)) })
      }
      const rings = this.rings(key)
      this.remove(key)
      for (const ring of rings) {
        if (keyOf(ring) !== key && this.parents(keyOf(ring)).length) continue
        // Do not delete multipolygon member ways carrying their own unrelated tags.
        if (keyOf(ring) !== key && Object.keys(ring.tags).length) continue
        this.remove(keyOf(ring))
        for (const id of new Set(ring.nodes)) {
          const node = this.get(`node/${id}`)
          if (node && !Object.keys(node.tags).length && !this.parents(keyOf(node)).length) this.remove(keyOf(node))
        }
      }
    } else throw new Error('Deleting this feature type is not supported')
  }
  validate(): string[] {
    const issues: string[] = [], changes = this.changes(), changed = new Set(changes.map(c => c.key))
    for (const c of changes) {
      const e = c.after
      if (c.before && !c.before.version) issues.push(`Missing OSM version: ${c.key}`)
      if (!e) continue
      if (e.type === 'node' && (!Number.isFinite(e.lon) || !Number.isFinite(e.lat) || Math.abs(e.lon!) > 180 || Math.abs(e.lat!) > 90)) issues.push(`Invalid coordinates: ${c.key}`)
      const refs: Key[] = e.type === 'way' ? (e.nodes ?? []).map(id => `node/${id}` as Key) : (e.members ?? []).map(m => `${m.type}/${m.ref}` as Key)
      for (const ref of refs) if ((Number(ref.split('/')[1]) < 0 || this.state.overrides[ref] === null) && !this.get(ref)) issues.push(`Missing reference ${ref} in ${c.key}`)
    }
    for (const w of this.boulderWays()) {
      if (!changed.has(keyOf(w)) && !w.nodes?.some(id => changed.has(`node/${id}`))) continue
      try {
        const ids = w.nodes ?? [], ps = ids.map(id => this.position(id))
        if (ids.length < 4 || ids[0] !== ids[ids.length - 1] || new Set(ids.slice(0, -1)).size !== ids.length - 1 || !validRing(ps)) issues.push(`Invalid boulder outline: ${keyOf(w)} (need a simple, closed outline with at least three distinct vertices)`)
      } catch (error) { issues.push(String(error)) }
    }
    for (const b of this.all().filter(e => isBoulder(e) && e.type === 'relation')) {
      const affected = changed.has(keyOf(b)) || b.members?.some(m => m.type === 'way' && (changed.has(`way/${m.ref}`) || this.get(`way/${m.ref}`)?.nodes?.some(id => changed.has(`node/${id}`))))
      if (!affected) continue
      try {
        const rings = this.rings(keyOf(b)).map(w => ({ role: b.members?.find(m => m.type === 'way' && m.ref === w.id)?.role ?? '', points: w.nodes!.map(id => this.position(id)) }))
        const outers = rings.filter(r => r.role !== 'inner')
        if (!outers.length || rings.some(r => !validRing(r.points)) || rings.some(r => r.role === 'inner' && outers.filter(o => pointInRing(r.points[0], o.points)).length !== 1) ||
          rings.some((r, i) => rings.some((s, j) => i < j && ringsIntersect(r.points, s.points))) ||
          outers.some((r, i) => outers.some((s, j) => i !== j && pointInRing(r.points[0], s.points))))
          issues.push(`Invalid multipolygon boulder ${keyOf(b)}: rings must not cross, and holes must lie inside one outer ring`)
      } catch (error) { issues.push(String(error)) }
    }
    for (const e of this.all()) {
      if (e.type === 'way' && e.nodes?.some(id => this.state.overrides[`node/${id}`] === null)) issues.push(`Deleted node still used by ${keyOf(e)}`)
      if (e.type === 'relation' && e.members?.some(m => this.state.overrides[`${m.type}/${m.ref}`] === null)) issues.push(`Deleted member still used by ${keyOf(e)}`)
      if (fatherKind(e)) {
        const parents = this.parentGroups(keyOf(e))
        if (parents.length > 1 && (changed.has(keyOf(e)) || parents.some(p => changed.has(keyOf(p))))) issues.push(`Conflicting parents for ${keyOf(e)}. Choose one parent before export.`)
      }
    }
    return [...new Set(issues)]
  }
  warnings(): string[] {
    const warnings = new Set<string>(), changed = new Set(this.changes().filter(c => c.after).map(c => c.key)), all = this.all()
    for (const e of all.filter(e => changed.has(keyOf(e)))) for (const other of all) {
      if (keyOf(e) === keyOf(other)) continue
      if (isRoute(e) && isRoute(other) && e.lon === other.lon && e.lat === other.lat)
        warnings.add(`Possible duplicate routes at the same location: ${[keyOf(e), keyOf(other)].sort().join(' and ')}. Check whether these are distinct problems.`)
      if (groupKind(e) && groupKind(e) === groupKind(other) && e.tags.name?.trim() && e.tags.name.trim().toLocaleLowerCase() === other.tags.name?.trim().toLocaleLowerCase())
        warnings.add(`Same-name ${groupKind(e)}s: ${[keyOf(e), keyOf(other)].sort().join(' and ')} (${e.tags.name}). Check for duplicates before uploading.`)
      if (isBoulder(e) && isBoulder(other) && e.type === 'way' && other.type === 'way') {
        const signature = (w: Element) => w.nodes?.slice(0, -1).map(id => { const n = this.get(`node/${id}`); return n ? `${n.lon},${n.lat}` : `missing:${id}` }).sort().join('|')
        if (signature(e) === signature(other)) warnings.add(`Possible duplicate boulders: ${[keyOf(e), keyOf(other)].sort().join(' and ')} have the same perimeter locations.`)
      }
    }
    return [...warnings]
  }
  exportOsc(): string {
    const issues = this.validate()
    if (issues.length) throw new Error(issues.join('\n'))
    const changes = this.changes()
    if (!changes.length) throw new Error('No local changes to export')
    const rank = { node: 0, way: 1, relation: 2 }
    const section = (action: Change['action']) => {
      let es = changes.filter(c => c.action === action).map(c => (c.after ?? c.before)!)
        .sort((a, b) => rank[a.type] - rank[b.type] || b.id - a.id)
      const byKey = new Map(es.map(e => [keyOf(e), e])), visited = new Set<Key>(), active = new Set<Key>(), ordered: Element[] = []
      const visit = (e: Element) => {
        const key = keyOf(e)
        if (visited.has(key)) return
        if (active.has(key)) throw new Error(`Cyclic relationships in export: ${key}. Review in JOSM.`)
        active.add(key)
        const refs: Key[] = e.type === 'way' ? (e.nodes ?? []).map(id => `node/${id}` as Key) : (e.members ?? []).map(m => `${m.type}/${m.ref}` as Key)
        for (const ref of refs) { const child = byKey.get(ref); if (child) visit(child) }
        active.delete(key); visited.add(key); ordered.push(e)
      }
      for (const e of es) visit(e)
      es = action === 'delete' ? ordered.reverse() : ordered
      return es.length ? `  <${action}>\n${es.map(e => serializeElement(e, action === 'create')).join('\n')}\n  </${action}>` : ''
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n<osmChange version="0.6" generator="OpenBoulderMap editor">\n${(['create', 'modify', 'delete'] as const).map(section).filter(Boolean).join('\n')}\n</osmChange>\n`
  }
}

const precision = (n: number): number => Number(n.toFixed(7))
export function pointInRing(p: Position, ring: Position[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j]
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}
function ringsIntersect(a: Position[], b: Position[]): boolean {
  const cross = (p: Position, q: Position, r: Position) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  for (let i = 0; i < a.length - 1; i++) for (let j = 0; j < b.length - 1; j++) {
    const p = a[i], q = a[i + 1], r = b[j], s = b[j + 1]
    if (Math.max(p[0], q[0]) < Math.min(r[0], s[0]) || Math.max(r[0], s[0]) < Math.min(p[0], q[0]) || Math.max(p[1], q[1]) < Math.min(r[1], s[1]) || Math.max(r[1], s[1]) < Math.min(p[1], q[1])) continue
    if (cross(p, q, r) * cross(p, q, s) <= 0 && cross(r, s, p) * cross(r, s, q) <= 0) return true
  }
  return false
}
export function validRing(ps: Position[]): boolean {
  const n = ps.length - 1
  if (n < 3 || ps.some(p => !p.every(Number.isFinite))) return false
  const cross = (a: Position, b: Position, c: Position) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const on = (a: Position, b: Position, c: Position) => Math.abs(cross(a, b, c)) < 1e-18 && c[0] >= Math.min(a[0], b[0]) && c[0] <= Math.max(a[0], b[0]) && c[1] >= Math.min(a[1], b[1]) && c[1] <= Math.max(a[1], b[1])
  let area = 0
  for (let i = 0; i < n; i++) {
    const a = ps[i], b = ps[i + 1]
    if (a[0] === b[0] && a[1] === b[1]) return false
    area += cross(ps[0], a, b)
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || i === 0 && j === n - 1) continue
      const c = ps[j], d = ps[j + 1]
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0 || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b)) return false
    }
  }
  return Math.abs(area) > 1e-18
}
const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!))
function serializeElement(e: Element, created: boolean): string {
  const attrs = `id="${e.id}"${created ? '' : ` version="${e.version}"`}${e.type === 'node' ? ` lon="${e.lon!.toFixed(7)}" lat="${e.lat!.toFixed(7)}"` : ''}`
  const children = [
    ...(e.nodes ?? []).map(id => `<nd ref="${id}" />`),
    ...(e.members ?? []).map(m => `<member type="${m.type}" ref="${m.ref}" role="${xml(m.role)}" />`),
    ...Object.entries(e.tags).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `<tag k="${xml(k)}" v="${xml(v)}" />`)
  ]
  return `    <${e.type} ${attrs}>\n${children.map(c => `      ${c}`).join('\n')}\n    </${e.type}>`
}
