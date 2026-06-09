const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { WorkspaceWatcher } = require('../dist/core/watcher.js');

function createScheduler() {
  let nextId = 1;
  const scheduled = new Map();
  const cleared = [];

  return {
    cleared,
    get pendingCount() {
      return scheduled.size;
    },
    setTimeout(callback, delayMs) {
      const handle = { id: nextId++, delayMs };
      scheduled.set(handle.id, { callback, handle });
      return handle;
    },
    clearTimeout(handle) {
      cleared.push(handle.id);
      scheduled.delete(handle.id);
    },
    runOnly(handle) {
      const task = scheduled.get(handle.id);
      assert.ok(task, `Expected scheduled task ${handle.id} to exist`);
      scheduled.delete(handle.id);
      task.callback();
    },
    lastHandle() {
      const tasks = Array.from(scheduled.values());
      assert.ok(tasks.length > 0, 'Expected a scheduled task');
      return tasks[tasks.length - 1].handle;
    }
  };
}

function createWatchFactory() {
  const watchers = [];
  const calls = [];

  return {
    calls,
    watchers,
    watch(pathToWatch, options, callback) {
      calls.push({ pathToWatch, options });
      const watcher = {
        closed: false,
        emit(eventType, filename) {
          callback(eventType, filename);
        },
        close() {
          this.closed = true;
        }
      };
      watchers.push(watcher);
      return watcher;
    }
  };
}

test('WorkspaceWatcher debounces TypeScript and JavaScript changes into a callback', () => {
  const scheduler = createScheduler();
  const watchFactory = createWatchFactory();
  const changes = [];
  const watcher = new WorkspaceWatcher('/repo', 25, {
    scheduler,
    watch: watchFactory.watch,
    onChange(files) {
      changes.push(files);
    }
  });

  watcher.start();

  assert.deepEqual(watchFactory.calls, [
    {
      pathToWatch: path.join('/repo', 'src'),
      options: { recursive: true }
    }
  ]);

  watchFactory.watchers[0].emit('change', 'core/watcher.ts');
  const firstHandle = scheduler.lastHandle();
  watchFactory.watchers[0].emit('change', 'cli.txt');
  watchFactory.watchers[0].emit('rename', 'cli.js');
  const secondHandle = scheduler.lastHandle();

  assert.notEqual(secondHandle.id, firstHandle.id);
  assert.deepEqual(scheduler.cleared, [firstHandle.id]);

  scheduler.runOnly(secondHandle);

  assert.deepEqual(changes, [['src/core/watcher.ts', 'src/cli.js']]);
  assert.equal(scheduler.pendingCount, 0);
});

test('WorkspaceWatcher close releases fs watcher and clears pending debounce work', () => {
  const scheduler = createScheduler();
  const watchFactory = createWatchFactory();
  const changes = [];
  const watcher = new WorkspaceWatcher('/repo', 25, {
    scheduler,
    watch: watchFactory.watch,
    onChange(files) {
      changes.push(files);
    }
  });

  watcher.start();
  watchFactory.watchers[0].emit('change', 'core/watcher.ts');
  const pendingHandle = scheduler.lastHandle();

  watcher.close();

  assert.equal(watchFactory.watchers[0].closed, true);
  assert.deepEqual(scheduler.cleared, [pendingHandle.id]);
  assert.equal(scheduler.pendingCount, 0);
  assert.deepEqual(changes, []);

  watcher.close();
  assert.deepEqual(scheduler.cleared, [pendingHandle.id]);
});
