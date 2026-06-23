const path = require('path');

function assertSafeTargetDir(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('targetDir is required');
  }
  if (input.includes('\0')) {
    throw new Error('targetDir contains invalid characters');
  }
  const normalized = path.resolve(input);
  if (!path.isAbsolute(normalized)) {
    throw new Error('targetDir must be an absolute path');
  }
  return normalized;
}

function safeRelativePath(input) {
  const raw = String(input || '').replaceAll('\\', '/').trim();
  if (!raw || raw.includes('\0')) {
    throw new Error('relative path is invalid');
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === '.' || normalized.startsWith('../') || normalized === '..' || path.posix.isAbsolute(normalized)) {
    throw new Error(`unsafe relative path: ${input}`);
  }
  return normalized;
}

function splitOutput(targetDir, relativePath) {
  const safeRel = safeRelativePath(relativePath);
  const outputName = path.posix.basename(safeRel);
  const relDir = path.posix.dirname(safeRel);
  const outputDir = relDir === '.'
    ? targetDir
    : path.resolve(targetDir, ...relDir.split('/'));
  const finalPath = path.resolve(outputDir, outputName);
  const rootWithSep = targetDir.endsWith(path.sep) ? targetDir : `${targetDir}${path.sep}`;
  if (finalPath !== targetDir && !finalPath.startsWith(rootWithSep)) {
    throw new Error('output path escapes targetDir');
  }
  return { relativePath: safeRel, outputDir, outputName };
}

function filenameFromUrl(url, index) {
  let name = '';
  try {
    const parsed = new URL(url);
    name = decodeURIComponent(path.posix.basename(parsed.pathname || ''));
  } catch {
    throw new Error(`invalid URL: ${url}`);
  }
  name = name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!name || name === '.' || name === '..') {
    name = `download-${String(index + 1).padStart(3, '0')}`;
  }
  return safeRelativePath(name);
}

module.exports = {
  assertSafeTargetDir,
  safeRelativePath,
  splitOutput,
  filenameFromUrl
};
