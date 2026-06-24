require('dotenv').config();

const fs = require('fs');
const express = require('express');
const path = require('path');
const {
  resetInterruptedWork,
  createJob,
  addFile,
  listJobs,
  getJobWithStats,
  getJob,
  listFiles,
  countFiles
} = require('./db');
const { DownloadQueue } = require('./queue');
const { fetchRepoFiles } = require('./hf');
const { safeRelativePath, assertSafeTargetDir, splitOutput, filenameFromUrl } = require('./paths');
const { checkAria2, installAria2 } = require('./system');
const {
  getDownloadPolicy,
  saveDownloadPolicy,
  defaultDownloadPolicy,
  getHFToken,
  getHFTokenStatus,
  saveHFToken,
  clearHFToken
} = require('./settings');

const PORT = Number(process.env.PORT || 3021);

function ensureAria2() {
  const status = checkAria2();
  if (!status.installed) {
    throw new Error('aria2c was not found. Install aria2 and make sure aria2c is available in PATH.');
  }
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function parsePatterns(value) {
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter(Boolean);
  return [];
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function etaSeconds(remainingBytes, speedBps) {
  const remaining = Number(remainingBytes || 0);
  const speed = Number(speedBps || 0);
  if (remaining <= 0) return 0;
  if (speed <= 0) return null;
  return Math.ceil(remaining / speed);
}

function diskCompletedSize(file) {
  if (!file || file.status !== 'completed') return null;
  try {
    const stat = fs.statSync(path.join(file.output_dir, file.output_name));
    return stat.isFile() && stat.size > 0 ? stat.size : null;
  } catch {
    return null;
  }
}

function effectiveFileNumbers(file) {
  const diskSize = diskCompletedSize(file);
  const rawSize = Number(file.size || 0);
  const rawDownloaded = Number(file.downloaded || 0);
  const shouldTrustDisk = diskSize && rawSize > 0 && rawSize <= 1024 && diskSize > rawSize;
  const size = shouldTrustDisk ? diskSize : rawSize;
  const downloaded = shouldTrustDisk ? diskSize : rawDownloaded;
  return { size, downloaded };
}

function effectiveJobStats(job, files = null) {
  if (!Array.isArray(files)) {
    return {
      totalFiles: Number(job.total_files || 0),
      completedFiles: Number(job.completed_files || 0),
      downloadedBytes: Number(job.downloaded_bytes || 0),
      totalBytes: Number(job.total_bytes || 0),
      unknownSizeFiles: Number(job.unknown_size_files || 0)
    };
  }

  return files.reduce((stats, file) => {
    const numbers = effectiveFileNumbers(file);
    stats.totalFiles += 1;
    if (file.status === 'completed') stats.completedFiles += 1;
    stats.downloadedBytes += numbers.downloaded || 0;
    if (numbers.size > 0) {
      stats.totalBytes += numbers.size;
    } else if (!['completed', 'skipped'].includes(file.status)) {
      stats.unknownSizeFiles += 1;
    }
    return stats;
  }, {
    totalFiles: 0,
    completedFiles: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    unknownSizeFiles: 0
  });
}

function publicJob(job, speedBps = 0, files = null) {
  const {
    totalFiles,
    completedFiles,
    downloadedBytes,
    totalBytes,
    unknownSizeFiles
  } = effectiveJobStats(job, files);
  const byteProgress = totalBytes > 0 ? clampPercent((downloadedBytes / totalBytes) * 100) : null;
  const fileProgress = totalFiles > 0 ? clampPercent((completedFiles / totalFiles) * 100) : 0;
  const remainingBytes = totalBytes > 0 ? Math.max(totalBytes - downloadedBytes, 0) : null;
  const eta = unknownSizeFiles > 0 || remainingBytes === null ? null : etaSeconds(remainingBytes, speedBps);

  return {
    id: job.id,
    type: job.type,
    name: job.name,
    status: job.status,
    target_dir: job.target_dir,
    created_at: job.created_at,
    updated_at: job.updated_at,
    error: job.error,
    total_files: totalFiles,
    completed_files: completedFiles,
    downloaded_bytes: downloadedBytes,
    total_bytes: totalBytes,
    remaining_bytes: remainingBytes,
    unknown_size_files: unknownSizeFiles,
    progress_percent: byteProgress ?? fileProgress,
    progress_basis: byteProgress === null ? 'files' : 'bytes',
    eta_seconds: eta,
    speed_bps: speedBps
  };
}

function publicFile(file, queue) {
  const speedBps = queue.speedForFile(file.id);
  const { size, downloaded } = effectiveFileNumbers(file);
  const remaining = size > 0 ? Math.max(size - downloaded, 0) : null;
  const progress = size > 0
    ? clampPercent((downloaded / size) * 100)
    : (file.status === 'completed' ? 100 : null);

  return {
    ...file,
    downloaded,
    size: size || file.size,
    remaining_bytes: remaining,
    progress_percent: progress,
    eta_seconds: remaining === null ? null : etaSeconds(remaining, speedBps),
    speed_bps: speedBps
  };
}

function createApp(queue) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/vendor/fontawesome', express.static(path.join(__dirname, 'node_modules', '@fortawesome', 'fontawesome-free')));
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, aria2c: checkAria2(), hfToken: getHFTokenStatus() });
  });

  app.get('/api/system/aria2', (req, res) => {
    res.json(checkAria2());
  });

  app.post('/api/system/aria2/install', asyncHandler(async (req, res) => {
    const result = await installAria2();
    res.json({ ...result, aria2c: checkAria2() });
  }));

  app.get('/api/settings/hf-token', (req, res) => {
    res.json(getHFTokenStatus());
  });

  app.put('/api/settings/hf-token', (req, res) => {
    res.json(saveHFToken(req.body?.token));
  });

  app.delete('/api/settings/hf-token', (req, res) => {
    res.json(clearHFToken());
  });

  app.get('/api/settings/download-policy', (req, res) => {
    res.json({ policy: getDownloadPolicy(), defaults: defaultDownloadPolicy });
  });

  app.put('/api/settings/download-policy', (req, res) => {
    res.json({ policy: saveDownloadPolicy(req.body || {}) });
  });

  app.get('/api/jobs', (req, res) => {
    res.json({ jobs: listJobs().map((job) => publicJob(job, queue.speedForJob(job.id), listFiles(job.id))) });
  });

  app.get('/api/jobs/:id', (req, res) => {
    const job = getJobWithStats(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    res.json({ job: publicJob(job, queue.speedForJob(job.id), listFiles(job.id)) });
  });

  app.get('/api/jobs/:id/files', (req, res) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    res.json({ files: listFiles(req.params.id).map((file) => publicFile(file, queue)) });
  });

  app.post('/api/jobs', asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (body.type !== 'url_list') {
    return res.status(400).json({ error: 'type must be url_list' });
  }
  const urls = Array.isArray(body.urls) ? body.urls.map(String).map((u) => u.trim()).filter(Boolean) : [];
  if (!urls.length) {
    return res.status(400).json({ error: 'urls must contain at least one URL' });
  }

  const targetDir = assertSafeTargetDir(body.targetDir);
  fs.mkdirSync(targetDir, { recursive: true });

  const job = createJob({
    type: 'url_list',
    name: String(body.name || 'manual-downloads').trim() || 'manual-downloads',
    targetDir
  });

  urls.forEach((url, index) => {
    const relativePath = filenameFromUrl(url, index);
    const output = splitOutput(targetDir, relativePath);
    addFile({
      jobId: job.id,
      url,
      relativePath: output.relativePath,
      outputDir: output.outputDir,
      outputName: output.outputName
    });
  });

  res.status(201).json({ job: publicJob(getJobWithStats(job.id), 0) });
  }));

  app.post('/api/hf/files', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const files = await fetchRepoFiles({
    repoId: body.repoId,
    repoType: body.repoType || 'model',
    revision: body.revision || 'main',
    include: parsePatterns(body.include),
    exclude: parsePatterns(body.exclude),
    token: getHFToken()
  });

  res.json({
    files: files.map((file) => ({
      relativePath: file.relativePath,
      size: file.size
    }))
  });
  }));

  app.post('/api/hf/import', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const repoType = body.repoType || 'model';
  const revision = body.revision || 'main';
  const targetDir = assertSafeTargetDir(body.targetDir);
  fs.mkdirSync(targetDir, { recursive: true });
  const selectedPaths = Array.isArray(body.selectedFiles)
    ? new Set(body.selectedFiles.map((item) => safeRelativePath(item)))
    : null;

  let files = await fetchRepoFiles({
    repoId: body.repoId,
    repoType,
    revision,
    include: parsePatterns(body.include),
    exclude: parsePatterns(body.exclude),
    token: getHFToken()
  });

  if (selectedPaths) {
    files = files.filter((file) => selectedPaths.has(file.relativePath));
  }

  if (!files.length) {
    return res.status(400).json({ error: 'No files matched the selected files or include/exclude rules' });
  }

  const job = createJob({
    type: 'hf_repo',
    name: `${body.repoId}@${revision}`,
    targetDir
  });

  files.forEach((file) => {
    const output = splitOutput(targetDir, file.relativePath);
    addFile({
      jobId: job.id,
      url: file.url,
      relativePath: output.relativePath,
      outputDir: output.outputDir,
      outputName: output.outputName,
      size: file.size
    });
  });

  res.status(201).json({ job: publicJob(getJobWithStats(job.id), 0), files_added: countFiles(job.id) });
  }));

  app.put('/api/jobs/:id/start', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  ensureAria2();
  queue.startJob(job.id);
  res.json({ job: publicJob(getJobWithStats(job.id), queue.speedForJob(job.id)) });
  });

  app.put('/api/jobs/:id/resume', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  ensureAria2();
  queue.startJob(job.id);
  res.json({ job: publicJob(getJobWithStats(job.id), queue.speedForJob(job.id)) });
  });

  app.put('/api/jobs/:id/pause', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  queue.pauseJob(job.id);
  res.json({ job: publicJob(getJobWithStats(job.id), 0) });
  });

  app.put('/api/jobs/:id/cancel', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  queue.cancelJob(job.id);
  res.json({ job: publicJob(getJobWithStats(job.id), 0) });
  });

  app.delete('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  queue.deleteJob(job.id);
  res.json({ ok: true });
  });

  app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const message = err && err.message ? err.message : 'Unexpected server error';
  res.status(400).json({ error: message });
  });

  return app;
}

function startServer(options = {}) {
  resetInterruptedWork();

  const queue = new DownloadQueue({
    getToken: getHFToken,
    lowestSpeedLimit: process.env.LOWEST_SPEED_LIMIT || '50K',
    timeout: Number(process.env.ARIA2_TIMEOUT || 60),
    retryWait: Number(process.env.ARIA2_RETRY_WAIT || 10),
    getPolicy: getDownloadPolicy
  });

  const app = createApp(queue);
  const port = Number(options.port ?? PORT);
  const server = app.listen(port, () => {
    if (options.log !== false) {
      console.log(`hf-downloader listening at http://localhost:${port}`);
    }
  });

  return { app, server, queue, port };
}

if (require.main === module) {
  try {
    startServer();
  } catch (error) {
    console.error(error.message);
    console.error('Linux Mint / Ubuntu / Debian: sudo apt update && sudo apt install aria2');
    console.error('macOS: brew install aria2');
    console.error('Windows: winget install aria2.aria2');
    process.exit(1);
  }
}

module.exports = {
  createApp,
  startServer,
  ensureAria2
};
