import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: false,
  build: {
    outDir: 'native-dist/renderer',
    rollupOptions: { input: 'desktop.html' },
  },
})
