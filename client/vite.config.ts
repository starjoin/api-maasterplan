import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/admin': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/docs': 'http://localhost:3000',
      '/openapi.json': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
