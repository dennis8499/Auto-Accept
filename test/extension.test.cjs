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

function host(t, options = {}) {
  const clock = new Clock();
  const lines = [];
  const logs = [];
  const channels = [];
  let throwLogs = false;
  const warnings = [];
  const information = [];
  const created = [];
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
    showInformationMessage: text => information.push(text),
    showWarningMessage: text => warnings.push(text),
    activeTextEditor: options.editorFolder ? { document: { uri: { scheme: 'file', path: '/editor/file.ts' } } } : undefined,
    createTerminal(creationOptions) {
      if (options.createError) throw options.createError;
      const value = terminal(creationOptions.name, false);
      value.creationOptions = creationOptions;
      value.show = () => {
        if (options.showError) throw options.showError;
        window.activeTerminal = value;
        events.active.fire(value);
      };
      value.dispose = () => { value.disposed = true; events.close.fire(value); };
      created.push(value);
      return value;
    },
    onDidChangeActiveTerminal: events.active.event,
    onDidCloseTerminal: events.close.event,
    onDidStartTerminalShellExecution: events.start.event,
    onDidEndTerminalShellExecution: events.end.event,
    onDidChangeTerminalShellIntegration: events.integration.event,
  };
  const vscode = {
    window, StatusBarAlignment: { Right: 1 }, ThemeColor: class { constructor(id) { this.id = id; } },
    TerminalExitReason: { Unknown: 0, Shutdown: 1, Process: 2, User: 3, Extension: 4 },
    workspace: { workspaceFolders: options.folders, getWorkspaceFolder: () => options.editorFolder },
    commands: { registerCommand(name, callback) { commands.set(name, callback); return { dispose: () => commands.delete(name) }; } },
  };
  const exports = {};
  const compiled = path.resolve(__dirname, '../out/extension.js');
  vm.runInNewContext(fs.readFileSync(compiled, 'utf8'), {
    exports,
    require(id) {
      if (id.startsWith('node:')) return require(id);
      if (id === 'vscode') return vscode;
      if (id === './autoAcceptSession') return {
        AutoAcceptSession: class extends AutoAcceptSession {
          constructor(send, report) { super(send, report, clock.scheduler); }
        },
      };
      return require(path.resolve(__dirname, '../out', id));
    },
    process: { platform: options.platform ?? 'win32', env: { SystemRoot: 'C:\\Windows' } },
    setTimeout: clock.scheduler.set,
    clearTimeout: clock.scheduler.clear,
  }, { filename: compiled });
  const context = { subscriptions: [], asAbsolutePath: relative => path.join('C:\\extension space & %LITERAL% ! ^ (中文)', relative) };
  exports.activate(context);
  t.after(() => exports.deactivate());
  return {
    a, clock, lines, logs, channels, warnings, information, created, events, status, window,
    records: event => logs.map(log => log.record).filter(record => !event || record.event === event),
    failLogs: () => { throwLogs = true; },
    toggle: () => commands.get('codexAutoAccept.toggle')(),
    startCmd: () => commands.get('codexAutoAccept.startCmd')(),
    start: (value, target = a) => events.start.fire({ terminal: target, execution: value }),
    end: (value, target = a, exitCode = 0) => events.end.fire({ terminal: target, execution: value, exitCode }),
    deactivate: () => exports.deactivate(),
    reactivate: () => exports.activate(context),
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('CMD command creates a transient Windows terminal with an unexpanded launcher path and defaults OFF', t => {
  const h = host(t);
  h.startCmd();
  assert.equal(h.created.length, 1);
  const [cmd] = h.created;
  assert.equal(cmd.creationOptions.name, 'Codex (CMD)');
  assert.equal(cmd.creationOptions.shellPath, 'C:\\Windows\\System32\\cmd.exe');
  assert.equal(cmd.creationOptions.shellArgs, '/d /s /v:off /c ""%CODEX_AUTO_ACCEPT_CMD_LAUNCHER%""');
  assert.equal(cmd.creationOptions.env.CODEX_AUTO_ACCEPT_CMD_LAUNCHER,
    path.join('C:\\extension space & %LITERAL% ! ^ (中文)', 'resources/cmd-launcher.cmd'));
  assert.equal(cmd.creationOptions.cwd, require('node:os').homedir());
  assert.equal(cmd.creationOptions.isTransient, true);
  assert.match(h.status.text, /: OFF$/);
  assert.equal(h.records('autoAccept.enabled').length, 0);
  h.toggle();
  assert.match(h.status.text, /等待 Codex$/);
  assert.match(h.status.tooltip, /CMD 啟動器/);
  assert.equal(h.information.length, 0);
});

test('CMD working directory prefers the active editor workspace then the first workspace', t => {
  const first = { uri: { fsPath: 'C:\\first' } };
  const editorFolder = { uri: { fsPath: 'C:\\second' } };
  const withEditor = host(t, { folders: [first, editorFolder], editorFolder });
  withEditor.startCmd();
  assert.equal(withEditor.created[0].creationOptions.cwd, editorFolder.uri);
  const noEditor = host(t, { folders: [first, editorFolder] });
  noEditor.startCmd();
  assert.equal(noEditor.created[0].creationOptions.cwd, first.uri);
});

test('CMD launch rejects non-Windows hosts and reports createTerminal failures', t => {
  const nonWindows = host(t, { platform: 'linux' });
  nonWindows.startCmd();
  assert.equal(nonWindows.created.length, 0);
  assert.match(nonWindows.information[0], /Windows 擴充套件主機/);
  assert.equal(nonWindows.clock.tasks.size, 0);
  const failed = host(t, { createError: new Error('shell missing') });
  failed.startCmd();
  assert.match(failed.warnings[0], /CMD 終端啟動失敗.*shell missing/);
  assert.equal(failed.records('watch.error').length, 1);
  assert.equal(failed.clock.tasks.size, 0);
  const hidden = host(t, { showError: new Error('cannot show') });
  hidden.startCmd();
  assert.match(hidden.warnings[0], /cannot show/);
  assert.equal(hidden.created[0].disposed, true);
  assert.equal(hidden.clock.tasks.size, 0);
});

test('CMD startup timeout disables approval while a recognized session cancels its timer', async t => {
  const stalled = host(t);
  stalled.startCmd();
  stalled.toggle();
  stalled.clock.advance(15000);
  assert.match(stalled.status.text, /: OFF$/);
  assert.match(stalled.warnings[0], /CMD 啟動器未能接上/);
  assert.equal(stalled.clock.tasks.size, 0);
  stalled.created[0].exitStatus = { code: 1, reason: 2 };
  stalled.events.close.fire(stalled.created[0]);
  assert.equal(stalled.warnings.length, 1);
  assert.equal(stalled.records('watch.error').length, 1);

  const h = host(t);
  h.startCmd();
  const cmd = h.created[0];
  const running = execution();
  h.start(running, cmd);
  assert.equal(h.clock.tasks.size, 0);
  running.write(frame(approval()));
  await settle();
  h.clock.advance(200);
  assert.equal(cmd.sends.length, 0);
  h.toggle();
  h.clock.advance(120);
  assert.deepEqual(cmd.sends, [['y', false]]);
  h.clock.advance(15000);
  assert.equal(h.warnings.length, 0);
});

test('CMD closes without an end marker cancel pending input and record the process exit code', async t => {
  const h = host(t);
  h.startCmd();
  const cmd = h.created[0];
  h.toggle();
  const running = execution();
  h.start(running, cmd);
  running.write(frame(approval()));
  await settle();
  h.clock.advance(60);
  cmd.exitStatus = { code: 7, reason: 2 };
  h.events.close.fire(cmd);
  h.clock.advance(20000);
  assert.equal(cmd.sends.length, 0);
  assert.match(h.status.text, /: OFF$/);
  assert.equal(h.clock.tasks.size, 0);
  assert.equal(h.records('session.stopped').at(-1).exitCode, 7);
  assert.equal(h.records('terminal.closed').at(-1).exitCode, 7);
  assert.equal(h.warnings.length, 0);
});

test('missing Codex and early CMD process failures report actionable errors; user close stays quiet', t => {
  for (const [code, reason, warning] of [[9009, 2, /找不到可執行的 Codex/], [1, 2, /結束碼 1/], [1, 0, /結束碼 1/], [undefined, 3, undefined]]) {
    const h = host(t);
    h.startCmd();
    h.toggle();
    const cmd = h.created[0];
    cmd.exitStatus = { code, reason };
    h.events.close.fire(cmd);
    h.clock.advance(20000);
    assert.equal(h.clock.tasks.size, 0);
    assert.match(h.status.text, /: OFF$/);
    assert.equal(h.warnings.length, warning ? 1 : 0);
    if (warning) assert.match(h.warnings[0], warning);
  }
});

test('deactivation cancels CMD startup timers without reviving auto-approval', t => {
  const h = host(t);
  h.startCmd();
  h.toggle();
  h.deactivate();
  h.clock.advance(20000);
  assert.equal(h.clock.tasks.size, 0);
  assert.equal(h.warnings.length, 0);
  assert.equal(h.created[0].sends.length, 0);
});

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
  for (const managedCmd of [false, true]) {
    for (const sync of [true, false]) {
      const h = host(t);
      if (managedCmd) h.startCmd();
      const target = managedCmd ? h.created[0] : h.a;
      h.toggle();
      const running = execution('codex', sync ? new Error('read failed') : undefined);
      h.start(running, target);
      if (!sync) { running.fail(new Error('stream failed')); await settle(); }
      assert.match(h.status.text, /: OFF$/);
      assert.equal(h.warnings.length, 1);
      h.toggle();
      assert.match(h.status.text, /等待 Codex$/);
      h.start(running, target);
      assert.equal(running.reads, 1);
      assert.equal(h.clock.tasks.size, 0);
    }
  }
});

