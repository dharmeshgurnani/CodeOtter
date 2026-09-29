import { Surface, useSceneTime } from '@webprodigies/flute'
import { JsonForm, type Section, type Values } from '@/components/json-form'
import { JsonReport, type ReportSection } from '@/components/json-report'
import { MarkdownView } from '@/components/markdown'
import { Ring } from '@/review-page'
import data from '../tour-demo.json'
import mascot from '../../../../assets/banners/hero-score-card.png'
import './product-tour.css'

const noop = () => {}
const chapters = [
  { id: 'intro', title: 'CodeOtter', route: 'Self-hosted AI code review', seconds: 3 },
  { id: 'dashboard', title: 'Your repositories, at a glance.', route: 'Home / acme-robotics', seconds: 5 },
  { id: 'repos', title: 'Connect your GitHub repositories.', route: 'Settings / Repositories', seconds: 5 },
  { id: 'rules', title: 'Your repository. Your review rules.', route: 'Settings / Repositories / fleet-api', seconds: 6 },
  { id: 'oauth', title: 'Sign in with GitHub.', route: 'Admin / OAuth', seconds: 5 },
  { id: 'llm', title: 'Choose the model that writes the review.', route: 'Admin / Model provider / Language model', seconds: 5 },
  { id: 's1', title: 'Give scores and gates their own engine.', route: 'Admin / Model provider / System One', seconds: 5 },
  { id: 'local', title: 'Run the language model locally.', route: 'Admin / Local models / Language models', seconds: 5 },
  { id: 'download', title: 'Download a model when you need it.', route: 'Admin / Local models / Qwen2.5-Coder 7B', seconds: 6 },
  { id: 'active', title: 'Downloaded. Selected. Ready.', route: 'Admin / Local models / Language models', seconds: 3 },
  { id: 'local-s1', title: 'Local scoring models, too.', route: 'Admin / Local models / System One models', seconds: 5 },
  { id: 'context', title: 'Start with the pull request.', route: 'acme-robotics / fleet-api / Pull request #482', seconds: 5 },
  { id: 'scores', title: 'Six scores. A clearer review.', route: 'Review / Scores & merge gates', seconds: 6 },
  { id: 'gates', title: 'Check the policy before you merge.', route: 'Review / Pre-merge checks', seconds: 6 },
  { id: 'walkthrough', title: 'Understand what changed.', route: 'Review / File walkthrough', seconds: 6 },
  { id: 'findings', title: 'Find the issue. See the fix.', route: 'Review / Actionable findings', seconds: 7 },
  { id: 'comments', title: 'Bring the review back to GitHub.', route: 'Admin / Model provider / Review', seconds: 6 },
  { id: 'github', title: 'Scores on the pull request.', route: 'GitHub PR comment / Generated from fictional data', seconds: 7 },
  { id: 'outro', title: 'CodeOtter', route: 'Your code. Your models. Your rules.', seconds: 3 },
] as const
export const durationMs = chapters.reduce((sum, c) => sum + c.seconds * 1000, 0)

