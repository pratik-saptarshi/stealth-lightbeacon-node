# Stealth Lightbeacon Desktop

Electron shell for the real-time auditing and historical diff dashboard. The
renderer is `index.html`; the main process is `main.js`.

## Renderer security decision

### Root cause

The renderer calls `ipcRenderer.invoke('audit:compare', …)` from an inline
`<script>` in `index.html`. It obtained `ipcRenderer` with
`require('electron')`, which only works while the renderer has Node.js access.

`main.js` previously tried to turn off the bridge with:

```js
webPreferences: {
  nodeIntegration: true,
  contextBridge: false
}
```

`contextBridge: false` is not a real `webPreferences` key. Electron ignores
unknown keys, so the option did nothing. The setting that actually governs
renderer isolation is `contextIsolation`, which **defaults to `true`** in
current Electron. The renderer therefore ran with `contextIsolation: true`
*and* `nodeIntegration: true`: an isolated world whose inline script still
reached Node's `require` because Node integration was on. That combination is
the worst of both worlds — no preload bridge, but a full Node sink in a page
that renders untrusted audit data.

The `require` call is the sink. Anything that can inject a script into the
renderer (a compromised page, a malicious audit finding rendered as HTML, a
future XSS) inherits the main process's Node privileges.

### Chosen fix: preload + `contextBridge`

- `preload.js` runs in an isolated context with Node access and exposes one
  narrow function:
  `window.stealthDesktop.compareAudits(runIdA, runIdB)`, implemented with
  `ipcRenderer.invoke('audit:compare', { runIdA, runIdB })`.
- `main.js` sets
  `webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }`.
- `index.html` no longer calls `require` or `ipcRenderer`. Both uses are
  replaced by `window.stealthDesktop.compareAudits('run-A', 'run-B')`.

The renderer now has exactly one capability — ask the main process to compare
two runs — instead of the whole Node runtime. `desktop/smoke.js` exercises the
real bridge end to end (`pnpm run smoke`) and fails if the preload stops
loading or the channel stops answering.

### Rejected alternative: `contextIsolation: false`

The one-line alternative was to keep the renderer `require` and set
`contextIsolation: false` explicitly. It makes the inline script work, but it
also makes every script in the renderer share the main world with full Node
privileges. That is the vulnerability, not a workaround for it: it trades a
missing bridge for an arbitrary-code-execution sink. It was rejected.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm start` | Launch the app (`electron .`). |
| `pnpm run smoke` | Run the IPC round-trip smoke test (`electron smoke.js`). |
