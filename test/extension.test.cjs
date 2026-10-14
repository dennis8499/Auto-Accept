const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { AutoAcceptSession } = require('../out/autoAcceptSession');
const { Clock, approval, frame } = require('./helpers.cjs');

function emitter() {
  const listeners = new Set();
  return {
    event(callback) { listeners.add(callback); return { dispose: () => listeners.delete(callback) }; },
    fire(event) { for (const callback of listeners) callback(event); },
  };
}

function execution(command = 'codex', readError) {
  const queue = [];
  let waiter;
  let ended = false;
  return {
    commandLine: { value: command },
    reads: 0,
    read() {
      this.reads++;
      if (readError) throw readError;
      return {
        [Symbol.asyncIterator]() { return this; },
        next() {
          if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
          if (ended) return Promise.resolve({ done: true });
          return new Promise((resolve, reject) => { waiter = { resolve, reject }; });
        },
        return() { return Promise.resolve({ done: true }); },
      };
    },
    write(value) {
      if (waiter) { const pending = waiter; waiter = undefined; pending.resolve({ value, done: false }); }
      else queue.push(value);
    },
    finish() {
      ended = true;
      if (waiter) { const pending = waiter; waiter = undefined; pending.resolve({ done: true }); }
    },
    fail(error) {
      ended = true;
      if (waiter) { const pending = waiter; waiter = undefined; pending.reject(error); }
    },
  };
}

function terminal(name, integrated = true) {
  return {
    name, shellIntegration: integrated ? {} : undefined, sends: [],
    sendText(...args) { this.sends.push(args); },
  };
}

