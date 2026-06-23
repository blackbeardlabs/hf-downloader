const jobsEl = document.querySelector('#jobs');
const filesEl = document.querySelector('#files');
const messageEl = document.querySelector('#message');
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

let selectedJobId = Number(localStorage.getItem('selectedJobId')) || null;
let hfPreviewFiles = [];
let settingsDefaults = null;

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

function showMessage(text, kind = '') {
  messageEl.textContent = text || '';
  messageEl.className = kind;
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function isActionEnabled(job, action) {
  if (action === 'start') return job.status === 'queued' || job.status === 'failed';
  if (action === 'pause') return job.status === 'running';
  if (action === 'resume') return job.status === 'paused';
  if (action === 'cancel') return !['completed', 'cancelled'].includes(job.status);
  if (action === 'delete') return true;
  return true;
}

function button(label, action, job) {
  const disabled = isActionEnabled(job, action) ? '' : ' disabled';
  return `<button data-action="${action}" data-id="${job.id}" type="button"${disabled}>${label}</button>`;
}

function renderJobs(jobs) {
  jobsEl.innerHTML = jobs.map((job) => `
    <tr class="${job.id === selectedJobId ? 'selected' : ''}" data-job-id="${job.id}">
      <td><button class="link" data-action="select" data-id="${job.id}" type="button">${escapeHtml(job.name)}</button></td>
      <td>${escapeHtml(job.type)}</td>
      <td><span class="status ${job.status}">${job.status}</span></td>
      <td>${job.completed_files}/${job.total_files}</td>
      <td>${bytes(job.downloaded_bytes)}</td>
      <td>${speed(job.speed_bps)}</td>
      <td class="actions">
        ${button('start', 'start', job)}
        ${button('pause', 'pause', job)}
        ${button('resume', 'resume', job)}
        ${button('cancel', 'cancel', job)}
        ${button('delete', 'delete', job)}
      </td>
    </tr>
  `).join('');
}

function renderFiles(files) {
  filesEl.innerHTML = files.map((file) => `
    <tr>
      <td>${escapeHtml(file.relative_path)}</td>
      <td><span class="status ${file.status}">${file.status}</span></td>
      <td>${bytes(file.downloaded)}</td>
      <td>${speed(file.speed_bps)}</td>
      <td>${file.attempts}</td>
      <td class="error">${escapeHtml(file.last_error || '')}</td>
    </tr>
  `).join('');
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
  const data = await api('/api/settings/download-policy');
  settingsDefaults = data.defaults;
  fillSettingsForm(data.policy);
  settingsModalEl.classList.remove('hidden');
}

function closeSettings() {
  settingsModalEl.classList.add('hidden');
}

function closeHfPreview() {
  hfPreviewModalEl.classList.add('hidden');
}

function clearHfPreview() {
  hfPreviewFiles = [];
  hfFilesEl.innerHTML = '';
  hfFileFilterEl.value = '';
  hfFileCountEl.textContent = 'No files loaded';
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

async function refresh() {
  try {
    const health = await api('/api/health');
    healthEl.textContent = health.ok ? 'ready' : 'error';
    healthEl.className = health.ok ? 'pill ok' : 'pill bad';
    renderTokenStatus(health.hfToken);
    renderAria2Status(health.aria2c);

    const { jobs } = await api('/api/jobs');
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
hfForm.addEventListener('input', clearHfPreview);

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
    const data = await api('/api/settings/download-policy', {
      method: 'PUT',
      body: JSON.stringify(policyFromSettingsForm())
    });
    fillSettingsForm(data.policy);
    showMessage('Settings saved', 'ok');
    closeSettings();
  } catch (error) {
    showMessage(error.message, 'error');
  }
});

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
    await refresh();
  } catch (error) {
    showMessage(error.message, 'error');
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!hfPreviewModalEl.classList.contains('hidden')) {
    closeHfPreview();
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
refresh();
setInterval(refresh, 2000);
