import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The backend runs on port 8000. We proxy /api to it so the browser only ever
// talks to ONE origin (this is what makes the app work both locally and behind
// a preview URL, and it also sidesteps all CORS problems).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,          // allow *.e2b.app preview hosts
    strictPort: false,
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND || 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
  },
})
