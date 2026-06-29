const jobsEl = document.querySelector('#jobs');
const filesEl = document.querySelector('#files');
const toastContainerEl = document.querySelector('#toast-container');
const selectedJobEl = document.querySelector('#selected-job');
const healthEl = document.querySelector('#health');
const systemPanelEl = document.querySelector('#system-panel');
const aria2StatusEl = document.querySelector('#aria2-status');
const aria2CommandEl = document.querySelector('#aria2-command');
const aria2InstallStatusEl = document.querySelector('#aria2-install-status');
const installAria2Btn = document.querySelector('#install-aria2-btn');
const tokenPanelEl = document.querySelector('#token-panel');
const tokenForm = document.querySelector('#token-form');
const tokenStatusEl = document.querySelector('#token-status');
const settingsTokenStatusEl = document.querySelector('#settings-token-status');
const hfForm = document.querySelector('#hf-form');
const hfFilesEl = document.querySelector('#hf-files');
const hfFileToolsEl = document.querySelector('#hf-file-tools');
const hfFileCountEl = document.querySelector('#hf-file-count');
const hfFileFilterEl = document.querySelector('#hf-file-filter');
const hfPreviewModalEl = document.querySelector('#hf-preview-modal');
const settingsModalEl = document.querySelector('#settings-modal');
const settingsForm = document.querySelector('#settings-form');
const modelsModalEl = document.querySelector('#models-modal');
const modelsEl = document.querySelector('#models');
const modelSearchEl = document.querySelector('#model-search');
const modelDomainEl = document.querySelector('#model-domain');
const modelFormatEl = document.querySelector('#model-format');
const modelScanStatusEl = document.querySelector('#model-scan-status');
const modelProgressFillEl = document.querySelector('#model-progress-fill');
const modelCountEl = document.querySelector('#model-count');
const modelExportModalEl = document.querySelector('#model-export-modal');
const modelExportListEl = document.querySelector('#model-export-list');
const modelExportTextEl = document.querySelector('#model-export-text');
const modelExportCountEl = document.querySelector('#model-export-count');
const modelExportFormatEl = document.querySelector('#model-export-format');

let selectedJobId = Number(localStorage.getItem('selectedJobId')) || null;
let hfPreviewFiles = [];
let settingsDefaults = null;
let seenJobStatuses = new Map();
let didLoadJobsOnce = false;
let currentModels = [];
let currentModelTotal = 0;
let modelSort = { key: 'name', direction: 'asc' };
let currentExportModels = [];
let primaryModelsRoot = '';
let modelRootsLoaded = false;
const recentToasts = new Map();

function persistForm(form, key) {
  form.addEventListener('input', () => {
    const data = Object.fromEntries(new FormData(form).entries());
    localStorage.setItem(key, JSON.stringify(data));
  });
}

function restoreForm(form, key) {
  const raw = localStorage.getItem(key);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    for (const [name, value] of Object.entries(data)) {
      const field = form.elements[name];
      if (field) field.value = value;
    }
  } catch {
    localStorage.removeItem(key);
  }
}

function showToast(text, kind = 'info') {
  if (!text || !toastContainerEl) return;
  const toast = document.createElement('div');
  const safeKind = ['ok', 'error', 'info'].includes(kind) ? kind : 'info';
  const toastKey = `${safeKind}:${text}`;
  const now = Date.now();
  if (now - (recentToasts.get(toastKey) || 0) < 10000) return;
  recentToasts.set(toastKey, now);

  toast.className = `toast ${safeKind}`;
  toast.setAttribute('role', safeKind === 'error' ? 'alert' : 'status');
  toast.innerHTML = `
    <div class="toast-icon">
      <i class="fa-solid ${safeKind === 'ok' ? 'fa-check' : safeKind === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-info'}" aria-hidden="true"></i>
    </div>
    <div class="toast-text">${escapeHtml(text)}</div>
    <button class="toast-close" type="button" aria-label="Close notification">
      <i class="fa-solid fa-xmark" aria-hidden="true"></i>
    </button>
  `;

  const close = () => {
    toast.classList.add('toast-out');
    window.setTimeout(() => toast.remove(), 180);
  };

  toast.querySelector('.toast-close').addEventListener('click', close);
  toastContainerEl.appendChild(toast);
  window.setTimeout(close, safeKind === 'error' ? 7000 : 4200);
}

function showMessage(text, kind = '') {
  if (kind === 'ok' || kind === 'error') {
    showToast(text, kind);
  }
}

function renderTokenStatus(status) {
  if (!status || !status.hasToken) {
    tokenPanelEl.classList.remove('hidden');
    tokenStatusEl.textContent = 'No token saved';
    tokenStatusEl.className = 'token-status missing';
    settingsTokenStatusEl.textContent = 'No token saved';
    settingsTokenStatusEl.className = 'token-status missing';
    return;
  }
  tokenPanelEl.classList.add('hidden');
  tokenStatusEl.textContent = status.source === 'env' ? 'Token from env' : 'Token saved';
  tokenStatusEl.className = 'token-status ok';
  settingsTokenStatusEl.textContent = status.source === 'env' ? 'Token from env' : 'Token saved';
  settingsTokenStatusEl.className = 'token-status ok';
}

