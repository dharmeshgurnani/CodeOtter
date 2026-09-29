// Flute remains the renderer: this only selects the installed browser and a
// higher-quality H.264 encoding profile for moving UI text.
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { existsSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const cli=realpathSync(resolve('node_modules/@webprodigies/flute/dist/cli/flute.js'))
const requireFlute=createRequire(cli)
const {chromium}=requireFlute('playwright')
const executablePath=process.env.CODEOTTER_RENDER_BROWSER || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync)
const from=Number(process.argv[3] || 0),to=Number(process.argv[4] || 0)
const launch=chromium.launch.bind(chromium)
chromium.launch=async options=>{
  const browser=await launch(executablePath?{...options,channel:undefined,executablePath}:options)
  if(to>from){
    // Sample a window of the same canonical clock. No motion curves change,
    // and there is still exactly one Flute capture bridge in each renderer.
    const newPage=browser.newPage.bind(browser)
    browser.newPage=async options=>{
      const page=await newPage(options),goto=page.goto.bind(page)
      page.goto=async(...args)=>{
        const response=await goto(...args)
        await page.waitForFunction(()=>typeof window.__FLUTE_CAPTURE__?.seek==='function')
        await page.evaluate(({from,to})=>{
          const bridge=window.__FLUTE_CAPTURE__,seek=bridge.seek
          bridge.durationMs=to-from
          bridge.seek=elapsed=>seek(from+elapsed)
        },{from,to})
        return response
      }
      return page
    }
  }
  return browser
}
const childProcess=requireFlute('node:child_process'),spawn=childProcess.spawn
childProcess.spawn=(command,args,options)=>{
  if(command==='ffmpeg' && args.includes('libx264')){
    args=[...args];args.splice(args.indexOf('libx264')+1,0,'-crf','17','-preset','fast')
  }
  return spawn(command,args,options)
}
syncBuiltinESMExports()
// Complex 3D DOM captures can exceed Flute's default 15-minute encoder timer.
// Give only that render watchdog more time; do not alter animation timing.
const schedule=globalThis.setTimeout
globalThis.setTimeout=(callback,ms,...args)=>schedule(callback,ms===15*60000?45*60000:ms,...args)
const output=process.argv[2] || '.flute/exports/codeotter-cinematic-film-silent.mp4'
process.argv=[process.argv[0],cli,'export',
  '--url','http://127.0.0.1:5189/?flute-preview=1&flute-scene=codeotter-cinematic-film',
  '--output',output,'--fps','60','--width','1920','--height','1080']
await import(pathToFileURL(cli).href)
