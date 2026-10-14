import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/error-boundary'
import { Toaster } from 'sonner'

const root = createRoot(document.getElementById('root')!)

// The cinematic server is isolated from the live API; ordinary dev/build never imports it.
if (import.meta.env.DEV && import.meta.env.VITE_CINEMATIC_DEMO === '1') {
  import('./flute/CinematicPreview').then(({ CinematicPreview }) => root.render(<CinematicPreview />))
} else root.render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <Toaster richColors position="top-right" />
    </ErrorBoundary>
  </StrictMode>,
)