function renderAria2Status(status) {
  if (status && status.installed) {
    systemPanelEl.classList.add('hidden');
    aria2StatusEl.textContent = status.version || 'aria2c installed';
    aria2CommandEl.textContent = '';
    aria2InstallStatusEl.textContent = '';
    aria2InstallStatusEl.className = 'system-status';
    if (installAria2Btn) {
      installAria2Btn.disabled = false;
      installAria2Btn.textContent = 'Install aria2';
    }
    return;
  }
  systemPanelEl.classList.remove('hidden');
  aria2StatusEl.textContent = 'aria2c was not found.';
  aria2CommandEl.textContent = status?.command || '';
}

async function refreshTokenStatus() {
  const status = await api('/api/settings/hf-token');
  renderTokenStatus(status);
  return status;
}

async function refreshModelRoots() {
  const data = await api('/api/settings/model-roots');
  fillModelRoots(data.roots);
  return data;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function bytes(value) {
  const n = Number(value || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function speed(value) {
  const n = Number(value || 0);
  if (n <= 0) return '-';
  return `${bytes(n)}/s`;
}

function eta(value) {
  if (value === 0) return 'done';
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '-';
  if (n < 60) return `${n}s`;
  const minutes = Math.floor(n / 60);
  const seconds = n % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const hrs = hours % 24;
  return hrs ? `${days}d ${hrs}h` : `${days}d`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function progressBar(percent, label = '') {
  const value = Number(percent);
  const hasValue = Number.isFinite(value);
  const safeValue = hasValue ? Math.max(0, Math.min(100, value)) : 0;
  const text = hasValue ? `${safeValue.toFixed(safeValue >= 10 || safeValue === 0 ? 0 : 1)}%` : '-';
  return `
    <div class="progress-cell">
      <div class="progress-bar" aria-label="${escapeHtml(label || 'progress')}">
        <div class="progress-fill" style="width: ${safeValue}%"></div>
      </div>
      <div class="progress-meta">
        <span>${text}</span>
        ${label ? `<small>${escapeHtml(label)}</small>` : ''}
      </div>
    </div>
  `;
}

function downloadedLabel(item) {
  const downloaded = bytes(item.downloaded ?? item.downloaded_bytes);
  const total = Number(item.size || item.total_bytes || 0);
  if (!total) return downloaded;
  const suffix = item.unknown_size_files > 0 ? ` + ${item.unknown_size_files} unknown` : '';
  return `${downloaded} / ${bytes(total)}${suffix}`;
}

function modelMeta(value) {
  return value ? escapeHtml(value) : '<span class="muted">-</span>';
}

function truncateText(value, title = value) {
  const text = value || '';
  return `<span class="truncate" title="${escapeHtml(title || text)}">${escapeHtml(text)}</span>`;
}

function compareValues(a, b) {
  const an = Number(a);
  const bn = Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
}

function sortedModels(models) {
  const { key, direction } = modelSort;
  const factor = direction === 'desc' ? -1 : 1;
  return [...models].sort((a, b) => compareValues(a[key], b[key]) * factor);
}

function cleanExportCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\t/g, ' ')
    .trim();
}

function modelExportTable(models) {
  return [
    ['Name', 'Domain', 'Format', 'Arch', 'Creator', 'Quant', 'Precision', 'Size', 'Path'],
    ...models.map((model) => [
      model.name,
      model.domain,
      model.format,
      model.architecture,
      model.creator,
      model.quant,
      model.precision,
      bytes(model.size_bytes),
      model.path
    ].map(cleanExportCell))
  ];
}

function escapeCsvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function modelExportRows(models, format = 'aligned') {
  const table = modelExportTable(models);
  if (format === 'csv') {
    return table.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
  }
  if (format === 'tsv') {
    return table.map((row) => row.join('\t')).join('\n');
  }

  const widths = table[0].map((_, columnIndex) => (
    columnIndex === table[0].length - 1
      ? 0
      : Math.max(...table.map((row) => String(row[columnIndex] || '').length))
  ));

  return table.map((row) => row.map((cell, columnIndex) => {
    if (columnIndex === row.length - 1) return cell;
    return String(cell || '').padEnd(widths[columnIndex] + 2, ' ');
  }).join('')).join('\n');
}

function exportFileName(format = 'aligned') {
  const stamp = new Date().toISOString().slice(0, 10);
  const extension = format === 'csv' ? 'csv' : 'txt';
  return `hf-downloader-models-${stamp}.${extension}`;
}

function pathSeparatorFor(root) {
  return String(root || '').includes('\\') ? '\\' : '/';
}

function joinDisplayPath(root, relativePath) {
  const cleanRoot = String(root || '').trim().replace(/[\\/]+$/, '');
  const cleanRel = String(relativePath || '').trim().replace(/^[\\/]+/, '').replace(/[\\/]+/g, pathSeparatorFor(cleanRoot));
  if (!cleanRoot) return '';
  if (!cleanRel) return cleanRoot;
  return `${cleanRoot}${pathSeparatorFor(cleanRoot)}${cleanRel}`;
}

function repoTargetRelativePath(repoId) {
  const clean = String(repoId || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!clean) return '';
  const parts = clean.split('/').filter(Boolean).slice(0, 2);
  if (parts.some((part) => part === '.' || part === '..')) return '';
  return parts.join('/');
}

function updateHfTargetDir() {
  const target = hfForm.elements.targetDir;
  if (!target) return;
  target.placeholder = modelRootsLoaded && !primaryModelsRoot ? 'Set Models root in Settings' : '';
  target.value = joinDisplayPath(primaryModelsRoot, repoTargetRelativePath(hfForm.elements.repoId?.value));
}

function isActionEnabled(job, action) {
  if (action === 'start') return job.status === 'queued' || job.status === 'failed';
  if (action === 'pause') return job.status === 'running';
  if (action === 'resume') return job.status === 'paused';
  if (action === 'cancel') return !['completed', 'cancelled'].includes(job.status);
  if (action === 'delete') return true;
  return true;
}

const actionIcons = {
  start: 'fa-play',
  pause: 'fa-pause',
  resume: 'fa-rotate-right',
  cancel: 'fa-ban',
  delete: 'fa-trash'
};

function button(label, action, job) {
  const disabled = isActionEnabled(job, action) ? '' : ' disabled';
  const classes = ['icon-button'];
  if (action === 'delete') classes.push('danger');
  if (action === 'cancel') classes.push('secondary');
  const icon = actionIcons[action] || 'fa-circle';
  return `
    <button class="${classes.join(' ')}" data-action="${action}" data-id="${job.id}" type="button" title="${label}" aria-label="${label}"${disabled}>
      <i class="fa-solid ${icon}" aria-hidden="true"></i>
    </button>
  `;
}

function lifecycleButton(job) {
  if (job.status === 'running') return button('Pause', 'pause', job);
  if (job.status === 'paused') return button('Resume', 'resume', job);
  if (job.status === 'queued' || job.status === 'failed') return button('Start', 'start', job);
  return '<span class="muted">No action</span>';
}

function actionButtons(job) {
  return `
    ${lifecycleButton(job)}
    ${button('Cancel', 'cancel', job)}
    ${button('Delete', 'delete', job)}
  `;
}

function renderJobs(jobs) {
  jobsEl.innerHTML = jobs.map((job) => `
    <tr class="${job.id === selectedJobId ? 'selected' : ''}" data-job-id="${job.id}">
      <td class="cell-name">
        <button class="link truncate" data-action="select" data-id="${job.id}" type="button" title="${escapeHtml(job.name)}">${escapeHtml(job.name)}</button>
        <div class="job-meta">${escapeHtml(job.type)}</div>
      </td>
      <td><span class="status ${job.status}">${job.status}</span></td>
      <td>${progressBar(job.progress_percent, job.progress_basis === 'files' ? 'file count' : 'bytes')}</td>
      <td class="cell-number">${job.completed_files}/${job.total_files}</td>
      <td class="cell-bytes">${downloadedLabel(job)}</td>
      <td class="cell-number">${speed(job.speed_bps)}</td>
      <td class="cell-number">${eta(job.eta_seconds)}</td>
      <td class="actions">${actionButtons(job)}</td>
    </tr>
  `).join('');
}

function renderFiles(files) {
  filesEl.innerHTML = files.map((file) => `
    <tr>
      <td class="cell-name">${truncateText(file.relative_path)}</td>
      <td><span class="status ${file.status}">${file.status}</span></td>
      <td>${progressBar(file.progress_percent)}</td>
      <td class="cell-bytes">${downloadedLabel(file)}</td>
      <td class="cell-number">${speed(file.speed_bps)}</td>
      <td class="cell-number">${eta(file.eta_seconds)}</td>
      <td class="cell-number">${file.attempts}</td>
      <td class="error">${truncateText(file.last_error || '')}</td>
    </tr>
  `).join('');
}

function storageKeyForTable(table) {
  if (table.classList.contains('jobs-table')) return 'columnPercents:jobs';
  if (table.classList.contains('models-table')) return 'columnPercents:models';
  return 'columnPercents:files';
}

function tableHeaders(table) {
  return [...table.querySelectorAll('thead th')];
}

function columnPercents(table) {
  const tableWidth = table.getBoundingClientRect().width || 1;
  return tableHeaders(table).map((th) => (th.getBoundingClientRect().width / tableWidth) * 100);
}

function applyColumnPercents(table, percents) {
  const headers = tableHeaders(table);
  headers.forEach((th, index) => {
    const value = Number(percents[index]);
    if (Number.isFinite(value) && value > 0) th.style.width = `${value}%`;
  });
}

function saveColumnPercents(table) {
  localStorage.setItem(storageKeyForTable(table), JSON.stringify(columnPercents(table)));
}

function applySavedColumnPercents(table) {
  const raw = localStorage.getItem(storageKeyForTable(table));
  if (!raw) return false;
  try {
    const percents = JSON.parse(raw);
    if (!Array.isArray(percents)) return false;
    if (percents.length !== tableHeaders(table).length) {
      localStorage.removeItem(storageKeyForTable(table));
      return false;
    }
    applyColumnPercents(table, percents);
    return true;
  } catch {
    localStorage.removeItem(storageKeyForTable(table));
    return false;
  }
}

function clearOldColumnSettings() {
  localStorage.removeItem('columnWidths:jobs');
  localStorage.removeItem('columnWidths:files');
  localStorage.removeItem('columnWidths:models');
}

function initResizableTable(table) {
  if (!table || table.dataset.resizableReady) return;
  table.dataset.resizableReady = 'true';
  table.classList.add('resizable-table');
  clearOldColumnSettings();

  requestAnimationFrame(() => {
    applySavedColumnPercents(table);
  });

  tableHeaders(table).forEach((th) => {
    const handle = document.createElement('span');
    handle.className = 'column-resizer';
    handle.title = 'Resize column';
    th.appendChild(handle);

    handle.addEventListener('dblclick', () => {
      localStorage.removeItem(storageKeyForTable(table));
      tableHeaders(table).forEach((header) => {
        header.style.width = '';
      });
    });

    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);

      const startX = event.clientX;
      const headers = tableHeaders(table);
      const index = headers.indexOf(th);
      const neighborIndex = index < headers.length - 1 ? index + 1 : index - 1;
      if (neighborIndex < 0) return;

      const tableWidth = table.getBoundingClientRect().width || 1;
      const startPercents = columnPercents(table);
      const minPercent = Math.min(18, Math.max(5, (56 / tableWidth) * 100));

      const onMove = (moveEvent) => {
        const direction = index < neighborIndex ? 1 : -1;
        const deltaPercent = ((moveEvent.clientX - startX) / tableWidth) * 100 * direction;
        const pairTotal = startPercents[index] + startPercents[neighborIndex];
        const current = Math.max(minPercent, Math.min(pairTotal - minPercent, startPercents[index] + deltaPercent));
        const next = pairTotal - current;
        const nextPercents = [...startPercents];
        nextPercents[index] = current;
        nextPercents[neighborIndex] = next;
        applyColumnPercents(table, nextPercents);
      };

      const onUp = (upEvent) => {
        handle.releasePointerCapture(upEvent.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        saveColumnPercents(table);
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
    });
  });
}

function modalStorageKey(panel) {
  const modal = panel.closest('.modal');
  return `modalSize:${modal?.id || 'default'}`;
}

function applySavedModalSize(panel) {
  const raw = sessionStorage.getItem(modalStorageKey(panel));
  if (!raw) return;
  try {
    const size = JSON.parse(raw);
    const width = Number(size.width);
    const height = Number(size.height);
    const maxWidth = Math.max(360, window.innerWidth - 40);
    const maxHeight = Math.max(280, window.innerHeight - 40);
    if (Number.isFinite(width) && width >= 360) panel.style.width = `${Math.min(width, maxWidth)}px`;
    if (Number.isFinite(height) && height >= 280) panel.style.height = `${Math.min(height, maxHeight)}px`;
  } catch {
    sessionStorage.removeItem(modalStorageKey(panel));
  }
}

function saveModalSize(panel) {
  sessionStorage.setItem(modalStorageKey(panel), JSON.stringify({
    width: Math.round(panel.getBoundingClientRect().width),
    height: Math.round(panel.getBoundingClientRect().height)
  }));
}

function initResizableModals() {
  document.querySelectorAll('.modal-panel').forEach((panel) => {
    if (panel.dataset.modalResizableReady) return;
    panel.dataset.modalResizableReady = 'true';
    panel.classList.add('resizable-modal-panel');
    applySavedModalSize(panel);

    const handle = document.createElement('span');
    handle.className = 'modal-resizer';
    handle.title = 'Resize modal';
    panel.appendChild(handle);

    handle.addEventListener('dblclick', () => {
      sessionStorage.removeItem(modalStorageKey(panel));
      panel.style.width = '';
      panel.style.height = '';
    });

    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);

      const startX = event.clientX;
      const startY = event.clientY;
      const rect = panel.getBoundingClientRect();
      const maxWidth = Math.max(360, window.innerWidth - 40);
      const maxHeight = Math.max(280, window.innerHeight - 40);

      const onMove = (moveEvent) => {
        const nextWidth = Math.max(360, Math.min(maxWidth, rect.width + moveEvent.clientX - startX));
        const nextHeight = Math.max(280, Math.min(maxHeight, rect.height + moveEvent.clientY - startY));
        panel.style.width = `${Math.round(nextWidth)}px`;
        panel.style.height = `${Math.round(nextHeight)}px`;
      };

      const onUp = (upEvent) => {
        handle.releasePointerCapture(upEvent.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        saveModalSize(panel);
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
    });
  });
}

