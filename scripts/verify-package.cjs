const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { inflateRawSync } = require('node:zlib');

const root = path.resolve(__dirname, '..');
const bytes = fs.readFileSync(path.join(root, 'codex-auto-accept-0.1.0.vsix'));
let end = bytes.length - 22;
while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
assert.ok(end >= 0, 'ZIP central directory must exist');
const count = bytes.readUInt16LE(end + 10);
let position = bytes.readUInt32LE(end + 16);
const files = new Map();
for (let index = 0; index < count; index++) {
  assert.equal(bytes.readUInt32LE(position), 0x02014b50, 'central entry signature');
  const method = bytes.readUInt16LE(position + 10);
  const compressedSize = bytes.readUInt32LE(position + 20);
  const size = bytes.readUInt32LE(position + 24);
  const nameLength = bytes.readUInt16LE(position + 28);
  const extraLength = bytes.readUInt16LE(position + 30);
  const commentLength = bytes.readUInt16LE(position + 32);
  const local = bytes.readUInt32LE(position + 42);
  const name = bytes.subarray(position + 46, position + 46 + nameLength).toString('utf8');
  assert.equal(bytes.readUInt32LE(local), 0x04034b50, 'local entry signature');
  const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
  const compressed = bytes.subarray(start, start + compressedSize);
  const content = method === 8 ? inflateRawSync(compressed) : compressed;
  assert.ok(method === 0 || method === 8, 'supported compression method');
  assert.equal(content.length, size, 'uncompressed size of ' + name);
  files.set(name, content);
  position += 46 + nameLength + extraLength + commentLength;
}
const manifest = JSON.parse(files.get('extension/package.json').toString('utf8'));
assert.equal(manifest.name, 'codex-auto-accept');
assert.equal(manifest.version, '0.1.0');
assert.equal(manifest.publisher, 'local-codex');
assert.equal(manifest.displayName, 'Codex Auto-Accept');
assert.deepEqual(manifest.contributes.commands.map(command => command.command), ['codexAutoAccept.toggle']);
for (const name of ['extension', 'codexCommand', 'terminalScreen', 'approvalPrompt', 'autoAcceptSession']) {
  assert.ok(files.has('extension/out/' + name + '.js'), 'compiled ' + name);
}
assert.ok(files.get('extension/readme.md').toString('utf8').includes('PowerShell 7'));
assert.ok(files.has('extension/UPSTREAM.md'));
assert.equal(files.get('extension/LICENSE.txt').toString('utf8').replace(/\r\n/g, '\n'),
  fs.readFileSync(path.join(root, 'LICENSE'), 'utf8').replace(/\r\n/g, '\n'));
for (const name of files.keys()) {
  assert.ok(!/^extension\/(?:src|test|scripts|node_modules|\.cache|\.vscode-test|out\/test)\//.test(name), 'no development files: ' + name);
  assert.ok(!name.endsWith('.map'), 'no source maps: ' + name);
}
const vsixManifest = files.get('extension.vsixmanifest').toString('utf8');
assert.ok(vsixManifest.includes('local-codex'));
console.log('VSIX verified: ' + manifest.publisher + '.' + manifest.name + '@' + manifest.version);
console.log([...files.keys()].sort().join('\n'));
