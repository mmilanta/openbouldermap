// Photo loading and route-path rendering for the sidebar.
// Path format follows OpenClimbing convention:
//   "x1,y1|x2,y2:|x3,y3"  where x,y are 0-1 percentages,
//   '|' = solid segment, ':|' = dotted segment, y may have a trailing bolt-type letter.

export interface PathPoint {
  x: number
  y: number
  dotted?: boolean // true = the segment arriving at this point is dotted
}

/** Construct a Wikimedia Commons thumbnail URL from a File:… tag value. */
export function wikimediaUrl(filename: string, width = 800): string {
  const name = filename.replace(/^File:/i, '').trim()
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${width}`
}


/**
 * Parse an OpenClimbing-style path string into {x,y} points (0-1 range).
 * Silently drops malformed coordinates.
 */
export function parsePath(str?: string | null): PathPoint[] {
  if (!str) return []
  const segments = str.split(/(:?\|)/).filter(Boolean)
  const points: PathPoint[] = []
  let dotted = false

  for (let seg of segments) {
    if (seg === '|' || seg === ':|') { dotted = seg === ':|'; continue }
    // Also accept the older |: spelling already handled by this parser.
    if (seg.startsWith(':')) { dotted = true; seg = seg.slice(1) }

    const [xStr, yRaw = ''] = seg.split(',', 2)
    // Strip trailing non-numeric characters (bolt-type suffixes: b, a, s, p)
    const yStr = yRaw.replace(/[^0-9.\-]/g, '')
    const x = parseFloat(xStr)
    const y = parseFloat(yStr)

    if (!isNaN(x) && !isNaN(y)) {
      points.push({ x, y, dotted })
    }
  }
  return points
}

/** Runs of segments with the same style, sharing endpoints at transitions. */
export function pathSegments(points: PathPoint[]): Array<{ points: PathPoint[]; dotted: boolean }> {
  const runs: Array<{ points: PathPoint[]; dotted: boolean }> = []
  for (let i = 1; i < points.length; i++) {
    const dotted = Boolean(points[i].dotted), last = runs[runs.length - 1]
    if (last && last.dotted === dotted) last.points.push(points[i])
    else runs.push({ points: [points[i - 1], points[i]], dotted })
  }
  return runs
}

/** Collect every wikimedia_commons*:path tag from a flat props bag. */
export function allPathTags(props: Record<string, any>): Array<{ image: string; path: string }> {
  const result: Array<{ image: string; path: string }> = []
  for (const [key, value] of Object.entries(props)) {
    if (!key.startsWith('wikimedia_commons') || !key.endsWith(':path')) continue
    if (typeof value !== 'string' || !value.trim()) continue
    // The image key is the prefix before ':path'
    const imageKey = key.replace(/:path$/, '')
    const image = String(props[imageKey] ?? '')
    if (!image.trim() || !image.startsWith('File:')) continue
    result.push({ image, path: value })
  }
  return result
}

/**
 * Render a <div> containing the image with SVG path overlays.
 * Returns the container element.  `paths` entries each describe one route line.
 */
export function renderPhotoBlock(
  imageFilename: string,
  paths: Array<{ points: PathPoint[]; color: string; key?: string }>,
): HTMLElement {
  const container = document.createElement('div')
  container.className = 'photo-block loading'

  const loader = document.createElement('div')
  loader.className = 'photo-loader'
  loader.setAttribute('role', 'status')
  loader.setAttribute('aria-label', 'Loading image')
  container.appendChild(loader)

  const img = document.createElement('img')
  img.className = 'photo-img'
  img.alt = 'Boulder photo'
  container.appendChild(img)

  // SVG overlay – sized once the image loads
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.classList.add('photo-overlay')
  container.appendChild(svg)

  img.addEventListener('load', () => {
    container.classList.remove('loading')
    loader.remove()

    const w = img.naturalWidth
    const h = img.naturalHeight
    if (w === 0 || h === 0) return
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
    svg.setAttribute('preserveAspectRatio', 'none')

    for (const p of paths) {
      if (p.points.length < 2) continue
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      g.classList.add('photo-route-line')
      if (p.key) g.dataset.routeKey = p.key

      for (const run of pathSegments(p.points)) {
        const d = run.points.map((pt, idx) =>
          `${idx === 0 ? 'M' : 'L'}${pt.x * w} ${pt.y * h}`
        ).join(' ')
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        line.setAttribute('d', d)
        line.setAttribute('stroke', p.color)
        line.setAttribute('stroke-width', '6')
        line.setAttribute('stroke-linecap', 'round')
        line.setAttribute('stroke-linejoin', 'round')
        line.setAttribute('fill', 'none')
        line.classList.add('photo-route-stroke')
        if (run.dotted) line.setAttribute('stroke-dasharray', '8 6')

        // A hidden copy becomes the white casing when this route is highlighted.
        const casing = line.cloneNode(true) as SVGPathElement
        casing.classList.remove('photo-route-stroke')
        casing.classList.add('photo-route-casing')
        casing.setAttribute('stroke', '#fff')
        g.appendChild(casing)
        g.appendChild(line)
      }

      svg.appendChild(g)
    }
  })
  img.addEventListener('error', () => {
    container.classList.remove('loading')
    loader.remove()
  })
  // Set src after listeners so cached images cannot finish before the loader
  // and route overlay handlers are ready.
  img.src = wikimediaUrl(imageFilename)

  return container
}
