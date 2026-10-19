import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { TerminalScreen } from '../terminalScreen';

const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
async function until(predicate: () => boolean, message: string, timeout = 15000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error(message);
    await delay(30);
  }
}
function quote(value: string): string { return "'" + value.replace(/'/g, "''") + "'"; }
function hasPrompt(text = ''): boolean {
  // Older ConPTY versions split text with cursor movements and erase sequences.
  const screen = new TerminalScreen();
  screen.write(text);
  return screen.snapshot().lines.some(line => line.includes('Press enter to confirm') || line.includes('enter to submit answer'));
}

function auditFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const location = path.join(directory, entry.name);
    return entry.isDirectory() ? auditFiles(location) : entry.name.endsWith('Codex Auto-Accept.log') ? [location] : [];
  });
}

export async function run(): Promise<void> {
  const root = process.env.CODEX_AUTO_ACCEPT_ROOT!;
  const cache = path.join(root, '.cache', 'integration');
  const reports: string[] = [];
  const executionEvents: unknown[] = [];
  const traces = new Map<vscode.Terminal, string>();
  const terminals: vscode.Terminal[] = [];
  const endings = new Set<vscode.Terminal>();
  const closed = new Set<vscode.Terminal>();
  const listeners: vscode.Disposable[] = [];
  const suite = process.env.CODEX_AUTO_ACCEPT_SUITE ?? 'all';
  const cmdEnvironment = vscode.workspace.getConfiguration('terminal.integrated').get<Record<string, string | null>>('env.windows') ?? {};
  let expectedSent = 0;
  const pass = (id: string) => { reports.push('PASS ' + id); console.log('PASS ' + id); };
  const extension = vscode.extensions.getExtension('local-codex.codex-auto-accept');
  assert.ok(extension, 'development extension must be installed');
  await extension.activate();
  listeners.push(vscode.window.onDidStartTerminalShellExecution(event => {
    endings.delete(event.terminal);
    executionEvents.push({ event: 'start', terminal: event.terminal.name, command: event.execution.commandLine.value });
    const stream = event.execution.read();
    void (async () => {
      for await (const chunk of stream) traces.set(event.terminal, (traces.get(event.terminal) ?? '') + chunk);
    })().catch(error => reports.push('TRACE ERROR: ' + String(error)));
  }));
  listeners.push(vscode.window.onDidEndTerminalShellExecution(event => {
    executionEvents.push({ event: 'end', terminal: event.terminal.name, code: event.exitCode });
    endings.add(event.terminal);
  }));
  listeners.push(vscode.window.onDidCloseTerminal(terminal => {
    closed.add(terminal);
    executionEvents.push({ event: 'close', terminal: terminal.name, code: terminal.exitStatus?.code });
  }));

  async function createTerminal(name: string): Promise<vscode.Terminal> {
    const terminal = vscode.window.createTerminal({
      name,
      shellPath: process.env.CODEX_AUTO_ACCEPT_PWSH ?? 'pwsh.exe',
      shellArgs: ['-NoLogo'],
      env: { CODEX_AUTO_ACCEPT_ROOT: root },
    });
    terminals.push(terminal);
    terminal.show();
    if (terminals.length === 1) await vscode.commands.executeCommand('workbench.action.toggleMaximizedPanel');
    await until(() => !!terminal.shellIntegration, 'PowerShell shell integration did not activate');
    return terminal;
  }
  async function toggle(terminal: vscode.Terminal): Promise<void> {
    terminal.show();
    await until(() => vscode.window.activeTerminal === terminal, 'terminal did not become active');
    await vscode.commands.executeCommand('codexAutoAccept.toggle');
  }
  async function start(terminal: vscode.Terminal, scenario: string, id: string, timeout = 2500, otherProgram = false): Promise<void> {
    endings.delete(terminal);
    traces.set(terminal, '');
    const fixture = process.env.CODEX_AUTO_ACCEPT_TEST_FIXTURE ?? path.join(root, 'test', 'fixtures', 'codex.ps1');
    const program = otherProgram
      ? '& powershell.exe -NoProfile -File ' + quote(fixture)
      : '& ' + quote(fixture);
    terminal.sendText(program + ' -Scenario ' + scenario + ' -TestId ' + id + ' -TimeoutMs ' + timeout, true);
    await until(() => hasPrompt(traces.get(terminal)), 'fixture prompt was not captured');
  }
  async function result(terminal: vscode.Terminal, id: string): Promise<string> {
    await until(() => (traces.get(terminal) ?? '').includes('SMOKE_RESULT:' + id + ':'), 'fixture result was not captured');
    const response = /SMOKE_RESULT:[^:]+:([^\r\n]*)/.exec(traces.get(terminal) ?? '')?.[1] ?? '';
    await until(() => endings.has(terminal), 'fixture execution did not finish');
    await delay(50);
    return response;
  }
  async function expect(terminal: vscode.Terminal, scenario: string, id: string, expected: string, other = false): Promise<void> {
    await start(terminal, scenario, id, expected === 'NONE' ? 650 : 3500, other);
    assert.equal(await result(terminal, id), expected, id);
    expectedSent += [...expected].filter(value => value === 'y').length;
    pass(id);
  }

  async function startCmd(scenario: string, id: string, timeout = 3500, binary: 'cmd' | 'exe' | 'missing' = 'cmd'): Promise<vscode.Terminal> {
    const directory = process.env[binary === 'cmd' ? 'CODEX_AUTO_ACCEPT_CMD_TEST_BIN'
      : binary === 'exe' ? 'CODEX_AUTO_ACCEPT_CMD_EXE_BIN' : 'CODEX_AUTO_ACCEPT_CMD_EMPTY_BIN']!;
    const resultFile = path.join(cache, id + '.json');
    if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile);
    // Only this isolated test workspace is changed; no user setting or product test hook is used.
    await vscode.workspace.getConfiguration('terminal.integrated').update('env.windows', {
      ...cmdEnvironment,
      PATH: directory,
      CODEX_AUTO_ACCEPT_ROOT: root,
      CODEX_AUTO_ACCEPT_TEST_PWSH: process.env.CODEX_AUTO_ACCEPT_TEST_PWSH!,
      CODEX_AUTO_ACCEPT_TEST_FIXTURE: process.env.CODEX_AUTO_ACCEPT_TEST_FIXTURE!,
      CODEX_AUTO_ACCEPT_TEST_SCENARIO: scenario,
      CODEX_AUTO_ACCEPT_TEST_ID: id,
      CODEX_AUTO_ACCEPT_TEST_TIMEOUT: String(timeout),
      CODEX_AUTO_ACCEPT_TEST_RESULT: resultFile,
    }, vscode.ConfigurationTarget.Workspace);
    const before = new Set(vscode.window.terminals);
    await vscode.commands.executeCommand('codexAutoAccept.startCmd');
    await until(() => vscode.window.terminals.some(terminal => !before.has(terminal)), 'CMD command did not create a terminal');
    const terminal = vscode.window.terminals.find(candidate => !before.has(candidate))!;
    terminals.push(terminal);
    assert.equal(terminal.name, 'Codex (CMD)');
    assert.equal((terminal.creationOptions as vscode.TerminalOptions).isTransient, true);
    if (binary !== 'missing') await until(() => hasPrompt(traces.get(terminal)), 'CMD fixture prompt was not captured: ' + id);
    return terminal;
  }
  async function cmdResult(terminal: vscode.Terminal, id: string): Promise<string> {
    const resultFile = path.join(cache, id + '.json');
    await until(() => fs.existsSync(resultFile), 'CMD fixture result was not written: ' + id);
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8').replace(/^\uFEFF/, '')) as { id: string; response: string; cwd: string };
    assert.equal(result.id, id);
    assert.equal(path.resolve(result.cwd).toLowerCase(), path.resolve(vscode.workspace.workspaceFolders![0].uri.fsPath).toLowerCase(), 'CMD must inherit the workspace cwd');
    await until(() => closed.has(terminal), 'CMD terminal did not close after Codex exited: ' + id);
    await delay(180);
    assert.ok((traces.get(terminal) ?? '').includes('SMOKE_RESULT:' + id + ':' + result.response), 'CMD result must also be captured from the public execution stream');
    return result.response;
  }
  async function expectCmd(scenario: string, id: string, expected: string, armed = true, binary: 'cmd' | 'exe' = 'cmd'): Promise<vscode.Terminal> {
    const terminal = await startCmd(scenario, id, expected === 'NONE' ? 650 : 3500, binary);
    if (armed) await toggle(terminal);
    assert.equal(await cmdResult(terminal, id), expected, id);
    expectedSent += [...expected].filter(value => value === 'y').length;
    pass(id);
    return terminal;
  }

  try {
    if (suite !== 'cmd') {
      const a = await createTerminal('Codex Auto-Accept test A');
      const b = await createTerminal('Codex Auto-Accept test B');
      await expect(a, 'command', 'default-off', 'NONE');
      await start(a, 'command', 'arm-waiting');
      await toggle(a);
      assert.equal(await result(a, 'arm-waiting'), 'y');
      expectedSent++;
      reports.push('PASS arm-waiting');
      for (const kind of ['command', 'edit', 'network', 'input', 'permissions']) await expect(a, kind, 'native-' + kind, 'y');
      for (const scenario of ['reason', 'program', 'git']) await expect(a, scenario, 'regression-' + scenario, 'y');
      await expect(a, 'sequence', 'consecutive-and-identical', 'yyyy');
      await expect(b, 'command', 'terminal-isolation', 'NONE');
      await expect(a, 'question', 'question-manual', 'NONE');
      await expect(a, 'mcp', 'mcp-manual', 'NONE');
      await expect(a, 'unknown', 'unknown-manual', 'NONE');
      await expect(a, 'incomplete', 'incomplete-manual', 'NONE');
      await expect(a, 'history', 'history-question-manual', 'NONE');
      await expect(a, 'historyMenu', 'history-generic-menu-manual', 'NONE');
      await expect(a, 'command', 'other-program', 'NONE', true);
      await toggle(a);
      await expect(a, 'command', 'disarmed', 'NONE');

      if (process.env.CODEX_AUTO_ACCEPT_LIVE_CLI) {
        await toggle(a);
        const liveRoot = path.join(cache, 'live-workspace', String(Date.now()));
        fs.mkdirSync(liveRoot, { recursive: true });
        const artifact = path.join(liveRoot, 'codex-live-smoke.txt');
        const prompt = 'This is an authorized smoke test of a terminal approval extension. Use exec_command with sandbox_permissions require_escalated to run a PowerShell command that writes the exact text codex-auto-accept-ok to codex-live-smoke.txt in the current working directory. Set justification to the exact text "This command needs your approval to validate the extension." Make exactly this one file change, request approval for the command, and then stop. Do not edit any other files or ask any questions.';
        traces.set(a, '');
        endings.delete(a);
        const command = '& ' + quote(process.env.CODEX_AUTO_ACCEPT_LIVE_CLI) +
          ' --no-daemon --no-alt-screen --sandbox read-only --ask-for-approval on-request --cd ' +
          quote(liveRoot) + ' -c ' + quote('approvals_reviewer="user"') +
          ' -c ' + quote('model_reasoning_effort="low"') +
          ' -c ' + quote('projects.' + JSON.stringify(liveRoot) + '.trust_level="trusted"') +
          ' ' + quote(prompt);
        a.sendText(command, true);
        await until(() => fs.existsSync(artifact) || /not logged in|sign in|authentication failed|Unable to.*home directory/i.test(traces.get(a) ?? ''),
          'Live Codex did not complete the approval smoke test', 180000);
        assert.ok(fs.existsSync(artifact), 'live CLI could not run; see captured trace');
        assert.equal(fs.readFileSync(artifact, 'utf8').trim(), 'codex-auto-accept-ok');
        const visibleTrace = (traces.get(a) ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\s+/g, ' ');
        assert.ok(visibleTrace.includes('Would you like to run the following command?'), 'live CLI must have requested command approval');
        assert.ok(visibleTrace.includes('Yes, proceed (y)'), 'live CLI must have offered the single-use shortcut');
        assert.ok(visibleTrace.includes('This command needs your approval to validate the extension.'), 'live CLI must exercise approval wording in the reason');
        expectedSent++;
        pass('live-codex-cli');
        a.sendText('\x03', false);
      } else {
        reports.push('NOT RUN live-codex-cli (set CODEX_AUTO_ACCEPT_LIVE_CLI to test the signed-in CLI)');
      }
    }

    if (suite !== 'powershell') {
      await expectCmd('command', 'cmd-default-off', 'NONE', false);
      await expectCmd('command', 'cmd-arm-waiting', 'y');
      for (const kind of ['command', 'edit', 'network', 'input', 'permissions']) await expectCmd(kind, 'cmd-native-' + kind, 'y');
      for (const scenario of ['reason', 'program', 'git']) await expectCmd(scenario, 'cmd-regression-' + scenario, 'y');
      await expectCmd('sequence', 'cmd-consecutive-and-identical', 'yyyy');
      await expectCmd('redraw', 'cmd-deduplicate-redraw', 'y');
      for (const scenario of ['question', 'mcp', 'unknown', 'incomplete', 'history', 'historyMenu']) await expectCmd(scenario, 'cmd-' + scenario + '-manual', 'NONE');
      const a = await startCmd('question', 'cmd-isolation-armed', 3500);
      await toggle(a);
      const b = await startCmd('command', 'cmd-isolation-unarmed', 650);
      assert.ok(!closed.has(a), 'The armed CMD terminal must remain open while the unarmed terminal prompts');
      assert.equal(await cmdResult(b, 'cmd-isolation-unarmed'), 'NONE');
      assert.equal(await cmdResult(a, 'cmd-isolation-armed'), 'NONE');
      pass('cmd-terminal-isolation');
      const disarmed = await startCmd('command', 'cmd-disarmed', 650);
      await toggle(disarmed);
      await toggle(disarmed);
      assert.equal(await cmdResult(disarmed, 'cmd-disarmed'), 'NONE');
      pass('cmd-disarmed');
      const executable = await expectCmd('command', 'cmd-executable-normal-exit', 'y', true, 'exe');
      assert.ok(endings.has(executable), 'An executable must return to the launcher and emit its execution end marker');
      const manualClose = await startCmd('command', 'cmd-manual-close', 5000);
      await toggle(manualClose);
      manualClose.dispose();
      await until(() => closed.has(manualClose), 'manually closed CMD terminal did not emit close');
      await delay(250);
      pass('cmd-manual-close-cancels-pending');
      const interrupted = await startCmd('question', 'cmd-interrupted', 5000);
      await toggle(interrupted);
      interrupted.sendText('\x03', false);
      // CMD may ask whether to terminate its batch. Answering that shell question remains manual.
      await until(() => closed.has(interrupted) || /\(Y\/N\)/i.test(traces.get(interrupted) ?? ''),
        'Ctrl+C did not terminate the CLI or expose the CMD batch termination question');
      if (!closed.has(interrupted)) interrupted.sendText('y\r', false);
      await until(() => closed.has(interrupted), 'interrupted CMD process did not close');
      pass('cmd-ctrl-c-cleanup');
      const missing = await startCmd('command', 'cmd-missing-codex', 650, 'missing');
      await until(() => closed.has(missing), 'CMD terminal did not close when Codex was missing');
      assert.equal(missing.exitStatus?.code, 9009, 'Missing Codex must preserve the CMD command-not-found exit code');
      pass('cmd-missing-codex');
    }

    let auditFile: string | undefined;
    await until(() => {
      auditFile = auditFiles(process.env.CODEX_AUTO_ACCEPT_LOG_ROOT!).find(file =>
        fs.readFileSync(file, 'utf8').split('"event":"approval.sent"').length - 1 === expectedSent);
      return !!auditFile;
    }, 'native audit log did not persist exactly ' + expectedSent + ' approval inputs');
    const auditText = fs.readFileSync(auditFile!, 'utf8');
    const records = auditText.trim().split(/\r?\n/).map(line => {
      assert.match(line, /^\d{4}-\d{2}-\d{2} .* \[(?:info|warn|warning|error)\] \{/,
        'VS Code must add native time and level prefixes to each JSON message');
      return JSON.parse(line.slice(line.indexOf('{')));
    });
    const sent = records.filter(record => record.event === 'approval.sent');
    assert.deepEqual([...new Set(sent.map(record => record.kind))].sort(), ['command', 'edit', 'input', 'network', 'permissions']);
    assert.ok(sent.every(record => typeof record.content === 'string' && !record.content.includes('\x1b')));
    assert.ok(records.some(record => record.event === 'approval.skipped'));
    assert.equal(new Set(records.map(record => record.runId)).size, 1);
    if (suite !== 'powershell') {
      const terminalClosed = new Set<number>();
      for (const record of records) {
        if (record.event === 'terminal.closed') terminalClosed.add(record.terminalId);
        if (record.event === 'approval.sent') assert.ok(!terminalClosed.has(record.terminalId), 'Never send an approval after terminal.closed');
      }
      assert.ok(records.some(record => record.event === 'watch.error'), 'Missing Codex must be diagnosed in the native log');
      assert.ok(records.some(record => record.event === 'session.stopped' && record.terminalName === 'Codex (CMD)'), 'CMD termination must stop its watched session');
      pass('cmd-native-audit-cleanup');
    }
    fs.writeFileSync(path.join(cache, 'audit-log-path.txt'), auditFile! + '\n');
    reports.push('PASS native-audit-json');
    console.log('PASS native-audit-json');

    // Exercise the actual Output models through VS Code commands, without adding a public extension command.
    const showAudit = (await vscode.commands.getCommands()).find(command =>
      command.startsWith('workbench.action.output.show.') && command.includes('local-codex.codex-auto-accept'));
    assert.ok(showAudit, 'VS Code must register the native audit channel show command');
    await vscode.commands.executeCommand(showAudit);
    await until(() => vscode.workspace.textDocuments.some(document =>
      document.getText().includes('"runId":"' + sent[0].runId + '"') && document.getText().includes('"event":"approval.sent"')),
      'native Output channel must display the persisted JSON audit messages');
    reports.push('PASS native-output-model');
    console.log('PASS native-output-model');

  } finally {
    await vscode.workspace.getConfiguration('terminal.integrated').update('env.windows', cmdEnvironment, vscode.ConfigurationTarget.Workspace);
    for (const listener of listeners) listener.dispose();
    for (const terminal of terminals) terminal.dispose();
    fs.writeFileSync(path.join(cache, 'results.txt'), reports.join('\n') + '\n');
    fs.writeFileSync(path.join(cache, 'executions.json'), JSON.stringify(executionEvents, null, 2));
    for (const [terminal, trace] of traces) {
      fs.writeFileSync(path.join(cache, terminals.indexOf(terminal) + '-' + terminal.name.replace(/[^a-zA-Z0-9]/g, '_') + '.txt'), trace);
    }
  }
}