test('send failures turn OFF, dispose the failed session and do not retry', async t => {
  for (const managedCmd of [false, true]) {
    const h = host(t);
    if (managedCmd) h.startCmd();
    const target = managedCmd ? h.created[0] : h.a;
    target.sendText = () => { throw new Error('terminal closed'); };
    h.toggle();
    const running = execution();
    h.start(running, target);
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
  }
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

test('spaced command titles send one y and retain the original review write content in audit JSON', async t => {
  const h = host(t);
  h.toggle();
  const running = execution();
  h.start(running);
  const reason = 'Do you want to allow writing the second fixed read batch into the owned review context?';
  const card = approval('command', 'Set-Content -LiteralPath "...."')
    .replace('  Reason: requested operation', '  Environment: local\r\n  Reason: ' + reason);
  running.write(frame(card));
  await settle();
  h.clock.advance(60);
  running.write(frame(card.replace('command?', 'command ?')));
  await settle();
  h.clock.advance(60);

  assert.deepEqual(h.a.sends, [['y', false]]);
  const [record] = h.records('approval.sent');
  assert.equal(h.records('approval.sent').length, 1);
  assert.equal(record.kind, 'command');
  assert.equal(record.content, [
    '  Would you like to run the following command ?', '',
    '  Environment: local', '  Reason: ' + reason, '',
    '  $ Set-Content -LiteralPath "...."',
  ].join('\n'));
  assert.equal(h.records('approval.skipped').length, 0);
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
