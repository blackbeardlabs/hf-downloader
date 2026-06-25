const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = process.env.HF_DOWNLOADER_DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  target_dir TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  error TEXT
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  output_dir TEXT NOT NULL,
  output_name TEXT NOT NULL,
  size INTEGER,
  downloaded INTEGER DEFAULT 0,
  status TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_dir TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  format TEXT NOT NULL,
  domain TEXT NOT NULL,
  architecture TEXT,
  creator TEXT,
  base_model TEXT,
  finetune TEXT,
  quant TEXT,
  params TEXT,
  precision TEXT,
  context_length INTEGER,
  size_bytes INTEGER DEFAULT 0,
  modified_at TEXT,
  metadata_json TEXT,
  scanned_at TEXT NOT NULL
);
`);

function now() {
  return new Date().toISOString();
}

function resetInterruptedWork() {
  const stamp = now();
  db.prepare(`
    UPDATE files
    SET status = 'queued', updated_at = ?
    WHERE status = 'downloading'
  `).run(stamp);
  db.prepare(`
    UPDATE jobs
    SET status = 'paused', updated_at = ?, error = COALESCE(error, 'Server restarted while job was running')
    WHERE status = 'running'
  `).run(stamp);
  db.prepare(`
    UPDATE files
    SET downloaded = 0, updated_at = ?
    WHERE status != 'completed' AND size IS NOT NULL AND downloaded >= size
  `).run(stamp);
}

function createJob({ type, name, targetDir }) {
  const stamp = now();
  const info = db.prepare(`
    INSERT INTO jobs (type, name, status, target_dir, created_at, updated_at)
    VALUES (?, ?, 'queued', ?, ?, ?)
  `).run(type, name, targetDir, stamp, stamp);
  return getJob(info.lastInsertRowid);
}

function addFile(file) {
  const stamp = now();
  const info = db.prepare(`
    INSERT INTO files (
      job_id, url, relative_path, output_dir, output_name, size, downloaded,
      status, attempts, last_error, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 0, 'queued', 0, NULL, ?, ?)
  `).run(
    file.jobId,
    file.url,
    file.relativePath,
    file.outputDir,
    file.outputName,
    file.size || null,
    stamp,
    stamp
  );
  return info.lastInsertRowid;
}

function getJob(id) {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
}

function listJobs() {
  return db.prepare(`
    SELECT
      j.*,
      COUNT(f.id) AS total_files,
      SUM(CASE WHEN f.status = 'completed' THEN 1 ELSE 0 END) AS completed_files,
      COALESCE(SUM(f.downloaded), 0) AS downloaded_bytes,
      COALESCE(SUM(CASE WHEN f.size IS NOT NULL THEN f.size ELSE 0 END), 0) AS total_bytes,
      SUM(CASE WHEN f.size IS NULL AND f.status NOT IN ('completed', 'skipped') THEN 1 ELSE 0 END) AS unknown_size_files
    FROM jobs j
    LEFT JOIN files f ON f.job_id = j.id
    GROUP BY j.id
    ORDER BY j.id DESC
  `).all();
}

function getJobWithStats(id) {
  return db.prepare(`
    SELECT
      j.*,
      COUNT(f.id) AS total_files,
      SUM(CASE WHEN f.status = 'completed' THEN 1 ELSE 0 END) AS completed_files,
      COALESCE(SUM(f.downloaded), 0) AS downloaded_bytes,
      COALESCE(SUM(CASE WHEN f.size IS NOT NULL THEN f.size ELSE 0 END), 0) AS total_bytes,
      SUM(CASE WHEN f.size IS NULL AND f.status NOT IN ('completed', 'skipped') THEN 1 ELSE 0 END) AS unknown_size_files
    FROM jobs j
    LEFT JOIN files f ON f.job_id = j.id
    WHERE j.id = ?
    GROUP BY j.id
  `).get(id);
}

function listFiles(jobId) {
  return db.prepare('SELECT * FROM files WHERE job_id = ? ORDER BY id ASC').all(jobId);
}

function nextQueuedFile(jobId) {
  return db.prepare(`
    SELECT * FROM files
    WHERE job_id = ? AND status IN ('queued', 'failed')
    ORDER BY id ASC
    LIMIT 1
  `).get(jobId);
}

function updateJob(id, fields) {
  const allowed = ['status', 'error'];
  const keys = Object.keys(fields).filter((key) => allowed.includes(key));
  if (!keys.length) return getJob(id);
  const assignments = keys.map((key) => `${key} = ?`);
  const values = keys.map((key) => fields[key]);
  values.push(now(), id);
  db.prepare(`UPDATE jobs SET ${assignments.join(', ')}, updated_at = ? WHERE id = ?`).run(...values);
  return getJob(id);
}

function updateFile(id, fields) {
  const allowed = ['status', 'attempts', 'last_error', 'downloaded', 'size'];
  const keys = Object.keys(fields).filter((key) => allowed.includes(key));
  if (!keys.length) return;
  const assignments = keys.map((key) => `${key} = ?`);
  const values = keys.map((key) => fields[key]);
  values.push(now(), id);
  db.prepare(`UPDATE files SET ${assignments.join(', ')}, updated_at = ? WHERE id = ?`).run(...values);
}

function markQueuedFiles(jobId) {
  db.prepare(`
    UPDATE files
    SET status = 'queued', last_error = NULL, updated_at = ?
    WHERE job_id = ? AND status IN ('paused', 'failed')
  `).run(now(), jobId);
}

function hasIncompleteFiles(jobId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM files
    WHERE job_id = ? AND status NOT IN ('completed', 'skipped')
  `).get(jobId);
  return row.count > 0;
}

