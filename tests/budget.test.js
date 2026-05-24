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

test('validateBudgets reports threshold failures for aggregate domain results', async () => {
  const mod = await loadModule(path.join('core', 'budget.js'));
  assert.equal(typeof mod.validateBudgets, 'function');

  const failures = mod.validateBudgets(
    {
      domains: [
        { id: 'performance', score: 4.5, metadata: { lighthousePerformanceScore: 42 } },
        { id: 'seo', score: 8.5, metadata: {} }
      ]
    },
    {
      minDomainScores: { performance: 6 },
      minLighthousePerformanceScore: 80
    }
  );

  assert.deepEqual(failures, [
    'Domain performance score 4.5 is below minimum 6',
    'Lighthouse performance score 42 is below minimum 80'
  ]);
});
