const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildAria2Args } = require('../aria2');

const file = {
  url: 'https://example.com/model.gguf',
  output_dir: '/tmp/downloads',
  output_name: 'model.gguf'
};

test('aria2 arguments omit the speed cap when downloads are unlimited', () => {
  const args = buildAria2Args(file, { maxDownloadSpeed: '0', lowestSpeedLimit: '50K' });
  assert.equal(args.includes('--max-download-limit=0'), false);
  assert.equal(args.includes('--lowest-speed-limit=50K'), true);
});

test('aria2 arguments apply the speed cap and preserve a lower built-in cutoff', () => {
  const args = buildAria2Args(file, { maxDownloadSpeed: '10M', lowestSpeedLimit: '50K' });
  assert.equal(args.includes('--max-download-limit=10485760'), true);
  assert.equal(args.includes('--lowest-speed-limit=50K'), true);
});

test('aria2 arguments disable a built-in low-speed cutoff that conflicts with the cap', () => {
  const args = buildAria2Args(file, { maxDownloadSpeed: '20K', lowestSpeedLimit: '50K' });
  assert.equal(args.includes('--max-download-limit=20480'), true);
  assert.equal(args.includes('--lowest-speed-limit=0'), true);
});

test('aria2 arguments convert G values to portable byte-per-second limits', () => {
  const args = buildAria2Args(file, { maxDownloadSpeed: '1G' });
  assert.equal(args.includes('--max-download-limit=1073741824'), true);
});
