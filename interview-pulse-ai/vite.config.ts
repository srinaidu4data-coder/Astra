import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // '/' for Cloudflare Pages website; './' only for Electron file:// builds
  base: process.env.VITE_ELECTRON === '1' ? './' : '/',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Same-origin proxy so Job Search / auth never "Failed to fetch" on localhost
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/v1': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8787',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Jobs hub + pdf.js are intentionally large; main app chunk stays lean via lazy routes.
    chunkSizeWarningLimit: 1200,
  },
})
