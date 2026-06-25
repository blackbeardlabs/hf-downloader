const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, dialog } = require('electron');

let serverHandle = null;
let mainWindow = null;
let logFile = null;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  if (logFile) {
    try {
      fs.appendFileSync(logFile, line);
    } catch {}
  }
}

function createWindow(url) {
  log(`creating window for ${url}`);
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.on('did-fail-load', (event, code, description, failedUrl) => {
    log(`did-fail-load code=${code} description=${description} url=${failedUrl}`);
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
      <html>
        <body style="font-family: system-ui; padding: 24px;">
          <h2>HF Downloader failed to load</h2>
          <p>${description}</p>
          <p>${failedUrl}</p>
          <p>Check the Electron log file in the app data directory.</p>
        </body>
      </html>
    `)}`);
  });

  mainWindow.loadURL(url).catch((error) => {
    log(`loadURL error: ${error.message}`);
  });
}

async function start() {
  process.env.HF_DOWNLOADER_DATA_DIR = path.join(app.getPath('userData'), 'data');
  logFile = path.join(app.getPath('userData'), 'main.log');
  log('app starting');

  try {
    const { startServer } = require('../server');
    serverHandle = startServer({
      port: 0,
      log: false,
      saveTextFile: async ({ text, suggestedName }) => {
        const result = await dialog.showSaveDialog(mainWindow, {
          title: 'Export Models',
          defaultPath: suggestedName || 'hf-downloader-models.txt',
          filters: [{ name: 'Text files', extensions: ['txt'] }]
        });
        if (result.canceled || !result.filePath) return { ok: false, canceled: true };
        await fs.promises.writeFile(result.filePath, text, 'utf8');
        return { ok: true, path: result.filePath };
      }
    });
    log('server start requested');
  } catch (error) {
    log(`server start failed: ${error.stack || error.message}`);
    dialog.showErrorBox('HF Downloader', error.message);
    app.quit();
    return;
  }

  const openWindow = () => {
    const address = serverHandle.server.address();
    log(`server listening on ${address.port}`);
    createWindow(`http://127.0.0.1:${address.port}`);
  };

  if (serverHandle.server.listening) {
    openWindow();
  } else {
    serverHandle.server.once('listening', openWindow);
  }
}

app.whenReady().then(start);

app.on('window-all-closed', () => {
  log('window-all-closed');
  if (serverHandle?.server) {
    serverHandle.server.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverHandle?.server?.listening) {
    const address = serverHandle.server.address();
    createWindow(`http://127.0.0.1:${address.port}`);
  }
});
