// Editor-only interactive photo path drawing. Kept out of the shared photos
// module so the viewer bundle never downloads the path editor.
import { wikimediaUrl, type PathPoint } from '../photos'

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
  referencePaths: PathPoint[][] = [],
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

    // Other routes on this block using the same image provide context without
    // competing visually with the route currently being edited.
    for (const reference of referencePaths) {
      if (reference.length < 2) continue
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
      line.setAttribute('points', reference.map(p => `${p.x * imgW},${p.y * imgH}`).join(' '))
      line.setAttribute('stroke', '#fff')
      line.setAttribute('stroke-width', '4')
      line.setAttribute('stroke-dasharray', '10 8')
      line.setAttribute('stroke-linecap', 'round')
      line.setAttribute('stroke-linejoin', 'round')
      line.setAttribute('fill', 'none')
      line.setAttribute('opacity', '0.8')
      svg.appendChild(line)
    }

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