function Form({ sections, values }: { sections: unknown; values: unknown }) {
  return <JsonForm sections={sections as Section[]} values={values as Values} saved={values as Values} busy="" onChange={noop} onAction={noop} />
}
function Settings({ page, section }: { page: 'model' | 'repos' | 'oauth'; section?: string }) {
  const d = data.settings[page]
  return <Form sections={d.sections.filter(s => !section || s.id === section)} values={d.values} />
}
function Models({ kind, progress, active }: { kind: 'llm' | 's1'; progress?: number; active?: boolean }) {
  const modelData = structuredClone(data.models)
  const rows = modelData.values.llm.list
  if (progress !== undefined || active) {
    const qwen = rows.find(r => r.id === 'qwen7')!
    const ready = active || progress === 100
    Object.assign(qwen, {
      badge: active ? 'Active' : ready ? 'Downloaded' : undefined,
      progress: ready ? undefined : progress,
      meta: `Alibaba · 4700 MB · Apache-2.0 · 32768-token context${ready ? '' : ` · downloading ${progress}%`}`,
      actions: active ? [{ id: 'delete', label: 'Delete', variant: 'outline' }] : ready ? [{ id: 'use', label: 'Use' }, { id: 'delete', label: 'Delete', variant: 'outline' }] : [],
    })
    if (active) { rows[0].badge = 'Downloaded'; rows[0].actions.unshift({ id: 'use', label: 'Use', variant: 'default' }) }
  }
  return <Form sections={modelData.sections.filter(s => s.id === kind)} values={modelData.values} />
}
function Scores() {
  const s = data.review.review.scores
  return <div className="tour-score-grid">
    <Ring label="Quality" value={s.quality} /><Ring label="Blast radius" value={data.review.blast.score} invert />
    <Ring label="Risk" value={s.correctness_risk} invert /><Ring label="Tests" value={s.test_coverage} />
    <Ring label="Readability" value={s.readability} /><Ring label="PR hygiene" value={s.pr_hygiene} />
  </div>
}
function Shot({ id, elapsed }: { id: string; elapsed: number }) {
  if (id === 'intro' || id === 'outro') return <div className="tour-identity"><div><h1>CodeOtter</h1><p>{id === 'intro' ? 'Know what you’re merging.' : 'Your code. Your models. Your rules.'}</p><span>Self-hosted AI code review</span><small>Dharmesh Gurnani</small></div><img src={mascot} alt="CodeOtter mascot" /></div>
  if (id === 'dashboard') return <div className="tour-ui scale-dashboard"><JsonReport sections={data.home.sections.filter(s => ['stats', 'repos'].includes(s.id)) as ReportSection[]} go={noop} /></div>
  if (id === 'repos') return <div className="tour-ui scale-form"><Settings page="repos" /></div>
  if (id === 'rules') { const s = data.settings.repos.values.repos.list[0].settings; return <div className="tour-ui scale-form"><Form sections={[{id:'rules',title:s.title,fields:s.fields}]} values={{rules:s.values}} /></div> }
  if (id === 'oauth') return <div className="tour-ui scale-oauth"><Settings page="oauth" /></div>
  if (id === 'llm' || id === 's1') return <div className="tour-ui scale-provider"><Settings page="model" section={id} /><div className="tour-model-note">{id === 'llm' ? 'Summary · walkthrough · findings' : 'Rubric scores · yes/no merge gates'}</div></div>
  if (id === 'local' || id === 'local-s1' || id === 'download' || id === 'active') return <div className="tour-ui scale-models"><Models kind={id === 'local-s1' ? 's1' : 'llm'} progress={id === 'download' ? elapsed < 500 ? undefined : Math.min(100, Math.floor((elapsed - 500) / 40)) : undefined} active={id === 'active'} /><div className="tour-model-note">{id === 'download' ? 'Simulated download · fictional demo' : 'Models download only when you choose Download.'}</div></div>
  if (id === 'context') return <div className="tour-ui scale-context"><JsonReport sections={[{id:'pr',kind:'table',title:'#482 Add rate limiting to telemetry ingest',columns:['Pull request','Details'],rows:[['Repository','acme-robotics/fleet-api'],['Author','dharmeshgurnani'],['Branch','feat/ingest-rate-limit → main'],['Changes','5 files · +197 −17'],['Repository guidelines','AGENTS.md'],['Commits','d3a0482 · Dharmesh Gurnani']]}]} go={noop} /><MarkdownView content={data.review.pr.body} /></div>
  if (id === 'scores') return <><Scores /><div className="tour-score-note">System One: Laya typed-decisions · fictional scores</div></>
  if (id === 'gates') return <div className="tour-ui scale-gates"><JsonReport sections={[{id:'gates',kind:'table',title:'Pre-merge checks',columns:['Check','Status','Model answer'],rows:data.review.gates.map(g=>[g.label,{text:g.pass?'Passed':'Warning',tone:g.pass?'ok':'warn'},`${Math.round(g.yes*100)}% yes`])}]} go={noop} /></div>
  if (id === 'walkthrough') return <div className="tour-ui scale-walkthrough"><JsonReport sections={[{id:'walkthrough',kind:'table',title:'5 files changed',columns:['File','Change'],rows:data.review.review.walkthrough.map(w=>[w.file,w.change])}]} go={noop} /></div>
  if (id === 'findings') return <div className="tour-ui scale-findings"><MarkdownView content={data.review.review.findings.slice(0,2).map((f,i)=>`### ${i+1}. ${f.title}\n\n**${f.severity.toUpperCase()} · ${f.file}**\n\n${f.detail}`).join('\n\n---\n\n')} /></div>
  if (id === 'comments') return <div className="tour-ui scale-form"><Form sections={[{...data.settings.model.sections.find(s=>s.id==='review')!,fields:data.settings.model.sections.find(s=>s.id==='review')!.fields.filter(f=>['postScores','postReview'].includes(f.key))}]} values={data.settings.model.values} /><div className="tour-model-note">Per-repository overrides are available in Settings / Repositories.</div></div>
  if (id === 'github') return <div className="tour-ui scale-github"><div className="tour-comment-author">dharmeshgurnani · fictional PR #482</div><MarkdownView content={data.githubComment.split('#### Pre-merge checks')[0]+'\n\n[View full review details on CodeOtter →](https://codeotter.example.com)'} /></div>
  return null
}
function Tour() {
  const time = useSceneTime()
  let start = 0, index = chapters.length - 1
  for (let i = 0; i < chapters.length; i++) { if (time < start + chapters[i].seconds * 1000) { index = i; break } start += chapters[i].seconds * 1000 }
  const chapter = chapters[index], identity = chapter.id === 'intro' || chapter.id === 'outro'
  return <div className="product-tour" data-tour-chapter={chapter.id}>
    {!identity && <><div className="tour-top"><b>CodeOtter</b><span>{chapter.route}</span><small>FICTIONAL DEMO · @dharmeshgurnani</small></div><h1 className="tour-heading">{chapter.title}</h1></>}
    <div className={`tour-body ${identity ? 'identity-body' : ''}`}><Shot id={chapter.id} elapsed={Math.max(0,time-start)} /></div>
    <footer><span>{identity ? 'CODEOTTER' : chapter.route}</span><span>{String(index+1).padStart(2,'0')} / {chapters.length}</span></footer>
    <div className="tour-progress" style={{width:`${Math.min(100,time/durationMs*100)}%`}} />
  </div>
}
export default function ProductTour() { return <Surface id="product-tour" style={{width:1920,height:1080}}><Tour /></Surface> }
