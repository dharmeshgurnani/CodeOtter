import { defineConfig } from 'vite'
import demo from './vite.cinematic.config.ts'

// Local, optimized render build. Normal vite build does not use this config.
export default defineConfig({
  ...demo,
  define: {...demo.define, 'import.meta.env.DEV': 'true'},
  build: {outDir: '.flute/render-site'},
  preview: {
    host:'127.0.0.1',port:5189,strictPort:true,
    headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:"},
  },
})
