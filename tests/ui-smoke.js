// Optional browser smoke test (needs Playwright): node tests/ui-smoke.js [outDir]
// Uses only made-up sample data.
const { chromium, devices } = require('playwright');
const path = require('path');
const out = process.argv[2] || path.join(__dirname, '..', 'screenshots');
const url = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  for (const [label, opts] of [['ipad', devices['iPad (gen 7)']], ['phone', devices['iPhone 13']]]) {
    const ctx = await browser.newContext(Object.assign({}, opts, { colorScheme: label === 'phone' ? 'dark' : 'light' }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(label + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(label + ' console: ' + m.text()); });
    await page.goto(url);
    await page.fill('input[name=name]', 'T.S.');
    await page.click('text=Add child');

    const addGoal = async (text, area, method, extra) => {
      await page.click('#tab-goals >> text=+ Add goal').catch(() => page.click('text=Add a goal'));
      await page.fill('#sheet textarea[name=text]', text);
      if (area.startsWith('+')) {
        await page.selectOption('#sheet select[name=area]', '__new__');
        await page.fill('#sheet input[name=newArea]', area.slice(1));
      } else await page.selectOption('#sheet select[name=area]', area);
      await page.check('#sheet input[value=' + method + ']');
      if (extra) await extra();
      await page.click('#sheet button[type=submit]');
    };
    await page.click('#tabbtn-goals');
    await addGoal('Sample: cuts along a curved line', 'Fine motor', 'scale');
    await addGoal('Sample: buttons a coat', 'Self-care', 'help');
    await addGoal('Sample: catches a ball', 'Gross motor', 'trials');
    await addGoal('Sample: holds plank', '+feeding', 'number', async () => {
      await page.fill('#sheet input[name=unit]', 'seconds');
      await page.fill('#sheet input[name=target]', '30');
    });

    // two sessions
    for (const [date, lv, help, trial, num] of [['2026-11-01', 0, 1, 2, '12'], ['2026-11-15', 2, 3, 4, '22']]) {
      await page.click('#tabbtn-score');
      await page.fill('#sessionDate', date);
      await page.dispatchEvent('#sessionDate', 'change');
      const card = t => page.locator('.goal-card', { hasText: t });
      await card('curved line').locator('.level').nth(lv).click();
      await card('buttons a coat').locator('.level').nth(help).click();
      await card('catches a ball').locator('.num-chip').nth(trial).click();
      await card('holds plank').locator('input[data-input=number]').fill(num);
      await page.fill('#sessionNote', 'Sample session note');
      await page.click('#saveSessionBtn');
    }
    // Score tab with a selection, for the screenshot
    await page.click('#tabbtn-score');
    await page.locator('.goal-card').nth(0).locator('.level').nth(1).click();
    await page.screenshot({ path: path.join(out, label + '-score.png'), fullPage: true });
    await page.click('#tabbtn-goals');
    await page.screenshot({ path: path.join(out, label + '-goals.png'), fullPage: true });
    await page.click('#tabbtn-progress');
    await page.screenshot({ path: path.join(out, label + '-progress.png'), fullPage: true });

    const st = await page.evaluate(() => window.OTApp.getState());
    if (st.sessions.length !== 2) errors.push(label + ': expected 2 sessions, got ' + st.sessions.length);
    if (!st.customAreas.includes('feeding') && !st.customAreas.includes('Feeding')) errors.push(label + ': custom area missing');
    const pills = await page.locator('.pill').allTextContents();
    console.log(label, 'pills:', pills.join(' | '));
    // ideas dialog
    await page.click('#tabbtn-goals');
    await page.locator('#tab-goals [data-action=open-ideas]').first().click();
    await page.click('text=+ Add idea');
    await page.fill('#sheet textarea[name=text]', 'Sample idea: tong pick-up race');
    await page.fill('#sheet textarea[name=links]', 'example.com/idea');
    await page.click('#sheet button[type=submit]');
    await page.screenshot({ path: path.join(out, label + '-ideas.png') });
    await page.click('#sheet .sheet-head button');
    // two-tap delete session
    await page.click('#tabbtn-progress');
    const del = page.locator('[data-action=delete-session]').first();
    await del.click();
    const txt = await del.textContent();
    await del.click();
    const after = await page.evaluate(() => window.OTApp.getState().sessions.length);
    console.log(label, 'confirm label:', txt, '-> sessions left', after);
    await page.click('[data-action=open-data]');
    await page.click('text=Backup as text');
    await page.screenshot({ path: path.join(out, label + '-backup.png') });
    await ctx.close();
  }
  await browser.close();
  if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1); }
  console.log('UI smoke test passed');
})();
