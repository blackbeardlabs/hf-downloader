const { spawn, spawnSync } = require('child_process');

function commandExists(command) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.split(/\r?\n/)[0].trim() : '';
}

function checkAria2() {
  const command = process.platform === 'win32' ? 'aria2c.exe' : 'aria2c';
  const foundPath = commandExists(command) || commandExists('aria2c');
  if (!foundPath) {
    return {
      installed: false,
      platform: process.platform,
      command: installCommand()
    };
  }

  const version = spawnSync('aria2c', ['--version'], { encoding: 'utf8' });
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
    if (!commandExists('brew')) {
      throw new Error('Homebrew was not found. Install Homebrew first, then run: brew install aria2');
    }
    return runAndCollect('brew', ['install', 'aria2']);
  }

  if (process.platform === 'win32') {
    if (!commandExists('winget')) {
      throw new Error('winget was not found. Install aria2 manually and make sure aria2c.exe is in PATH.');
    }
    return runAndCollect('winget', ['install', 'aria2.aria2', '--accept-package-agreements', '--accept-source-agreements']);
  }

  if (commandExists('apt-get')) {
    if (process.getuid && process.getuid() === 0) {
      return await runSequence([
        ['apt-get', ['update']],
        ['apt-get', ['install', '-y', 'aria2']]
      ]);
    }
    if (commandExists('pkexec')) {
      return await runSequence([
        ['pkexec', ['apt-get', 'update']],
        ['pkexec', ['apt-get', 'install', '-y', 'aria2']]
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

function runAndCollect(command, args) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
  installAria2
};
