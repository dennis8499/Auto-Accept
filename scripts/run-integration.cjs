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
const workspace = path.join(cache, 'workspace');
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
  extensionDevelopmentPath: root,
  extensionTestsPath: path.join(root, 'out', 'test', 'integration.js'),
  extensionTestsEnv: {
    ELECTRON_RUN_AS_NODE: undefined,
    CODEX_AUTO_ACCEPT_ROOT: root,
    CODEX_AUTO_ACCEPT_LOG_ROOT: path.join(profile, 'user-data', 'logs'),
    CODEX_AUTO_ACCEPT_LIVE_CLI: process.env.CODEX_AUTO_ACCEPT_LIVE_CLI,
    CODEX_AUTO_ACCEPT_PWSH: process.env.CODEX_AUTO_ACCEPT_PWSH ||
      path.join(root, '.cache', 'pwsh', 'portable', 'pwsh.exe'),
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
