import { defineConfig } from 'vite'

export default defineConfig({
  // Custom domain (openbouldermap.org) serves this project site at the root.
  base: '/',
  server: {
    port: 5173,
    // serve the tiles/ and data/ folders so the browser can fetch the PMTiles archive
    fs: { strict: false }
  },
  build: { target: 'es2020', sourcemap: true }
})
