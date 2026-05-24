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

test('SeoEvaluator: flags robots disallow, path blocking, missing sitemap, canonical scheme, and desc length', async () => {
  const mod = await loadModule(path.join('evaluators', 'seo.js'));
  const evaluator = new mod.SeoEvaluator();

  // Test Case 1: Global robots.txt block (Disallow: /)
  const ctx1 = {
    url: 'https://example.com/',
    html: `
      <html>
        <head>
          <title>A Valid Page Title for Test Suite</title>
          <meta name="description" content="A valid description of the page that has at least one hundred and ten characters to ensure we do not hit length warning triggers during this specific run. Let's make it long enough.">
          <link rel="canonical" href="https://example.com/">
          <script type="application/ld+json">{"@context": "https://schema.org", "@type": "WebPage"}</script>
        </head>
        <body>
          <h1>Heading 1</h1>
        </body>
      </html>
    `,
    headers: {},
    robotsContent: 'User-agent: *\nDisallow: /'
  };

  const res1 = await evaluator.evaluate(ctx1);
  const blockIssue = res1.issues.find(i => i.id === 'R-SEO-ROBOTS-BLOCK');
  assert.ok(blockIssue, 'Expected R-SEO-ROBOTS-BLOCK issue');
  assert.equal(blockIssue.severity, 'critical');

  // Test Case 2: Path-level robots.txt block
  const ctx2 = {
    url: 'https://example.com/admin/settings',
    html: ctx1.html,
    headers: {},
    robotsContent: 'User-agent: *\nDisallow: /admin'
  };

  const res2 = await evaluator.evaluate(ctx2);
  const pathBlockIssue = res2.issues.find(i => i.id === 'R-SEO-ROBOTS-PATH-BLOCK');
  assert.ok(pathBlockIssue, 'Expected R-SEO-ROBOTS-PATH-BLOCK issue');
  assert.equal(pathBlockIssue.severity, 'warning');

  // Test Case 3: Missing sitemap in robots.txt
  const ctx3 = {
    url: 'https://example.com/',
    html: ctx1.html,
    headers: {},
    robotsContent: 'User-agent: *\nAllow: /'
  };

  const res3 = await evaluator.evaluate(ctx3);
  const sitemapIssue = res3.issues.find(i => i.id === 'R-SEO-ROBOTS-SITEMAP');
  assert.ok(sitemapIssue, 'Expected R-SEO-ROBOTS-SITEMAP issue');
  assert.equal(sitemapIssue.severity, 'warning');

  // Test Case 4: Canonical scheme mismatch
  const ctx4 = {
    url: 'https://example.com/',
    html: `
      <html>
        <head>
          <title>A Valid Page Title for Test Suite</title>
          <meta name="description" content="A valid description of the page that has at least one hundred and ten characters to ensure we do not hit length warning triggers during this specific run. Let's make it long enough.">
          <link rel="canonical" href="http://example.com/">
          <script type="application/ld+json">{"@context": "https://schema.org", "@type": "WebPage"}</script>
        </head>
        <body>
          <h1>Heading 1</h1>
        </body>
      </html>
    `,
    headers: {},
    robotsContent: 'User-agent: *\nSitemap: https://example.com/sitemap.xml'
  };

  const res4 = await evaluator.evaluate(ctx4);
  const schemeIssue = res4.issues.find(i => i.id === 'R-SEO-CAN-SCHEME');
  assert.ok(schemeIssue, 'Expected R-SEO-CAN-SCHEME issue');
  assert.equal(schemeIssue.severity, 'warning');

  // Test Case 5: Meta description length warnings (too short / too long)
  const ctx5Short = {
    url: 'https://example.com/',
    html: `
      <html>
        <head>
          <title>A Valid Page Title for Test Suite</title>
          <meta name="description" content="Too short.">
          <link rel="canonical" href="https://example.com/">
          <script type="application/ld+json">{"@context": "https://schema.org", "@type": "WebPage"}</script>
        </head>
        <body>
          <h1>Heading 1</h1>
        </body>
      </html>
    `,
    headers: {},
    robotsContent: 'User-agent: *\nSitemap: https://example.com/sitemap.xml'
  };

  const res5Short = await evaluator.evaluate(ctx5Short);
  const lenIssueShort = res5Short.issues.find(i => i.id === 'R-SEO-DESC-LEN');
  assert.ok(lenIssueShort, 'Expected R-SEO-DESC-LEN issue for short description');
  assert.equal(lenIssueShort.severity, 'warning');
});
