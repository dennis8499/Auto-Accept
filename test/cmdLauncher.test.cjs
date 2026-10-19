const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const launcher = path.resolve(__dirname, '../resources/cmd-launcher.cmd');
const windows = process.platform === 'win32';
const osc = value => '\x1b]633;' + value + '\x07';
const start = ['P;IsWindows=True', 'A', 'B', 'E;codex', 'C'].map(osc).join('');

test('CMD launcher is reviewable ASCII without literal control bytes', () => {
  const source = fs.readFileSync(launcher);
  assert.ok([...source].every(byte => byte === 10 || byte === 13 || byte >= 32 && byte <= 126));
  assert.match(source.toString('ascii'), /setlocal DisableDelayedExpansion/);
});

function fixture(t) {
  const cache = path.resolve(__dirname, '../.cache/cmd-launcher-tests');
  fs.mkdirSync(cache, { recursive: true });
  const root = fs.mkdtempSync(path.join(cache, 'case-'));
  t.after(() => {
    // Check the absolute deletion target before removing a Windows cache tree.
    assert.equal(path.dirname(path.resolve(root)), cache);
    assert.ok(path.basename(root).startsWith('case-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const resources = path.join(root, 'resource 路徑 space %CAA_PATH_SENTINEL% ! & ^ ( )');
  const programs = path.join(root, 'program 路徑 space %CAA_PATH_SENTINEL% ! & ^ ( )');
  const cwd = path.join(root, 'working 路徑 space %CAA_PATH_SENTINEL% ! & ^ ( )');
  for (const directory of [resources, programs, cwd]) fs.mkdirSync(directory);
  const target = path.join(resources, 'cmd-launcher.cmd');
  fs.copyFileSync(launcher, target);
  const system32 = path.join(process.env.SystemRoot, 'System32');
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) if (/^path$/i.test(key)) delete environment[key];
  Object.assign(environment, {
    PATH: programs + path.delimiter + system32,
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    CODEX_AUTO_ACCEPT_CMD_LAUNCHER: target,
    CAA_PATH_SENTINEL: 'unexpected-expanded-value',
    CAA_EXPECTED_CWD: cwd,
  });
  return {
    root, resources, programs, cwd,
    run(extraEnvironment = {}) {
      return spawnSync(process.env.ComSpec || path.join(system32, 'cmd.exe'),
        ['/d', '/s', '/v:off', '/c', '""%CODEX_AUTO_ACCEPT_CMD_LAUNCHER%""'], {
          windowsHide: true,
          windowsVerbatimArguments: true,
          encoding: 'utf8',
          cwd,
          env: { ...environment, ...extraEnvironment },
          timeout: 15000,
        });
    },
  };
}

test('CMD shim preserves cwd and special paths, receives no arguments, and tail-calls', { skip: !windows }, t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.programs, 'codex.cmd'), [
    '@echo off',
    'echo FIXTURE_CMD',
    'if /i "%CD%"=="%CAA_EXPECTED_CWD%" (echo CWD_OK) else exit /b 97',
    'if not "%~1"=="" exit /b 98',
    'exit /b 23',
  ].join('\r\n') + '\r\n');
  const result = f.run();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 23, result.stderr);
  assert.equal(result.stderr, '');
  assert.ok(result.stdout.startsWith(start), JSON.stringify(result.stdout));
  assert.ok(result.stdout.includes('FIXTURE_CMD\r\nCWD_OK\r\n'));
  assert.ok(!result.stdout.includes(osc('D;23')), 'batch launcher must not return to the wrapper');
});

test('native launcher emits D and preserves the native exit code', { skip: !windows }, t => {
  const f = fixture(t);
  // WHOAMI is a harmless console executable that accepts no arguments.
  fs.copyFileSync(path.join(process.env.SystemRoot, 'System32', 'whoami.exe'), path.join(f.programs, 'codex.exe'));
  const result = f.run();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.startsWith(start), JSON.stringify(result.stdout));
  assert.ok(result.stdout.endsWith(osc('D;0')), JSON.stringify(result.stdout));
});

test('native launcher preserves a nonzero exit code in D and the CMD process', { skip: !windows }, t => {
  const f = fixture(t);
  // WHERE without a pattern fails immediately, without changing any files.
  fs.copyFileSync(path.join(process.env.SystemRoot, 'System32', 'where.exe'), path.join(f.programs, 'codex.exe'));
  const result = f.run();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, start + osc('D;2'));
});

test('missing Codex returns 9009 without starting a watched execution', { skip: !windows }, t => {
  const f = fixture(t);
  const result = f.run({ PATH: '' });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 9009, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /codex\.exe or codex\.cmd was not found on PATH/);
});

test('unsupported batch launchers are skipped rather than watched', { skip: !windows }, t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.programs, 'codex.bat'), '@echo UNSUPPORTED_BATCH_WAS_RUN\r\n');
  const result = f.run();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 9009, result.stderr);
  assert.equal(result.stdout, '');
});

test('a supported PATH shim is used after an unsupported current-directory match', { skip: !windows }, t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.cwd, 'codex.bat'), '@echo UNSUPPORTED_BATCH_WAS_RUN\r\n');
  fs.writeFileSync(path.join(f.programs, 'codex.cmd'), '@echo off\r\necho SUPPORTED_SHIM\r\nexit /b 31\r\n');
  const result = f.run();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 31, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, start + 'SUPPORTED_SHIM\r\n');
});
