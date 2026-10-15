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
  const logs = [];
  const channels = [];
  let throwLogs = false;
  const warnings = [];
  const commands = new Map();
  const events = Object.fromEntries(['active', 'close', 'start', 'end', 'integration'].map(name => [name, emitter()]));
  const status = { show() {}, dispose() {} };
  const a = terminal('A');
  const window = {
    activeTerminal: a,
    createOutputChannel(name, options) {
      channels.push({ name, log: options?.log });
      let disposed = false;
      const write = (level, line) => {
        if (throwLogs || disposed) throw new Error('log channel unavailable');
        lines.push(line);
        logs.push({ level, record: JSON.parse(line) });
      };
      return {
        info: line => write('info', line), warn: line => write('warn', line), error: line => write('error', line),
        dispose() { disposed = true; },
      };
    },
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
    a, clock, lines, logs, channels, warnings, events, status, window,
    records: event => logs.map(log => log.record).filter(record => !event || record.event === event),
    failLogs: () => { throwLogs = true; },
    toggle: () => commands.get('codexAutoAccept.toggle')(),
    start: (value, target = a) => events.start.fire({ terminal: target, execution: value }),
    end: (value, target = a, exitCode = 0) => events.end.fire({ terminal: target, execution: value, exitCode }),
    deactivate: () => exports.deactivate(),
    reactivate: () => exports.activate({ subscriptions: [] }),
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
  assert.equal(h.records('watch.error').length, 0);
  assert.equal(h.records('approval.sent').length, 1);
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
  h.end(running);
  assert.equal(h.records('session.stopped').length, 1);
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
  const [failure] = h.records('watch.error');
  assert.equal(failure.kind, 'command');
  assert.ok(failure.content.includes('$ echo hello'));
  assert.equal(h.records('approval.sent').length, 0);
  assert.equal(h.clock.tasks.size, 0);
  h.toggle();
  running.write(frame(approval()));
  await settle();
  h.clock.advance(1000);
  assert.equal(h.warnings.length, 1);
  assert.match(h.status.text, /等待 Codex$/);
});

test('native audit messages are single-line JSON with current operation content for all five kinds', async t => {
  const h = host(t);
  h.a.name = 'Terminal "A"\\path\nsecond\u2028third\u2029fourth';
  h.toggle();
  const running = execution();
  h.start(running);
  const detail = '  detail: "quoted" \\path\r\n      continued\u2028separator';
  for (const kind of ['command', 'edit', 'network', 'input', 'permissions']) {
    running.write(frame(approval(kind, 'echo "hello"', detail)));
    await settle();
    h.clock.advance(120);
  }
  assert.deepEqual(h.channels, [{ name: 'Codex Auto-Accept', log: true }]);
  const sent = h.records('approval.sent');
  assert.equal(sent.length, 5);
  assert.equal(h.a.sends.length, 5);
  assert.deepEqual(sent.map(record => record.kind), ['command', 'edit', 'network', 'input', 'permissions']);
  for (const record of sent) {
    assert.equal(record.terminalName, h.a.name);
    assert.equal(record.timestamp, new Date(record.timestamp).toISOString());
    assert.match(record.runId, /^[0-9a-f-]{36}$/);
    assert.ok(record.content.includes(detail.replace(/\r\n/g, '\n')));
    assert.ok(record.content.includes('Reason: requested operation'));
    assert.ok(!record.content.includes('Yes, proceed'));
    assert.ok(!record.content.includes('Press enter to confirm'));
  }
  assert.equal(new Set(sent.map(record => record.terminalId)).size, 1);
  assert.equal(new Set(sent.map(record => record.sessionId)).size, 1);
  assert.equal(new Set(h.records().map(record => record.runId)).size, 1);
  assert.ok(h.lines.every(line => !/[\r\n\u2028\u2029]/.test(line)));
  assert.ok(h.logs.every(log => log.level === 'info'));
});

