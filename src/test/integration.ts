import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
async function until(predicate: () => boolean, message: string, timeout = 15000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error(message);
    await delay(30);
  }
}
function quote(value: string): string { return "'" + value.replace(/'/g, "''") + "'"; }

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
  const listeners: vscode.Disposable[] = [];
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

  async function createTerminal(name: string): Promise<vscode.Terminal> {
    const terminal = vscode.window.createTerminal({
      name,
      shellPath: process.env.CODEX_AUTO_ACCEPT_PWSH ?? 'pwsh.exe',
      shellArgs: ['-NoLogo'],
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
    const fixture = path.join(root, 'test', 'fixtures', 'codex.ps1');
    const program = otherProgram
      ? '& powershell.exe -NoProfile -File ' + quote(fixture)
      : '& ' + quote(fixture);
    terminal.sendText(program + ' -Scenario ' + scenario + ' -TestId ' + id + ' -TimeoutMs ' + timeout, true);
    await until(() => (traces.get(terminal) ?? '').includes('Press enter to confirm') ||
      (traces.get(terminal) ?? '').includes('enter to submit answer'), 'fixture prompt was not captured');
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
    reports.push('PASS ' + id);
    console.log('PASS ' + id);
  }

  try {
    const a = await createTerminal('Codex Auto-Accept test A');
    const b = await createTerminal('Codex Auto-Accept test B');
    await expect(a, 'command', 'default-off', 'NONE');
    await start(a, 'command', 'arm-waiting');
    await toggle(a);
    assert.equal(await result(a, 'arm-waiting'), 'y');
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

    let auditFile: string | undefined;
    await until(() => {
      auditFile = auditFiles(process.env.CODEX_AUTO_ACCEPT_LOG_ROOT!).find(file =>
        fs.readFileSync(file, 'utf8').split('"event":"approval.sent"').length - 1 === 13);
      return !!auditFile;
    }, 'native audit log did not persist all thirteen approval inputs');
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
      reports.push('PASS live-codex-cli');
      console.log('PASS live-codex-cli');
      a.sendText('\x03', false);
    } else {
      reports.push('NOT RUN live-codex-cli (set CODEX_AUTO_ACCEPT_LIVE_CLI to test the signed-in CLI)');
    }
  } finally {
    for (const listener of listeners) listener.dispose();
    for (const terminal of terminals) terminal.dispose();
    fs.writeFileSync(path.join(cache, 'results.txt'), reports.join('\n') + '\n');
    fs.writeFileSync(path.join(cache, 'executions.json'), JSON.stringify(executionEvents, null, 2));
    for (const [terminal, trace] of traces) {
      fs.writeFileSync(path.join(cache, terminal.name.replace(/[^a-zA-Z0-9]/g, '_') + '.txt'), trace);
    }
  }
}
