// Exercise an explicitly selected disposable local Orbit OS workspace.
// Dependencies come from the approved tool environment, not the runtime wheel.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');

async function main() {
  const [base, toolRoot, output] = process.argv.slice(2);
  const url = new URL(base);
  assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname),
    'Select a disposable loopback server');
  assert.equal(url.pathname, '/');
  await fs.mkdir(output, { recursive: false });
  const load = createRequire(path.join(path.resolve(toolRoot), 'package.json'));
  const { chromium } = load('@playwright/test');
  const AxeBuilder = load('@axe-core/playwright').default;
  const browser = await chromium.launch({ headless: true });
  const receipt = { outcome: 'error', live_collection: 'not performed', states: [], errors: [] };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 },
      serviceWorkers: 'block', acceptDownloads: true });
    const page = await context.newPage();
    const forbidden = [];
    await context.route('**/*', route => {
      const target = new URL(route.request().url());
      if (target.origin !== url.origin || target.pathname === '/api/scan') {
        forbidden.push(target.pathname);
        return route.abort();
      }
      return route.continue();
    });
    page.on('pageerror', error => receipt.errors.push(error.message));
    async function audit(state) {
      await page.waitForLoadState('networkidle');
      const result = await new AxeBuilder({ page }).analyze();
      const violations = result.violations.map(v => ({ id: v.id, impact: v.impact,
        targets: v.nodes.map(n => n.target), details: v.nodes.map(n => n.failureSummary) }));
      receipt.states.push({ state, viewport: page.viewportSize(), violations });
      await page.screenshot({ path: path.join(output, state + '.png'), fullPage: true });
    }
    await page.goto(base);
    await page.getByRole('heading', { name: 'Your orbit starts here.' }).waitFor();
    await audit('empty');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator(':focus').textContent(), 'Skip to content');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator(':focus').getAttribute('id'), 'main-content');
    await page.getByRole('button', { name: 'Explore the demo' }).click();
    await page.getByText('Synthetic demo', { exact: true }).waitFor();
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const view of ['overview', 'relationships', 'watchlist', 'activity', 'setup', 'system']) {
        await page.locator('[data-view="' + view + '"]').click();
        await audit('demo-' + view + '-' + width);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        'Page must fit viewport; tables may scroll inside their containers');
    }
    await page.locator('[data-view="relationships"]').click();
    const search = page.locator('#relationship-search');
    await search.fill('nova');
    assert.equal(await page.locator(':focus').getAttribute('id'), 'relationship-search');
    await search.fill('');
    const download = page.waitForEvent('download');
    await page.locator('[data-export="relationships"]').click();
    const csv = await download;
    await csv.saveAs(path.join(output, 'synthetic-relationships.csv'));
    assert.ok((await fs.readFile(path.join(output, 'synthetic-relationships.csv'), 'utf8')).includes('username'));
    await page.getByRole('button', { name: 'Exit demo', exact: true }).click();
    await page.locator('[data-view="setup"]').click();
    await page.locator('#import-account').fill('orbit_demo');
    await page.locator('#import-captured').fill('2026-10-01T09:00');
    await page.locator('#complete-followers').check();
    await page.locator('#complete-following').check();
    const rows = [{ string_list_data: [{ value: 'nova_labs', timestamp: 1790850000 }] }];
    await page.locator('#import-files').setInputFiles([
      { name: 'followers_1.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(rows)) },
      { name: 'following.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ relationships_following: rows })) },
    ]);
    const imported = page.waitForResponse(response => response.url() === new URL('/api/import', base).href);
    await page.locator('#import-submit').click();
    assert.equal((await imported).status(), 200);
    await page.getByText('Personal export snapshot', { exact: true }).waitFor();
    await audit('owner-import');
    await page.locator('[data-view="relationships"]').click();
    await page.getByText('@nova_labs', { exact: true }).first().waitFor();
    await page.reload();
    await page.getByText('@nova_labs', { exact: true }).first().waitFor();
    await audit('owner-reload');
    await page.locator('[data-view="setup"]').click();
    await page.locator('#import-files').setInputFiles({ name: 'followers_1.json',
      mimeType: 'application/json', buffer: Buffer.from('not-json') });
    const rejected = page.waitForResponse(response => response.url() === new URL('/api/import', base).href);
    await page.locator('#import-submit').click();
    assert.equal((await rejected).status(), 400);
    await page.waitForFunction(() => document.querySelector('#import-result')?.textContent?.length > 0);
    await audit('malformed-import');
    await page.locator('[data-view="relationships"]').click();
    await page.getByText('@nova_labs', { exact: true }).first().waitFor();
    await page.setViewportSize({ width: 390, height: 900 });
    const enlarged = await page.evaluate(() => {
      const heading = document.querySelector('h1');
      const before = parseFloat(getComputedStyle(heading).fontSize);
      const sizes = [...document.querySelectorAll('body *')].filter(el => el instanceof HTMLElement)
        .map(el => [el, parseFloat(getComputedStyle(el).fontSize)]);
      for (const [el, size] of sizes) el.style.fontSize = (size * 2) + 'px';
      return { before, after: parseFloat(getComputedStyle(heading).fontSize) };
    });
    assert.equal(enlarged.after, enlarged.before * 2);
    await audit('text-zoom');
    assert.deepEqual(forbidden, [], 'No external requests or live scan attempts');
    assert.deepEqual(receipt.errors, [], 'No browser runtime errors');
    assert.deepEqual(receipt.states.filter(state => state.violations.length), [],
      'Accessibility violations in rendered states');
    receipt.outcome = 'success';
    receipt.keyboard = 'skip link and search focus checked; human screen-reader unproven';
    receipt.text_enlargement = 'computed text sizes doubled at 390px; human browser zoom unproven';
  } finally {
    await fs.writeFile(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2));
    await browser.close();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
