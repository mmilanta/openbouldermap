/**
 * Minimal XYZ tile server for the climbing PMTiles archive.
 * Usage: npx tsx scripts/serve-tiles.ts [port]
 *
 * Reads tiles/climbing.pmtiles and serves vector tiles at /{z}/{x}/{y}
 * so Maputnik (or any standard MapLibre style editor) can consume them.
 */
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { PMTiles } from 'pmtiles'
import { openSync, readSync } from 'fs'

const PORT = parseInt(process.argv[2] || '8081', 10)
const PMTILES_PATH = 'tiles/climbing.pmtiles'

// Custom Node.js filesystem source (pmtiles expects { data: ArrayBuffer })
const fd = openSync(PMTILES_PATH, 'r')
const source = {
  getKey: () => PMTILES_PATH,
  getBytes: async (offset: number, length: number) => {
    const ab = new ArrayBuffer(length)
    const buf = Buffer.from(ab)
    const bytesRead = readSync(fd, buf, 0, length, offset)
    if (bytesRead < length) {
      const trimmed = new ArrayBuffer(bytesRead)
      new Uint8Array(trimmed).set(new Uint8Array(ab, 0, bytesRead))
      return { data: trimmed }
    }
    return { data: ab }
  }
}

const p = new PMTiles(source)

// Cache header (static, read once)
let cachedHeader: any = null
async function getHeader() {
  if (!cachedHeader) cachedHeader = await p.getHeader()
  return cachedHeader
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*'
}

function reply(res: ServerResponse, status: number, body: string | Buffer | ArrayBuffer, contentType?: string) {
  const h: Record<string, string> = { ...CORS_HEADERS }
  if (contentType) h['Content-Type'] = contentType
  res.writeHead(status, h)
  res.end(body instanceof ArrayBuffer ? Buffer.from(body) : body)
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`)
  const path = url.pathname

  // Z/X/Y tile endpoint
  const match = path.match(/^\/(\d+)\/(\d+)\/(\d+)$/)
  if (match) {
    const z = parseInt(match[1], 10)
    const x = parseInt(match[2], 10)
    const y = parseInt(match[3], 10)

    try {
      const tile = await p.getZxy(z, x, y)

      if (tile) {
        res.setHeader('Content-Encoding', '')
        reply(res, 200, tile.data, 'application/x-protobuf')
      } else {
        reply(res, 204, Buffer.alloc(0))
      }
    } catch (err) {
      console.error(`Tile ${z}/${x}/${y} error:`, err)
      reply(res, 500, 'Internal error')
    }
    return
  }

  // TileJSON endpoint
  if (path === '/tiles.json' || path === '/') {
    try {
      const header = await getHeader()
      reply(res, 200, JSON.stringify({
        tilejson: '3.0.0',
        name: `OpenBoulderMap — climbing features`,
        tiles: [`http://localhost:${PORT}/{z}/{x}/{y}`],
        minzoom: header.minZoom,
        maxzoom: header.maxZoom,
        vector_layers: [
          { id: 'boulders', description: 'Boulder areas (polygons)' },
          { id: 'routes', description: 'Boulder routes (points)' }
        ]
      }, null, 2), 'application/json')
    } catch (err) {
      console.error('TileJSON error:', err)
      reply(res, 500, 'Internal error')
    }
    return
  }

  reply(res, 404, 'Not found')
})

server.listen(PORT, () => {
  console.log(`\n  🗺  Climbing tile server running at http://localhost:${PORT}\n`)
  console.log(`     Source URL for Maputnik: http://localhost:${PORT}/{z}/{x}/{y}\n`)
})
