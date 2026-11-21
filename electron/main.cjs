const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const isDev = !app.isPackaged;
const PORT = process.env.PORT || '3000';
const APP_URL = `http://127.0.0.1:${PORT}`;

let serverProcess = null;
let mainWindow = null;

function waitForServer(url, retries = 40, delayMs = 250) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts += 1;
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (attempts >= retries) {
          reject(new Error(`Server did not respond at ${url} in time`));
        } else {
          setTimeout(check, delayMs);
        }
      });
      req.setTimeout(1000, () => {
        req.destroy();
      });
    };
    check();
  });
}

function startBackend() {
  const userDataDir = app.getPath('userData');
  const env = {
    ...process.env,
    NODE_ENV: isDev ? 'development' : 'production',
    PORT,
    CURE_DB_PATH: path.join(userDataDir, 'data', 'cure.db'),
    CURE_UPLOAD_DIR: path.join(userDataDir, 'data', 'uploads'),
  };

  const serverEntry = isDev
    ? path.join(__dirname, '..', 'server.ts')
    : path.join(process.resourcesPath, 'app', 'server.ts');

  const runnerCmd = isDev ? 'bun' : 'bun';
  const runnerArgs = ['run', serverEntry];

  serverProcess = spawn(runnerCmd, runnerArgs, {
    cwd: isDev ? path.join(__dirname, '..') : process.resourcesPath,
    env,
    stdio: 'inherit',
  });

  serverProcess.on('exit', (code) => {
    serverProcess = null;
    if (!app.isQuitting && code !== 0) {
      console.error(`Backend server exited unexpectedly with code ${code}`);
    }
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    title: 'Project C.U.R.E.',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  startBackend();
  await waitForServer(APP_URL);
  await mainWindow.loadURL(APP_URL);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
