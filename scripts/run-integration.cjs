const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');
const { runTests } = require('@vscode/test-electron');
const { approval, frame, FOOTER } = require('../test/helpers.cjs');

const root = path.resolve(__dirname, '..');
const cache = path.join(root, '.cache', 'integration');
const profile = path.join(cache, 'profiles', String(Date.now()));
const suite = process.env.CODEX_AUTO_ACCEPT_SUITE || (process.platform === 'win32' ? 'all' : 'powershell');
assert.ok(['all', 'powershell', 'cmd'].includes(suite), 'CODEX_AUTO_ACCEPT_SUITE must be all, powershell, or cmd');
const workspace = path.join(cache, 'workspace space & %UNEXPANDED_TEST% ! ^ (中文)');
const specialRoot = path.join(cache, 'fixture space & %UNEXPANDED_TEST% ! ^ (中文)');
const cmdBin = process.env.CODEX_AUTO_ACCEPT_CMD_TEST_BIN || path.join(specialRoot, 'cmd');
const exeBin = path.join(specialRoot, 'exe');
const emptyBin = path.join(specialRoot, 'empty');
const pwsh = process.env.CODEX_AUTO_ACCEPT_PWSH || path.join(root, '.cache', 'pwsh', 'portable', 'pwsh.exe');
const cmdFixture = path.join(specialRoot, 'codex.ps1');
const extensionRoot = path.join(cache, 'extension space & %UNEXPANDED_TEST% ! ^ (中文)');
fs.mkdirSync(specialRoot, { recursive: true });
for (const directory of [cmdBin, exeBin, emptyBin]) fs.mkdirSync(directory, { recursive: true });
const fixture = fs.readFileSync(path.join(root, 'test', 'fixtures', 'codex.ps1'), 'utf8')
    .replace('$fixtureRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)', '$fixtureRoot = $env:CODEX_AUTO_ACCEPT_ROOT')
    // ConPTY in VS Code 1.93 coalesces adjacent frames before exposing terminal data.
    // Let the real terminal render each resolution; unit tests retain the coalesced case.
    .replace('[Console]::Write($prefix + $prompt)', `if ($prefix) { [Console]::Write($prefix); Start-Sleep -Milliseconds 250 }
    [Console]::Write($prompt)
    if ($Scenario -eq 'redraw') { [Console]::Write($prompt + $prompt) }`)
    .replace('$responses.Add($response)', `$responses.Add($response)
    if ($Scenario -eq 'redraw') {
        Start-Sleep -Milliseconds 300
        while ([Console]::KeyAvailable) { $responses.Add([string][Console]::ReadKey($true).KeyChar) }
    }`);
