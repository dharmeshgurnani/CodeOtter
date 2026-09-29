import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import demo from './src/flute/demo.json' with { type: 'json' }
import tour from './src/flute/tour-demo.json' with { type: 'json' }

// Deliberately independent of vite.config.ts: no proxy, credentials, storage or live API.
export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: 'cinematic-fictional-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:5188; media-src 'self' blob:")
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (!url.pathname.startsWith('/api/')) return next()
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        if (req.method !== 'GET') {
          res.statusCode = 405
          return res.end(JSON.stringify({ error: 'Read-only fictional demo' }))
        }
        if (url.pathname === '/api/me') return res.end(JSON.stringify({user:tour.user,signInAvailable:true}))
        if (url.pathname === '/api/reviews') return res.end(JSON.stringify(tour.board))
        if (url.pathname === '/api/home') return res.end(JSON.stringify(tour.home))
        if (url.pathname === '/api/login') return res.end(JSON.stringify(tour.login))
        if (url.pathname === '/api/settings/models') return res.end(JSON.stringify(tour.models))
        const page = url.pathname.match(/^\/api\/settings\/(model|repos|oauth)$/)?.[1]
        if (page) return res.end(JSON.stringify(tour.settings[page as keyof typeof tour.settings]))
        if (url.pathname === '/api/score' && url.searchParams.get('pr') === demo.review.pr.url) {
          return res.end(JSON.stringify(tour.review))
        }
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'Not in the fictional demo' }))
      })
    },
  }],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  define: { 'import.meta.env.VITE_CINEMATIC_DEMO': JSON.stringify('1') },
  server: { host: '127.0.0.1', port: 5188, strictPort: true },
})