test('same-name terminals and consecutive executions have distinct audit identities', t => {
  const h = host(t);
  const first = execution();
  h.toggle();
  h.start(first);
  h.end(first, h.a, 7);
  h.end(first, h.a, 7);
  const second = execution('codex resume --last');
  h.start(second);
  const b = terminal(h.a.name);
  h.window.activeTerminal = b;
  h.toggle();
  h.start(execution(), b);
  const started = h.records('session.started');
  assert.equal(started.length, 3);
  assert.equal(new Set(started.map(record => record.sessionId)).size, 3);
  assert.equal(started[0].terminalId, started[1].terminalId);
  assert.notEqual(started[0].terminalId, started[2].terminalId);
  assert.equal(started[0].terminalName, started[2].terminalName);
  assert.equal(started[1].mode, 'resume');
  const [stopped] = h.records('session.stopped');
  assert.equal(h.records('session.stopped').length, 1);
  assert.equal(stopped.sessionId, started[0].sessionId);
  assert.equal(stopped.exitCode, 7);
  h.toggle();
  assert.equal(h.records('autoAccept.disabled').at(-1).terminalId, started[2].terminalId);
});

test('repaints log one approval, while a later resolved identical operation logs again', async t => {
  const h = host(t);
  h.toggle();
  const running = execution();
  h.start(running);
  for (let index = 0; index < 4; index++) {
    running.write(frame(approval()));
    await settle();
    h.clock.advance(200);
  }
  assert.equal(h.records('approval.sent').length, 1);
  running.write(frame('Working...') + frame(approval()));
  await settle();
  h.clock.advance(120);
  assert.equal(h.records('approval.sent').length, 2);
  assert.equal(h.a.sends.length, 2);
});

test('unsupported cards log one warning per request and read errors log at error level', async t => {
  const h = host(t);
  h.toggle();
  const running = execution();
  h.start(running);
  for (let index = 0; index < 3; index++) {
    running.write(frame(approval().replace('proceed (y)', 'proceed (q)')));
    await settle();
    h.clock.advance(200);
  }
  const skipped = h.logs.filter(log => log.record.event === 'approval.skipped');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].level, 'warn');
  assert.match(skipped[0].record.reason, /快捷鍵未知/);
  running.fail(new Error('read failed'));
  await settle();
  const failure = h.logs.find(log => log.record.event === 'watch.error');
  assert.equal(failure.level, 'error');
  assert.equal(failure.record.sessionId, skipped[0].record.sessionId);
  assert.equal(h.records('autoAccept.disabled').length, 1);
  assert.equal(h.records('approval.sent').length, 0);
});

test('log channel failures do not change successful sends or retry failed sends', async t => {
  for (const sendFails of [false, true]) {
    const h = host(t);
    h.toggle();
    const running = execution();
    h.start(running);
    h.failLogs();
    if (sendFails) h.a.sendText = () => { throw new Error('send failed'); };
    running.write(frame(approval()));
    await settle();
    h.clock.advance(120);
    running.write(frame(approval()));
    await settle();
    h.clock.advance(1000);
    assert.equal(h.a.sends.length, sendFails ? 0 : 1);
    assert.equal(h.warnings.length, sendFails ? 1 : 0);
    assert.match(h.status.text, sendFails ? /: OFF$/ : /: ON$/);
  }
});

test('deactivation stops each session once and reactivation creates a new audit run', t => {
  const h = host(t);
  h.toggle();
  const running = execution();
  h.start(running);
  h.reactivate();
  assert.equal(h.records('session.stopped').length, 1);
  assert.match(h.records('session.stopped')[0].reason, /擴充套件已停用/);
  assert.equal(h.records('extension.stopped').length, 1);
  const starts = h.records('extension.started');
  assert.equal(starts.length, 2);
  assert.notEqual(starts[0].runId, starts[1].runId);
  const before = h.lines.length;
  h.end(running);
  assert.equal(h.lines.length, before);
  h.deactivate();
  h.deactivate();
  assert.equal(h.records('extension.stopped').length, 2);
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
