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
    throw new Error(`Hugging Face API error ${response.status}: ${text.slice(0, 300)}`);
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
  downloadUrl
};
