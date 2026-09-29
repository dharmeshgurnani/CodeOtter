import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const root = createRoot(document.getElementById('root')!)

// The cinematic server is isolated from the live API; ordinary dev/build never imports it.
if (import.meta.env.DEV && import.meta.env.VITE_CINEMATIC_DEMO === '1') {
  import('./flute/CinematicPreview').then(({ CinematicPreview }) => root.render(<CinematicPreview />))
} else root.render(
  <StrictMode>
    <App />
  </StrictMode>,
)