function hfPayloadFromForm() {
  const form = new FormData(hfForm);
  const payload = Object.fromEntries(form.entries());
  payload.include = payload.include ? payload.include.split(',').map((v) => v.trim()).filter(Boolean) : [];
  payload.exclude = payload.exclude ? payload.exclude.split(',').map((v) => v.trim()).filter(Boolean) : [];
  return payload;
}

function selectedHfFiles() {
  return [...hfFilesEl.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
}

function renderHfPreview(files) {
  hfPreviewFiles = files;
  hfFileFilterEl.value = '';
  hfFileCountEl.textContent = `${files.length} files loaded, ${files.length} selected`;
  hfFilesEl.innerHTML = files.map((file) => `
    <label class="file-choice" data-path="${escapeHtml(file.relativePath.toLowerCase())}">
      <input type="checkbox" value="${escapeHtml(file.relativePath)}" checked>
      <span>${escapeHtml(file.relativePath)}</span>
      <small>${file.size ? bytes(file.size) : ''}</small>
    </label>
  `).join('');
  hfPreviewModalEl.classList.remove('hidden');
}

function updateHfSelectionCount() {
  if (!hfPreviewFiles.length) return;
  const visible = hfFilesEl.querySelectorAll('.file-choice:not(.hidden)').length;
  hfFileCountEl.textContent = `${hfPreviewFiles.length} files loaded, ${visible} visible, ${selectedHfFiles().length} selected`;
}

function filterHfPreview() {
  const needle = hfFileFilterEl.value.trim().toLowerCase();
  hfFilesEl.querySelectorAll('.file-choice').forEach((row) => {
    const path = row.dataset.path || '';
    row.classList.toggle('hidden', Boolean(needle) && !path.includes(needle));
  });
  updateHfSelectionCount();
}

function fillSettingsForm(policy) {
  settingsForm.autoRestartEnabled.checked = policy.autoRestartEnabled;
  settingsForm.applyRules.value = policy.behavior.applyRules;
  settingsForm.lowSpeedEnabled.checked = policy.rules.lowSpeed.enabled;
  settingsForm.lowSpeedLimit.value = policy.rules.lowSpeed.speedLimit;
  settingsForm.lowSpeedDuration.value = policy.rules.lowSpeed.durationSeconds;
  settingsForm.averageDropEnabled.checked = policy.rules.averageDrop.enabled;
  settingsForm.averageWindow.value = policy.rules.averageDrop.windowSeconds;
  settingsForm.averageDuration.value = policy.rules.averageDrop.durationSeconds;
  settingsForm.dropPercent.value = policy.rules.averageDrop.dropPercent;
  settingsForm.minBaselineSpeed.value = policy.rules.averageDrop.minBaselineSpeed;
  settingsForm.maxRestartsPerFile.value = policy.restartLimits.maxRestartsPerFile;
  settingsForm.maxRestartsPerJob.value = policy.restartLimits.maxRestartsPerJob;
  settingsForm.cooldownSeconds.value = policy.restartLimits.cooldownSeconds;
}

function fillModelRoots(roots) {
  const cleanRoots = roots || [];
  settingsForm.modelRoots.value = cleanRoots.join('\n');
  primaryModelsRoot = String(cleanRoots[0] || '');
  modelRootsLoaded = true;
  updateHfTargetDir();
}

function modelRootsFromSettingsForm() {
  return String(settingsForm.modelRoots.value || '')
    .split(/\r?\n/)
    .map((root) => root.trim())
    .filter(Boolean);
}

function policyFromSettingsForm() {
  return {
    autoRestartEnabled: settingsForm.autoRestartEnabled.checked,
    behavior: {
      applyRules: settingsForm.applyRules.value
    },
    rules: {
      lowSpeed: {
        enabled: settingsForm.lowSpeedEnabled.checked,
        speedLimit: settingsForm.lowSpeedLimit.value,
        durationSeconds: Number(settingsForm.lowSpeedDuration.value)
      },
      averageDrop: {
        enabled: settingsForm.averageDropEnabled.checked,
        windowSeconds: Number(settingsForm.averageWindow.value),
        durationSeconds: Number(settingsForm.averageDuration.value),
        dropPercent: Number(settingsForm.dropPercent.value),
        minBaselineSpeed: settingsForm.minBaselineSpeed.value
      }
    },
    restartLimits: {
      maxRestartsPerFile: Number(settingsForm.maxRestartsPerFile.value),
      maxRestartsPerJob: Number(settingsForm.maxRestartsPerJob.value),
      cooldownSeconds: Number(settingsForm.cooldownSeconds.value)
    }
  };
}

async function openSettings() {
  const [policyData, rootsData] = await Promise.all([
    api('/api/settings/download-policy'),
    api('/api/settings/model-roots')
  ]);
  settingsDefaults = policyData.defaults;
  fillSettingsForm(policyData.policy);
  fillModelRoots(rootsData.roots);
  settingsModalEl.classList.remove('hidden');
}

function closeSettings() {
  settingsModalEl.classList.add('hidden');
}

function closeHfPreview() {
  hfPreviewModalEl.classList.add('hidden');
}

function closeModels() {
  modelsModalEl.classList.add('hidden');
}

function closeModelExport() {
  modelExportModalEl.classList.add('hidden');
}

async function openModels() {
  modelsModalEl.classList.remove('hidden');
  await Promise.all([refreshModels(), refreshModelScanStatus()]);
}

function selectedExportModels() {
  const selected = new Set([...modelExportListEl.querySelectorAll('input[type="checkbox"]:checked')].map((input) => Number(input.value)));
  return currentExportModels.filter((model) => selected.has(model.id));
}

function updateModelExportText() {
  const selected = selectedExportModels();
  modelExportCountEl.textContent = `${selected.length} selected`;
  modelExportTextEl.value = modelExportRows(selected, modelExportFormatEl.value);
}

function setModelExportSelection(checked) {
  modelExportListEl.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = checked;
  });
  updateModelExportText();
}

