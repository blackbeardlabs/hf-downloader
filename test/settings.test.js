const fs = require('fs');
const os = require('os');
const path = require('path');
const { after, test } = require('node:test');
const assert = require('node:assert/strict');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-downloader-settings-'));
process.env.HF_DOWNLOADER_DATA_DIR = dataDir;

const { db } = require('../db');
const { defaultDownloadPolicy, validateDownloadPolicy } = require('../settings');

after(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('download speed is unlimited by default', () => {
  const policy = validateDownloadPolicy(defaultDownloadPolicy);
  assert.equal(policy.maxDownloadSpeed, '0');
});

test('download speed accepts aria2 K, M, and G values', () => {
  for (const value of ['500K', '12.5M', '1G']) {
    const policy = validateDownloadPolicy({
      ...defaultDownloadPolicy,
      maxDownloadSpeed: value
    });
    assert.equal(policy.maxDownloadSpeed, value);
  }
});

test('download speed rejects invalid values', () => {
  assert.throws(
    () => validateDownloadPolicy({ ...defaultDownloadPolicy, maxDownloadSpeed: 'fast' }),
    /Invalid speed value/
  );
});

test('download speed cannot trigger the enabled low-speed restart rule continuously', () => {
  assert.throws(
    () => validateDownloadPolicy({
      ...defaultDownloadPolicy,
      maxDownloadSpeed: '5K',
      autoRestartEnabled: true
    }),
    /must be higher than the low-speed restart threshold/
  );
});
