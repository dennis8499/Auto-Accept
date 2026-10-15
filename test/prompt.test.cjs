const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TerminalScreen } = require('../out/terminalScreen');
const { detectApproval } = require('../out/approvalPrompt');
const { ESC, FOOTER, approval, frame, detect } = require('./helpers.cjs');

for (const kind of ['command', 'edit', 'network', 'input', 'permissions']) {
  test('recognizes native ' + kind + ' approval', () => {
    assert.equal(detect(frame(approval(kind))).prompt?.kind, kind);
  });
}

for (const [kind, action, detail, expected] of [
  ['command', 'node -e "console.log(\'quoted\')"', '    Write-Output "first"\r\n      Write-Output "second"',
    '  $ node -e "console.log(\'quoted\')"\n    Write-Output "first"\n      Write-Output "second"'],
  ['edit', '', '  @@ -1,2 +1,2 @@\r\n  -before\r\n  +  after',
    '  Destination: README.md\n  @@ -1,2 +1,2 @@\n  -before\n  +  after'],
  ['network', 'curl "https://example.com/path"', '    Port: 443',
    '  $ curl "https://example.com/path"\n    Port: 443'],
  ['input', 'printf "line1\\nline2"', '    exit "quoted"',
    '  $ printf "line1\\nline2"\n    exit "quoted"'],
  ['permissions', '', '    C:\\project\\file.txt',
    '  Permission rule: read README.md\n    C:\\project\\file.txt'],
]) {
  test('retains formatted ' + kind + ' content without historical text or menu controls', () => {
    const result = detect(frame('Historical output that must stay out\r\n' + approval(kind, action, detail)));
    assert.equal(result.prompt?.kind, kind);
    assert.ok(result.prompt.content.includes(expected));
    assert.ok(result.prompt.content.includes('\n\n  Reason: requested operation\n\n'));
    assert.ok(!result.prompt.content.includes('Historical output'));
    assert.ok(!result.prompt.content.includes('Yes,'));
    assert.ok(!result.prompt.content.includes('Press enter'));
  });
}

