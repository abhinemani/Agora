const { chromium } = require('playwright');
const B = process.argv[2] || 'http://localhost:3000';
// A smoke test that is safe to run against the live site: it signs in to nothing, resets nothing
// and buys nothing. It runs one search as a visitor with no agency and opens the three shopper
// tools, then reports PASS/FAIL per check. Usage: node scripts/smoke.cjs [base-url]
// (npm run smoke -- https://agora.ethoslabs.us). The search it makes is kept as that visitor's request.
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  const results = [];
  let failed = 0;
  const check = async (name, fn) => {
    const t = Date.now();
    try { const note = await fn(); results.push(`PASS ${name}${note ? ' — ' + note : ''} (${Date.now() - t} ms)`); }
    catch (e) { failed++; results.push(`FAIL ${name} — ${e.message.split('\n')[0]}`); }
  };
  const main = () => p.locator('main').innerText();

  await check('Search: the request is read into fields', async () => {
    await p.goto(B + '/'); await p.locator('input[placeholder^="Describe"]').fill('laptops for the town hall'); await p.keyboard.press('Enter');
    await p.waitForURL(/\/request\//, { timeout: 60000 });
    await p.locator('#options').or(p.locator('text=Confirm the item')).first().waitFor({ timeout: 60000 });
    const txt = await main();
    for (const f of ['ITEM', 'QUANTITY', 'NEEDED BY', 'AGENCY', 'Entered as']) if (!txt.toUpperCase().includes(f.toUpperCase())) throw new Error('missing field: ' + f);
    if (!/Not selected/.test(txt)) throw new Error('a visitor with no agency should see the agency as not selected');
  });
  await check('Results: a recommended route or an item to confirm', async () => {
    const txt = await main();
    if (!/Recommended route|Confirm the item/i.test(txt)) throw new Error('neither a recommended route nor a confirmation step');
    return /Recommended route/i.test(txt) ? 'recommended route shown' : 'confirmation step shown';
  });
  await check('Results: priced options in one table', async () => {
    const n = await p.locator('#options > div').count();
    if (!n) throw new Error('no priced option rows');
    return `${n} option${n === 1 ? '' : 's'}`;
  });
  await check('Results: no state leads for a visitor with no agency', async () => {
    const txt = await main();
    const at = (s) => { const i = txt.indexOf(s); return i < 0 ? Infinity : i; };
    if (at('state contracts for this') < at('Other sources')) throw new Error('a state contract block sits above the other sources');
    const open = await p.locator('#coops > h3 > button[aria-expanded="false"]'); if (await open.count()) await open.click();
    const coops = await p.locator('#coops').innerText().catch(() => '');
    if (/State contract ·/.test(coops)) throw new Error('state contracts are repeated in the co-op list');
    return (await p.locator('#other-state-contracts').count()) ? 'state contracts folded under other sources' : 'no state contracts matched';
  });
  await check('Find a product', async () => {
    await p.goto(B + '/dive'); const box = p.locator('input[placeholder="Describe what you need"]'); await box.waitFor(); await box.fill('small electric utility vehicle'); await box.press('Enter');
    await p.waitForSelector('text=/\\d+ OF \\d+ MATCH/i', { timeout: 90000 });
    const txt = await main();
    if (/gasoline/i.test(txt)) throw new Error('a gasoline vehicle is on an electric shortlist');
    return (txt.match(/\d+ OF \d+ MATCH/i) || [''])[0];
  });
  await check('Ask a contract', async () => {
    await p.goto(B + '/ask'); await p.waitForSelector('text=Which contract?'); await p.waitForTimeout(2000);
    await p.locator('#find-contract').fill('R220201'); await p.waitForTimeout(500);
    await p.locator('main button:has-text("R220201")').first().click();
    await p.locator('button:has-text("What date are these prices from?")').click();
    await p.locator('main figcaption').or(p.locator('text=/Nothing in these documents|couldn\'t/i')).first().waitFor({ timeout: 120000 });
    return (await p.locator('main figcaption').count()) ? 'answered with quoted passages' : 'answered without a passage';
  });
  await check('Check a quote', async () => {
    await p.goto(B + '/quote-check'); await p.locator('main button:has-text("sample")').first().click();
    await p.waitForSelector('text=/Lines read/i', { timeout: 120000 });
    return ((await main()).match(/\d+ of \d+ checked lines[^.\n]*/i) || ['report shown'])[0];
  });
  await check('No page errors', async () => { if (errors.length) throw new Error([...new Set(errors)].slice(0, 3).join(' | ')); });

  console.log(results.join('\n'));
  await b.close();
  process.exit(failed ? 1 : 0);
})();
