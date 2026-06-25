const fs = require('fs');
const path = require('path');
const { upsertModel, deleteModelsNotScannedAt, now } = require('./db');

const scanStatus = {
  running: false,
  startedAt: null,
  finishedAt: null,
  roots: [],
  scanned: 0,
  indexed: 0,
  phase: 'idle',
  total: 0,
  current: 0,
  currentPath: '',
  errors: [],
  error: null
};

const SUPPORTED_EXTENSIONS = new Set(['.gguf', '.safetensors']);
const IGNORED_MODEL_NAME_PATTERNS = [
  /(^|[-_.\s])mmproj([-_.\s]|$)/i
];

function yieldToLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

function compact(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function safeJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function statInfo(filePath) {
  const stat = fs.statSync(filePath);
  return {
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString()
  };
}

function toSlugName(value) {
  return path.basename(String(value || '')).replace(/\.[^.]+$/, '');
}

function isGenericModelName(value) {
  const text = String(value || '').trim().toLowerCase();
  return !text || [
    'model',
    'models',
    'safetensors',
    'pytorch_model',
    'diffusion_pytorch_model',
    'adapter_model',
    'consolidated'
  ].includes(text);
}

function modelFolderName(filePath, rootDir) {
  const relative = path.relative(rootDir, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const parts = relative.split(path.sep).filter(Boolean);
  return parts.length >= 2 ? parts.at(-2) : null;
}

function modelDisplayName(filePath, rootDir, preferredName) {
  const preferred = compact(preferredName);
  if (preferred && !isGenericModelName(preferred)) return preferred;

  const shard = shardInfo(filePath);
  const stem = shard?.baseName || toSlugName(filePath);
  if (!isGenericModelName(stem)) return stem;

  return modelFolderName(filePath, rootDir) || preferred || stem;
}

function isIgnoredModelFile(filePath) {
  const name = path.basename(filePath);
  return IGNORED_MODEL_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

function inferCreator(filePath, rootDir) {
  const relative = path.relative(rootDir, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const parts = relative.split(path.sep).filter(Boolean);
  return parts.length >= 2 ? parts[0] : null;
}

function inferQuant(name) {
  const text = String(name || '');
  const match = text.match(/\b(?:I?Q\d(?:_[A-Z0-9]+)*|F(?:16|32)|BF16|FP(?:8|16|32)|INT(?:4|8))\b/i);
  return match ? match[0].toUpperCase() : null;
}

function inferParams(name) {
  const text = String(name || '');
  const match = text.match(/\b(\d+(?:\.\d+)?\s*[BM]|\d+x\d+(?:\.\d+)?B|\d+B-A\d+B)\b/i);
  return match ? match[1].replace(/\s+/g, '').toUpperCase() : null;
}

function inferArchitecture(name, metadata = {}) {
  const explicit = compact(metadata['general.architecture'] || metadata.architecture || metadata.model_type);
  if (explicit) return explicit;
  const text = String(name || '').toLowerCase();
  const known = [
    ['deepseek', 'deepseek'],
    ['qwen3', 'qwen3'],
    ['qwen2', 'qwen2'],
    ['llama', 'llama'],
    ['mistral', 'mistral'],
    ['mixtral', 'mixtral'],
    ['gemma', 'gemma'],
    ['phi', 'phi'],
    ['minimax', 'minimax'],
    ['glm', 'glm'],
    ['mimo', 'mimo'],
    ['step', 'step'],
    ['flux', 'flux'],
    ['sdxl', 'sdxl'],
    ['stable-diffusion-xl', 'sdxl'],
    ['stable-diffusion', 'stable-diffusion'],
    ['wan', 'wan'],
    ['hunyuan', 'hunyuan'],
    ['cogvideo', 'cogvideo']
  ];
  return known.find(([needle]) => text.includes(needle))?.[1] || null;
}

function inferDomain(name, metadata = {}, tensorNames = []) {
  const text = `${name} ${Object.values(metadata).join(' ')}`.toLowerCase();
  const tensors = tensorNames.slice(0, 200).join(' ').toLowerCase();
  if (text.includes('embedding')) return 'embedding';
  if (text.includes('controlnet')) return 'controlnet';
  if (text.includes('lora') || tensors.includes('lora_')) return 'lora';
  if (text.includes('vae') || tensors.includes('first_stage_model')) return 'vae';
  if (text.includes('wan') || text.includes('hunyuanvideo') || text.includes('cogvideo') || text.includes('video')) return 'video';
  if (
    text.includes('stable-diffusion') ||
    text.includes('sdxl') ||
    text.includes('flux') ||
    tensors.includes('diffusion_model') ||
    tensors.includes('model.diffusion_model') ||
    tensors.includes('conditioner.embedders') ||
    tensors.includes('unet')
  ) return 'image';
  return 'llm';
}

function readUInt64(buffer, offset) {
  return Number(buffer.readBigUInt64LE(offset));
}

class BufferReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }

  remaining() {
    return this.buffer.length - this.offset;
  }

  ensure(bytes) {
    if (this.remaining() < bytes) throw new Error('metadata exceeds read buffer');
  }

  u32() {
    this.ensure(4);
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  u64() {
    this.ensure(8);
    const value = readUInt64(this.buffer, this.offset);
    this.offset += 8;
    return value;
  }

  string() {
    const length = this.u64();
    if (length > this.remaining()) throw new Error('invalid string length');
    const value = this.buffer.toString('utf8', this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  skip(bytes) {
    this.ensure(bytes);
    this.offset += bytes;
  }
}

function readGgufValue(reader, type, depth = 0) {
  if (depth > 2) return null;
  if (type === 0 || type === 1) {
    reader.skip(1);
    return null;
  }
  if (type === 2 || type === 3) {
    reader.skip(2);
    return null;
  }
  if (type === 4) return reader.u32();
  if (type === 5) {
    reader.ensure(4);
    const value = reader.buffer.readInt32LE(reader.offset);
    reader.offset += 4;
    return value;
  }
  if (type === 6) {
    reader.ensure(4);
    const value = reader.buffer.readFloatLE(reader.offset);
    reader.offset += 4;
    return value;
  }
  if (type === 7) {
    reader.ensure(1);
    const value = Boolean(reader.buffer.readUInt8(reader.offset));
    reader.offset += 1;
    return value;
  }
  if (type === 8) return reader.string();
  if (type === 10 || type === 11 || type === 12) {
    reader.skip(8);
    return null;
  }
  if (type === 9) {
    const innerType = reader.u32();
    const length = reader.u64();
    const values = [];
    for (let i = 0; i < length; i += 1) {
      const value = readGgufValue(reader, innerType, depth + 1);
      if (values.length < 20 && value !== null) values.push(value);
    }
    return values;
  }
  return null;
}

function readGgufMetadata(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const readSize = Math.min(fs.fstatSync(fd).size, 16 * 1024 * 1024);
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, 0);
    if (buffer.toString('utf8', 0, 4) !== 'GGUF') return {};
    const reader = new BufferReader(buffer);
    reader.skip(4);
    const version = reader.u32();
    const tensorCount = reader.u64();
    const metadataCount = reader.u64();
    const metadata = {
      gguf_version: version,
      tensor_count: tensorCount
    };
    for (let i = 0; i < metadataCount; i += 1) {
      const key = reader.string();
      const type = reader.u32();
      const value = readGgufValue(reader, type);
      if (value !== null && key.length < 120) metadata[key] = value;
    }
    return metadata;
  } catch {
    return {};
  } finally {
    fs.closeSync(fd);
  }
}

function readSafeTensorsHeader(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const lengthBuffer = Buffer.alloc(8);
    fs.readSync(fd, lengthBuffer, 0, 8, 0);
    const headerLength = readUInt64(lengthBuffer, 0);
    if (!Number.isFinite(headerLength) || headerLength <= 0 || headerLength > 64 * 1024 * 1024) {
      return { metadata: {}, tensors: [] };
    }
    const headerBuffer = Buffer.alloc(headerLength);
    fs.readSync(fd, headerBuffer, 0, headerLength, 8);
    const parsed = JSON.parse(headerBuffer.toString('utf8'));
    const metadata = parsed.__metadata__ || {};
    const tensors = Object.keys(parsed).filter((key) => key !== '__metadata__');
    const dtypes = [...new Set(tensors.map((key) => parsed[key]?.dtype).filter(Boolean))];
    return { metadata: { ...metadata, dtypes }, tensors };
  } catch {
    return { metadata: {}, tensors: [] };
  } finally {
    fs.closeSync(fd);
  }
}

function modelFromGguf(filePath, rootDir, scanStamp) {
  const info = statInfo(filePath);
  const metadata = readGgufMetadata(filePath);
  const name = modelDisplayName(filePath, rootDir, metadata['general.name']);
  return {
    rootDir,
    path: filePath,
    name,
    format: 'gguf',
    domain: inferDomain(name, metadata),
    architecture: inferArchitecture(name, metadata),
    creator: inferCreator(filePath, rootDir),
    baseModel: compact(metadata['general.basename']),
    finetune: compact(metadata['general.finetune']),
    quant: inferQuant(filePath),
    params: compact(metadata['general.size_label']) || inferParams(filePath),
    precision: null,
    contextLength: Number(metadata[`${metadata['general.architecture']}.context_length`] || metadata['llama.context_length'] || 0) || null,
    sizeBytes: info.sizeBytes,
    modifiedAt: info.modifiedAt,
    metadata,
    scannedAt: scanStamp
  };
}

function modelFromSafeTensors(filePath, rootDir, scanStamp) {
  const info = statInfo(filePath);
  const { metadata, tensors } = readSafeTensorsHeader(filePath);
  const name = modelDisplayName(filePath, rootDir, metadata.title || metadata.name || metadata.model_name);
  return {
    rootDir,
    path: filePath,
    name,
    format: 'safetensors',
    domain: inferDomain(filePath, metadata, tensors),
    architecture: inferArchitecture(filePath, metadata),
    creator: inferCreator(filePath, rootDir),
    baseModel: compact(metadata.base_model || metadata.baseModel),
    finetune: compact(metadata.finetune || metadata.finetuned_from),
    quant: compact(metadata.quantization) || inferQuant(filePath),
    params: compact(metadata.parameter_count || metadata.params) || inferParams(filePath),
    precision: Array.isArray(metadata.dtypes) ? metadata.dtypes.join(', ') : compact(metadata.dtype),
    contextLength: Number(metadata.context_length || metadata.max_position_embeddings || 0) || null,
    sizeBytes: info.sizeBytes,
    modifiedAt: info.modifiedAt,
    metadata: { ...metadata, tensor_count: tensors.length, sample_tensors: tensors.slice(0, 30) },
    scannedAt: scanStamp
  };
}

function domainFromDiffusers(config, modelPath) {
  const text = `${JSON.stringify(config)} ${modelPath}`.toLowerCase();
  if (text.includes('wan') || text.includes('hunyuanvideo') || text.includes('cogvideo') || text.includes('video')) return 'video';
  if (text.includes('lora')) return 'lora';
  if (text.includes('controlnet')) return 'controlnet';
  if (text.includes('vae')) return 'vae';
  return 'image';
}

function directorySize(dir) {
  let total = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return total;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    try {
      if (entry.isDirectory()) total += directorySize(full);
      if (entry.isFile()) total += fs.statSync(full).size;
    } catch {
      // Ignore unreadable files while estimating model size.
    }
  }
  return total;
}

function modelFromDiffusers(dirPath, rootDir, scanStamp) {
  const config = safeJson(path.join(dirPath, 'model_index.json')) || {};
  const info = statInfo(dirPath);
  const name = compact(config._name_or_path) || path.basename(dirPath);
  const components = Object.keys(config).filter((key) => !key.startsWith('_'));
  return {
    rootDir,
    path: dirPath,
    name,
    format: 'diffusers',
    domain: domainFromDiffusers(config, dirPath),
    architecture: inferArchitecture(name, { architecture: config._class_name }),
    creator: inferCreator(dirPath, rootDir),
    baseModel: compact(config.base_model || config._name_or_path),
    finetune: null,
    quant: inferQuant(dirPath),
    params: inferParams(dirPath),
    precision: null,
    contextLength: null,
    sizeBytes: directorySize(dirPath),
    modifiedAt: info.modifiedAt,
    metadata: { class_name: config._class_name, components },
    scannedAt: scanStamp
  };
}

function indexFile(filePath, rootDir, scanStamp) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.gguf') return modelFromGguf(filePath, rootDir, scanStamp);
  if (ext === '.safetensors') return modelFromSafeTensors(filePath, rootDir, scanStamp);
  return null;
}

