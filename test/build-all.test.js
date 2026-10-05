const { test } = require('node:test');
const assert = require('node:assert/strict');

const { inspectNativeBinary } = require('../scripts/build-all');

test('identifies Linux x64 and ARM64 native modules', () => {
  const x64 = Buffer.alloc(20);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(x64);
  x64.writeUInt16LE(0x3e, 18);

  const arm64 = Buffer.from(x64);
  arm64.writeUInt16LE(0xb7, 18);

  assert.deepEqual(inspectNativeBinary(x64), { platform: 'linux', arch: 'x64' });
  assert.deepEqual(inspectNativeBinary(arm64), { platform: 'linux', arch: 'arm64' });
});

test('identifies Windows x64 native modules', () => {
  const binary = Buffer.alloc(80);
  binary.write('MZ', 0, 'ascii');
  binary.writeUInt32LE(64, 0x3c);
  binary.write('PE\0\0', 64, 'ascii');
  binary.writeUInt16LE(0x8664, 68);

  assert.deepEqual(inspectNativeBinary(binary), { platform: 'win32', arch: 'x64' });
});

test('identifies macOS ARM64 native modules', () => {
  const binary = Buffer.alloc(8);
  binary.writeUInt32LE(0xfeedfacf, 0);
  binary.writeUInt32LE(0x0100000c, 4);

  assert.deepEqual(inspectNativeBinary(binary), { platform: 'darwin', arch: 'arm64' });
});
