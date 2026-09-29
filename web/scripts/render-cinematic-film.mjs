import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'

const output=process.argv[2] || '.flute/exports/codeotter-cinematic-film-silent.mp4'
const root=resolve('.flute/exports'),target=resolve(output)
if(!target.startsWith(root+'/')&&!target.startsWith(root+'\\')) throw new Error('Keep exports inside web/.flute/exports.')
if(existsSync(target)) throw new Error('Output exists; choose a fresh filename.')
const job=resolve(root,`film-render-${Date.now()}`)
mkdirSync(job,{recursive:true})
const recipe=JSON.parse(readFileSync('src/flute/scenes/codeotter-cinematic-film.scene.json','utf8'))
const duration=recipe.definition.motion.durationMs,parts=4
if(duration%2000) throw new Error('Use a duration divisible by 2000 ms for four exact 60 fps parts.')
const outputs=Array.from({length:parts},(_,i)=>resolve(job,`part-${i+1}.mp4`))
function run(command,args,label){return new Promise((resolveJob,reject)=>{
  const child=spawn(command,args,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']})
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>process.stdout.write(`[${label}] ${b.toString()}`))
  child.on('error',reject)
  child.on('exit',code=>code===0?resolveJob():reject(new Error(`${label} exited ${code}`)))
})}
console.log('Rendering four contiguous sampling windows of the same Flute scene.')
const results=await Promise.allSettled(outputs.map((file,i)=>run(process.execPath,[
  'scripts/export-cinematic-film.mjs',relative(process.cwd(),file).replaceAll('\\','/'),String(i*duration/parts),String((i+1)*duration/parts),
],`Part ${i+1}/${parts}`)))
const failures=results.filter(r=>r.status==='rejected')
if(failures.length) throw new AggregateError(failures.map(r=>r.reason),'Render incomplete; no final video assembled.')
const list=resolve(job,'concat.txt')
writeFileSync(list,outputs.map(p=>`file '${p.replaceAll('\\','/')}'`).join('\n')+'\n')
await run('ffmpeg',['-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart','-n',target],'Assemble')
console.log(`Ready: ${target}. Concatenated without re-encoding.`)