function openModelExport() {
  currentExportModels = sortedModels(currentModels);
  modelExportListEl.innerHTML = currentExportModels.map((model) => `
    <label class="export-choice">
      <input type="checkbox" value="${model.id}" checked>
      ${truncateText(model.name, model.path || model.name)}
      <small>${escapeHtml([model.format, model.quant, bytes(model.size_bytes)].filter(Boolean).join(' / '))}</small>
    </label>
  `).join('');
  updateModelExportText();
  modelExportModalEl.classList.remove('hidden');
}

async function saveModelExport() {
  const text = modelExportTextEl.value.trimEnd();
  if (!text) {
    showMessage('Export text is empty', 'error');
    return;
  }

  const format = modelExportFormatEl.value;
  const name = exportFileName(format);
  try {
    const result = await api('/api/models/export-file', {
      method: 'POST',
      body: JSON.stringify({ suggestedName: name, text })
    });
    if (result.canceled) return;
    showMessage('Model list exported', 'ok');
    closeModelExport();
    return;
  } catch (error) {
    if (!/Native save dialog is not available/i.test(error.message)) throw error;
  }

  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName: name,
      types: [{
        description: format === 'csv' ? 'CSV file' : 'Text file',
        accept: format === 'csv' ? { 'text/csv': ['.csv'] } : { 'text/plain': ['.txt'] }
      }]
    });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
  } else {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  showMessage('Model list exported', 'ok');
  closeModelExport();
}

