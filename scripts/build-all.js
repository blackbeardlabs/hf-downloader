const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const packageJson = require(path.join(projectRoot, 'package.json'));
const installedNativeBuild = path.join(projectRoot, 'node_modules', 'better-sqlite3', 'build');
const nativeModuleParts = [
  'resources',
  'app.asar.unpacked',
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node'
];

function inspectNativeBinary(buffer) {
  if (buffer.length >= 20 && buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    const littleEndian = buffer[5] === 1;
    const machine = littleEndian ? buffer.readUInt16LE(18) : buffer.readUInt16BE(18);
    const architectures = { 0x3e: 'x64', 0xb7: 'arm64' };
    return { platform: 'linux', arch: architectures[machine] || `machine-${machine}` };
  }

  if (buffer.length >= 64 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    const peOffset = buffer.readUInt32LE(0x3c);
    if (buffer.length >= peOffset + 6 && buffer.subarray(peOffset, peOffset + 4).equals(Buffer.from('PE\0\0'))) {
      const machine = buffer.readUInt16LE(peOffset + 4);
      const architectures = { 0x8664: 'x64', 0xaa64: 'arm64' };
      return { platform: 'win32', arch: architectures[machine] || `machine-${machine}` };
    }
  }

  if (buffer.length >= 8) {
    const magic = buffer.readUInt32LE(0);
    if (magic === 0xfeedfacf) {
      const cpuType = buffer.readUInt32LE(4);
      const architectures = { 0x01000007: 'x64', 0x0100000c: 'arm64' };
      return { platform: 'darwin', arch: architectures[cpuType] || `cpu-${cpuType}` };
    }
  }

  return { platform: 'unknown', arch: 'unknown' };
}

function validateNativeModule(filePath, expectedPlatform, expectedArch) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Packaged native module was not found: ${filePath}`);
  }

  const actual = inspectNativeBinary(fs.readFileSync(filePath));
  if (actual.platform !== expectedPlatform || actual.arch !== expectedArch) {
    throw new Error(
      `Wrong better-sqlite3 binary in ${filePath}: expected ${expectedPlatform}/${expectedArch}, ` +
      `found ${actual.platform}/${actual.arch}`
    );
  }

  console.log(`Verified better-sqlite3: ${actual.platform}/${actual.arch}`);
}

function nativeModulePath(outputDirectory, appBundle) {
  const base = appBundle
    ? path.join(projectRoot, 'dist', outputDirectory, appBundle, 'Contents')
    : path.join(projectRoot, 'dist', outputDirectory);
  const parts = appBundle ? ['Resources', ...nativeModuleParts.slice(1)] : nativeModuleParts;
  return path.join(base, ...parts);
}

function buildAll() {
  if (process.platform !== 'darwin') {
    throw new Error('npm run dist:all must run on macOS because the target set includes a macOS DMG.');
  }

  const macOutput = process.arch === 'x64' ? 'mac' : `mac-${process.arch}`;
  const productName = packageJson.build.productName;
  const steps = [
    {
      label: `macOS ${process.arch}`,
      script: 'dist:mac',
      module: nativeModulePath(macOutput, `${productName}.app`),
      platform: 'darwin',
      arch: process.arch
    },
    {
      label: 'Windows x64',
      script: 'dist:win',
      module: nativeModulePath('win-unpacked'),
      platform: 'win32',
      arch: 'x64'
    },
    {
      label: 'Linux x64',
      script: 'dist:linux',
      module: nativeModulePath('linux-unpacked'),
      platform: 'linux',
      arch: 'x64'
    },
    {
      label: 'Linux ARM64',
      script: 'dist:linux:arm64',
      module: nativeModulePath('linux-arm64-unpacked'),
      platform: 'linux',
      arch: 'arm64'
    }
  ];

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  let buildError = null;
  try {
    for (const step of steps) {
      console.log(`\n=== Building ${step.label} ===`);
      fs.rmSync(installedNativeBuild, { recursive: true, force: true });
      const result = spawnSync(npmCommand, ['run', step.script], {
        cwd: projectRoot,
        env: process.env,
        stdio: 'inherit'
      });

      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        throw new Error(`${step.label} build failed with exit code ${result.status || 1}.`);
      }

      validateNativeModule(step.module, step.platform, step.arch);
    }
  } catch (error) {
    buildError = error;
  }

  console.log('\n=== Restoring local Node.js native modules ===');
  const restore = spawnSync(npmCommand, ['run', 'rebuild:node'], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit'
  });
  if (restore.error) {
    throw restore.error;
  }
  if (restore.status !== 0) {
    if (buildError) {
      console.error(`Original build error: ${buildError.message}`);
    }
    throw new Error(`Local native-module restore failed with exit code ${restore.status || 1}.`);
  }
  if (buildError) {
    throw buildError;
  }

  console.log('\nAll configured Electron releases built and validated successfully.');
}

if (require.main === module) {
  try {
    buildAll();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { inspectNativeBinary, validateNativeModule };
