/**
 * geo-extended.test.js
 * Covers branches not reached by geo.test.js:
 *  - High-authority outbound citations (wikipedia.org, .edu, .gov, .org, arxiv.org)
 *  - JSON-LD author object with name → hasSchemaAuthor = true
 *  - JSON-LD datePublished → hasSchemaRecency = true
 *  - microdata [itemprop=author], [itemprop=datePublished]
 *  - HTML byline/author class signals
 *  - meta[name=author] signal
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadGeo() {
  const modulePath = path.join(__dirname, '..', 'dist', 'evaluators', 'geo.js');
  return import(pathToFileURL(modulePath).href);
}

const LONG_BODY = 'The quick brown fox jumps over the lazy dog. '.repeat(20);

test('GeoEvaluator: high-authority citation clears R-GEO-CIT-LOW', async () => {
  const mod = await loadGeo();
  const ev = new mod.GeoEvaluator();
  const result = await ev.evaluate({
    url: 'https://example.com/post',
    html: `<html><body>
      <p>${LONG_BODY}</p>
      <a href="https://en.wikipedia.org/wiki/Something">Wikipedia source</a>
      <a href="https://example.com/privacy">Privacy Policy</a>
      <a href="https://example.com/contact">Contact</a>
      <a href="https://example.com/about">About</a>
    </body></html>`,
    headers: {},
  });
  assert.ok(!result.issues.some((i) => i.id === 'R-GEO-CIT-NONE'), 'Should not flag CIT-NONE');
  assert.ok(!result.issues.some((i) => i.id === 'R-GEO-CIT-LOW'), 'Should not flag CIT-LOW for wikipedia');
});

test('GeoEvaluator: .edu authority citation clears R-GEO-CIT-LOW', async () => {
  const mod = await loadGeo();
  const ev = new mod.GeoEvaluator();
  const result = await ev.evaluate({
    url: 'https://example.com/post',
    html: `<html><body>
      <p>${LONG_BODY}</p>
      <a href="https://mit.edu/research">MIT research</a>
      <a href="https://example.com/privacy">Privacy Policy</a>
      <a href="https://example.com/contact">Contact</a>
      <a href="https://example.com/about">About</a>
    </body></html>`,
    headers: {},
  });
  assert.ok(!result.issues.some((i) => i.id === 'R-GEO-CIT-LOW'), 'Should not flag CIT-LOW for .edu');
});

test('GeoEvaluator: JSON-LD author object resolves hasSchemaAuthor', async () => {
  const mod = await loadGeo();
  const ev = new mod.GeoEvaluator();
  const ldJson = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    author: { '@type': 'Person', name: 'Jane Doe' },
    datePublished: '2024-01-01',
  });
  const result = await ev.evaluate({
    url: 'https://example.com/post',
    html: `<html><body>
      <p>${LONG_BODY}</p>
      <script type="application/ld+json">${ldJson}</script>
      <a href="https://example.com/privacy">Privacy Policy</a>
      <a href="https://example.com/contact">Contact</a>
      <a href="https://example.com/about">About</a>
    </body></html>`,
    headers: {},
  });
  assert.ok(!result.issues.some((i) => i.id === 'R-GEO-EEAT-AUTHOR'), 'JSON-LD author → no EEAT-AUTHOR issue');
  assert.ok(!result.issues.some((i) => i.id === 'R-GEO-EEAT-RECENCY'), 'datePublished → no EEAT-RECENCY issue');
});

test('GeoEvaluator: string author in JSON-LD resolves hasSchemaAuthor', async () => {
  const mod = await loadGeo();
  const ev = new mod.GeoEvaluator();
  const ldJson = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    author: 'Jane Doe',
    dateModified: '2024-06-01',
  });
  const result = await ev.evaluate({
    url: 'https://example.com/post',
    html: `<html><body>
      <p>${LONG_BODY}</p>
      <script type="application/ld+json">${ldJson}</script>
      <a href="https://example.com/privacy">Privacy Policy</a>
      <a href="https://example.com/contact">Contact</a>
      <a href="https://example.com/about">About</a>
    </body></html>`,
    headers: {},
  });
  assert.ok(!result.issues.some((i) => i.id === 'R-GEO-EEAT-AUTHOR'), 'string author → no EEAT-AUTHOR');
  assert.ok(!result.issues.some((i) => i.id === 'R-GEO-EEAT-RECENCY'), 'dateModified → no EEAT-RECENCY');
});

test('GeoEvaluator: microdata itemprop=author resolves hasSchemaAuthor', async () => {
  const mod = await loadGeo();
  const ev = new mod.GeoEvaluator();
  const result = await ev.evaluate({
    url: 'https://example.com/post',
    html: `<html><body>
      <p>${LONG_BODY}</p>
      <span itemprop="author">Jane Doe</span>
      <span itemprop="datePublished" content="2024-01-01">Jan 2024</span>
      <a href="https://example.com/privacy">Privacy Policy</a>
      <a href="https://example.com/contact">Contact</a>
      <a href="https://example.com/about">About</a>
    </body></html>`,
    headers: {},
  });
  assert.ok(!result.issues.some((i) => i.id === 'R-GEO-EEAT-AUTHOR'), 'microdata author → no EEAT-AUTHOR');
  assert.ok(!result.issues.some((i) => i.id === 'R-GEO-EEAT-RECENCY'), 'microdata datePublished → no EEAT-RECENCY');
});

test('GeoEvaluator: HTML byline class resolves hasAuthor (R-GEO-AUTHOR cleared)', async () => {
  const mod = await loadGeo();
  const ev = new mod.GeoEvaluator();
  const result = await ev.evaluate({
    url: 'https://example.com/post',
    html: `<html><body>
      <p>${LONG_BODY}</p>
      <span class="byline">Written by Jane Doe</span>
      <a href="https://example.com/privacy">Privacy Policy</a>
      <a href="https://example.com/contact">Contact</a>
      <a href="https://example.com/about">About</a>
    </body></html>`,
    headers: {},
  });
  assert.ok(!result.issues.some((i) => i.id === 'R-GEO-AUTHOR'), 'byline class → no R-GEO-AUTHOR');
});

test('GeoEvaluator: meta[name=author] resolves HTML author signal', async () => {
  const mod = await loadGeo();
  const ev = new mod.GeoEvaluator();
  const result = await ev.evaluate({
    url: 'https://example.com/post',
    html: `<html><head>
      <meta name="author" content="Jane Doe">
    </head><body>
      <p>${LONG_BODY}</p>
      <a href="https://example.com/privacy">Privacy Policy</a>
      <a href="https://example.com/contact">Contact</a>
      <a href="https://example.com/about">About</a>
    </body></html>`,
    headers: {},
  });
  assert.ok(!result.issues.some((i) => i.id === 'R-GEO-AUTHOR'), 'meta author → no R-GEO-AUTHOR');
});
