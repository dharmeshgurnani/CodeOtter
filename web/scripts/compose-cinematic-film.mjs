import { writeFileSync, renameSync } from 'node:fs'
import { matrixFor, reviewAuthoring } from '@webprodigies/flute'

// Camera positions are derived from Flute's own rotation matrix. Equal-angle
// endpoints describe rails across the app plane, not arbitrary screen pans.
const duration = 74000, perspective = 2400
const nodes = [], tracks = []
const key = (timeMs, value, easing = 'cinematic') => ({ timeMs, value, easing })
function track(id, property, pairs) {
  tracks.push({target: id === 'camera' ? {kind:'camera'} : {kind:'surface',id},property,keyframes:pairs.filter((p,i,a)=>i===0||p[0]>a[i-1][0]).map(p=>key(...p))})
}
function leaf(id, x, y, z, start, end, {delay=0, lift=160, drift=70}={}) {
  nodes.push({id,transform:{x,y,z}})
  const s=start+delay, settle=s+1250, leave=end-300
  track(id,'opacity',[[0,0],[s,0],[s+180,1],[leave,1],[end,0],[duration,0]].filter((v,i,a)=>i===0||v[0]>a[i-1][0]))
  track(id,'z',[[0,z+lift],[s,z+lift],[settle,z],[leave,z],[end,z-180]])
  track(id,'y',[[0,y+drift],[s,y+drift],[settle,y],[leave,y],[end,y-40]])
}
function pose(t, target, zoom, angles) {
  const [rotateX,rotateY,rotateZ]=angles
  const m=matrixFor({x:0,y:0,z:0,rotateX,rotateY,rotateZ,scale:1})
  const p=[0,1,2].map(row=>m[row*4]*target[0]+m[row*4+1]*target[1]+m[row*4+2]*target[2])
  return {t,x:p[0],y:p[1],z:p[2]+perspective/zoom-perspective,rotateX,rotateY,rotateZ}
}
const camera=[
  pose(0,[0,0,0],1.04,[0,-5,0]),
  pose(2700,[30,0,0],1,[0,0,0]),
  pose(5200,[-230,-90,40],1.18,[10,-19,-3]),
  pose(10200,[100,65,40],1.12,[10,-19,-3]),
  pose(13000,[140,-65,80],1.10,[8,16,2]),
  pose(20300,[210,80,80],1.18,[8,16,2]),
  pose(23100,[40,15,100],1.06,[8,-13,-2]),
  pose(25600,[155,55,100],1.09,[8,-13,-2]),
  pose(28200,[330,75,210],1.35,[-7,14,2]),
  pose(31500,[350,130,210],1.30,[-7,14,2]),
  pose(34200,[90,0,40],1.15,[10,-17,-3]),
  pose(37800,[155,30,190],1.20,[10,-17,-3]),
  pose(39800,[180,45,190],1.16,[10,-17,-3]),
  pose(42200,[-220,20,100],1.18,[-7,18,2]),
  pose(46900,[460,30,100],1.18,[-7,18,2]),
  pose(49700,[165,20,90],1.14,[9,-12,-2]),
  pose(55000,[220,40,90],1.18,[9,-12,-2]),
  pose(57400,[200,480,90],1.22,[9,-12,-2]),
  pose(59600,[-180,0,100],1.16,[-6,15,2]),
  pose(63400,[200,25,120],1.05,[-6,15,2]),
  pose(67600,[460,40,120],1.22,[-6,15,2]),
  pose(70900,[0,0,0],1,[0,0,0]),
  pose(duration,[0,0,0],1.04,[0,-3,0]),
]
for(const prop of ['x','y','z','rotateX','rotateY','rotateZ']) track('camera',prop,camera.map(p=>[p.t,p[prop]]))

leaf('film-title',-380,0,0,0,4100,{lift:-80,drift:24})
leaf('film-mascot',565,0,60,100,4400,{lift:-100,drift:55})
leaf('film-deck',145,20,-35,3100,69800,{lift:-180,drift:180})
leaf('film-sidebar',-785,20,0,3400,69400,{lift:160,drift:110})
for(let i=0;i<3;i++) leaf(`film-stat-${i}`,-310+i*445,-185,70,3700,11700,{delay:i*150,lift:260-i*50,drift:80})
leaf('film-repositories',135,205,35,4050,11800,{lift:140,drift:130})
leaf('film-pr',145,-280,70,11100,22000,{lift:70,drift:35})
for(let i=0;i<6;i++) leaf(`film-score-${i}`,-265+i%3*410,-65+Math.floor(i/3)*285,110,11800,22000,{delay:i*95,lift:230-i*20,drift:85})
leaf('film-gates',-210,55,100,21100,27300,{lift:130,drift:90})
leaf('film-walkthrough',580,55,55,21500,28900,{lift:40,drift:90})
leaf('film-finding',340,80,230,26100,32700,{lift:160,drift:100})
leaf('film-repo-settings',145,30,35,32100,40200,{lift:50,drift:100})
leaf('film-rules',155,40,220,35200,40500,{lift:250,drift:150})
leaf('film-llm',-310,25,100,40000,48100,{lift:120,drift:70})
leaf('film-s1',600,25,100,40300,48300,{lift:200,drift:120})
leaf('film-local',160,310,90,47600,58700,{lift:70,drift:100})
leaf('film-oauth',-160,0,100,58100,62400,{lift:150,drift:80})
leaf('film-comment-options',-500,10,80,61500,68900,{lift:80,drift:90})
leaf('film-comment',530,25,130,61900,69600,{lift:220,drift:100})
leaf('film-end-title',-380,0,0,69000,75500,{lift:-50,drift:25})
leaf('film-end-mascot',565,0,60,69200,75500,{lift:-60,drift:55})
// Last shot holds to the final frame, rather than fading to blank white.
for(const t of tracks.filter(t=>['film-end-title','film-end-mascot'].includes(t.target.id))) t.keyframes=t.keyframes.filter(k=>k.timeMs<=duration)

const definition={width:1920,height:1080,scene:{version:3,camera:{perspective},focus:{distance:2400,fStop:22,focalLength:45,maxBlur:0},nodes},motion:{durationMs:duration,speed:1,tracks}}
const qa=reviewAuthoring({scene:definition.scene,motion:definition.motion})
if(!qa.valid) throw new Error(JSON.stringify(qa.issues))
const recipe={version:1,id:'codeotter-cinematic-film',title:'CodeOtter — AI Code Review Platform',description:'74-second cinematic product film. Live UI surfaces, camera rails, layered reveals. Fictional data. Silent.',definition}
const destination='src/flute/scenes/codeotter-cinematic-film.scene.json'
writeFileSync(destination+'.new',JSON.stringify(recipe,null,2)+'\n');renameSync(destination+'.new',destination)
console.log(`Composed ${nodes.length} surfaces and ${tracks.length} Flute tracks. ${duration/1000}s.`)