function clearHfPreview() {
  hfPreviewFiles = [];
  hfFilesEl.innerHTML = '';
  hfFileFilterEl.value = '';
  hfFileCountEl.textContent = 'No files loaded';
}

function renderModels(models) {
  document.querySelectorAll('.models-table th[data-sort]').forEach((th) => {
    const active = th.dataset.sort === modelSort.key;
    th.classList.toggle('sorted', active);
    th.dataset.direction = active ? modelSort.direction : '';
  });

  const sorted = sortedModels(models);
  const total = Number(currentModelTotal || sorted.length);
  modelCountEl.textContent = total === sorted.length
    ? `${total} model${total === 1 ? '' : 's'}`
    : `${sorted.length} of ${total} models`;
  modelsEl.innerHTML = sorted.map((model) => `
    <tr>
      <td class="cell-name">${truncateText(model.name, model.path || model.name)}</td>
      <td><span class="status queued">${escapeHtml(model.domain)}</span></td>
      <td>${truncateText(model.format)}</td>
      <td>${model.architecture ? truncateText(model.architecture) : modelMeta(model.architecture)}</td>
      <td>${model.creator ? truncateText(model.creator) : modelMeta(model.creator)}</td>
      <td>${model.quant ? truncateText(model.quant) : modelMeta(model.quant)}</td>
      <td>${model.precision ? truncateText(model.precision) : modelMeta(model.precision)}</td>
      <td class="cell-bytes">${bytes(model.size_bytes)}</td>
    </tr>
  `).join('');
}

