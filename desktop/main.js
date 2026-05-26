const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0b10',
    webPreferences: {
      nodeIntegration: true,
      contextBridge: false
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC communication channel to query comparative run diffs using parent JS module
ipcMain.handle('audit:compare', async (event, { runIdA, runIdB }) => {
  try {
    const diffEnginePath = path.join(__dirname, '..', 'dist', 'core', 'diffEngine.js');
    const dbPath = path.join(__dirname, '..', 'dist', 'core', 'db', 'duckdb.js');
    const ontologyPath = path.join(__dirname, '..', 'dist', 'core', 'ontology.js');

    const ontologyMod = await import(pathToFileURL(ontologyPath).href);
    const dbMod = await import(pathToFileURL(dbPath).href);
    const diffMod = await import(pathToFileURL(diffEnginePath).href);

    const paths = ontologyMod.resolveOntologyPaths({});
    const duck = await dbMod.createDuckDbRuntime({ databasePath: paths.duckDbPath });
    try {
      const engine = new diffMod.DiffEngine(duck);
      const diff = await engine.compareRuns(runIdA, runIdB);
      return { ok: true, diff };
    } finally {
      await duck.close();
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
