const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BIN_DIRS = process.platform === 'win32'
  ? []
  : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];

function resolveCommand(command) {
  if (path.isAbsolute(command) && fs.existsSync(command)) return command;
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], { encoding: 'utf8' });
  if (result.status === 0) {
    const found = result.stdout.split(/\r?\n/)[0].trim();
    if (found) return found;
  }
  if (process.platform === 'win32') return '';
  for (const dir of BIN_DIRS) {
    const candidate = path.join(dir, command);
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

function commandExists(command) {
  return Boolean(resolveCommand(command));
}

function envWithPath(...dirs) {
  const extra = dirs.filter(Boolean);
  if (!extra.length) return process.env;
  return {
    ...process.env,
    PATH: [...extra, process.env.PATH || ''].filter(Boolean).join(path.delimiter)
  };
}

let aria2BinaryCache = null;
function getAria2Binary() {
  if (aria2BinaryCache) return aria2BinaryCache;
  const command = process.platform === 'win32' ? 'aria2c.exe' : 'aria2c';
  const found = resolveCommand(command) || resolveCommand('aria2c');
  if (found) aria2BinaryCache = found;
  return found;
}

function checkAria2() {
  const command = process.platform === 'win32' ? 'aria2c.exe' : 'aria2c';
  const foundPath = resolveCommand(command) || resolveCommand('aria2c');
  if (!foundPath) {
    return {
      installed: false,
      platform: process.platform,
      command: installCommand()
    };
  }

  const version = spawnSync(foundPath, ['--version'], { encoding: 'utf8' });
  return {
    installed: version.status === 0,
    platform: process.platform,
    path: foundPath,
    version: version.stdout ? version.stdout.split(/\r?\n/)[0] : '',
    command: installCommand()
  };
}

function installCommand() {
  if (process.platform === 'darwin') return 'brew install aria2';
  if (process.platform === 'win32') return 'winget install aria2.aria2';
  return 'sudo apt update && sudo apt install aria2';
}

async function installAria2() {
  if (checkAria2().installed) {
    return { started: false, alreadyInstalled: true, output: 'aria2c is already installed' };
  }

  if (process.platform === 'darwin') {
    const brew = resolveCommand('brew');
    if (!brew) {
      throw new Error('Homebrew was not found. Install Homebrew first, then run: brew install aria2');
    }
    return runAndCollect(brew, ['install', 'aria2'], envWithPath(path.dirname(brew)));
  }

  if (process.platform === 'win32') {
    const winget = resolveCommand('winget');
    if (!winget) {
      throw new Error('winget was not found. Install aria2 manually and make sure aria2c.exe is in PATH.');
    }
    return runAndCollect(winget, ['install', 'aria2.aria2', '--accept-package-agreements', '--accept-source-agreements']);
  }

  const aptGet = resolveCommand('apt-get');
  if (aptGet) {
    if (process.getuid && process.getuid() === 0) {
      return await runSequence([
        [aptGet, ['update']],
        [aptGet, ['install', '-y', 'aria2']]
      ]);
    }
    const pkexec = resolveCommand('pkexec');
    if (pkexec) {
      return await runSequence([
        [pkexec, ['apt-get', 'update']],
        [pkexec, ['apt-get', 'install', '-y', 'aria2']]
      ]);
    }
    throw new Error('apt-get was found but pkexec is unavailable. Run manually: sudo apt update && sudo apt install aria2');
  }

  throw new Error(`Automatic install is not supported on this Linux distribution. Run manually: ${installCommand()}`);
}

async function runSequence(commands) {
  let output = '';
  for (const [command, args] of commands) {
    const result = await runAndCollect(command, args);
    output += result.output;
  }
  return { started: true, output };
}

function runAndCollect(command, args, env) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: env || process.env });
  let output = '';

  return new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ started: true, output });
        return;
      }
      reject(new Error(output || `${command} exited with code ${code}`));
    });
  });
}

module.exports = {
  checkAria2,
  installAria2,
  getAria2Binary
};