test('content boundaries retain numbered operation steps and wrapped native titles', () => {
  const text = approval('permissions', '', '  1. Read an operation file\r\n  2. Inspect its contents')
    .replace('grant these permissions?', 'grant these\r\n  permissions?');
  const result = detect(frame(approval('command', 'echo historical') + '\r\n' + text));
  assert.match(result.prompt.content, /^  Would you like to grant these\n  permissions\?/);
  assert.ok(result.prompt.content.endsWith('  1. Read an operation file\n  2. Inspect its contents'));
  assert.ok(!result.prompt.content.includes('echo historical'));
});
test('accepts a single-use shortcut independently of the highlighted row', () => {
  const text = approval().replace('› 1.', '  1.').replace('  3.', '› 3.');
  assert.equal(detect(frame(text)).prompt?.kind, 'command');
});
test('requires a complete approval, not just a title or Yes', () => {
  for (const text of ['› 1. Yes, proceed (y)', 'Would you like to run the following command?', approval().replace(FOOTER, '')]) {
    assert.equal(detect(frame(text)).prompt, undefined);
  }
});
test('a title embedded in prose cannot impersonate the native header', () => {
  const text = approval().replace('Would you like to run', 'Explanation: Would you like to run');
  assert.equal(detect(frame(text)).prompt, undefined);
});
test('numbered strings in a command are not menu items', () => {
  assert.equal(detect(frame(approval('command', "echo '1. Yes, proceed (y)'"))).prompt?.kind, 'command');
});
test('approval wording and code fences in operation descriptions are not questions', () => {
  for (const phrase of ['needs your approval', 'Yes, provide the requested info', 'Question 1/1', '```']) {
    for (const text of [
      approval('command', 'git status').replace('requested operation', 'Inspect text containing ' + phrase),
      approval('command', 'node -e "console.log(\'' + phrase + '\')"'),
    ]) assert.equal(detect(frame(text)).prompt?.kind, 'command', phrase);
  }
});
test('selection markers and confirmation text inside commands are not menu controls', () => {
  const text = approval('command', 'echo "› 1. Yes, proceed (y)"').replace('\r\n› 1.', '\r\n  1.');
  assert.equal(detect(frame(text)).prompt, undefined);
  assert.equal(detect(frame(approval().replace(FOOTER, '  Explanation: ' + FOOTER.trim()))).prompt, undefined);
});
test('truncated confirmation footers report why the native card cannot be accepted', () => {
  const result = detect(frame(approval().replace(FOOTER, '')));
  assert.equal(result.state, 'partial');
  assert.match(result.reason, /確認提示/);
});
test('leaves normal questions and MCP forms unanswered', () => {
  for (const text of [
    'Question 1/1 (1 unanswered)\r\nChoose an option.\r\n› 1. Yes, proceed (y)\r\n  2. No\r\nenter to submit answer',
    'test-server needs your approval.\r\n› 1. Yes, provide the requested info (y)\r\n  2. No, but continue without it (n)\r\n' + FOOTER,
    'Would you like to continue the discussion?\r\n› 1. Yes, proceed (y)\r\n  2. No, and tell Codex what to do differently (esc)\r\n' + FOOTER,
  ]) assert.equal(detect(frame(text)).prompt, undefined);
});
test('unknown shortcut, missing refusal, and session-only choices never send', () => {
  for (const text of [
    approval().replace('Yes, proceed (y)', 'Yes, proceed (q)'),
    approval().replace('No, and tell Codex what to do differently (esc)', 'Maybe'),
    approval().replace('Yes, proceed (y)', 'Yes, allow for this session (y)'),
    approval().replace('›', ' '),
  ]) assert.equal(detect(frame(text)).prompt, undefined);
});
test('ignores an old card with a composer or another question below it', () => {
  for (const suffix of ['\r\n› Tell Codex what to do', '\r\nQuestion 1/1\r\n› 1. First choice', '\r\n' + String.fromCharCode(96).repeat(3)]) {
    assert.equal(detect(frame(approval() + suffix)).prompt, undefined);
  }
});
test('native card examples inside active questions and MCP forms stay manual', () => {
  for (const suffix of [
    '\r\nQuestion 1/1 (1 unanswered)\r\n› 1. Yes, proceed (y)\r\n  2. No\r\nenter to submit answer',
    '\r\nexample needs your approval.\r\n› 1. Yes, provide the requested info (y)\r\n  2. No, but continue without it (n)\r\n' + FOOTER,
  ]) assert.equal(detect(frame(approval() + suffix)).prompt, undefined);
});
test('a later generic menu with the native footer does not reuse a historical approval title', () => {
  const question = 'Would you like to continue the discussion?\r\n› 1. Yes, proceed (y)\r\n  2. No, and tell Codex what to do differently (esc)\r\n' + FOOTER;
  assert.equal(detect(frame(approval() + '\r\n' + question)).prompt, undefined);
});
test('handles wrapped titles, options and footer', () => {
  const text = approval('permissions')
    .replace('grant these permissions?', 'grant these\r\n  permissions?')
    .replace('for this turn (y)', 'for this\r\n     turn (y)')
    .replace('confirm or esc', 'confirm or\r\n  esc');
  assert.equal(detect(frame(text)).prompt?.kind, 'permissions');
});
test('supports Codex approvals from a labeled thread', () => {
  const text = approval().replace(FOOTER, FOOTER + ' or t to open thread');
  assert.equal(detect(frame(text)).prompt?.kind, 'command');
});
test('ANSI styles and OSC links do not pollute detection', () => {
  const text = approval().replace('echo hello', ESC + ']8;;https://example.com' + ESC + '\\' + 'echo hello' + ESC + ']8;;' + '\x07')
    .replace('› 1.', ESC + '[1;7m› 1.' + ESC + '[0m');
  const prompt = detect(frame(text)).prompt;
  assert.equal(prompt?.kind, 'command');
  assert.ok(prompt.content.includes('$ echo hello'));
  assert.ok(!prompt.content.includes(ESC));
  assert.ok(!prompt.content.includes('https://example.com'));
});
test('detects only after split CSI and synchronized updates finish', () => {
  const screen = new TerminalScreen();
  const text = frame(approval());
  for (const char of text.slice(0, -1)) {
    screen.write(char);
    assert.equal(detectApproval(screen.snapshot()).prompt, undefined);
  }
  screen.write(text.slice(-1));
  assert.equal(detectApproval(screen.snapshot()).prompt?.kind, 'command');
});
test('a removed row and cleared display cannot leave stale approvals', () => {
  const screen = new TerminalScreen();
  screen.write(frame(approval()));
  assert.equal(detectApproval(screen.snapshot()).prompt?.kind, 'command');
  screen.write(ESC + '[2J' + ESC + '[HWorking...');
  assert.equal(detectApproval(screen.snapshot()).prompt, undefined);
});
