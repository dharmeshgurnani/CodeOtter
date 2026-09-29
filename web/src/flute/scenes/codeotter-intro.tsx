import { Surface, useSceneTime } from '@webprodigies/flute'
import { useLayoutEffect, useRef } from 'react'
import { AppSidebar } from '@/app-sidebar'
import { SidebarProvider } from '@/components/animate-ui/components/radix/sidebar'
import { JsonReport, type ReportSection } from '@/components/json-report'
import { ReviewPage } from '@/review-page'
import demo from '../demo.json'
import mascot from '../../../../assets/banners/hero-score-card.png'
import './cinematic.css'

const noop = () => {}
const frame = (width: number, height: number) => ({ position: 'absolute' as const, width, height, left: (1920 - width) / 2, top: (1080 - height) / 2 })

function ReviewShot() {
  const time = useSceneTime()
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.scrollTop = Math.max(0, Math.min(1, (time - 14500) / 2500)) * 390
    const terminal = el.querySelectorAll('.overflow-y-auto')[1]
    if (terminal) terminal.scrollTop = Math.max(0, Math.min(1, (time - 18500) / 3000)) * 620
    el.querySelectorAll('details').forEach(details => { details.open = time >= 21000 && details.textContent?.startsWith('Pre-merge checks') === true })
  }, [time])
  return <main ref={ref} className="cinematic-review-scroll"><ReviewPage pr={demo.review.pr.url} repo="acme-robotics/fleet-api" force="" onDone={noop} /></main>
}

export default function CodeOtterIntro() {
  return <>
    <Surface id="intro" transform={{ x: -350 }} className="cinematic-title" style={frame(950, 650)}>
      <div className="eyebrow">YOUR CODE. YOUR MODELS. YOUR RULES.</div>
      <h1>Code<span>Otter</span></h1>
      <p>Know what you're merging.</p>
      <div className="title-rule" />
      <small>SELF-HOSTED AI CODE REVIEW</small>
    </Surface>
    <Surface id="mascot" transform={{ x: 530 }} style={frame(640, 700)}>
      <img className="cinematic-mascot" src={mascot} alt="CodeOtter mascot holding the quality score card" />
    </Surface>
    <Surface id="sidebar" transform={{ x: -660 }} style={frame(256, 820)}>
      <div className="cinematic-sidebar">
        <SidebarProvider defaultOpen className="!min-h-0 h-full">
          <AppSidebar repos={demo.repos} org="acme-robotics" setOrg={noop}
            route="/" openCounts={{ 'acme-robotics/fleet-api': 3, 'acme-robotics/dispatch-ui': 1 }}
            settingsPages={[{ id: 'model', title: 'Model provider', group: 'settings' }, { id: 'repos', title: 'Repositories', group: 'settings' }, { id: 'models', title: 'Local models', group: 'admin' }]}
            user={demo.user} signInAvailable={false} onLogin={noop} onLogout={noop} go={noop} />
        </SidebarProvider>
      </div>
    </Surface>
    <Surface id="dashboard" transform={{ x: 130 }} style={frame(1280, 820)}>
      <div className="cinematic-page">
        <header><b>CodeOtter</b><span>Home</span><em>FICTIONAL DEMO</em></header>
        <main><JsonReport sections={demo.home.sections as ReportSection[]} go={noop} /></main>
      </div>
    </Surface>
    <Surface id="review" style={frame(1540, 850)}>
      <div className="cinematic-page">
        <header><b>CodeOtter</b><span>Pull request review</span><em>FICTIONAL DEMO · @dharmeshgurnani</em></header>
        <ReviewShot />
      </div>
    </Surface>
    <Surface id="review-caption" transform={{ y: 475 }} className="cinematic-caption" style={frame(1500, 90)}>
      <span>02 / INSIDE THE CHANGE</span><h2>Scores. Findings. Merge gates.</h2>
    </Surface>
    <Surface id="outro" transform={{ x: -350 }} className="cinematic-title" style={frame(950, 650)}>
      <div className="eyebrow">REVIEW WITH CONTEXT</div>
      <h1>Code<span>Otter</span></h1>
      <p>Two engines. One informed decision.</p>
      <div className="title-rule" />
      <small>SELF-HOSTED · LOCAL MODELS OR YOUR OWN API</small>
      <div className="credit">Demo by Dharmesh Gurnani</div>
    </Surface>
  </>
}
