const fs = require('fs');
const os = require('os');
const path = require('path');
const { after, test } = require('node:test');
const assert = require('node:assert/strict');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-downloader-server-'));
process.env.HF_DOWNLOADER_DATA_DIR = dataDir;

const { db } = require('../db');
const { saveDownloadPolicyForQueue } = require('../server');
const { defaultDownloadPolicy } = require('../settings');

let restartCalls = 0;
const queue = {
  restartActiveForSpeedLimit() {
    restartCalls += 1;
    return true;
  }
};

after(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('saving a changed speed limit persists it and restarts the active transfer once', () => {
  const policy = {
    ...defaultDownloadPolicy,
    maxDownloadSpeed: '10M'
  };

  const firstResult = saveDownloadPolicyForQueue(queue, policy);
  assert.equal(firstResult.policy.maxDownloadSpeed, '10M');
  assert.equal(firstResult.restartedActiveDownload, true);
  assert.equal(restartCalls, 1);

  const secondResult = saveDownloadPolicyForQueue(queue, policy);
  assert.equal(secondResult.restartedActiveDownload, false);
  assert.equal(restartCalls, 1);
});
