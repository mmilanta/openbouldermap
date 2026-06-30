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
