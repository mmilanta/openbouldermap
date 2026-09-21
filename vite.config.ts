import { defineConfig, type Plugin } from 'vite'

// In production (GitHub Pages) `/wiki/` is served from `public/wiki/index.html`
// via the directory index. Vite's dev server would instead hand `/wiki/` to the
// SPA fallback and show the map, so rewrite the bare wiki URLs to its index.
function wikiDirectoryIndex(): Plugin {
  return {
    name: 'wiki-directory-index',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const request = req as { url?: string }
        const [path, query] = (request.url ?? '').split('?')
        if (path === '/wiki' || path === '/wiki/') {
          request.url = '/wiki/index.html' + (query ? `?${query}` : '')
        }
        next()
      })
    }
  }
}

export default defineConfig({
  // Custom domain (openbouldermap.org) serves this project site at the root.
  base: '/',
  plugins: [wikiDirectoryIndex()],
  server: {
    port: 5173,
    // serve the tiles/ and data/ folders so the browser can fetch the PMTiles archive
    fs: { strict: false }
  },
  build: { target: 'es2020', sourcemap: true }
})
