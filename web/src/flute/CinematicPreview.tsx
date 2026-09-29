import { ProjectPreview } from '@webprodigies/flute/preview'
import App from '@/App'

const sceneModules = import.meta.glob('/src/flute/scenes/*.{scene.json,tsx}')

export function CinematicPreview() {
  if (new URLSearchParams(location.search).has('inspect')) return <App />
  return <ProjectPreview projectId="codeotter-demo" enabled active sceneModules={sceneModules} hot={import.meta.hot} />
}