function countFiles(jobId) {
  return db.prepare('SELECT COUNT(*) AS count FROM files WHERE job_id = ?').get(jobId).count;
}

function deleteJob(id) {
  return db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
}

function getSetting(key) {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key);
  if (!row) return null;
  return JSON.parse(row.value_json);
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), now());
}

function deleteSetting(key) {
  return db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

function listModels(filters = {}) {
  const clauses = [];
  const values = [];
  if (filters.domain) {
    clauses.push('domain = ?');
    values.push(filters.domain);
  }
  if (filters.format) {
    clauses.push('format = ?');
    values.push(filters.format);
  }
  if (filters.search) {
    clauses.push(`(
      name LIKE ?
      OR path LIKE ?
      OR architecture LIKE ?
      OR creator LIKE ?
      OR quant LIKE ?
    )`);
    const needle = `%${filters.search}%`;
    values.push(needle, needle, needle, needle, needle);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`
    SELECT * FROM model_index
    ${where}
    ORDER BY domain ASC, name ASC, path ASC
  `).all(...values);
}

function getModel(id) {
  return db.prepare('SELECT * FROM model_index WHERE id = ?').get(id);
}

function upsertModel(model) {
  const stamp = model.scannedAt || now();
  db.prepare(`
    INSERT INTO model_index (
      root_dir, path, name, format, domain, architecture, creator, base_model,
      finetune, quant, params, precision, context_length, size_bytes,
      modified_at, metadata_json, scanned_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      root_dir = excluded.root_dir,
      name = excluded.name,
      format = excluded.format,
      domain = excluded.domain,
      architecture = excluded.architecture,
      creator = excluded.creator,
      base_model = excluded.base_model,
      finetune = excluded.finetune,
      quant = excluded.quant,
      params = excluded.params,
      precision = excluded.precision,
      context_length = excluded.context_length,
      size_bytes = excluded.size_bytes,
      modified_at = excluded.modified_at,
      metadata_json = excluded.metadata_json,
      scanned_at = excluded.scanned_at
  `).run(
    model.rootDir,
    model.path,
    model.name,
    model.format,
    model.domain,
    model.architecture || null,
    model.creator || null,
    model.baseModel || null,
    model.finetune || null,
    model.quant || null,
    model.params || null,
    model.precision || null,
    model.contextLength || null,
    model.sizeBytes || 0,
    model.modifiedAt || null,
    JSON.stringify(model.metadata || {}),
    stamp
  );
}

function deleteModelsNotScannedAt(stamp) {
  return db.prepare('DELETE FROM model_index WHERE scanned_at != ?').run(stamp);
}

module.exports = {
  db,
  now,
  resetInterruptedWork,
  createJob,
  addFile,
  getJob,
  listJobs,
  getJobWithStats,
  listFiles,
  nextQueuedFile,
  updateJob,
  updateFile,
  markQueuedFiles,
  hasIncompleteFiles,
  countFiles,
  deleteJob,
  getSetting,
  setSetting,
  deleteSetting,
  listModels,
  getModel,
  upsertModel,
  deleteModelsNotScannedAt
};
