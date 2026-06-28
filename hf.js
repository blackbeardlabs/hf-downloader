const { safeRelativePath } = require('./paths');

const API_BASE = 'https://huggingface.co/api';
const HF_BASE = 'https://huggingface.co';

const repoPrefixes = {
  model: { api: 'models', download: '' },
  dataset: { api: 'datasets', download: 'datasets' },
  space: { api: 'spaces', download: 'spaces' }
};

function globToRegExp(pattern) {
  let out = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    const next = pattern[i + 1];
    if (char === '*' && next === '*') {
      out += '.*';
      i += 1;
    } else if (char === '*') {
      out += '[^/]*';
    } else if (char === '?') {
      out += '[^/]';
    } else {
      out += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  out += '$';
  return new RegExp(out);
}

function matchesPattern(relativePath, pattern) {
  const normalized = relativePath.replaceAll('\\', '/');
  const basename = normalized.split('/').pop();
  const regex = globToRegExp(pattern);
  return regex.test(normalized) || regex.test(basename);
}

function shouldInclude(relativePath, include = [], exclude = []) {
  const includes = Array.isArray(include) ? include.filter(Boolean) : [];
  const excludes = Array.isArray(exclude) ? exclude.filter(Boolean) : [];
  const included = includes.length === 0 || includes.some((pattern) => matchesPattern(relativePath, pattern));
  const excluded = excludes.some((pattern) => matchesPattern(relativePath, pattern));
  return included && !excluded;
}

function encodePath(relativePath) {
  return relativePath.split('/').map(encodeURIComponent).join('/');
}

function downloadUrl(repoId, repoType, revision, relativePath) {
  const prefix = repoPrefixes[repoType].download;
  const parts = [HF_BASE];
  if (prefix) parts.push(prefix);
  parts.push(repoId, 'resolve', encodeURIComponent(revision), encodePath(relativePath));
  return parts.join('/');
}

function repoUrl(repoId, repoType = 'model') {
  const prefix = repoPrefixes[repoType]?.download;
  const parts = [HF_BASE];
  if (prefix) parts.push(prefix);
  parts.push(repoId);
  return parts.join('/');
}

function parseErrorText(text) {
  if (!text) return '';
  try {
    const data = JSON.parse(text);
    return data.error || data.message || text;
  } catch {
    return text;
  }
}

function huggingFaceApiError(status, text, repoId, repoType) {
  const message = parseErrorText(text).slice(0, 500);
  const lower = message.toLowerCase();
  const link = repoUrl(repoId, repoType);

  if (status === 401) {
    return new Error(`Hugging Face authentication required for ${repoId}. Save a valid HF token in Settings, then try again. Repo: ${link}`);
  }

  if (status === 403 || /\b(gated|restricted|access request|terms|license|forbidden)\b/.test(lower)) {
    return new Error(`Hugging Face gated repo access is required for ${repoId}. Open ${link} in your browser, agree/request access with the same account used for your token, then try again.`);
  }

  return new Error(`Hugging Face API error ${status}: ${message}`);
}

async function fetchRepoFiles({ repoId, repoType = 'model', revision = 'main', include = [], exclude = [], token }) {
  if (!repoId || typeof repoId !== 'string' || !repoId.includes('/')) {
    throw new Error('repoId must look like owner/repo-name');
  }
  if (!repoPrefixes[repoType]) {
    throw new Error('repoType must be model, dataset, or space');
  }

  const apiType = repoPrefixes[repoType].api;
  const url = `${API_BASE}/${apiType}/${repoId}/tree/${encodeURIComponent(revision)}?recursive=true`;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(url, { headers });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw huggingFaceApiError(response.status, text, repoId, repoType);
  }

  const entries = await response.json();
  if (!Array.isArray(entries)) {
    throw new Error('Unexpected Hugging Face API response');
  }

  return entries
    .filter((entry) => entry && entry.type === 'file' && entry.path)
    .map((entry) => ({
      relativePath: safeRelativePath(entry.path),
      size: Number.isFinite(entry.size) ? entry.size : null
    }))
    .filter((entry) => shouldInclude(entry.relativePath, include, exclude))
    .map((entry) => ({
      ...entry,
      url: downloadUrl(repoId, repoType, revision, entry.relativePath)
    }));
}

module.exports = {
  fetchRepoFiles,
  shouldInclude,
  downloadUrl,
  repoUrl,
  huggingFaceApiError
};