function shardInfo(filePath) {
  const ext = path.extname(filePath);
  const name = path.basename(filePath, ext);
  const patterns = [
    /^(.*?)-(\d{5})-of-(\d{5})$/i,
    /^(.*?)-(\d{4})-of-(\d{4})$/i,
    /^(.*?)-(\d+)-of-(\d+)$/i,
    /^(.*?)\.part(\d+)$/i,
    /^(.*?)-part-?(\d+)$/i
  ];
  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (!match) continue;
    return {
      baseName: match[1],
      index: Number(match[2]),
      total: Number(match[3] || 0) || null,
      ext: ext.toLowerCase()
    };
  }
  return null;
}

function groupModelFiles(files) {
  const groups = new Map();
  for (const file of files) {
    const info = shardInfo(file);
    const key = info
      ? `${path.dirname(file)}${path.sep}${info.baseName}${info.ext}`
      : file;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        shard: Boolean(info),
        baseName: info?.baseName || toSlugName(file),
        ext: (info?.ext || path.extname(file)).toLowerCase(),
        files: []
      });
    }
    groups.get(key).files.push(file);
  }
  return [...groups.values()].map((group) => {
    group.files.sort((a, b) => {
      const aInfo = shardInfo(a);
      const bInfo = shardInfo(b);
      return (aInfo?.index || 0) - (bInfo?.index || 0) || a.localeCompare(b);
    });
    return group;
  });
}

