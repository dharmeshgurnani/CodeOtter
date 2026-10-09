import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { attachTerminalIcon, faviconSixel } from '../bin/terminal-icon.mjs';

const source = readFileSync(new URL('../web/public/favicon.svg', import.meta.url));
const asset = JSON.parse(readFileSync(new URL('../bin/assets/favicon.json', import.meta.url)));
assert.equal(asset.sha256, createHash('sha256').update(source).digest('hex'), 'Rebuild the icon after changing favicon.svg');
assert(faviconSixel(48).startsWith('\x1bP0;1;0q"1;1;48;48'));
assert(faviconSixel(48).endsWith('\x1b\\'));

const previous = process.env.CODEOTTER_IMAGE;
delete process.env.CODEOTTER_IMAGE;
try {
  const screen = new EventEmitter();
  let output = '';
  screen.program = new EventEmitter();
  screen.program.flush = () => {};
  screen.program.output = { isTTY: true, write: text => { output += text; } };
  Object.assign(screen, { width: 100, height: 30, children: [], render: () => screen.emit('render') });
  const fallback = { hidden: false, hide() { this.hidden = true; }, show() { this.hidden = false; } };
  attachTerminalIcon(screen, fallback);
  screen.program.emit('data', '\x1b[?62;1;2c\x1b[6;16;8t');
  assert.equal(fallback.hidden, false, 'Unsupported terminals retain the emoji');
  assert(!output.includes('\x1bP'));
  screen.emit('resize');
  screen.program.emit('data', '\x1b[?65;1;');
  screen.program.emit('data', '4c\x1b[6;16;8t');
  assert.equal(fallback.hidden, true);
  assert(output.includes('\x1b[1;3H' + faviconSixel(48)));
  output = '';
  screen.emit('resize');
  screen.program.emit('data', '\x1b[?65;4c\x1b[6;20;10t');
  assert(output.includes(faviconSixel(60)), 'Resize follows terminal cell dimensions');
  screen.emit('destroy');
  assert.equal(screen.program.listenerCount('data'), 0);
  assert.equal(screen.listenerCount('render'), 0);
  assert.equal(screen.listenerCount('resize'), 0);
} finally {
  if (previous === undefined) delete process.env.CODEOTTER_IMAGE;
  else process.env.CODEOTTER_IMAGE = previous;
}
console.log('Terminal icon tests passed: source, capability negotiation, sizing, fallback and cleanup.');
