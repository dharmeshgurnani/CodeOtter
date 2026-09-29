import { memo, useMemo, type ReactNode } from 'react'
import { Surface, useSceneTime, cinematicProgress } from '@webprodigies/flute'
import { AppSidebar } from '@/app-sidebar'
import { SidebarProvider } from '@/components/animate-ui/components/radix/sidebar'
import { JsonForm, type Section, type Values } from '@/components/json-form'
import { JsonReport, type ReportSection } from '@/components/json-report'
import { MarkdownView } from '@/components/markdown'
import { Ring } from '@/review-page'
import type { User } from '@/types'
import { GitPullRequest, Check, ShieldCheck, Cpu } from 'lucide-react'
import { GitHubMark } from '@/login-page'
import d from '../tour-demo.json'
import mascot from '../../../../assets/banners/hero-score-card.png'
import recipe from './codeotter-cinematic-film.scene.json'
import './cinematic-film.css'

const noop=()=>{}
const frame=(w:number,h:number)=>({position:'absolute' as const,left:(1920-w)/2,top:(1080-h)/2,width:w,height:h})
const visibleWindows=Object.fromEntries(recipe.definition.motion.tracks.filter(t=>t.property==='opacity').map(t=>{
  const first=t.keyframes.findIndex(k=>k.value>0)
  const last=t.keyframes.findLastIndex(k=>k.value>0)
  return [t.target.id!,[t.keyframes[Math.max(0,first-1)].timeMs-250,(t.keyframes[last+1]?.timeMs??74000)+250]]
}))
function Visible({id,children}:{id:string;children:ReactNode}){const time=useSceneTime(),[start,end]=visibleWindows[id];return time>=start&&time<=end?children:null}
function Layer({id,x=0,y=0,z=0,w,h,children,className=''}:{id:string;x?:number;y?:number;z?:number;w:number;h:number;children:ReactNode;className?:string}) {
  return <Surface id={id} transform={{x,y,z}} style={frame(w,h)} className={`film-layer ${className}`}><Visible id={id}>{children}</Visible></Surface>
}
const Form=memo(function Form({sections,values}:{sections:unknown;values:unknown}) {return <JsonForm sections={sections as Section[]} values={values as Values} saved={values as Values} busy="" onChange={noop} onAction={noop}/>})
const pages=d.board.settingsPages as {id:string;title:string;group:'admin'|'settings'}[]
function locationAt(t:number) {
  if(t<11000) return {route:'/',path:'Workspace / acme-robotics',title:'Your next review starts here.'}
  if(t<32000) return {route:'/review',path:'fleet-api / Pull request #482',title:t<21100?'Review the change. Know the risk.':t<26300?'Check the gates. Trace the change.':'Find the issue. See the fix.'}
  if(t<40000) return {route:'/settings/repos',path:'Settings / Repositories',title:'Your repository. Your rules.'}
  if(t<47700) return {route:'/settings/model',path:'Admin / Model provider',title:'Two engines. One review.'}
  if(t<58200) return {route:'/settings/models',path:'Admin / Local models',title:'Run the models on your machine.'}
  return {route:'/settings/oauth',path:'GitHub / Review workflow',title:'Bring the review back to GitHub.'}
}
function Deck(){const t=useSceneTime(),p=locationAt(t);return <div className="film-deck"><header><b>CodeOtter</b><span>{p.path}</span><small>DEMO · @dharmeshgurnani</small></header><div className="film-deck-footer"><span>CodeOtter AI Code Review Platform</span><span>Fictional data · Dharmesh Gurnani</span></div></div>}
function Sidebar(){const t=useSceneTime(),route=locationAt(t).route;return useMemo(()=><div className="film-sidebar"><SidebarProvider key={route} defaultOpen className="!min-h-0 h-full"><AppSidebar repos={d.repos} org="acme-robotics" setOrg={noop} route={route} openCounts={{'acme-robotics/fleet-api':2,'acme-robotics/dispatch-ui':1}} settingsPages={pages} user={d.user as User} signInAvailable={false} onLogin={noop} onLogout={noop} go={noop}/></SidebarProvider></div>,[route])}
function Brand({end=false}:{end?:boolean}) {return <div className="film-brand"><div className="film-kicker">{end?'YOUR CODE. YOUR MODELS. YOUR RULES.':'MEET YOUR NEXT CODE REVIEW.'}</div><h1>CodeOtter</h1><h2>AI Code Review Platform</h2><p>{end?'Review with context. Merge with confidence.':'Know what you’re merging.'}</p><div className="film-brand-bottom"><span>Self-hosted</span><i/><span>Local models or your own API</span></div><small>Dharmesh Gurnani</small></div>}
const stats=d.home.sections.find(s=>s.id==='stats')! as Extract<ReportSection,{kind:'stats'}>
function Stat({index}:{index:number}) {return <div className="film-stat"><JsonReport sections={[{...stats,items:[stats.items[index]]}]} go={noop}/></div>}
const metrics=[['Quality',88,false],['Blast radius',42,true],['Risk',25,true],['Tests',75,false],['Readability',92,false],['PR hygiene',84,false]] as const
function Score({index}:{index:number}) {const t=useSceneTime(),[label,value,invert]=metrics[index];const p=cinematicProgress(Math.max(0,Math.min(1,(t-12700-index*110)/1850)));return <div className="film-ring"><Ring label={label} value={Math.round(value*p)} invert={invert}/></div>}
function Pr(){return <div className="film-pr"><GitPullRequest size={35}/><div><h3>#482 Add rate limiting to telemetry ingest</h3><p>@dharmeshgurnani <span>·</span> 5 files <span>·</span> +197 −17 <span>·</span> AGENTS.md</p></div><span className="film-status"><Check size={19}/> Reviewed</span></div>}
const gateSections:ReportSection[]=[{id:'gates',kind:'table',title:'Pre-merge checks',columns:['Check','Result'],rows:d.review.gates.map(g=>[g.label,{text:g.pass?'Passed':'Warning',tone:g.pass?'ok':'warn'}])}]
const walkthrough:ReportSection[]=[{id:'files',kind:'table',title:'File walkthrough',columns:['File','Change'],rows:d.review.review.walkthrough.map(f=>[f.file,f.change])}]
const finding=d.review.review.findings[0]
const findingText=`### ${finding.title}\n\n**HIGH · ${finding.file}**\n\n${finding.detail}\n\n\`\`\`diff\n- const key = fleetId || req.socket.remoteAddress;\n+ if (!fleetId) return res.status(400).end();\n+ const key = fleetId;\n\`\`\``
const repoRule=d.settings.repos.values.repos.list[0].settings
const ruleSections=[{id:'rules',title:repoRule.title,fields:repoRule.fields}]
const ruleValues={rules:repoRule.values}
function Provider({kind}:{kind:'llm'|'s1'}) {const section=d.settings.model.sections.find(s=>s.id===kind)!;return <div className="film-panel film-provider"><div className="film-provider-icon">{kind==='llm'?<Cpu size={30}/>:<ShieldCheck size={30}/>}</div><div className="film-form-provider"><Form sections={[section]} values={d.settings.model.values}/></div><div className="film-panel-note">{kind==='llm'?'Summary · walkthrough · findings':'Rubric scores · yes/no gates'}</div></div>}
function LocalModels(){
  const time=useSceneTime(),values=structuredClone(d.models.values)
  const qwen=values.llm.list.find(m=>m.id==='qwen7')!
  const progress=Math.min(100,Math.max(0,Math.floor((time-50500)/38)))
  if(time>=50500){const ready=progress===100,active=time>=55100
    Object.assign(qwen,{badge:active?'Active':ready?'Downloaded':undefined,progress:ready?undefined:progress,meta:`Alibaba · 4700 MB · Apache-2.0 · 32768-token context${ready?'':` · downloading ${progress}%`}`,actions:active?[{id:'delete',label:'Delete',variant:'outline'}]:ready?[{id:'use',label:'Use'},{id:'delete',label:'Delete',variant:'outline'}]:[]})
    if(active) Object.assign(values.llm.list[0],{badge:'Downloaded',actions:[{id:'use',label:'Use'},{id:'delete',label:'Delete',variant:'outline'}]})
  }
  return <div className="film-panel film-local"><div className="film-local-inner"><Form sections={d.models.sections.filter(s=>['llm','s1'].includes(s.id))} values={values}/></div><small>Simulated download · no model is downloaded in this demo</small></div>
}
const oauth=d.settings.oauth.sections.map(s=>({...s,fields:s.fields.filter(f=>['status','provider','enabled','clientId'].includes(f.key))}))
const reviewSettings=d.settings.model.sections.find(s=>s.id==='review')!
const comments=[{...reviewSettings,description:undefined,fields:reviewSettings.fields.filter(f=>['postScores','postReview'].includes(f.key))}]
const comment=d.githubComment.split('#### Pre-merge checks')[0]+'\n\n[View full review details on CodeOtter →](https://codeotter.example.com)'

export default function CinematicFilm(){return <>
  <Layer id="film-title" x={-380} w={1000} h={650}><Brand/></Layer>
  <Layer id="film-mascot" x={565} z={60} w={730} h={850}><img className="film-mascot" src={mascot} alt="CodeOtter mascot"/></Layer>
  <Layer id="film-deck" x={145} y={20} z={-35} w={1510} h={930}><Deck/></Layer>
  <Layer id="film-sidebar" x={-785} y={20} w={300} h={930}><Sidebar/></Layer>
  {[0,1,2].map(i=><Layer key={i} id={`film-stat-${i}`} x={-310+i*445} y={-185} z={70} w={420} h={282}><Stat index={i}/></Layer>)}
  <Layer id="film-repositories" x={135} y={205} z={35} w={1340} h={340}><div className="film-panel film-home-table"><JsonReport sections={d.home.sections.filter(s=>s.id==='repos') as ReportSection[]} go={noop}/></div></Layer>
  <Layer id="film-pr" x={145} y={-280} z={70} w={1330} h={125}><Pr/></Layer>
  {metrics.map((_,i)=><Layer key={i} id={`film-score-${i}`} x={-265+i%3*410} y={-65+Math.floor(i/3)*285} z={110} w={260} h={260}><Score index={i}/></Layer>)}
  <Layer id="film-gates" x={-210} y={55} z={100} w={740} h={650}><div className="film-panel film-gates"><JsonReport sections={gateSections} go={noop}/></div></Layer>
  <Layer id="film-walkthrough" x={580} y={55} z={55} w={740} h={725}><div className="film-panel film-walkthrough"><JsonReport sections={walkthrough} go={noop}/></div></Layer>
  <Layer id="film-finding" x={340} y={80} z={230} w={1090} h={530}><div className="film-panel film-finding"><div className="film-finding-label"><span>Actionable finding</span><span>01 / 04</span></div><div className="film-finding-text"><MarkdownView content={findingText}/></div></div></Layer>
  <Layer id="film-repo-settings" x={145} y={30} z={35} w={1360} h={710}><div className="film-panel film-repo-settings"><Form sections={d.settings.repos.sections} values={d.settings.repos.values}/></div></Layer>
  <Layer id="film-rules" x={155} y={40} z={220} w={1100} h={530}><div className="film-panel film-rules"><div className="film-rules-icon"><ShieldCheck size={30}/><span>Repository review guidelines</span></div><div className="film-rules-form"><Form sections={ruleSections} values={ruleValues}/></div></div></Layer>
  <Layer id="film-llm" x={-310} y={25} z={100} w={850} h={650}><Provider kind="llm"/></Layer>
  <Layer id="film-s1" x={600} y={25} z={100} w={850} h={650}><Provider kind="s1"/></Layer>
  <Layer id="film-local" x={160} y={310} z={90} w={1430} h={1120}><LocalModels/></Layer>
  <Layer id="film-oauth" x={-160} z={100} w={1110} h={740}><div className="film-panel film-oauth"><div className="film-github-label"><GitHubMark/><span>GitHub OAuth</span></div><div className="film-oauth-form"><Form sections={oauth} values={d.settings.oauth.values}/></div></div></Layer>
  <Layer id="film-comment-options" x={-500} y={10} z={80} w={610} h={590}><div className="film-panel film-comment-options"><div><Form sections={comments} values={d.settings.model.values}/></div></div></Layer>
  <Layer id="film-comment" x={530} y={25} z={130} w={1000} h={750}><div className="film-panel film-comment"><div className="film-github-label"><GitHubMark/><span>PR #482 · @dharmeshgurnani</span><small>COMMENT PREVIEW</small></div><div className="film-comment-body"><MarkdownView content={comment}/></div></div></Layer>
  <Layer id="film-end-title" x={-380} w={1000} h={650}><Brand end/></Layer>
  <Layer id="film-end-mascot" x={565} z={60} w={730} h={850}><img className="film-mascot" src={mascot} alt="CodeOtter mascot"/></Layer>
  </>}