fs.writeFileSync(cmdFixture, fixture + `
if ($env:CODEX_AUTO_ACCEPT_TEST_RESULT) {
@{ id = $TestId; response = ($responses -join ''); cwd = (Get-Location).Path } |
    ConvertTo-Json -Compress | Set-Content -LiteralPath $env:CODEX_AUTO_ACCEPT_TEST_RESULT -Encoding UTF8
}
`, 'utf8');
if (suite !== 'powershell') {
  assert.equal(process.platform, 'win32', 'The CMD integration suite requires Windows');
  assert.ok(fs.existsSync(pwsh), 'PowerShell fixture executable must exist: ' + pwsh);
  if (!process.env.CODEX_AUTO_ACCEPT_CMD_TEST_BIN) fs.writeFileSync(path.join(cmdBin, 'codex.cmd'), [
    '@echo off', 'setlocal DisableDelayedExpansion',
    '"%CODEX_AUTO_ACCEPT_TEST_PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%CODEX_AUTO_ACCEPT_TEST_FIXTURE%" -Scenario "%CODEX_AUTO_ACCEPT_TEST_SCENARIO%" -TestId "%CODEX_AUTO_ACCEPT_TEST_ID%" -TimeoutMs "%CODEX_AUTO_ACCEPT_TEST_TIMEOUT%"',
    'exit /b %errorlevel%',
  ].join('\r\n'), 'ascii');
  // Windows includes the .NET Framework compiler; no native npm dependency is needed.
  const compiler = ['Framework64', 'Framework'].map(directory =>
    path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', directory, 'v4.0.30319', 'csc.exe')).find(candidate => fs.existsSync(candidate));
  assert.ok(compiler, 'The Windows .NET Framework C# compiler is required for the executable fixture');
  const source = path.join(specialRoot, 'CodexFixture.cs');
  fs.writeFileSync(source, `using System;
using System.Diagnostics;
public static class CodexFixture {
    private static string Env(string name) { return Environment.GetEnvironmentVariable("CODEX_AUTO_ACCEPT_TEST_" + name); }
    private static string Quote(string value) { return "\\\"" + value + "\\\""; }
    public static int Main(string[] args) {
        if (args.Length != 0) return 42;
        var start = new ProcessStartInfo(Env("PWSH"), "-NoLogo -NoProfile -ExecutionPolicy Bypass -File " + Quote(Env("FIXTURE")) +
            " -Scenario " + Quote(Env("SCENARIO")) + " -TestId " + Quote(Env("ID")) + " -TimeoutMs " + Quote(Env("TIMEOUT")));
        start.UseShellExecute = false;
        using (var child = Process.Start(start)) { child.WaitForExit(); return child.ExitCode; }
    }
}`, 'utf8');
  const compile = cp.spawnSync(compiler, ['/nologo', '/target:exe', '/out:' + path.join(exeBin, 'codex.exe'), source], { windowsHide: true, encoding: 'utf8' });
  if (compile.error || compile.status !== 0) throw new Error('Cannot compile executable CMD fixture: ' + (compile.error || compile.stdout + compile.stderr));
  // Exercise the real extension command with the extension/launcher itself in a hostile path.
  fs.mkdirSync(extensionRoot, { recursive: true });
  fs.copyFileSync(path.join(root, 'package.json'), path.join(extensionRoot, 'package.json'));
  fs.cpSync(path.join(root, 'out'), path.join(extensionRoot, 'out'), { recursive: true });
  fs.cpSync(path.join(root, 'resources'), path.join(extensionRoot, 'resources'), { recursive: true });
}
fs.mkdirSync(path.join(workspace, '.vscode'), { recursive: true });
fs.writeFileSync(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({
  'terminal.integrated.shellIntegration.enabled': true,
  'terminal.integrated.enablePersistentSessions': false,
  'workbench.startupEditor': 'none',
}, null, 2));
fs.writeFileSync(path.join(cache, 'prompts.json'), JSON.stringify({
  command: frame(approval('command')),
  edit: frame(approval('edit')),
  network: frame(approval('network')),
  input: frame(approval('input')),
  permissions: frame(approval('permissions')),
  question: frame('Question 1/1 (1 unanswered)\r\nChoose an option.\r\n› 1. Yes\r\n  2. No\r\ntab to add notes | enter to submit answer | esc to interrupt'),
  mcp: frame('example needs your approval.\r\n› 1. Yes, provide the requested info (y)\r\n  2. No, but continue without it (n)\r\n' + FOOTER),
  unknown: frame(approval().replace('proceed (y)', 'proceed (q)')),
  reason: frame(approval('command', 'Write-Output ok').replace('requested operation', 'This command needs your approval')),
  program: frame(approval('command', 'node -e "console.log(\'```\')"')),
  git: frame(approval('command', 'git commit -m "Question 1/1"').replace('requested operation', 'Inspect Yes, provide the requested info text')),
  incomplete: frame(approval().replace('  3. No, and tell Codex what to do differently (esc)', '')),
  history: frame(approval() + '\r\nQuestion 1/1 (1 unanswered)\r\n› 1. Yes, proceed (y)\r\n  2. No\r\nenter to submit answer'),
  historyMenu: frame(approval() + '\r\nWould you like to continue the discussion?\r\n› 1. Yes, proceed (y)\r\n  2. No, and tell Codex what to do differently (esc)\r\n' + FOOTER),
  sequence: [
    frame(approval('command', 'Write-Output "needs your approval"')),
    frame(approval('command', 'node -e "console.log(\'```\')"')),
    frame(approval('command', 'git status')),
    frame(approval('command', 'git status')),
  ],
  redraw: frame(approval('command', 'deduplicate repeated redraws')),
  working: frame('Working...'),
}));
const defaultCode = process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Microsoft VS Code', 'Code.exe')
  : undefined;
const code = process.env.CODEX_AUTO_ACCEPT_VSCODE || defaultCode;
if (code && !fs.existsSync(code)) throw new Error('VS Code executable does not exist: ' + code);
const log = fs.createWriteStream(path.join(cache, 'host.log'));
const output = new Writable({ write(chunk, encoding, callback) {
  log.write(chunk);
  const lines = chunk.toString().split(/\r?\n/);
  for (const line of lines) if (/^PASS |^Error:|AssertionError|^Exit code:/.test(line)) console.log(line);
  callback();
}});
// Suppress extra console windows when launching the isolated test host.
const spawn = cp.spawn;
cp.spawn = function(executable, args, options) {
  return spawn.call(this, executable, args, { ...options, windowsHide: true });
};
runTests({
  vscodeExecutablePath: code,
  extensionDevelopmentPath: suite === 'powershell' ? root : extensionRoot,
  extensionTestsPath: path.join(root, 'out', 'test', 'integration.js'),
  extensionTestsEnv: {
    ELECTRON_RUN_AS_NODE: undefined,
    CODEX_AUTO_ACCEPT_ROOT: root,
    CODEX_AUTO_ACCEPT_SUITE: suite,
    CODEX_AUTO_ACCEPT_CMD_TEST_BIN: cmdBin,
    CODEX_AUTO_ACCEPT_CMD_EXE_BIN: exeBin,
    CODEX_AUTO_ACCEPT_CMD_EMPTY_BIN: emptyBin,
    CODEX_AUTO_ACCEPT_TEST_FIXTURE: cmdFixture,
    CODEX_AUTO_ACCEPT_TEST_PWSH: pwsh,
    CODEX_AUTO_ACCEPT_LOG_ROOT: path.join(profile, 'user-data', 'logs'),
    CODEX_AUTO_ACCEPT_LIVE_CLI: process.env.CODEX_AUTO_ACCEPT_LIVE_CLI,
    CODEX_AUTO_ACCEPT_PWSH: pwsh,
  },
  stdout: output,
  stderr: output,
  launchArgs: [
    workspace, '--new-window', '--disable-extensions', '--disable-gpu',
    '--user-data-dir=' + path.join(profile, 'user-data'),
    '--extensions-dir=' + path.join(profile, 'extensions'),
  ],
}).then(() => {
  const auditFile = fs.readFileSync(path.join(cache, 'audit-log-path.txt'), 'utf8').trim();
  assert.ok(fs.readFileSync(auditFile, 'utf8').includes('"event":"approval.sent"'),
    'native audit file must remain readable after the development host exits');
  fs.appendFileSync(path.join(cache, 'results.txt'), 'PASS native-log-retained-after-exit\n');
  console.log('PASS native-log-retained-after-exit');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => { cp.spawn = spawn; log.end(); });
