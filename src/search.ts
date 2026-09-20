// View-mode worldwide search.
//
// Backed entirely by the static hierarchy index built at build time
// (tiles/climbing-index.json). The index underlies the area/boulder/route panels
// too, so the viewer never calls the live OSM API. It is fetched lazily on the
// first interaction with the search box.
import type { Map as LibreMap } from 'maplibre-gl'
import { loadSearchIndex, normalize, type PlaceEntry } from './searchIndex'
import { openArea, openBoulder, openProblem } from './sidebar'

const MIN_QUERY = 2
const MAX_RESULTS = 20
const DEBOUNCE_MS = 120

/** Rank exact matches, then prefixes, word starts and finally substrings. */
function search(entries: PlaceEntry[], query: string): PlaceEntry[] {
  const q = normalize(query.trim())
  if (q.length < MIN_QUERY) return []
  const matches: Array<{ entry: PlaceEntry; score: number }> = []
  for (const entry of entries) {
    const at = entry.norm.indexOf(q)
    if (at === -1) continue
    let score = 3
    if (at === 0) score = entry.norm.length === q.length ? 0 : 1
    else if (entry.norm[at - 1] === ' ' || entry.norm[at - 1] === '-' || entry.norm[at - 1] === "'") score = 2
    matches.push({ entry, score })
  }
  matches.sort((a, b) =>
    a.score - b.score ||
    a.entry.norm.length - b.entry.norm.length ||
    a.entry.name.localeCompare(b.entry.name)
  )
  return matches.slice(0, MAX_RESULTS).map(match => match.entry)
}

export function initSearch(map: LibreMap): void {
  const container = document.createElement('div')
  container.className = 'search'

  const input = document.createElement('input')
  input.type = 'search'
  input.className = 'search-input'
  input.placeholder = 'Search areas, boulders, problems'
  input.setAttribute('aria-label', input.placeholder)
  input.autocomplete = 'off'
  input.spellcheck = false

  const results = document.createElement('ul')
  results.className = 'search-results'
  results.setAttribute('role', 'listbox')
  results.hidden = true

  container.append(input, results)
  document.getElementById('app')!.append(container)

  let items: PlaceEntry[] = []
  let index: PlaceEntry[] | undefined
  let active = -1
  let timer: number | undefined
  let status: 'idle' | 'loading' | 'failed' = 'idle'
  let requested = ''

  const close = () => {
    results.hidden = true
    results.replaceChildren()
    items = []
    active = -1
  }

  const renderStatus = (text: string) => {
    const item = document.createElement('li')
    item.className = 'search-status'
    item.textContent = text
    results.replaceChildren(item)
    results.hidden = false
  }

  const render = () => {
    if (status === 'loading') return renderStatus('Loading search index…')
    if (status === 'failed') return renderStatus('Search is unavailable right now. Try again later.')
    if (requested.length < MIN_QUERY) return close()

    items = search(index ?? [], requested)
    if (!items.length) return renderStatus('No matches.')

    const fragment = document.createDocumentFragment()
    items.forEach((entry, index) => {
      const item = document.createElement('li')
      item.setAttribute('role', 'option')
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'search-result'
      button.setAttribute('aria-selected', String(index === active))
      button.addEventListener('mousedown', event => event.preventDefault()) // Keep input focus.
      button.addEventListener('click', () => open(entry))

      const kind = document.createElement('span')
      kind.className = 'search-result-kind'
      kind.textContent = entry.groupLabel

      const body = document.createElement('span')
      body.className = 'search-result-body'

      const name = document.createElement('span')
      name.className = 'search-result-name'
      name.textContent = entry.name
      body.append(name)

      if (entry.path.length) {
        const meta = document.createElement('span')
        meta.className = 'search-result-meta'
        meta.textContent = entry.path.join(' › ')
        body.append(meta)
      }

      button.append(kind, body)
      const grades = [entry.font, entry.hueco].filter((value): value is string => Boolean(value))
      if (grades.length) {
        const wrap = document.createElement('span')
        wrap.className = 'search-result-grades'
        for (const value of grades) {
          const grade = document.createElement('span')
          grade.className = 'search-result-grade'
          grade.textContent = value
          wrap.append(grade)
        }
        button.append(wrap)
      }
      item.append(button)
      fragment.append(item)
    })
    results.replaceChildren(fragment)
    results.hidden = false
  }

  const open = (entry: PlaceEntry) => {
    close()
    // The sidebar owns fly-to zoom so clicks from search and breadcrumbs agree.
    if (entry.kind === 'p') void openProblem(entry.id, true)
    else if (entry.kind === 's') void openBoulder(entry.id, true)
    else void openArea(entry.id, true)
  }

  const ensureIndex = () => {
    if (index || status === 'loading') return
    status = 'loading'
    if (requested.length >= MIN_QUERY) render()
    void loadSearchIndex()
      .then(list => { index = list; status = 'idle'; render() })
      .catch(() => { status = 'failed'; render() })
  }

  const move = (delta: number) => {
    if (!items.length) return
    active = (active + delta + items.length) % items.length
    render()
    results.querySelectorAll('.search-result')[active]?.scrollIntoView({ block: 'nearest' })
  }

  input.addEventListener('focus', () => ensureIndex())

  input.addEventListener('input', () => {
    requested = input.value
    active = -1
    window.clearTimeout(timer)
    if (requested.trim().length < MIN_QUERY) {
      close()
      return
    }
    if (!index) {
      ensureIndex()
      return
    }
    timer = window.setTimeout(render, DEBOUNCE_MS)
  })

  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (results.hidden && items.length) render()
      move(event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'Enter') {
      if (active >= 0 && items[active]) {
        event.preventDefault()
        open(items[active])
      }
    } else if (event.key === 'Escape') {
      close()
      input.blur()
    }
  })

  // Close when focus moves elsewhere (clicking the map, sidebar, etc.).
  document.addEventListener('pointerdown', event => {
    if (!container.contains(event.target as Node)) close()
  })
}
