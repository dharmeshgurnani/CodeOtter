import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import blessed from 'blessed';
import { fitDiffOutput } from '../tui/diff-viewer.mjs';

const code = '+  ' + 'long_code_'.repeat(20) + '界';
const input = `\x1b[31m  11   12 │ ${code}\x1b[0m\x1b[0K`;
for (const width of [40, 76, 120]) {
  const output = fitDiffOutput(input, width);
  assert(!output.includes('[0K'));
  const lines = stripVTControlCharacters(output).split('\n');
  assert(lines.length > 1);
  assert(lines[0].startsWith('  11   12 │ '));
  for (const line of lines.slice(1)) assert(line.startsWith('          │ '), 'Continuation keeps the number gutter empty');
  for (const line of lines) assert(blessed.unicode.strWidth(line) <= width);
  assert.equal(lines.map(line => line.slice(12)).join(''), code, 'Wrapping preserves source whitespace and characters');
}
console.log('Diff layout tests passed: preserved gutters, Unicode width, source text and erase-code cleanup.');