function modelFromFileGroup(group, rootDir, scanStamp) {
  const representative = group.files[0];
  const model = indexFile(representative, rootDir, scanStamp);
  if (!model) return null;
  if (group.files.length <= 1) return model;

  let sizeBytes = 0;
  let modifiedAt = model.modifiedAt;
  for (const file of group.files) {
    const info = statInfo(file);
    sizeBytes += info.sizeBytes;
    if (!modifiedAt || info.modifiedAt > modifiedAt) modifiedAt = info.modifiedAt;
  }

  const syntheticPath = group.key;
  const metadata = {
    ...model.metadata,
    shard_count: group.files.length,
    shard_files: group.files.map((file) => path.basename(file))
  };

  return {
    ...model,
    path: syntheticPath,
    name: model.name === toSlugName(representative) ? group.baseName : model.name,
    sizeBytes,
    modifiedAt,
    metadata
  };
}

async function collectGroups(rootDir, currentDir, groups, counter) {
  counter.count += 1;
  if (counter.count % 40 === 0) await yieldToLoop();
  scanStatus.phase = 'discovering';
  scanStatus.current += 1;
  scanStatus.currentPath = currentDir;

  let entries = [];
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch (error) {
    scanStatus.errors.push({ path: currentDir, error: error.message });
    return;
  }
  const diffusersConfig = entries.find((entry) => entry.isFile() && entry.name === 'model_index.json');
  if (diffusersConfig) {
    groups.push({ type: 'diffusers', rootDir, dirPath: currentDir, key: currentDir });
    return;
  }

  const modelFiles = [];
  for (const entry of entries) {
    const full = path.join(currentDir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await collectGroups(rootDir, full, groups, counter);
      continue;
    }
    if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) && !isIgnoredModelFile(full)) {
      modelFiles.push(full);
    }
  }

  for (const group of groupModelFiles(modelFiles)) {
    groups.push({ type: 'file-group', rootDir, group, key: group.key });
  }
}

