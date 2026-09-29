// Use Flute's canonical offline renderer with an installed browser when its
// bundled Chromium is unavailable. Browser review stays in the shared preview.
import { createRequire } from 'node:module'
import { existsSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const cli = realpathSync(resolve('node_modules/@webprodigies/flute/dist/cli/flute.js'))
const requireFlute = createRequire(cli)
const { chromium } = requireFlute('playwright')
const executablePath = process.env.CODEOTTER_RENDER_BROWSER || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync)
if (executablePath) {
  const launch = chromium.launch.bind(chromium)
  chromium.launch = options => launch({ ...options, channel: undefined, executablePath })
}
const output = process.argv[2] || '.flute/exports/codeotter-product-tour-silent.mp4'
process.argv = [process.argv[0], cli, 'export',
  '--url', 'http://127.0.0.1:5188/?flute-preview=1&flute-scene=codeotter-product-tour',
  '--output', output, '--fps', '30', '--width', '1920', '--height', '1080']
await import(pathToFileURL(cli).href)
