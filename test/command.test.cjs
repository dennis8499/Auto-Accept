const { test } = require('node:test');
const assert = require('node:assert/strict');
const { identifyCodexCommand } = require('../out/codexCommand');

const supported = [
  ['codex', 'direct', 'interactive'],
  ['codex.exe -a on-request -s read-only', 'direct', 'interactive'],
  ['codex.cmd --no-alt-screen', 'direct', 'interactive'],
  ['codex.ps1 --config model="example" resume --last', 'direct', 'resume'],
  ['codex --model example --cd "C:\\my project" fork abc', 'direct', 'fork'],
  ['& "C:\\Program Files\\Codex\\codex.exe" resume --last', 'direct', 'resume'],
  ["&'C:\\tools\\codex.ps1' --no-daemon", 'direct', 'interactive'],
  ['/usr/local/bin/codex "fix the issue"', 'direct', 'interactive'],
  ['npx @openai/codex', 'npx', 'interactive'],
  ['npx.cmd -y @openai/codex@latest resume --last', 'npx', 'resume'],
  ['npx --yes --quiet @openai/codex@0.162.0-alpha.17.2 fork abc', 'npx', 'fork'],
  ['codex -- "exec"', 'direct', 'interactive'],
  ['codex "Explain pipes | and ; in quoted text"', 'direct', 'interactive'],
  ['codex --config name=\'it\'\'s fine\'', 'direct', 'interactive'],
];
for (const [command, launcher, mode] of supported) {
  test('identifies ' + command, () => assert.deepEqual(identifyCodexCommand(command), { launcher, mode }));
}
for (const command of [
  '', 'claude', 'echo codex', 'node codex.js', 'npx codex', 'npx @openai/codex-other',
  'other-codex', 'cmd /c codex', 'codex ; echo done', 'codex | tee log', 'codex && echo done',
  'codex\nWrite-Output hello', 'codex > output.txt', 'codex --help', 'codex -V',
  'codex exec "do something"', 'codex e task', 'codex review', 'codex login',
  'codex app-server', 'codex agents', 'codex mcp list', 'codex --model',
  'codex "unterminated', 'codex --config ' + String.fromCharCode(96),
]) {
  test('ignores ' + JSON.stringify(command), () => assert.equal(identifyCodexCommand(command), undefined));
}