async function refreshModels() {
  const params = new URLSearchParams();
  if (modelSearchEl.value.trim()) params.set('search', modelSearchEl.value.trim());
  if (modelDomainEl.value) params.set('domain', modelDomainEl.value);
  if (modelFormatEl.value) params.set('format', modelFormatEl.value);
  const suffix = params.toString() ? `?${params}` : '';
  const { models, total } = await api(`/api/models${suffix}`);
  currentModels = models;
  currentModelTotal = Number(total || models.length);
  renderModels(currentModels);
}

function renderModelScanStatus(status) {
  if (!status) {
    modelScanStatusEl.textContent = 'No scan running';
    modelProgressFillEl.style.width = '0%';
    return;
  }
  const rootCount = status.roots?.length || 0;
  const total = Number(status.total || 0);
  const current = Number(status.current || 0);
  const percent = total > 0 ? Math.max(0, Math.min(100, (current / total) * 100)) : (status.running ? 12 : 0);
  const phase = status.phase || (status.running ? 'scanning' : 'idle');
  const pathText = status.currentPath ? ` - ${status.currentPath}` : '';
  const base = status.running
    ? `${phase}: ${current}${total ? `/${total}` : ''}, indexed ${status.indexed}, scanned ${status.scanned}${pathText}`
    : status.finishedAt
      ? `Last scan finished: ${status.indexed} indexed from ${status.scanned} candidates`
      : `No scan running${rootCount ? ` (${rootCount} roots configured)` : ''}`;
  const errors = status.errors?.length ? `, ${status.errors.length} recent errors` : '';
  modelScanStatusEl.textContent = `${base}${errors}`;
  modelScanStatusEl.className = status.error ? 'model-scan-status error' : 'model-scan-status';
  modelProgressFillEl.style.width = status.finishedAt && !status.running ? '100%' : `${percent}%`;
}

async function refreshModelScanStatus() {
  const status = await api('/api/models/scan/status');
  renderModelScanStatus(status);
  if (!status.running) await refreshModels();
  return status;
}

async function importSelectedHfFiles() {
  const payload = hfPayloadFromForm();
  if (hfPreviewFiles.length) {
    payload.selectedFiles = selectedHfFiles();
    if (!payload.selectedFiles.length) {
      showMessage('Select at least one Hugging Face file', 'error');
      return;
    }
  }
  const data = await api('/api/hf/import', { method: 'POST', body: JSON.stringify(payload) });
  selectedJobId = data.job.id;
  localStorage.setItem('selectedJobId', String(selectedJobId));
  showMessage(`Imported ${data.files_added} files`, 'ok');
  closeHfPreview();
  await refresh();
}

function notifyJobStatusChanges(jobs) {
  const nextStatuses = new Map();
  for (const job of jobs) {
    const previous = seenJobStatuses.get(job.id);
    nextStatuses.set(job.id, job.status);

    if (!didLoadJobsOnce) continue;

    if (job.status === 'completed' && previous !== 'completed') {
      showToast(`Job completed: ${job.name}`, 'ok');
    }
    if (job.status === 'failed' && previous !== 'failed') {
      showToast(`Job failed: ${job.name}${job.error ? ` - ${job.error}` : ''}`, 'error');
    }
  }
  seenJobStatuses = nextStatuses;
  didLoadJobsOnce = true;
}

