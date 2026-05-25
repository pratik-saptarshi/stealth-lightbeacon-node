const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadModule(relativePath) {
  const modulePath = path.join(__dirname, '..', 'dist', relativePath);
  try {
    return await import(pathToFileURL(modulePath).href);
  } catch (error) {
    assert.fail(`Failed to load ${relativePath}: ${error.message}`);
  }
}

test('default evaluator registry exposes deterministic plugin metadata order', async () => {
  const mod = await loadModule(path.join('core', 'defaultEvaluators.js'));
  const plugins = mod.listDefaultEvaluatorPlugins();
  assert.deepEqual(
    plugins.map((plugin) => plugin.id),
    ['performance', 'seo', 'aeo', 'geo', 'accessibility', 'ux', 'drupal-security']
  );
  assert.equal(plugins[0].domain, 'Performance');
  assert.equal(plugins[0].order, 10);
});

test('createDefaultEvaluators returns evaluators in registry order', async () => {
  const mod = await loadModule(path.join('core', 'defaultEvaluators.js'));
  const evaluators = mod.createDefaultEvaluators();
  assert.deepEqual(
    evaluators.map((evaluator) => evaluator.id),
    ['performance', 'seo', 'aeo', 'geo', 'accessibility', 'ux', 'drupal-security']
  );
});

test('EvaluatorRegistry rejects duplicate plugin IDs', async () => {
  const mod = await loadModule(path.join('core', 'evaluatorRegistry.js'));
  const registry = new mod.EvaluatorRegistry();
  registry.register({
    id: 'dup',
    domain: 'Duplicate',
    description: 'First',
    prerequisites: [],
    order: 1,
    create: () => ({ id: 'dup', domain: 'Duplicate', evaluate: async () => ({ id: 'dup', domain: 'Duplicate', score: 10, issues: [], metadata: {} }) })
  });

  assert.throws(
    () =>
      registry.register({
        id: 'dup',
        domain: 'Duplicate',
        description: 'Second',
        prerequisites: [],
        order: 2,
        create: () => ({ id: 'dup', domain: 'Duplicate', evaluate: async () => ({ id: 'dup', domain: 'Duplicate', score: 10, issues: [], metadata: {} }) })
      }),
    /Duplicate evaluator plugin id: dup/
  );
});
