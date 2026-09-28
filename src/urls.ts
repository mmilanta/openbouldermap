// URL helpers for untrusted OSM tag values.

/** Accept only http(s) URLs; a bare domain such as `example.com/x` gets https. */
export function safeExternalUrl(value: string | undefined): string | undefined {
  const raw = value?.trim()
  if (!raw) return undefined
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : /^[\w-]+(\.[\w-]+)+([/?#]|$)/.test(raw) ? `https://${raw}` : undefined
  if (!candidate) return undefined
  try {
    const url = new URL(candidate)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}