async function refresh() {
  try {
    const health = await api('/api/health');
    healthEl.textContent = health.ok ? 'ready' : 'error';
    healthEl.className = health.ok ? 'pill ok' : 'pill bad';
    renderTokenStatus(health.hfToken);
    renderAria2Status(health.aria2c);

    const { jobs } = await api('/api/jobs');
    notifyJobStatusChanges(jobs);
    renderJobs(jobs);
    if (selectedJobId) {
      const selected = jobs.find((job) => job.id === selectedJobId);
      if (!selected) {
        selectedJobId = null;
        localStorage.removeItem('selectedJobId');
        selectedJobEl.textContent = 'Select a job';
        filesEl.innerHTML = '';
        return;
      }
      selectedJobEl.textContent = selected ? `${selected.name} (${selected.status})` : 'Select a job';
      const { files } = await api(`/api/jobs/${selectedJobId}/files`);
      renderFiles(files);
    }
  } catch (error) {
    healthEl.textContent = 'error';
    healthEl.className = 'pill bad';
    showMessage(error.message, 'error');
  }
}

document.querySelector('#hf-preview').addEventListener('click', async () => {
  try {
    showMessage('Loading repo files...', '');
    const data = await api('/api/hf/files', { method: 'POST', body: JSON.stringify(hfPayloadFromForm()) });
    renderHfPreview(data.files);
    showMessage(`Loaded ${data.files.length} files`, 'ok');
  } catch (error) {
    showMessage(error.message, 'error');
  }
});

tokenForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = new FormData(tokenForm).get('token');
  try {
    const status = await api('/api/settings/hf-token', {
      method: 'PUT',
      body: JSON.stringify({ token })
    });
    tokenForm.reset();
    renderTokenStatus(status);
    showMessage('Token saved locally', 'ok');
  } catch (error) {
    showMessage(error.message, 'error');
  }
});

hfFilesEl.addEventListener('change', updateHfSelectionCount);
hfFileFilterEl.addEventListener('input', filterHfPreview);

restoreForm(hfForm, 'hfFormDraft');
restoreForm(document.querySelector('#url-form'), 'urlFormDraft');
persistForm(hfForm, 'hfFormDraft');
persistForm(document.querySelector('#url-form'), 'urlFormDraft');
document.querySelectorAll('table.jobs-table, table.files-table, table.models-table').forEach(initResizableTable);
initResizableModals();
updateHfTargetDir();
hfForm.addEventListener('input', () => {
  updateHfTargetDir();
  clearHfPreview();
});

hfForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await importSelectedHfFiles();
  } catch (error) {
    showMessage(error.message, 'error');
  }
});

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const [data, rootsData] = await Promise.all([
      api('/api/settings/download-policy', {
        method: 'PUT',
        body: JSON.stringify(policyFromSettingsForm())
      }),
      api('/api/settings/model-roots', {
        method: 'PUT',
        body: JSON.stringify({ roots: modelRootsFromSettingsForm() })
      })
    ]);
    fillSettingsForm(data.policy);
    fillModelRoots(rootsData.roots);
    showMessage('Settings saved', 'ok');
    closeSettings();
  } catch (error) {
    showMessage(error.message, 'error');
  }
});

[modelSearchEl, modelDomainEl, modelFormatEl].forEach((input) => {
  input.addEventListener('input', () => {
    refreshModels().catch((error) => showMessage(error.message, 'error'));
  });
});

modelDomainEl.addEventListener('change', () => {
  refreshModels().catch((error) => showMessage(error.message, 'error'));
});

modelFormatEl.addEventListener('change', () => {
  refreshModels().catch((error) => showMessage(error.message, 'error'));
});

document.querySelector('.models-table thead').addEventListener('click', (event) => {
  const header = event.target.closest('th[data-sort]');
  if (!header) return;
  const key = header.dataset.sort;
  modelSort = {
    key,
    direction: modelSort.key === key && modelSort.direction === 'asc' ? 'desc' : 'asc'
  };
  renderModels(currentModels);
});

modelExportListEl.addEventListener('change', (event) => {
  if (event.target.matches('input[type="checkbox"]')) {
    updateModelExportText();
  }
});

modelExportFormatEl.addEventListener('change', updateModelExportText);

document.querySelector('#url-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = {
    type: 'url_list',
    name: form.get('name'),
    targetDir: form.get('targetDir'),
    urls: String(form.get('urls') || '').split(/\r?\n/).map((v) => v.trim()).filter(Boolean)
  };
  try {
    const data = await api('/api/jobs', { method: 'POST', body: JSON.stringify(payload) });
    selectedJobId = data.job.id;
    localStorage.setItem('selectedJobId', String(selectedJobId));
    showMessage('Job created', 'ok');
    await refresh();
  } catch (error) {
    showMessage(error.message, 'error');
  }
});

