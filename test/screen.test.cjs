const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TerminalScreen } = require('../out/terminalScreen');
const { ESC, approval, frame } = require('./helpers.cjs');

test('cursor movement overwrites cells instead of appending history', () => {
  const screen = new TerminalScreen();
  screen.write('hello world\r' + ESC + '[2Knew\r\nnext');
  assert.deepEqual(screen.snapshot().lines, ['new', 'next']);
  screen.write(ESC + '[1A\r' + ESC + '[2Kchanged');
  assert.deepEqual(screen.snapshot().lines, ['changed', 'next']);
});
test('absolute positions and erase-to-end handle differential frames', () => {
  const screen = new TerminalScreen();
  screen.write('abcdefgh' + ESC + '[1;4H' + ESC + '[KXYZ');
  assert.deepEqual(screen.snapshot().lines, ['abcXYZ']);
  screen.write(ESC + '[1;2H' + ESC + '[J');
  assert.deepEqual(screen.snapshot().lines, ['a']);
});
test('split OSC and DCS strings are discarded', () => {
  const screen = new TerminalScreen();
  screen.write(ESC + ']0;window title');
  assert.equal(screen.snapshot().complete, false);
  screen.write(ESC);
  screen.write('\\visible' + ESC + 'Pignored');
  screen.write(ESC + '\\ end');
  assert.deepEqual(screen.snapshot().lines, ['visible end']);
});
test('alternate screen restores the previous screen without retaining its card', () => {
  const screen = new TerminalScreen();
  screen.write('shell prompt');
  screen.write(ESC + '[?1049h' + frame(approval()));
  assert.ok(screen.snapshot().lines.join('\n').includes('Yes, proceed'));
  screen.write(ESC + '[?1049l');
  assert.deepEqual(screen.snapshot().lines, ['shell prompt']);
});
test('save and restore cursor and scrolling regions', () => {
  const screen = new TerminalScreen();
  screen.write('a' + ESC + '7' + '\r\nb' + ESC + '8' + 'c');
  assert.deepEqual(screen.snapshot().lines, ['ac', 'b']);
  screen.write(ESC + '[1;2r' + ESC + '[2;1H' + '\r\nz');
  assert.deepEqual(screen.snapshot().lines, ['b', 'z']);
});
test('insert and delete cells retain the visible line', () => {
  const screen = new TerminalScreen();
  screen.write('abcdef' + ESC + '[1;3H' + ESC + '[2P');
  assert.deepEqual(screen.snapshot().lines, ['abef']);
  screen.write(ESC + '[2@xy');
  assert.deepEqual(screen.snapshot().lines, ['abxyef']);
});
test('storage remains bounded during long output', () => {
  const screen = new TerminalScreen();
  for (let index = 0; index < 2000; index++) screen.write('line ' + index + '\r\n');
  assert.ok(screen.snapshot().lines.length <= 512);
  assert.ok(screen.snapshot().lines.join('\n').includes('line 1999'));
});
test('oversized ANSI or line data fails closed', () => {
  const screen = new TerminalScreen();
  screen.write(ESC + '[' + '1'.repeat(1100));
  assert.equal(screen.snapshot().complete, false);
  assert.ok(screen.snapshot().issue);
  const other = new TerminalScreen();
  other.write('x'.repeat(4200));
  assert.ok(other.snapshot().issue);
});
test('combining characters cannot grow a single cell without a bound', () => {
  const screen = new TerminalScreen();
  screen.write('a' + '\u0301'.repeat(10000));
  assert.ok(screen.snapshot().issue);
  assert.ok(screen.snapshot().lines.join('').length <= 32);
});
