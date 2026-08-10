import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // rutas relativas: permite servir el sitio desde una subcarpeta
  // (por ejemplo GitHub Pages en /paolo-saxton-login/)
  base: './',
  server: {
    port: 5173,
  },
})
