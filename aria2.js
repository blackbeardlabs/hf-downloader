const fs = require('fs');
const { spawn } = require('child_process');
const { getAria2Binary } = require('./system');

function maskToken(text, token) {
  if (!text || !token) return text || '';
  return String(text).split(token).join('[HF_TOKEN]');
}

function unitToBytes(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const normalized = String(unit || '').toLowerCase();
  if (normalized.startsWith('p')) return n * 1024 * 1024 * 1024 * 1024 * 1024;
  if (normalized.startsWith('t')) return n * 1024 * 1024 * 1024 * 1024;
  if (normalized.startsWith('g')) return n * 1024 * 1024 * 1024;
  if (normalized.startsWith('m')) return n * 1024 * 1024;
  if (normalized.startsWith('k')) return n * 1024;
  return n;
}

function parseAria2Progress(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.includes('[#') || line.includes('DL:'));
  const line = lines.at(-1) || '';
  const unit = '(?:[KMGTPE]?i?B|B)';
  const speedMatch = line.match(new RegExp(`DL:([0-9.]+)\\s*(${unit})`, 'i'));
  const progressMatch = line.match(/\((\d+)%\)/);
  const downloadedMatch = line.match(new RegExp(`([0-9.]+)\\s*(${unit})\\/([0-9.]+)\\s*(${unit})\\s*\\((\\d+)%\\)`, 'i'));
  const progress = {};

  if (speedMatch) {
    progress.speedBps = Math.round(unitToBytes(speedMatch[1], speedMatch[2]));
  }
  if (progressMatch) {
    progress.percent = Number(progressMatch[1]);
  }
  if (downloadedMatch) {
    progress.downloaded = Math.round(unitToBytes(downloadedMatch[1], downloadedMatch[2]));
    progress.size = Math.round(unitToBytes(downloadedMatch[3], downloadedMatch[4]));
    progress.percent = Number(downloadedMatch[5]);
  }

  return Object.keys(progress).length ? progress : null;
}

function httpStatusFromMessage(message) {
  const text = String(message || '');
  const patterns = [
    /\bstatus\s*=\s*(\d{3})\b/i,
    /\bstatus\s+(\d{3})\b/i,
    /\bHTTP(?:\/\d(?:\.\d)?)?\s+(\d{3})\b/i,
    /\bresponse\s+status\s+is\s+(\d{3})\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function classifyDownloadFailure(message, file) {
  const status = httpStatusFromMessage(message);
  const url = String(file?.url || '');
  const text = String(message || '').toLowerCase();
  const isHuggingFace = /(^|\.)huggingface\.co\//i.test(url);
  const authFailure = status === 401 || status === 403;

  if (authFailure) {
    const hint = isHuggingFace
      ? 'Hugging Face access denied. If this is a gated repo, open the repo in your browser, agree/request access with the same account, save a valid HF token in Settings, then resume the job.'
      : 'Download access denied. Check authentication or permissions.';
    return {
      httpStatus: status,
      nonRetryable: true,
      error: `${hint}\n\n${message}`
    };
  }

  if (isHuggingFace && /\b(gated|restricted|access request|terms|license|unauthorized|forbidden)\b/i.test(text)) {
    return {
      httpStatus: status,
      nonRetryable: true,
      error: `Hugging Face gated repo access is required. Open the repo in your browser, agree/request access with the same account, save a valid HF token in Settings, then resume the job.\n\n${message}`
    };
  }

  return { httpStatus: status, nonRetryable: false, error: message };
}

function runAria2(file, options = {}) {
  fs.mkdirSync(file.output_dir, { recursive: true });
  const token = typeof options.getToken === 'function' ? options.getToken() : options.token;

  const args = [
    '-c',
    '--summary-interval=1',
    '--auto-file-renaming=false',
    '--allow-overwrite=true',
    '--max-tries=0',
    `--retry-wait=${options.retryWait || 10}`,
    `--timeout=${options.timeout || 60}`,
    `--lowest-speed-limit=${options.lowestSpeedLimit || '50K'}`,
    '-d',
    file.output_dir,
    '-o',
    file.output_name
  ];

  if (token) {
    args.push(`--header=Authorization: Bearer ${token}`);
  }

  args.push(file.url);

  const binary = getAria2Binary();
  if (!binary) {
    return {
      child: null,
      promise: Promise.resolve({ ok: false, error: 'aria2c was not found. Install aria2 and make sure aria2c is available.', childError: true })
    };
  }

  const child = spawn(binary, args, {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  let stdout = '';

  child.stdout.on('data', (chunk) => {
    const text = maskToken(chunk.toString(), token);
    const progress = parseAria2Progress(text);
    if (progress && typeof options.onProgress === 'function') {
      options.onProgress(progress);
    }
    stdout += text.slice(-4000);
  });

  child.stderr.on('data', (chunk) => {
    stderr += maskToken(chunk.toString(), token).slice(-4000);
  });

  const promise = new Promise((resolve) => {
    child.on('error', (error) => {
      resolve({ ok: false, error: maskToken(error.message, token), childError: true });
    });
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve({ ok: true });
        return;
      }
      const message = stderr || stdout || `aria2c exited with code ${code || 'none'} signal ${signal || 'none'}`;
      const failure = classifyDownloadFailure(maskToken(message.trim(), token), file);
      resolve({ ok: false, ...failure, code, signal });
    });
  });

  return { child, promise };
}

module.exports = {
  runAria2,
  maskToken,
  parseAria2Progress,
  classifyDownloadFailure
};
