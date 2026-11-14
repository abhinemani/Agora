const { chromium } = require('playwright');
const B = process.argv[2] || 'http://localhost:3000';
// Runs the README demo path (steps 1–13) in a real browser against a running
// server and reports PASS/FAIL per step. Usage: npm run build && npm start, then
// node scripts/rehearse-demo.cjs [base-url]. Failure screenshots go to ./rehearsal/.
const OUT = require('path').join(process.cwd(), 'rehearsal') + '/';
require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const results = [];
  const step = async (n, name, fn) => {
    try { const note = await fn(); results.push(`PASS ${n}. ${name}${note ? ' — ' + note : ''}`); }
    catch (e) { results.push(`FAIL ${n}. ${name} — ${e.message.split('\n')[0]}`); await p.screenshot({ path: `${OUT}fail-${n}.png`, fullPage: true }).catch(() => {}); }
  };
  const menu = async () => { await p.locator('button[aria-haspopup="menu"]').click(); };
  const role = async (r) => { await menu(); await p.getByRole('menuitemradio', { name: new RegExp(r) }).click(); await p.waitForTimeout(800); };
  const agency = async (name) => { await menu(); await p.getByRole('menuitem', { name: /Your agency/ }).click(); await p.locator(`button:has-text("${name}")`).first().click(); await p.waitForTimeout(800); };
  const search = async (q) => { await p.goto(B + '/'); await p.locator('input[placeholder^="Describe"]').fill(q); await p.keyboard.press('Enter'); await p.waitForURL(/\/request\//); await p.waitForTimeout(1500); const yes = p.locator('button:has-text("Yes")'); if (await yes.count()) { await yes.first().click(); } await p.waitForTimeout(1500); };
  const ledgerOpts = async () => p.evaluate(() => fetch('/api/state').then(r => r.json()).then(j => [...new Set(j.db.revenue.map(e => e.option))].sort((a,b)=>a-b)));

  // Buying, uploads and the purchasing pages need an account, so the walkthrough signs in first (creating the account on a fresh server).
  await p.goto(B + '/');
  // Outside the page, through the context's request client (it shares the page's cookies), so the
  // expected 400 from signing up an account that already exists isn't counted as a page error.
  const auth = (op) => p.context().request.post(B + '/api/auth', { data: { op, name: 'Rehearsal', email: 'rehearsal@example.gov', password: 'rehearsal-walkthrough', role: 'buyer' } });
  if (!(await auth('signup')).ok()) await auth('signin');
  await p.evaluate(() => fetch('/api/act', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"reset"}' })); await p.goto(B + '/');

  await step(1, 'Riverbend folding tables, local/MBE yes', async () => {
    await p.goto(B + '/marketplaces/riverbend'); await p.waitForTimeout(1500);
    const box = p.locator('input[placeholder^="Search Riverbend"]');
    await box.fill('40 folding tables for the Eastside rec center, delivered before March'); await p.keyboard.press('Enter');
    await p.waitForURL(/\/request\//); await p.waitForTimeout(1500);
    await p.locator('button:has-text("Yes")').first().click(); await p.waitForTimeout(2500);
    const makers = await p.locator('#options a[href^="/storefronts/"]').allInnerTexts();
    const peer = await p.locator('text=Harper County').count();
    if (!/riverside/i.test(makers[0] ?? '')) throw new Error('first is ' + makers[0]);
    return `order: ${makers.slice(0,4).join(', ')}; Harper County peer shown: ${peer > 0}`;
  });
  await step(2, 'Buy from Riverside, send PO for approval', async () => {
    await p.locator('#options a:has-text("Buy")').first().click(); await p.waitForURL(/checkout/); await p.waitForTimeout(1200);
    await p.locator('button:has-text("Send for approval")').click(); await p.waitForURL(/\/orders\//); await p.waitForTimeout(1000);
    return (await p.locator('h1').innerText()) + ' · options ' + (await ledgerOpts()).join(',');
  });
  await step(3, 'Procurement approves PO, opens Spend', async () => {
    await role('Procurement'); await p.goto(B + '/procurement'); await p.waitForTimeout(1200);
    await p.locator('button:has-text("Approve PO")').first().click(); await p.waitForTimeout(800);
    await p.goto(B + '/procurement/spend'); await p.waitForTimeout(1200);
    return 'spend heading: ' + (await p.locator('h1').first().innerText());
  });
  await step(4, 'Pencils, P-card checkout', async () => {
    await role('Buyer'); await search('a box of pencils for the front desk');
    const n = await p.locator('#options > div').count();
    await p.locator('#options a:has-text("Buy")').first().click(); await p.waitForURL(/checkout/); await p.waitForTimeout(1000);
    await p.locator('main button:has-text("Place"), main button:has-text("Buy"), main button:has-text("Order")').first().click(); await p.waitForURL(/\/orders\//);
    return `${n} option(s) · options ${(await ledgerOpts()).join(',')}`;
  });
  await step(5, 'LED retrofit, publish solicitation', async () => {
    await search('LED retrofit for the ice rink');
    await p.locator('a:has-text("Build it")').click(); await p.waitForSelector('text=Draft solicitation');
    await p.locator('button:has-text("Publish")').click(); await p.waitForURL(/\/solicitations$/);
    return 'options ' + (await ledgerOpts()).join(',');
  });
  await step(6, 'Supplier upload: State office supplies', async () => {
    await role('Supplier'); await p.goto(B + '/contracts/upload?as=supplier'); await p.waitForTimeout(1200);
    await p.locator('button:has-text("State office supplies")').click();
    await p.waitForSelector('text=Accept all above 90%', { timeout: 60000 });
    const two = p.locator('tr:has-text("Two prices")').first();
    if (await two.count()) { const row = p.locator('tr', { has: p.locator('text=Looks right') }).filter({ hasText: '' }); }
    // fix the two-price row: accept its first price
    const flagged = await p.locator('text=/Two prices in one cell/').count();
    if (flagged) {
      const idx = await p.evaluate(() => { const rows=[...document.querySelectorAll('tbody tr')]; return rows.findIndex(r => /Two prices/.test(r.innerText)); });
      await p.locator('tbody tr').nth(idx - 1).locator('button:has-text("Looks right")').click();
    }
    const merges = p.locator('button:has-text("Merge into row")'); const m = await merges.count(); for (let i = 0; i < m; i++) await merges.first().click();
    await p.locator('button:has-text("Accept all above 90%")').click();
    const pub = p.locator('button:has-text("Publish")').last(); const label = await pub.innerText();
    await pub.click(); await p.waitForTimeout(2500);
    const body = await p.locator('main').innerText();
    return `${label}; two-price fixed: ${flagged > 0}; merged ${m}; after: ${(body.match(/\d+ items? listed[^.\n]*/i) || body.match(/\d+[^.\n]{0,30}attention/i) || ['(no summary found)'])[0]}`;
  });
  await step(7, 'Supplier insights, list in Harper, PO financing, review reply', async () => {
    await p.goto(B + '/supplier?tab=insights'); await p.waitForTimeout(1000);
    const led = await p.locator('text=/LED/').count();
    await p.goto(B + '/supplier'); await p.waitForTimeout(800);
    await p.locator('button:has-text("City marketplaces")').click(); await p.waitForTimeout(500);
    await p.locator('div:has-text("Harper County") >> button:has-text("List here")').first().click(); await p.waitForTimeout(600);
    await p.locator('button:has-text("Apps")').click(); await p.waitForTimeout(500);
    await p.locator('div:has-text("PO financing") >> button:has-text("Get started")').first().click(); await p.waitForTimeout(600);
    await p.locator('button:has-text("Reviews")').click(); await p.waitForTimeout(500);
    await p.locator('input[placeholder^="Respond"]').first().fill('Thank you, glad the chairs worked out.'); await p.locator('button:has-text("Respond")').first().click(); await p.waitForTimeout(600);
    return `LED in insights: ${led > 0} · options ${(await ledgerOpts()).join(',')}`;
  });
  await step(8, 'Ledger totals: all ten options', async () => {
    const o = await ledgerOpts(); if (o.length < 10) throw new Error('only options ' + o.join(','));
    return o.join(',');
  });
  await step(9, 'Crested Butte laptops: co-ops it is on, a catalog co-op it could join, ask purchasing', async () => {
    await role('Buyer'); await agency('Town of Crested Butte'); await search('laptops for the town hall');
    const sec = p.locator('#coops'); const txt = await sec.innerText();
    // Colorado signed NASPO's addendum for Dell 23004 (not Apple 23003), and Sourcewell's roster lists the town.
    const [on, join] = txt.split("Co-ops you could join");
    if (!/23004/.test(on) || !/Sourcewell/.test(on)) throw new Error('Dell 23004 and Sourcewell should be under Co-ops you\'re on');
    if (!/Equalis/.test(join)) throw new Error('no catalog co-op under Co-ops you could join');
    await sec.locator('button:has-text("Confirm")').first().click(); await p.waitForTimeout(1500);
    await p.locator('#coops li:has-text("Equalis") button:has-text("Ask purchasing")').first().click(); await p.waitForTimeout(800);
    await role('Procurement'); await p.goto(B + '/procurement'); await p.waitForTimeout(1000);
    const req = await p.locator('text=Requests to join a co-op contract').count();
    const equalis = await p.locator('text=/Equalis Group COG-/').count();
    return `join request on procurement page: ${req > 0}, for an Equalis catalog contract: ${equalis > 0}`;
  });
  await step(10, 'Harmon Lake register + vests', async () => {
    await p.goto(B + '/procurement/setup'); await p.waitForTimeout(800); await agency('Harmon Lake Township'); await p.goto(B + '/procurement/setup'); await p.waitForTimeout(1000);
    await p.locator('button:has-text("Try the sample register")').click(); await p.waitForSelector("text=couldn't be read");
    const rep = await p.locator("text=/added, \\d+ couldn't be read/").innerText();
    await role('Buyer'); await search('bulletproof vests for patrol');
    const own = await p.locator('#own-contracts').innerText();
    return `${rep} · own contract first: ${/body armor/i.test(own)}`;
  });
  await step(11, 'Harmon Lake free tier: 5th RFP, 6th blocked, Euna handoff', async () => {
    await search('LED retrofit for the ice rink'); await p.locator('a:has-text("Build it")').click(); await p.waitForSelector('text=Draft solicitation');
    await p.locator('button:has-text("Publish")').click(); await p.waitForURL(/\/solicitations$/);
    await search('LED retrofit for the ice rink'); await p.locator('a:has-text("Build it")').click(); await p.waitForSelector('text=Draft solicitation'); await p.waitForTimeout(800);
    const limit = await p.locator('text=/used all 5 free RFPs/').count();
    await p.goBack(); await p.waitForTimeout(2000); await p.locator('button:has-text("Send it over")').click(); await p.waitForTimeout(800);
    const sent = await p.locator('text=/Sent to Euna/').count();
    return `limit shown: ${limit > 0} · Euna handoff: ${sent > 0}`;
  });
  await step(12, 'Riverbend cart, hand off, send back, revise, approve, reconcile', async () => {
    await agency('City of Riverbend'); await search('40 folding tables for the Eastside rec center, delivered before March');
    const tiles = p.locator('#options > div');
    await tiles.filter({ hasText: 'Riverside Office Supply' }).locator('button:has-text("Add to cart")').first().click(); await p.waitForTimeout(600);
    await tiles.filter({ hasText: 'Folding table, 6 ft, commercial' }).locator('button:has-text("Add to cart")').first().click(); await p.waitForTimeout(600);
    await p.goto(B + '/cart'); await p.waitForTimeout(1200);
    const split = await p.locator('aside').innerText();
    await p.locator('button:has-text("Hand this cart")').click(); await p.locator('button:has-text("Hand off")').click(); await p.waitForTimeout(600);
    await p.locator('button:has-text("Send for approval")').click(); await p.waitForTimeout(800);
    await role('Procurement'); await p.goto(B + '/procurement'); await p.waitForTimeout(1000);
    await p.locator('button:has-text("Send back")').first().click(); await p.locator('input[placeholder^="Why"]').fill('Use the state contract for the 6 ft tables'); await p.locator('form button:has-text("Send back")').click(); await p.waitForTimeout(800);
    await role('Buyer'); await p.goto(B + '/cart'); await p.waitForTimeout(800); await p.locator('button[role="tab"]:has-text("Sent back")').click();
    await p.locator('button:has-text("Revise and resubmit")').click(); await p.waitForTimeout(800); await p.locator('button:has-text("Send for approval")').click(); await p.waitForTimeout(800);
    await role('Procurement'); await p.goto(B + '/procurement'); await p.waitForTimeout(1000); await p.locator('button:has-text("Approve and order")').click(); await p.waitForTimeout(1000);
    await p.goto(B + '/procurement/orders'); await p.waitForTimeout(1200);
    const row = p.locator('tbody tr').filter({ hasText: '-PO-' }).first(); const id = (await row.locator('a').first().innerText()).trim();
    for (let i = 0; i < 4; i++) { await p.locator('tbody tr').filter({ hasText: id }).locator('button').first().click(); await p.waitForTimeout(500); }
    const status = await p.locator('tbody tr').filter({ hasText: id }).innerText();
    return `cart split: ${/PO/.test(split) && /P-card/.test(split)} · ${id} → ${/Reconciled/.test(status) ? 'Reconciled' : status.replace(/\s+/g,' ').slice(0,80)}`;
  });
  await step(13, 'Member list sample, Harmon Lake matched', async () => {
    await p.goto(B + '/coops'); await p.waitForTimeout(1000);
    await p.locator('button:has-text("Try the sample")').click(); await p.waitForSelector('text=/Matched in Agora/');
    const m = await p.locator('text=/Matched in Agora/').innerText();
    await role('Buyer'); await agency('Harmon Lake Township'); await search('laptops');
    const coops = await p.locator('#coops').innerText().catch(() => '');
    return `${m} · Harmon Lake sees Sourcewell as its co-op: ${/Harmon Lake Township's co-ops:[\s\S]*Sourcewell/.test(coops)}`;
  });
  console.log(results.join('\n'));
  console.log('page errors:', [...new Set(errors)].slice(0, 8));
  await b.close();
})();