async function indexGroups(groups, scanStamp) {
  scanStatus.phase = 'indexing';
  scanStatus.total = groups.length;
  scanStatus.current = 0;

  for (const item of groups) {
    scanStatus.current += 1;
    scanStatus.currentPath = item.key;
    if (scanStatus.current % 5 === 0) await yieldToLoop();

    try {
      let model = null;
      if (item.type === 'diffusers') {
        scanStatus.scanned += 1;
        model = modelFromDiffusers(item.dirPath, item.rootDir, scanStamp);
      } else {
        scanStatus.scanned += item.group.files.length;
        model = modelFromFileGroup(item.group, item.rootDir, scanStamp);
      }
      if (model) {
        upsertModel(model);
        scanStatus.indexed += 1;
      }
    } catch (error) {
      scanStatus.errors.push({ path: item.key, error: error.message });
    }
  }
}

function validateRoots(roots) {
  const clean = [];
  for (const root of roots || []) {
    const resolved = path.resolve(String(root || '').trim());
    if (!resolved) continue;
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) throw new Error(`Model root is not a directory: ${root}`);
    clean.push(resolved);
  }
  return [...new Set(clean)];
}

async function scanModelRoots(roots) {
  if (scanStatus.running) throw new Error('Model scan is already running');
  const resolvedRoots = validateRoots(roots);
  if (!resolvedRoots.length) throw new Error('Add at least one model root before scanning');
  Object.assign(scanStatus, {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    roots: resolvedRoots,
    scanned: 0,
    indexed: 0,
    phase: 'discovering',
    total: 0,
    current: 0,
    currentPath: '',
    errors: [],
    error: null
  });

  const scanStamp = now();
  setImmediate(() => {
    (async () => {
    try {
      const groups = [];
      for (const root of resolvedRoots) {
        await collectGroups(root, root, groups, { count: 0 });
      }
      scanStatus.total = groups.length;
      await indexGroups(groups, scanStamp);
      scanStatus.phase = 'cleanup';
      scanStatus.currentPath = '';
      deleteModelsNotScannedAt(scanStamp);
    } catch (error) {
      scanStatus.error = error.message;
    } finally {
      scanStatus.running = false;
      scanStatus.phase = 'done';
      scanStatus.finishedAt = new Date().toISOString();
    }
    })();
  });

  return getScanStatus();
}

function getScanStatus() {
  return {
    ...scanStatus,
    errors: scanStatus.errors.slice(-20)
  };
}

module.exports = {
  getScanStatus,
  scanModelRoots,
  inferQuant,
  inferParams,
  shardInfo,
  readGgufMetadata,
  readSafeTensorsHeader
};
