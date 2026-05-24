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

test('UxEvaluator flags missing viewport and readability issues', async () => {
  const mod = await loadModule(path.join('evaluators', 'ux.js'));
  const evaluator = new mod.UxEvaluator();
  const result = await evaluator.evaluate({
    url: 'https://example.com',
    html: '<html><head></head><body><p>' + 'word '.repeat(250) + '</p></body></html>',
    headers: {}
  });

  assert.equal(result.id, 'ux');
  assert.equal(result.issues.some((issue) => issue.id === 'R-UX-VIEWPORT'), true);
  assert.equal(result.issues.some((issue) => issue.id === 'R-UX-READABILITY'), true);
});

test('UxEvaluator: flags small inline fonts, deep nav menu, and tap targets from inline style', async () => {
  const mod = await loadModule(path.join('evaluators', 'ux.js'));
  const evaluator = new mod.UxEvaluator();

  const result = await evaluator.evaluate({
    url: 'https://example.com',
    html: `
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body>
          <p style="font-size: 10px;">Tiny font text</p>
          
          <nav class="main-menu">
            <ul>
              <li>Level 1
                <ul>
                  <li>Level 2
                    <ul>
                      <li>Level 3
                        <ul>
                          <li>Level 4</li>
                        </ul>
                      </li>
                    </ul>
                  </li>
                </ul>
              </li>
            </ul>
          </nav>
          
          <button style="height: 35px; width: 35px;">Small button</button>
        </body>
      </html>
    `,
    headers: {}
  });

  assert.ok(result.issues.some(i => i.id === 'R-UX-FONT-SMALL'), 'Expected R-UX-FONT-SMALL');
  assert.ok(result.issues.some(i => i.id === 'R-UX-NAV-DEPTH'), 'Expected R-UX-NAV-DEPTH');
  assert.ok(result.issues.some(i => i.id === 'R-UX-TAP-TARGET'), 'Expected R-UX-TAP-TARGET for small inline style');
});
