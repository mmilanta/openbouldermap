// Resilient pmtiles:// protocol and source recovery.
//
// Two failure modes used to leave the climbing overlay empty until a reload:
//
// 1. pmtiles' SharedPromiseCache stores the archive-header promise *before* it
//    settles and never evicts it on rejection. One failed header request (a
//    flaky mobile connection, a CDN hiccup) therefore poisons every later tile
//    request for that archive.
// 2. MapLibre loads a source's TileJSON exactly once. If that fails, the source
//    stays empty for the whole session.
//
// `resilientProtocol` retries transient failures with a fresh archive instance;
// `recoverSourceOnFailure` re-requests the TileJSON once the network returns.

import type { Map as LibreMap, VectorTileSource } from 'maplibre-gl'
import type { Protocol } from 'pmtiles'

type Params = Parameters<Protocol['tilev4']>[0]
type Handler = (params: Params, abortController: AbortController) => ReturnType<Protocol['tilev4']>

export interface RetryOptions {
  /** Total attempts, including the first one. */
  attempts?: number
  /** Delay before the first retry; doubles on each further retry. */
  baseDelayMs?: number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

/** The archive URL (the protocol's instance key) of a TileJSON or tile request. */
export function archiveUrl(url: string): string {
  const rest = url.replace(/^pmtiles:\/\//, '')
  return rest.match(/^(.+)\/\d+\/\d+\/\d+(?:\.\w+)?$/)?.[1] ?? rest
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = () => { clearTimeout(timer); reject(signal.reason) }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Wrap `protocol.tilev4` so transient failures are retried from a clean cache. */
export function resilientProtocol(protocol: Protocol, options: RetryOptions = {}): Handler {
  const attempts = options.attempts ?? 4
  const baseDelayMs = options.baseDelayMs ?? 500
  const sleep = options.sleep ?? abortableSleep
  return async (params, abortController) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await protocol.tilev4(params, abortController)
      } catch (error) {
        // MapLibre aborts tiles that scrolled out of view; never retry those.
        if (abortController.signal.aborted || attempt >= attempts) throw error
        // Forget the (possibly poisoned) instance so the retry refetches the header.
        protocol.tiles.delete(archiveUrl(params.url))
        await sleep(baseDelayMs * 2 ** (attempt - 1), abortController.signal)
      }
    }
  }
}

/**
 * If a vector source's TileJSON fails to load even after protocol retries
 * (e.g. the device was offline), reload it when the browser comes back online
 * and on a capped exponential backoff, instead of staying empty until reload.
 */
export function recoverSourceOnFailure(map: LibreMap, sourceId: string, url: string): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let delay = 5000
  const failed = () => {
    const source = map.getSource(sourceId) as VectorTileSource | undefined
    return !!source && !source.tiles?.length
  }
  const reload = () => {
    clearTimeout(timer)
    timer = undefined
    const source = map.getSource(sourceId) as VectorTileSource | undefined
    if (source && failed()) source.setUrl(url)
  }
  map.on('error', event => {
    // Tile-level errors carry `tile`; a missing `tile` means the TileJSON failed.
    if ((event as { sourceId?: string }).sourceId !== sourceId || (event as { tile?: unknown }).tile) return
    if (!failed() || timer !== undefined) return
    timer = setTimeout(reload, delay)
    delay = Math.min(delay * 2, 60000)
  })
  map.on('sourcedata', event => {
    if (event.sourceId === sourceId && event.sourceDataType === 'metadata') delay = 5000
  })
  window.addEventListener('online', reload)
}
