import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiPort = process.env.API_PORT || process.env.PORT || '3000'
const apiOrigin = `http://localhost:${apiPort}`

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/admin': apiOrigin,
      '/api': apiOrigin,
      '/health': apiOrigin,
      '/docs': apiOrigin,
      '/openapi.json': apiOrigin,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
