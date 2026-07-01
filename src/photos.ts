// Photo loading, route-path rendering and editing for the sidebar.
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

/** Serialize points back to the OpenClimbing path string. */
export function stringifyPath(points: PathPoint[]): string {
  if (points.length === 0) return ''
  return points
    .map((p, i) => {
      const prefix = i === 0 ? '' : p.dotted ? ':|' : '|'
      return `${prefix}${p.x.toFixed(2)},${p.y.toFixed(2)}`
    })
    .join('')
}

/**
 * Parse an OpenClimbing-style path string into {x,y} points (0-1 range).
 * Silently drops malformed coordinates.
 */
export function parsePath(str?: string | null): PathPoint[] {
  if (!str) return []
  const segments = str.split('|').filter(Boolean)
  const points: PathPoint[] = []

  for (let i = 0; i < segments.length; i++) {
    let seg = segments[i]
    const dotted = seg.startsWith(':')
    if (dotted) seg = seg.slice(1) // strip leading ':'

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
  paths: Array<{ points: PathPoint[]; color: string; label?: string }>,
): HTMLElement {
  const container = document.createElement('div')
  container.className = 'photo-block'

  const img = document.createElement('img')
  img.className = 'photo-img'
  img.src = wikimediaUrl(imageFilename)
  img.alt = 'Boulder photo'
  container.appendChild(img)

  // SVG overlay – sized once the image loads
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.classList.add('photo-overlay')
  container.appendChild(svg)

  img.addEventListener('load', () => {
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (w === 0 || h === 0) return
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
    svg.setAttribute('preserveAspectRatio', 'none')

    for (const p of paths) {
      if (p.points.length < 2) continue
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')

      // split path into solid and dotted segments
      let current: PathPoint[] = []
      const flush = (dotted: boolean) => {
        if (current.length < 2) return
        const d = current.map((pt, idx) =>
          `${idx === 0 ? 'M' : 'L'}${pt.x * w} ${pt.y * h}`
        ).join(' ')
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        line.setAttribute('d', d)
        line.setAttribute('stroke', p.color)
        line.setAttribute('stroke-width', '3')
        line.setAttribute('stroke-linecap', 'round')
        line.setAttribute('stroke-linejoin', 'round')
        line.setAttribute('fill', 'none')
        if (dotted) line.setAttribute('stroke-dasharray', '6 4')
        g.appendChild(line)
      }

      for (let i = 0; i < p.points.length; i++) {
        const pt = p.points[i]
        if (i > 0 && pt.dotted && current.length >= 1) {
          // close current segment, start dotted
          current.push(pt)
          flush(false)
          // start new dotted segment from previous point
          current = [p.points[i - 1], pt]
        } else if (i > 0 && !pt.dotted && current.length >= 1 && p.points[i - 1]?.dotted) {
          // dotted segment ends, flush it
          current.push(pt)
          flush(true)
          // start new solid segment
          current = [pt]
        } else {
          current.push(pt)
        }
      }
      flush(current.some(pt => pt.dotted))

      // label
      if (p.label) {
        const last = p.points[p.points.length - 1]
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        text.setAttribute('x', String(last.x * w + 6))
        text.setAttribute('y', String(last.y * h + 4))
        text.setAttribute('fill', p.color)
        text.setAttribute('font-size', '13')
        text.setAttribute('font-weight', '700')
        text.textContent = p.label
        g.appendChild(text)
      }

      svg.appendChild(g)
    }
  })

  return container
}

// ---------------------------------------------------------------------------
//  Path editor — interactive drawing overlay
// ---------------------------------------------------------------------------

export interface EditorCallbacks {
  onDone: (points: PathPoint[]) => void
  onCancel: () => void
}

/**
 * Create a full-page lightbox overlay for drawing a path on the photo.
 * Click to add points, right-click to delete, toolbar at bottom.
 */
export function createPathEditor(
  imageFilename: string,
  initialPoints: PathPoint[],
  callbacks: EditorCallbacks,
): void {
  // --- backdrop ---
  const backdrop = document.createElement('div')
  backdrop.className = 'editor-backdrop'

  // --- toolbar (floating at bottom) ---
  const toolbar = document.createElement('div')
  toolbar.className = 'editor-toolbar'
  toolbar.innerHTML = `
    <span class="editor-hint">Click to trace the route · Right‑click a point to delete</span>
    <div class="editor-actions">
      <button class="editor-btn editor-undo" title="Undo last point">↩</button>
      <button class="editor-btn editor-clear" title="Clear all">✕</button>
      <button class="editor-btn editor-done">✓ Done</button>
      <button class="editor-btn editor-cancel">Cancel</button>
    </div>
  `

  // --- image ---
  const img = document.createElement('img')
  img.className = 'editor-img'
  img.src = wikimediaUrl(imageFilename, 1200)
  img.alt = 'Boulder photo'

  // --- SVG overlay ---
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.classList.add('editor-svg')

  backdrop.appendChild(img)
  backdrop.appendChild(svg)
  backdrop.appendChild(toolbar)
  document.body.appendChild(backdrop)

  // prevent background scrolling
  const scrollY = window.scrollY
  document.body.style.overflow = 'hidden'
  const cleanup = () => {
    backdrop.remove()
    document.body.style.overflow = ''
    window.scrollTo(0, scrollY)
  }

  const wrappedCallbacks: EditorCallbacks = {
    onDone: (pts) => { cleanup(); callbacks.onDone(pts) },
    onCancel: () => { cleanup(); callbacks.onCancel() },
  }

  // --- state ---
  let points: PathPoint[] = initialPoints.map(p => ({ ...p, dotted: false }))
  let imgW = 0
  let imgH = 0

  function syncOverlay() {
    const ir = img.getBoundingClientRect()
    svg.style.left = ir.left + 'px'
    svg.style.top = ir.top + 'px'
    svg.style.width = ir.width + 'px'
    svg.style.height = ir.height + 'px'
    svg.setAttribute('viewBox', `0 0 ${imgW} ${imgH}`)
    svg.setAttribute('preserveAspectRatio', 'none')
    redraw()
  }

  function redraw() {
    svg.innerHTML = ''
    if (imgW === 0 || imgH === 0) return

    if (points.length > 1) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
      const pts = points.map(p => `${p.x * imgW},${p.y * imgH}`).join(' ')
      line.setAttribute('points', pts)
      line.setAttribute('stroke', '#e53935')
      line.setAttribute('stroke-width', '4')
      line.setAttribute('stroke-linecap', 'round')
      line.setAttribute('stroke-linejoin', 'round')
      line.setAttribute('fill', 'none')
      svg.appendChild(line)
    }

    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      circle.setAttribute('cx', String(p.x * imgW))
      circle.setAttribute('cy', String(p.y * imgH))
      circle.setAttribute('r', String(i === 0 ? 8 : 6))
      circle.setAttribute('fill', i === 0 ? '#2e7d32' : '#e53935')
      circle.setAttribute('stroke', '#fff')
      circle.setAttribute('stroke-width', '2')
      svg.appendChild(circle)

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      text.setAttribute('x', String(p.x * imgW + 12))
      text.setAttribute('y', String(p.y * imgH + 5))
      text.setAttribute('fill', '#fff')
      text.setAttribute('font-size', '12')
      text.setAttribute('font-weight', '700')
      text.setAttribute('stroke', '#000')
      text.setAttribute('stroke-width', '3')
      text.setAttribute('paint-order', 'stroke')
      text.textContent = String(i + 1)
      svg.appendChild(text)
    }
  }

  img.addEventListener('load', () => {
    imgW = img.naturalWidth
    imgH = img.naturalHeight
    syncOverlay()
  })

  // keep overlay aligned on resize
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => syncOverlay())
    ro.observe(img)
  }

  // click → add point
  img.addEventListener('click', (e: MouseEvent) => {
    const rect = img.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    if (x < 0 || x > 1 || y < 0 || y > 1) return
    points.push({ x, y })
    redraw()
  })

  // right-click → delete nearest point
  img.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault()
    if (points.length === 0) return
    const rect = img.getBoundingClientRect()
    const cx = (e.clientX - rect.left) / rect.width
    const cy = (e.clientY - rect.top) / rect.height
    const threshold = 0.03
    let bestIdx = -1
    let bestDist = Infinity
    for (let i = 0; i < points.length; i++) {
      const dx = points[i].x - cx
      const dy = points[i].y - cy
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < bestDist) { bestDist = d; bestIdx = i }
    }
    if (bestIdx >= 0 && bestDist < threshold) {
      points.splice(bestIdx, 1)
      redraw()
    }
  })

  // toolbar handlers
  toolbar.querySelector('.editor-undo')!.addEventListener('click', () => {
    points.pop(); redraw()
  })
  toolbar.querySelector('.editor-clear')!.addEventListener('click', () => {
    points = []; redraw()
  })
  toolbar.querySelector('.editor-done')!.addEventListener('click', () => {
    wrappedCallbacks.onDone(points)
  })
  toolbar.querySelector('.editor-cancel')!.addEventListener('click', () => {
    wrappedCallbacks.onCancel()
  })

  // close on Escape
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') wrappedCallbacks.onCancel()
  }
  document.addEventListener('keydown', onKey, { once: true })
}
