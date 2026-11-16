// IPC round-trip smoke: the renderer must reach `audit:compare` through the
// preload bridge (`window.stealthDesktop.compareAudits`), not through `require`.
//
// The smoke installs its own `audit:compare` stub after requiring main.js, so
// it does not need a DuckDB fixture. This checks the bridge, not the production
// handler; `fixture.js` exercises the real handler against a seeded DuckDB.
const { app, ipcMain } = require('electron');
const { createWindow } = require('./main.js');

ipcMain.removeHandler('audit:compare');
ipcMain.handle('audit:compare', () => ({ ok: true, diff: {} }));

const TIMEOUT_MS = 30000;

let finished = false;

function finish(code, message) {
  if (finished) return;
  finished = true;
  const stream = code === 0 ? process.stdout : process.stderr;
  stream.write(`${message}\n`);
  app.exit(code);
}

setTimeout(() => {
  finish(1, 'SMOKE FAIL: timed out waiting for the renderer bridge');
}, TIMEOUT_MS);

app.whenReady().then(async () => {
  const win = createWindow();

  const loaded = new Promise((resolve, reject) => {
    win.webContents.once('did-finish-load', resolve);
    win.webContents.once('did-fail-load', (_event, code, description) => {
      reject(new Error(`did-fail-load ${code} ${description}`));
    });
  });

  try {
    await loaded;

    // Surface renderer-side failures (missing bridge, rejected invoke) instead
    // of Electron's generic "Script failed to execute" message.
    const result = await win.webContents.executeJavaScript(`
      (async () => {
        try {
          if (!window.stealthDesktop) {
            return { smokeError: 'window.stealthDesktop is undefined (preload bridge missing)' };
          }
          return await window.stealthDesktop.compareAudits('run-A', 'run-B');
        } catch (err) {
          return { smokeError: err && err.message ? err.message : String(err) };
        }
      })()
    `);

    if (result && result.smokeError) {
      finish(1, `SMOKE FAIL: ${result.smokeError}`);
      return;
    }

    if (!result || result.ok !== true) {
      finish(1, `SMOKE FAIL: expected ok === true, got ${JSON.stringify(result)}`);
      return;
    }

    finish(0, `SMOKE PASS: window.stealthDesktop.compareAudits -> ${JSON.stringify(result)}`);
  } catch (err) {
    finish(1, `SMOKE FAIL: ${err && err.message ? err.message : String(err)}`);
  }
});