function host(t) {
  const clock = new Clock();
  const lines = [];
  const warnings = [];
  const commands = new Map();
  const events = Object.fromEntries(['active', 'close', 'start', 'end', 'integration'].map(name => [name, emitter()]));
  const status = { show() {}, dispose() {} };
  const a = terminal('A');
  const window = {
    activeTerminal: a,
    createOutputChannel: () => ({ appendLine: line => lines.push(line), dispose() {} }),
    createStatusBarItem: () => status,
    showInformationMessage() {},
    showWarningMessage: text => warnings.push(text),
    onDidChangeActiveTerminal: events.active.event,
    onDidCloseTerminal: events.close.event,
    onDidStartTerminalShellExecution: events.start.event,
    onDidEndTerminalShellExecution: events.end.event,
    onDidChangeTerminalShellIntegration: events.integration.event,
  };
  const vscode = {
    window, StatusBarAlignment: { Right: 1 }, ThemeColor: class { constructor(id) { this.id = id; } },
    commands: { registerCommand(name, callback) { commands.set(name, callback); return { dispose: () => commands.delete(name) }; } },
  };
  const exports = {};
  const compiled = path.resolve(__dirname, '../out/extension.js');
  vm.runInNewContext(fs.readFileSync(compiled, 'utf8'), {
    exports,
    require(id) {
      if (id === 'vscode') return vscode;
      if (id === './autoAcceptSession') return {
        AutoAcceptSession: class extends AutoAcceptSession {
          constructor(send, report) { super(send, report, clock.scheduler); }
        },
      };
      return require(path.resolve(__dirname, '../out', id));
    },
  }, { filename: compiled });
  exports.activate({ subscriptions: [] });
  t.after(() => exports.deactivate());
  return {
    a, clock, lines, warnings, events, status, window,
    toggle: () => commands.get('codexAutoAccept.toggle')(),
    start: (value, target = a) => events.start.fire({ terminal: target, execution: value }),
    end: (value, target = a, exitCode = 0) => events.end.fire({ terminal: target, execution: value, exitCode }),
    deactivate: () => exports.deactivate(),
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('ON requires a watched execution; arming an existing terminal shows restart guidance', async t => {
  const h = host(t);
  assert.match(h.status.text, /: OFF$/);
  h.toggle();
  assert.match(h.status.text, /等待 Codex$/);
  assert.match(h.status.tooltip, /重新執行 codex/);
  assert.match(h.lines.at(-1), /等待下一個可監看/);
  const running = execution();
  h.start(running);
  assert.match(h.status.text, /: ON$/);
  running.write(frame(approval()));
  await settle();
  h.clock.advance(120);
  assert.deepEqual(h.a.sends, [['y', false]]);
  h.end(running);
  assert.match(h.status.text, /等待 Codex$/);
});

test('missing shell integration stays waiting and repeated property updates do not spam logs', t => {
  const h = host(t);
  h.a.shellIntegration = undefined;
  h.toggle();
  assert.match(h.status.text, /等待 Codex$/);
  assert.match(h.status.tooltip, /Shell Integration/);
  h.a.shellIntegration = {};
  h.events.integration.fire({ terminal: h.a });
  const count = h.lines.length;
  for (let index = 0; index < 5; index++) h.events.integration.fire({ terminal: h.a });
  assert.equal(h.lines.length, count);
  assert.match(h.status.text, /等待 Codex$/);
});

test('duplicate execution starts preserve pending input and never reread or resend', async t => {
  const h = host(t);
  h.toggle();
  const running = execution();
  h.start(running);
  running.write(frame(approval()));
  await settle();
  h.clock.advance(60);
  running.commandLine.value = '';
  h.start(running);
  h.clock.advance(60);
  assert.equal(running.reads, 1);
  assert.equal(h.a.sends.length, 1);
  h.start(running);
  running.write(frame(approval()));
  await settle();
  h.clock.advance(500);
  assert.equal(h.a.sends.length, 1);
  assert.match(h.status.text, /: ON$/);
});

test('replacement by a non-Codex command cancels stale input and visibly waits', async t => {
  const h = host(t);
  h.toggle();
  const running = execution();
  h.start(running);
  running.write(frame(approval()));
  await settle();
  h.clock.advance(60);
  const shellCommand = execution('git status');
  h.start(shellCommand);
  h.clock.advance(1000);
  assert.equal(h.a.sends.length, 0);
  assert.equal(shellCommand.reads, 0);
  assert.match(h.status.text, /等待 Codex$/);
  assert.ok(h.lines.some(line => line.includes('監看已被另一個指令取代')));
  assert.match(h.status.tooltip, /不是可辨識的 Codex/);
  assert.ok(!h.lines.some(line => line.includes('git status')));
});

test('a new Codex execution survives stale end events and errors from its predecessor', async t => {
  const h = host(t);
  h.toggle();
  const old = execution();
  h.start(old);
  old.write(frame(approval()));
  await settle();
  h.clock.advance(60);
  const current = execution('codex resume --last');
  h.start(current);
  h.end(old);
  old.fail(new Error('old stream failed'));
  current.write(frame(approval('command', 'node --version')));
  await settle();
  h.clock.advance(120);
  assert.deepEqual(h.a.sends, [['y', false]]);
  assert.match(h.status.text, /: ON$/);
  assert.equal(h.warnings.length, 0);
});

test('stream completion cancels pending input even before a shell end event arrives', async t => {
  const h = host(t);
  h.toggle();
  const running = execution();
  h.start(running);
  running.write(frame(approval()));
  await settle();
  running.finish();
  await settle();
  h.clock.advance(1000);
  assert.equal(h.a.sends.length, 0);
  assert.match(h.status.text, /等待 Codex$/);
  assert.match(h.lines.at(-1), /輸出串流已結束/);
});

test('matching shell end and terminal close events cancel pending approvals', async t => {
  for (const stop of ['end', 'close']) {
    const h = host(t);
    h.toggle();
    const running = execution();
    h.start(running);
    running.write(frame(approval()));
    await settle();
    if (stop === 'end') h.end(running);
    else h.events.close.fire(h.a);
    h.clock.advance(1000);
    assert.equal(h.a.sends.length, 0);
    assert.match(h.status.text, stop === 'end' ? /等待 Codex$/ : /: OFF$/);
  }
});

test('synchronous and asynchronous read failures turn OFF and cannot appear ON when rearmed', async t => {
  for (const sync of [true, false]) {
    const h = host(t);
    h.toggle();
    const running = execution('codex', sync ? new Error('read failed') : undefined);
    h.start(running);
    if (!sync) { running.fail(new Error('stream failed')); await settle(); }
    assert.match(h.status.text, /: OFF$/);
    assert.equal(h.warnings.length, 1);
    h.toggle();
    assert.match(h.status.text, /等待 Codex$/);
    h.start(running);
    assert.equal(running.reads, 1);
  }
});

test('send failures turn OFF, dispose the failed session and do not retry', async t => {
  const h = host(t);
  h.a.sendText = () => { throw new Error('terminal closed'); };
  h.toggle();
  const running = execution();
  h.start(running);
  running.write(frame(approval()));
  await settle();
  h.clock.advance(120);
  assert.match(h.status.text, /: OFF$/);
  assert.equal(h.warnings.length, 1);
  assert.equal(h.clock.tasks.size, 0);
  h.toggle();
  running.write(frame(approval()));
  await settle();
  h.clock.advance(1000);
  assert.equal(h.warnings.length, 1);
  assert.match(h.status.text, /等待 Codex$/);
});

test('terminal switching preserves independent OFF, waiting and ON states', async t => {
  const h = host(t);
  h.toggle();
  const running = execution();
  h.start(running);
  const b = terminal('B');
  h.window.activeTerminal = b;
  h.events.active.fire(b);
  assert.match(h.status.text, /: OFF$/);
  h.toggle();
  assert.match(h.status.text, /等待 Codex$/);
  h.window.activeTerminal = h.a;
  h.events.active.fire(h.a);
  assert.match(h.status.text, /: ON$/);
  h.toggle();
  running.write(frame(approval()));
  await settle();
  h.clock.advance(1000);
  assert.equal(h.a.sends.length, 0);
});

test('deactivation disposes sessions and cancels both approval and diagnostic timers', async t => {
  for (const text of [approval(), 'Would you like to run the following command?']) {
    const h = host(t);
    h.toggle();
    const running = execution();
    h.start(running);
    running.write(frame(text));
    await settle();
    h.deactivate();
    h.clock.advance(1000);
    assert.equal(h.clock.tasks.size, 0);
    assert.equal(h.a.sends.length, 0);
    assert.ok(!h.lines.some(line => line.includes('核准確認提示')));
  }
});
