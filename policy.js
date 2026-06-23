const { parseSpeed } = require('./settings');

function avg(samples) {
  if (!samples.length) return 0;
  return samples.reduce((sum, sample) => sum + sample.speedBps, 0) / samples.length;
}

class DownloadPolicyMonitor {
  constructor() {
    this.state = null;
    this.fileRestarts = new Map();
    this.jobRestarts = new Map();
    this.lastRestartAt = new Map();
  }

  start(jobId, fileId) {
    this.state = {
      jobId,
      fileId,
      samples: [],
      restartsThisFile: this.fileRestarts.get(fileId) || 0,
      restartsThisJob: this.jobRestarts.get(jobId) || 0,
      lastRestartAt: this.lastRestartAt.get(fileId) || 0
    };
  }

  stop() {
    this.state = null;
  }

  record(speedBps, policy) {
    if (!this.state) return;
    const now = Date.now();
    const averageWindow = policy.rules.averageDrop.windowSeconds || 600;
    const lowWindow = policy.rules.lowSpeed.durationSeconds || 120;
    const keepMs = (Math.max(averageWindow, lowWindow) + 30) * 1000;
    this.state.samples.push({ at: now, speedBps: Math.max(0, Number(speedBps || 0)) });
    this.state.samples = this.state.samples.filter((sample) => now - sample.at <= keepMs);
  }

  evaluate(policy) {
    if (!this.state || !policy.autoRestartEnabled) return null;
    const enabledRules = [];
    const results = [];

    if (policy.rules.lowSpeed.enabled) {
      enabledRules.push('lowSpeed');
      results.push(this.lowSpeed(policy));
    }

    if (policy.rules.averageDrop.enabled) {
      enabledRules.push('averageDrop');
      results.push(this.averageDrop(policy));
    }

    if (!enabledRules.length) return null;
    const matched = policy.behavior.applyRules === 'all'
      ? results.every(Boolean)
      : results.some(Boolean);
    if (!matched) return null;

    const limitReason = this.limitReason(policy);
    if (limitReason) return null;

    return {
      reason: results.filter(Boolean).map((item) => item.reason).join('; ') || 'Auto restart policy matched'
    };
  }

  lowSpeed(policy) {
    const now = Date.now();
    const durationMs = policy.rules.lowSpeed.durationSeconds * 1000;
    const samples = this.state.samples.filter((sample) => now - sample.at <= durationMs);
    if (!samples.length || now - samples[0].at < durationMs * 0.8) return null;
    const average = avg(samples);
    const limit = parseSpeed(policy.rules.lowSpeed.speedLimit);
    if (average < limit) {
      return { reason: `low speed below ${policy.rules.lowSpeed.speedLimit} for ${policy.rules.lowSpeed.durationSeconds}s` };
    }
    return null;
  }

  averageDrop(policy) {
    const now = Date.now();
    const longMs = policy.rules.averageDrop.windowSeconds * 1000;
    const recentMs = policy.rules.averageDrop.durationSeconds * 1000;
    const longSamples = this.state.samples.filter((sample) => now - sample.at <= longMs);
    const recentSamples = this.state.samples.filter((sample) => now - sample.at <= recentMs);
    if (!longSamples.length || !recentSamples.length) return null;
    if (now - longSamples[0].at < longMs * 0.5) return null;
    if (now - recentSamples[0].at < recentMs * 0.8) return null;

    const longAverage = avg(longSamples);
    const recentAverage = avg(recentSamples);
    const minBaseline = parseSpeed(policy.rules.averageDrop.minBaselineSpeed);
    if (longAverage < minBaseline) return null;

    const threshold = longAverage * (1 - policy.rules.averageDrop.dropPercent / 100);
    if (recentAverage < threshold) {
      return { reason: `speed dropped ${policy.rules.averageDrop.dropPercent}% below ${policy.rules.averageDrop.windowSeconds}s average` };
    }
    return null;
  }

  limitReason(policy) {
    const now = Date.now();
    const cooldownMs = policy.restartLimits.cooldownSeconds * 1000;
    if (cooldownMs && now - this.state.lastRestartAt < cooldownMs) return 'cooldown';
    if (this.state.restartsThisFile >= policy.restartLimits.maxRestartsPerFile) return 'file restart limit';
    if (this.state.restartsThisJob >= policy.restartLimits.maxRestartsPerJob) return 'job restart limit';
    return null;
  }

  markRestart() {
    if (!this.state) return;
    this.state.restartsThisFile += 1;
    this.state.restartsThisJob += 1;
    this.fileRestarts.set(this.state.fileId, this.state.restartsThisFile);
    this.jobRestarts.set(this.state.jobId, this.state.restartsThisJob);
    this.state.lastRestartAt = Date.now();
    this.lastRestartAt.set(this.state.fileId, this.state.lastRestartAt);
    this.state.samples = [];
  }
}

module.exports = {
  DownloadPolicyMonitor
};
