const { getSetting, setSetting, deleteSetting } = require('./db');

const SETTINGS_KEY = 'downloadPolicy';
const HF_TOKEN_KEY = 'hfToken';

const defaultDownloadPolicy = {
  autoRestartEnabled: false,
  behavior: {
    applyRules: 'any'
  },
  rules: {
    lowSpeed: {
      enabled: true,
      speedLimit: '5K',
      durationSeconds: 120
    },
    averageDrop: {
      enabled: false,
      windowSeconds: 600,
      dropPercent: 50,
      durationSeconds: 90,
      minBaselineSpeed: '20K'
    }
  },
  restartLimits: {
    maxRestartsPerFile: 5,
    maxRestartsPerJob: 30,
    cooldownSeconds: 60
  }
};

function parseSpeed(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)\s*([KMG]?)(?:B|iB)?$/i);
  if (!match) throw new Error(`Invalid speed value: ${value}`);
  const n = Number(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === 'G') return Math.round(n * 1024 * 1024 * 1024);
  if (unit === 'M') return Math.round(n * 1024 * 1024);
  if (unit === 'K') return Math.round(n * 1024);
  return Math.round(n);
}

function intInRange(value, name, min, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

function bool(value) {
  return Boolean(value);
}

function validateDownloadPolicy(input) {
  const src = input || {};
  const policy = JSON.parse(JSON.stringify(defaultDownloadPolicy));

  policy.autoRestartEnabled = bool(src.autoRestartEnabled);
  policy.behavior.applyRules = src.behavior?.applyRules === 'all' ? 'all' : 'any';

  policy.rules.lowSpeed.enabled = bool(src.rules?.lowSpeed?.enabled);
  policy.rules.lowSpeed.speedLimit = String(src.rules?.lowSpeed?.speedLimit || policy.rules.lowSpeed.speedLimit).trim();
  parseSpeed(policy.rules.lowSpeed.speedLimit);
  policy.rules.lowSpeed.durationSeconds = intInRange(src.rules?.lowSpeed?.durationSeconds ?? policy.rules.lowSpeed.durationSeconds, 'lowSpeed.durationSeconds', 5);

  policy.rules.averageDrop.enabled = bool(src.rules?.averageDrop?.enabled);
  policy.rules.averageDrop.windowSeconds = intInRange(src.rules?.averageDrop?.windowSeconds ?? policy.rules.averageDrop.windowSeconds, 'averageDrop.windowSeconds', 30);
  policy.rules.averageDrop.dropPercent = intInRange(src.rules?.averageDrop?.dropPercent ?? policy.rules.averageDrop.dropPercent, 'averageDrop.dropPercent', 1, 99);
  policy.rules.averageDrop.durationSeconds = intInRange(src.rules?.averageDrop?.durationSeconds ?? policy.rules.averageDrop.durationSeconds, 'averageDrop.durationSeconds', 5);
  policy.rules.averageDrop.minBaselineSpeed = String(src.rules?.averageDrop?.minBaselineSpeed || policy.rules.averageDrop.minBaselineSpeed).trim();
  parseSpeed(policy.rules.averageDrop.minBaselineSpeed);

  policy.restartLimits.maxRestartsPerFile = intInRange(src.restartLimits?.maxRestartsPerFile ?? policy.restartLimits.maxRestartsPerFile, 'maxRestartsPerFile', 0);
  policy.restartLimits.maxRestartsPerJob = intInRange(src.restartLimits?.maxRestartsPerJob ?? policy.restartLimits.maxRestartsPerJob, 'maxRestartsPerJob', 0);
  policy.restartLimits.cooldownSeconds = intInRange(src.restartLimits?.cooldownSeconds ?? policy.restartLimits.cooldownSeconds, 'cooldownSeconds', 0);

  return policy;
}

function getDownloadPolicy() {
  const stored = getSetting(SETTINGS_KEY);
  return validateDownloadPolicy(stored || defaultDownloadPolicy);
}

function saveDownloadPolicy(policy) {
  const clean = validateDownloadPolicy(policy);
  setSetting(SETTINGS_KEY, clean);
  return clean;
}

function getStoredHFToken() {
  const stored = getSetting(HF_TOKEN_KEY);
  if (stored && typeof stored.token === 'string' && stored.token.trim()) {
    return stored.token.trim();
  }
  return '';
}

function getHFToken() {
  return getStoredHFToken() || process.env.HF_TOKEN || '';
}

function getHFTokenStatus() {
  const stored = getStoredHFToken();
  if (stored) return { hasToken: true, source: 'stored' };
  if (process.env.HF_TOKEN) return { hasToken: true, source: 'env' };
  return { hasToken: false, source: 'none' };
}

function saveHFToken(token) {
  const clean = String(token || '').trim();
  if (!clean) {
    deleteSetting(HF_TOKEN_KEY);
    return getHFTokenStatus();
  }
  setSetting(HF_TOKEN_KEY, { token: clean });
  return getHFTokenStatus();
}

function clearHFToken() {
  deleteSetting(HF_TOKEN_KEY);
  return getHFTokenStatus();
}

module.exports = {
  defaultDownloadPolicy,
  parseSpeed,
  validateDownloadPolicy,
  getDownloadPolicy,
  saveDownloadPolicy,
  getHFToken,
  getHFTokenStatus,
  saveHFToken,
  clearHFToken
};