document.addEventListener('click', async (event) => {
  const target = event.target.closest('button[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const id = Number(target.dataset.id);

  if (action === 'open-models') {
    try {
      await openModels();
    } catch (error) {
      showMessage(error.message, 'error');
    }
    return;
  }

  if (action === 'close-models') {
    closeModels();
    return;
  }

  if (action === 'scan-models') {
    try {
      await api('/api/models/scan', { method: 'POST' });
      showMessage('Model scan started', 'ok');
      await refreshModelScanStatus();
    } catch (error) {
      showMessage(error.message, 'error');
    }
    return;
  }

  if (action === 'open-model-export') {
    openModelExport();
    return;
  }

  if (action === 'close-model-export') {
    closeModelExport();
    return;
  }

  if (action === 'export-select-all') {
    setModelExportSelection(true);
    return;
  }

  if (action === 'export-select-none') {
    setModelExportSelection(false);
    return;
  }

  if (action === 'export-regenerate') {
    updateModelExportText();
    return;
  }

  if (action === 'save-model-export') {
    try {
      await saveModelExport();
    } catch (error) {
      if (error.name !== 'AbortError') showMessage(error.message, 'error');
    }
    return;
  }

  if (action === 'open-settings') {
    try {
      await openSettings();
    } catch (error) {
      showMessage(error.message, 'error');
    }
    return;
  }

  if (action === 'close-settings') {
    closeSettings();
    return;
  }

  if (action === 'reset-settings') {
    if (settingsDefaults) fillSettingsForm(settingsDefaults);
    return;
  }

  if (action === 'clear-token') {
    try {
      const status = await api('/api/settings/hf-token', { method: 'DELETE' });
      tokenForm.reset();
      renderTokenStatus(status);
      showMessage('Token cleared', 'ok');
    } catch (error) {
      showMessage(error.message, 'error');
    }
    return;
  }

  if (action === 'install-aria2') {
    const btn = target;
    const setBusy = (busy) => {
      if (!installAria2Btn) return;
      installAria2Btn.disabled = busy;
      installAria2Btn.textContent = busy ? 'Installing…' : 'Install aria2';
    };
    try {
      setBusy(true);
      aria2InstallStatusEl.textContent = 'Installing aria2… this can take a minute.';
      aria2InstallStatusEl.className = 'system-status';
      showMessage('Installing aria2...', '');
      const result = await api('/api/system/aria2/install', { method: 'POST' });
      renderAria2Status(result.aria2c);
      if (result.aria2c.installed) {
        aria2InstallStatusEl.textContent = '';
        showMessage('aria2 installed', 'ok');
      } else {
        const msg = result.output || result.aria2c.command || 'Install command finished';
        aria2InstallStatusEl.textContent = msg;
        aria2InstallStatusEl.className = 'system-status error';
        showMessage(msg, 'error');
      }
    } catch (error) {
      aria2InstallStatusEl.textContent = error.message;
      aria2InstallStatusEl.className = 'system-status error';
      showMessage(error.message, 'error');
    } finally {
      setBusy(false);
    }
    return;
  }

  if (action === 'close-hf-preview') {
    closeHfPreview();
    return;
  }

  if (action === 'hf-import-selected') {
    try {
      await importSelectedHfFiles();
    } catch (error) {
      showMessage(error.message, 'error');
    }
    return;
  }

  if (action === 'hf-select-all' || action === 'hf-select-none' || action === 'hf-select-visible') {
    hfFilesEl.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      if (action === 'hf-select-visible') {
        input.checked = !input.closest('.file-choice').classList.contains('hidden');
      } else {
        input.checked = action === 'hf-select-all';
      }
    });
    updateHfSelectionCount();
    return;
  }

  if (action === 'select') {
    selectedJobId = id;
    localStorage.setItem('selectedJobId', String(selectedJobId));
    await refresh();
    return;
  }

  try {
    const actionSuccess = {
      start: 'Job started',
      pause: 'Job paused',
      resume: 'Job resumed',
      cancel: 'Job cancelled',
      delete: 'Job deleted'
    };

    if (action === 'delete') {
      await api(`/api/jobs/${id}`, { method: 'DELETE' });
      if (selectedJobId === id) {
        selectedJobId = null;
        localStorage.removeItem('selectedJobId');
      }
    } else if (action === 'cancel') {
      await api(`/api/jobs/${id}/cancel`, { method: 'PUT' });
    } else {
      await api(`/api/jobs/${id}/${action}`, { method: 'PUT' });
    }
    if (action !== 'delete') {
      selectedJobId = id;
      localStorage.setItem('selectedJobId', String(selectedJobId));
    }
    if (actionSuccess[action]) {
      showMessage(actionSuccess[action], 'ok');
    }
    await refresh();
  } catch (error) {
    showMessage(error.message, 'error');
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!modelExportModalEl.classList.contains('hidden')) {
    closeModelExport();
    return;
  }
  if (!hfPreviewModalEl.classList.contains('hidden')) {
    closeHfPreview();
    return;
  }
  if (!modelsModalEl.classList.contains('hidden')) {
    closeModels();
    return;
  }
  if (!settingsModalEl.classList.contains('hidden')) {
    closeSettings();
  }
});

refreshTokenStatus()
  .then((status) => {
    if (!status.hasToken) tokenForm.token.focus();
  })
  .catch(() => {});
refreshModelRoots().catch(() => {});
refresh();
setInterval(refresh, 2000);
setInterval(() => {
  if (!modelsModalEl.classList.contains('hidden')) {
    refreshModelScanStatus().catch((error) => showMessage(error.message, 'error'));
  }
}, 2000);
