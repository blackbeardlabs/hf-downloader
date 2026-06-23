const {
  getJob,
  updateJob,
  updateFile,
  nextQueuedFile,
  markQueuedFiles,
  hasIncompleteFiles,
  listFiles,
  deleteJob
} = require('./db');
const { runAria2 } = require('./aria2');
const { DownloadPolicyMonitor } = require('./policy');

class DownloadQueue {
  constructor(options) {
    this.options = options;
    this.active = null;
    this.monitor = new DownloadPolicyMonitor();
    this.progress = {
      jobId: null,
      fileId: null,
      speedBps: 0,
      percent: null,
      updatedAt: 0
    };
  }

  startJob(jobId) {
    const job = getJob(jobId);
    if (!job) throw new Error('job not found');
    if (job.status === 'cancelled') throw new Error('cancelled jobs cannot be started');
    markQueuedFiles(jobId);
    updateJob(jobId, { status: 'queued', error: null });
    this.pump();
  }

  pauseJob(jobId) {
    const job = getJob(jobId);
    if (!job) throw new Error('job not found');
    if (this.active && this.active.jobId === Number(jobId)) {
      this.active.reason = 'paused';
      this.active.child?.kill('SIGTERM');
    }
    updateJob(jobId, { status: 'paused', error: null });
    for (const file of listFiles(jobId)) {
      if (file.status === 'downloading') {
        updateFile(file.id, { status: 'paused' });
      }
    }
  }

  cancelJob(jobId) {
    const job = getJob(jobId);
    if (!job) throw new Error('job not found');
    if (this.active && this.active.jobId === Number(jobId)) {
      this.active.reason = 'cancelled';
      updateFile(this.active.fileId, { status: 'paused' });
      this.active.child?.kill('SIGTERM');
    }
    updateJob(jobId, { status: 'cancelled', error: null });
  }

  deleteJob(jobId) {
    const job = getJob(jobId);
    if (!job) throw new Error('job not found');
    if (this.active && this.active.jobId === Number(jobId)) {
      this.active.reason = 'deleted';
      this.active.child?.kill('SIGTERM');
    }
    deleteJob(jobId);
  }

  speedForJob(jobId) {
    if (this.progress.jobId !== Number(jobId)) return 0;
    if (Date.now() - this.progress.updatedAt > 5000) return 0;
    return this.progress.speedBps || 0;
  }

  speedForFile(fileId) {
    if (this.progress.fileId !== Number(fileId)) return 0;
    if (Date.now() - this.progress.updatedAt > 5000) return 0;
    return this.progress.speedBps || 0;
  }

  pump() {
    if (this.active) return;

    const job = this.findNextRunnableJob();
    if (!job) return;

    const file = nextQueuedFile(job.id);
    if (!file) {
      const done = !hasIncompleteFiles(job.id);
      updateJob(job.id, { status: done ? 'completed' : 'failed', error: done ? null : 'No queued files remain' });
      setImmediate(() => this.pump());
      return;
    }

    this.runFile(job, file);
  }

  findNextRunnableJob() {
    const { db } = require('./db');
    return db.prepare(`
      SELECT * FROM jobs
      WHERE status IN ('queued', 'running')
      ORDER BY id ASC
      LIMIT 1
    `).get();
  }

  runFile(job, file) {
    updateJob(job.id, { status: 'running', error: null });
    updateFile(file.id, {
      status: 'downloading',
      attempts: file.attempts + 1,
      last_error: null
    });

    this.monitor.start(job.id, file.id);

    const { child, promise } = runAria2(file, {
      ...this.options,
      onProgress: (progress) => {
        this.progress = {
          jobId: job.id,
          fileId: file.id,
          speedBps: progress.speedBps || this.progress.speedBps || 0,
          percent: progress.percent ?? this.progress.percent,
          updatedAt: Date.now()
        };
        const updates = {};
        if (Number.isFinite(progress.downloaded)) updates.downloaded = progress.downloaded;
        if (Number.isFinite(progress.size)) updates.size = progress.size;
        if (Object.keys(updates).length) updateFile(file.id, updates);
        this.monitor.record(progress.speedBps || 0, this.options.getPolicy());
        const decision = this.monitor.evaluate(this.options.getPolicy());
        if (decision && this.active && this.active.fileId === file.id) {
          this.monitor.markRestart();
          this.active.reason = 'auto_restart';
          this.active.restartMessage = `Auto restart: ${decision.reason}`;
          this.active.child?.kill('SIGTERM');
        }
      }
    });
    this.active = { jobId: job.id, fileId: file.id, child, reason: null };

    promise.then((result) => {
      const active = this.active;
      this.active = null;
      const latestFile = listFiles(job.id).find((item) => item.id === file.id) || file;

      if (active && active.reason === 'paused') {
        this.monitor.stop();
        this.progress = { jobId: null, fileId: null, speedBps: 0, percent: null, updatedAt: 0 };
        updateFile(file.id, { status: 'paused' });
        updateJob(job.id, { status: 'paused', error: null });
        return;
      }

      if (active && active.reason === 'cancelled') {
        this.monitor.stop();
        this.progress = { jobId: null, fileId: null, speedBps: 0, percent: null, updatedAt: 0 };
        updateJob(job.id, { status: 'cancelled', error: null });
        return;
      }

      if (active && active.reason === 'deleted') {
        this.monitor.stop();
        this.progress = { jobId: null, fileId: null, speedBps: 0, percent: null, updatedAt: 0 };
        return;
      }

      if (active && active.reason === 'auto_restart') {
        this.progress = { jobId: null, fileId: null, speedBps: 0, percent: null, updatedAt: 0 };
        updateFile(file.id, { status: 'queued', last_error: active.restartMessage || 'Auto restart' });
        setImmediate(() => this.pump());
        return;
      }

      if (result.ok) {
        this.monitor.stop();
        const downloaded = latestFile.size || latestFile.downloaded || file.downloaded || null;
        updateFile(file.id, { status: 'completed', downloaded, last_error: null });
      } else {
        updateFile(file.id, { status: 'queued', last_error: result.error || 'Download failed' });
      }

      this.progress = { jobId: null, fileId: null, speedBps: 0, percent: null, updatedAt: 0 };
      setImmediate(() => this.pump());
    }).catch((error) => {
      this.active = null;
      this.progress = { jobId: null, fileId: null, speedBps: 0, percent: null, updatedAt: 0 };
      updateFile(file.id, { status: 'queued', last_error: error.message });
      setImmediate(() => this.pump());
    });
  }

}

module.exports = {
  DownloadQueue
};
