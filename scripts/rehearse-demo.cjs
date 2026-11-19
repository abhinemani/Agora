const { chromium } = require('playwright');
const B = process.argv[2] || 'http://localhost:3000';
// Runs the README demo path (steps 1–17) in a real browser against a running
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
  // The homepage narrows product requests in place (the front door); contract-shaped ones go straight to results.
  // Either way this lands on the results page: from the front door, by "See full results".
  const search = async (q) => { await p.goto(B + '/'); await p.locator('input[aria-label="What are you looking to buy?"]').fill(q); await p.keyboard.press('Enter'); await p.waitForFunction(() => location.pathname.startsWith('/request/') || location.search.startsWith('?q='), null, { timeout: 60000 }); if (!new URL(p.url()).pathname.startsWith('/request/')) { await p.locator('button:has-text("See full results")').click(); } await p.waitForURL(/\/request\//, { timeout: 60000 }); await p.waitForTimeout(1500); const yes = p.locator('button:has-text("Yes")'); if (await yes.count()) { await yes.first().click(); } await p.waitForTimeout(1500); };
  // The other sources on a results page are folded; open one before reading it.
  const openFold = async (id) => { const b = p.locator(`#${id} > h3 > button[aria-expanded="false"]`); if (await b.count()) { await b.click(); await p.waitForTimeout(400); } };
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
    await p.locator('button:has-text("Yes")').first().click();
    // The first search loads the catalog on a cold server: wait for the options rather than a fixed time.
    await p.locator('#options a[href^="/storefronts/"]').first().waitFor({ timeout: 30000 }); await p.waitForTimeout(1000);
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
    await openFold('coops'); const sec = p.locator('#coops'); const txt = await sec.innerText();
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
    await openFold('coops'); const coops = await p.locator('#coops').innerText().catch(() => '');
    return `${m} · Harmon Lake sees Sourcewell as its co-op: ${/Harmon Lake Township's co-ops:[\s\S]*Sourcewell/.test(coops)}`;
  });
  await step(14, 'Find a product: electric vehicles only, no gasoline', async () => {
    await p.goto(B + '/dive'); await p.waitForTimeout(1200);
    const box = p.locator('input[placeholder="Describe what you need"]'); await box.fill('small electric utility vehicle'); await box.press('Enter');
    await p.waitForSelector('text=/\\d+ OF \\d+ MATCH/i', { timeout: 60000 });
    const txt = await p.locator('main').innerText();
    if (/gasoline/i.test(txt)) throw new Error('a gasoline vehicle is on an electric shortlist');
    if (!/Electric/.test(txt)) throw new Error('no electric vehicle on the shortlist');
    return (txt.match(/\d+ OF \d+ MATCH/i) || ['matched'])[0];
  });
  await step(15, 'Ask a contract: agreements listed first, price files get price questions', async () => {
    await p.goto(B + '/ask'); await p.waitForSelector('text=Which contract?'); await p.waitForTimeout(1500);
    const first = await p.locator('main ul button, main li button').first().innerText();
    if (/^[^\n]*\n[^\n]*\nPrice file/.test(first)) throw new Error('a price file leads the list: ' + first.split('\n')[0]);
    await p.locator('#find-contract').fill('R220201'); await p.waitForTimeout(500);
    await p.locator('main button:has-text("R220201")').first().click(); await p.waitForTimeout(800);
    const q = p.locator('button:has-text("What date are these prices from?")');
    if (!(await q.count())) throw new Error('no price-file question offered for a price file');
    await q.click();
    await p.locator('main figcaption').or(p.locator('text=/Nothing in these documents|couldn\'t/i')).first().waitFor({ timeout: 90000 });
    return 'first listed: ' + first.split('\n')[0] + ' · Burke price file answered';
  });
  await step(16, 'Check a quote: the playground sample', async () => {
    await p.goto(B + '/quote-check'); await p.waitForTimeout(1000);
    await p.locator('main button:has-text("sample")').first().click();
    await p.waitForSelector('text=/Lines read/i', { timeout: 90000 });
    const txt = await p.locator('main').innerText();
    return (txt.match(/\d+ of \d+ checked lines[^.\n]*/i) || ['report shown'])[0];
  });
  await step(17, 'Front door: folding tables asked, narrowed, routed, with a way out', async () => {
    await p.goto(B + '/'); await p.waitForTimeout(800);
    await p.locator('input[aria-label="What are you looking to buy?"]').fill('40 folding tables for the rec center'); await p.keyboard.press('Enter');
    await p.waitForSelector('text=/\\d+ OF \\d+ MATCH/i', { timeout: 60000 });
    if (new URL(p.url()).pathname !== '/') throw new Error('a product request left the homepage: ' + p.url());
    const chips = await p.locator('section[aria-label=Shortlist]').innerText();
    if (!/\b40\b/.test(chips)) throw new Error('the quantity in the request was not read');
    if (!/40 × \$[\d,.]+ = \$/.test(chips)) throw new Error('no order total on the cards');
    const skip = p.locator('section[aria-label=Conversation] button:has-text("Skip: show every contract")'); if (await skip.count()) await skip.click();
    // The dive asks a question when the shortlist has enough to split; when the request's own requirements (read by the
    // model) already narrowed it, a filter from the request stands in for the answer.
    const opts = p.locator('section[aria-label=Conversation] div.flex-col > button');
    if (await opts.count()) { await opts.first().click(); await p.waitForTimeout(2500); }
    else if (!(await p.locator('section[aria-label=Shortlist] button[aria-label^="Remove "]').count())) throw new Error('nothing narrowed the shortlist: no question asked and no filter read from the request');
    if (!/[?&]f=/.test(p.url())) throw new Error('the answer is not kept in the address');
    const strip = p.locator('button:has-text("See the options")'); if (await strip.count()) await strip.click();
    const ramp = await p.locator('#none-fit').innerText();
    if (!/Recommended/i.test(ramp) || !/Draft a solicitation/i.test(ramp)) throw new Error('the way out is missing a path or a recommendation');
    await p.locator('button:has-text("Choose this one")').first().click();
    const route = await p.locator('section[aria-label=Route]').innerText();
    if (!/HOW IT.S BOUGHT/i.test(route)) throw new Error('no route for the chosen product');
    await p.locator('section[aria-label=Route] button:has-text("Start the purchase file"), section[aria-label=Route] button:has-text("Plan this purchase")').first().click();
    await p.waitForURL(/\/request\//, { timeout: 60000 });
    return (chips.match(/\d+ OF \d+ MATCH/i) || ['matched'])[0] + ' · ' + (ramp.match(/RECOMMENDED\s+([^\n]+)/i) || ['', 'a path'])[1].trim();
  });
  console.log(results.join('\n'));
  console.log('page errors:', [...new Set(errors)].slice(0, 8));
  await b.close();
})();
