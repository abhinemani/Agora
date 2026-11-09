// Gives the featured Tyler products names a buyer can read. The price catalog
// names rows the way its price sheet does ("Flip to Saas: Tax Pro (Tier D
// -population >280,000)", "Task - Custom"); this step adds `name`, `tier` and,
// where the catalog repeats one blurb across a whole product line, `summary`,
// and hides duplicate or federal-only rows. Source fields are left untouched.
// Runs after feature-tyler.mjs as part of `npm run import:catalog`.

import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../seed/catalogs/tyler-technologies-2025-03.json", import.meta.url);

// Keyed by the title of each product's first featured row, in file order.
// [name, summary?]
const NAMES = {
  "Resident Engagement Platform (Engagement Builder eSign) - transaction-based pricing": ["Engagement Builder e-signatures", "Electronic signatures on resident forms built in Engagement Builder, priced per signature."],
  "Engagement Builder Platform - D&I Integration": ["Engagement Builder data integration", "Connects Engagement Builder forms and requests to Tyler Data & Insights for reporting."],
  "Payments Platform - ACH Processing": ["Online payments: ACH bank transfers", "Accept resident payments by bank transfer through Tyler's payments platform, priced per transaction."],
  "Disbursements - Monthly Platform Access": ["Digital disbursements platform", "Send refunds, benefits and other payments by direct deposit, push-to-card or prepaid card from one platform."],
  "Disbursements - Professional Services & Configuration": ["Digital disbursements setup and configuration", "Tyler staff hours to configure the disbursements platform for your programs."],
  "Application Platform: 1 Year Term, Turnkey": ["Case management app, turnkey (annual)", "A pre-configured case management app on Tyler's low-code platform for a common agency process."],
  "Application Platform: 1 Year Term, Turnkey 1 Named User (5 minimum named users)": ["Case management app, turnkey: user license (annual)", "One named user for the turnkey case management app. Five users minimum."],
  "Application Platform: 1 Year Term, Turnkey Portal < 100 Users": ["Case management app, turnkey: public portal (annual)", "A portal where residents or outside agencies submit and track cases in the turnkey app."],
  "Application Platform: 1 Year Term, Turnkey Plus": ["Case management app, turnkey plus (annual)", "A pre-configured case management app for more complex processes, on Tyler's low-code platform."],
  "Application Platform: 1 Year Term, Turnkey Plus 1 Named User (5 minimum named users)": ["Case management app, turnkey plus: user license (annual)", "One named user for the turnkey plus app. Five users minimum."],
  "Application Platform: 1 Year Term, Turnkey Plus Portal < 100 Users": ["Case management app, turnkey plus: public portal (annual)", "A portal where residents or outside agencies submit and track cases in the turnkey plus app."],
  "Application Platform: 1 Year Term, Turnkey Advanced": ["Case management app, turnkey advanced (annual)", "The most capable pre-configured case management app on Tyler's low-code platform."],
  "Application Platform: 1 Year Term, Turnkey Advanced 1 Named User (5 minimum named users)": ["Case management app, turnkey advanced: user license (annual)", "One named user for the turnkey advanced app. Five users minimum."],
  "Application Platform: 1 Year Term, Turnkey Advanced Portal < 100 Users": ["Case management app, turnkey advanced: public portal (annual)", "A portal where residents or outside agencies submit and track cases in the turnkey advanced app."],
  "Application Platform: Perpetual, Turnkey 1 Named User (5 minimum named users)": ["Case management app, turnkey: user license (perpetual)", "A permanent named-user license for the turnkey case management app. Five users minimum."],
  "Application Platform: Perpetual, Turnkey Access < 100 Users": ["Case management app, turnkey: public portal (perpetual)", "A permanent license for the turnkey app's resident and partner portal."],
  "Application Platform: Perpetual, Turnkey Plus 1 Named User (5 minimum named users)": ["Case management app, turnkey plus: user license (perpetual)", "A permanent named-user license for the turnkey plus app. Five users minimum."],
  "Application Platform: Perpetual, Turnkey Advanced 1 Named User (5 minimum named users)": ["Case management app, turnkey advanced: user license (perpetual)", "A permanent named-user license for the turnkey advanced app. Five users minimum."],
  "Application Platform: 1 Year Term": ["Low-code case management platform (annual)", "Tyler's low-code platform for building your own case management apps."],
  "Application Platform: 1 Year Term, 1 Concurrent User (5 minimum concurrent users)": ["Low-code case management platform: user license (annual)", "One concurrent user on the low-code platform. Five users minimum."],
  "Application Platform, Direct Scan Module: 1 Year Term, 1 Concurrent User (5 minimum concurrent users)": ["Document scanning add-on (annual, per user)", "Scan paper, faxes and email straight into case files on the low-code platform."],
  "Application Platform, Access Module: 1 Year Term, 1 Concurrent User (5 minimum concurrent users)": ["Online submissions add-on (annual, per user)", "Lets people outside the agency submit forms and documents into the low-code platform."],
  "Application Platform, Mobile Module: 1 Year Term, 1 Named User (5 minimum named users)": ["Mobile app add-on (annual, per user)", "Work cases from a phone or tablet in the field. Five users minimum."],
  "Application Platform Analytics: 1 Year Term, 1 Concurrent User (5 minimum concurrent users)": ["Case analytics add-on (annual, per user)", "Dashboards and reports on case data in the low-code platform."],
  "Data Collect Mobile: 1 Year Term, 1 Named User (5 minimum named users)": ["Mobile field data collection (annual, per user)", "Capture inspections and field data on a phone or tablet, with photos and location."],
  "Application Platform, Mobile Module: Perpetual, 1 Named User (5 minimum named users)": ["Mobile app add-on (perpetual, per user)", "A permanent license to work cases from a phone or tablet. Five users minimum."],
  "Enterprise CAD Single Jurisdiction Law Enforcement": ["Computer-aided dispatch: police, one jurisdiction", "Dispatch software for a single police agency: call intake, unit status and incident tracking."],
  "Enterprise CAD Multiple Jurisdiction Law Enforcement": ["Computer-aided dispatch: police, multiple jurisdictions", "Dispatch software for a center that dispatches for several police agencies."],
  "Enterprise CAD Fire/EMS Single & Multi-Jurisdictional": ["Computer-aided dispatch: fire and EMS", "Dispatch software for fire and EMS, for one jurisdiction or several."],
  "Enterprise CAD Combined LE/Fire/EMS": ["Computer-aided dispatch: police, fire and EMS combined", "One dispatch system for a center handling police, fire and EMS calls together."],
  "CAD Auto Routing": ["Dispatch add-on: automatic routing", "Suggests the fastest route to each call for the responding unit."],
  "CAD AVL": ["Dispatch add-on: vehicle location tracking (AVL)", "Shows where every unit is on the dispatch map in real time."],
  "Web CAD Monitor": ["Dispatch add-on: web monitor", "A browser view of live dispatch activity for supervisors and partner agencies."],
  "Enterprise Law Enforcement Records": ["Police records management system", "Incident reports, arrests, case files and evidence for a police department."],
  "Permits (Guns)": ["Firearm permits module", "Process and track firearm permit applications in the police records system."],
  "Tyler Content Manager (TCM)": ["Public safety document management", "Stores and links documents, photos and files to police records."],
  "CAD Data Mart Includes 2 users": ["Dispatch reporting database", "A reporting copy of dispatch data for analysts, priced by number of users."],
  "Records Data Mart Includes 2 users": ["Police records reporting database", "A reporting copy of records data for analysts, priced by number of users."],
  "Enterprise Mobile Server": ["Public safety mobile server", "The server that connects patrol and fire laptops to dispatch and records."],
  "Enterprise Law Enforcement Mobile Site License (per user)": ["Patrol car mobile app (per officer)", "Dispatch, messaging and records lookups on the patrol car laptop."],
  "Enterprise Fire/EMS Mobile Site License (per user)": ["Fire and EMS mobile app (per user)", "Dispatch, mapping and run information on the apparatus laptop."],
  "Field Reporting Site License (per user)": ["Field incident reporting (per officer)", "Officers write and submit incident reports from the field."],
  "E-Citation Site License (per user)": ["Electronic citations (per officer)", "Write traffic and parking tickets on a handheld or laptop instead of paper."],
  "E-Crash Site License (per user)": ["Electronic crash reports (per officer)", "Complete crash reports in the field and submit them electronically."],
  "Enterprise Fire Field Mobile (per user)": ["Fire field app (per user)", "Incident and inspection data on a phone or tablet for firefighters."],
  "Enterprise Law Enforcement Field Mobile (per user)": ["Police field app (per officer)", "Records lookups and reporting on a phone or tablet for officers."],
  "Fire Dispatch/Messaging (per user)": ["Fire dispatch messaging (per user)", "Receive dispatches and messages on a mobile device."],
  "EPS Platform - Enhanced": ["Public safety suite, enhanced (annual)", "Tyler's integrated dispatch, records and mobile suite as an annual subscription."],
  "EPS Platform - Mobility": ["Public safety suite, mobile add-on (annual)", "Adds mobile access to the public safety suite subscription."],
  "Data Collect Mobile (per user)": ["Public safety field data collection (per user)", "Capture field data and photos on a phone or tablet for public safety staff."],
  "E-Citation License (per user)": ["Electronic citations, Enforcement Mobile (per officer)", "Tyler's Enforcement Mobile ticket-writing app for officers in the field."],
  "E-Crash License w/ Drawing Tool (per user)": ["Electronic crash reports with diagram tool (per officer)", "Crash reporting in Enforcement Mobile, including a scene diagram tool."],
  "E-Crash License w/o Drawing Tool (per user)": ["Electronic crash reports without diagram tool (per officer)", "Crash reporting in Enforcement Mobile, without the diagram tool."],
  "Interface - Records Management System": ["Enforcement Mobile link to your records system", "Sends citations and crash reports from Enforcement Mobile into your police records system."],
  "Task - Custom": ["Enforcement Mobile custom form", "A custom form or workflow built for your agency in Enforcement Mobile."],
  "E-Crash Locally Installed Diagram Tool (per user)": ["Crash diagram tool, installed (per officer)", "A crash scene drawing tool installed on the officer's device."],
  "Message Switch": ["Enforcement Mobile state database connection", "Connects Enforcement Mobile to state driver and vehicle lookups."],
  "Civil Serve - Perpetual License per Concurrent User": ["Civil process: serving papers (per user)", "Track and manage service of civil papers for a sheriff's office."],
  "Civil Mobile - Perpetual License per Concurrent User": ["Civil process mobile app (per user)", "Deputies record service attempts and results in the field."],
  "Public Sales Access - Perpetual Enterprise License": ["Civil process: public sheriff's sales site", "Publishes upcoming sheriff's sales and foreclosures online."],
  "Internal Civil Case Access - Perpetual Enterprise License": ["Civil process: staff case lookup", "Lets office staff look up civil process cases and their status."],
  "Public Civil Case Access - Perpetual Enterprise License": ["Civil process: public case lookup", "Lets the public check the status of civil papers online."],
  "Attorney Access - License On-Premise": ["Civil process: attorney portal", "Lets attorneys and law firms track the papers they've filed."],
  "Civil Mobile - SaaS per Concurrent User": ["Civil process mobile app, cloud (per user)", "Deputies record service attempts in the field, as a cloud subscription."],
  "Public Sales Access - Enterprise SaaS": ["Civil process: public sheriff's sales site, cloud", "Publishes upcoming sheriff's sales online, as a cloud subscription."],
  "Enterprise Jury Manager (Up to 5,000 Summons Annually)": ["Jury management software", "Summons, juror portal, source lists and juror pay for a court, priced by summonses a year."],
  "Inspector Mobile": ["Fire inspection app", "Fire inspectors complete inspections on a tablet, per inspector per year."],
  "Inspector Mobile Plus": ["Fire inspection app, plus", "Fire inspections on a tablet with added scheduling and reporting, per inspector per year."],
  "Company Inspector Mobile": ["Fire company inspection app", "Engine companies complete in-service inspections on a tablet, per user per year."],
  "Preplans Mobile": ["Fire pre-incident planning app", "Building pre-plans and hazards on a tablet for responding crews, per user per year."],
  "Permits Mobile": ["Fire permits app", "Issue and inspect fire permits on a tablet, per user per year."],
  "Enterprise Supervision - CMS (10 - 50 Users)": ["Probation case management", "Case management for probation and community supervision officers, priced per user."],
  "Enterprise Supervision Access - Basic (10 - 50 Users, Includes up to 16,000 Reminders)": ["Probation client portal, basic", "Online check-ins and automated reminders for people under supervision, priced per officer."],
  "Enterprise Supervision Access - Premium (10 - 50 Users, Includes up to 16,000 Reminders)": ["Probation client portal, premium", "Online check-ins, payments and automated reminders for people under supervision, priced per officer."],
  "Supervision Analytics - (10-19 Users)": ["Probation analytics", "Caseload and outcome dashboards for supervision agencies, priced per user."],
  "Enterprise Supervision - Integration Toolkit (10 - 50 Users)": ["Probation system integrations", "Connects probation case management to courts, jails and other systems, priced per user."],
  "Enterprise Supervision - Mobile": ["Probation mobile app (per device)", "Officers work cases and record field contacts on a mobile device."],
  "Flip to Saas: Tax Pro (Tier D -population >280,000)": ["Property assessment and tax software, cloud", "Tyler Tax Pro for assessment and tax billing, moved to a cloud subscription. Priced by population."],
  "Enterprise Permitting & Licensing User": ["Permitting and licensing software (per user)", "Building permits, business licenses, inspections and code enforcement, per staff user per year."],
  "ERM Core Application: # Recorded Documents/Yr 0 - 10,000 (Tier SA)": ["Land records and recording software", "Recording, indexing and search for deeds and official records, priced by documents recorded a year."],
  "User License: # Recorded Documents/Yr 0 - 10,000 (Tier LA)": ["Land records software: user license", "One staff user of the land records system, priced by the office's recording volume."],
  "Open Payroll (1M - 5M)": ["Open payroll transparency site", "Publishes government payroll data in a searchable public site. Priced by population."],
  "Public Safety Insights": ["Public safety data dashboards", "Crime and calls-for-service dashboards for the public and command staff, priced per sworn officer."],
  "Open Budget": ["Open budget transparency site", "Publishes your operating and capital budgets in an explorable public site. Priced by population."],
  "Insights Dashboard": ["Data benchmarking dashboard", "Explore, analyze and compare data across places."],
  "Open Data Platform (Under 25k)": ["Open data portal", "Publish datasets, maps and charts on a public open data site. Priced by population."],
  "Open Data Platform - Basic": ["Open data portal, basic edition", "A hosted open data site with set limits on datasets and storage."],
  "Open Data Platform - Master Subscription License (10)": ["Open data portal, multi-site master subscription", "A master subscription to run several open data sites under one agreement."],
  "Finance Insights": ["Financial transparency dashboards", "Public dashboards that show where money comes from and goes."],
  "Data Insights Open Data Platform": ["Open data portal, connected edition", "An open data site that connects to Tyler's other Data & Insights apps."],
  "Performance Insights": ["Performance measures site", "Publishes your goals and performance measures with live data. Priced by population."],
  "Open Checkbook (Under 25k)": ["Open checkbook transparency site", "Publishes vendor payments and spending in a searchable public site. Priced by population."],
  "Enterprise Data Platform - Department Edition": ["Data & Insights full suite, department edition", "Every Tyler Data & Insights app, licensed for one department."],
  "Enterprise Data Platform - Program Edition": ["Data & Insights full suite, program edition", "Every Tyler Data & Insights app, licensed for one program."],
  "Data & Insights Academy": ["Data skills training for staff", "Training courses that teach government staff to analyze and present data."],
  "12 Perspective Creation Licenses (Under 25k)": ["Report builder licenses", "Licenses for staff to build charts and data stories in Data & Insights. Packs of 5, 12 or 30, priced by population."],
  "Financial Transparency Suite - Essentials": ["Financial transparency suite, essentials", "Budget, checkbook and payroll transparency apps together."],
  "Financial Transparency Suite - Enterprise": ["Financial transparency suite, enterprise", "The full set of financial transparency apps with more data and users."],
  "Financial Transparency Suite - Connected": ["Financial transparency suite, connected", "Financial transparency apps connected to your finance system."],
  "Cannabis Insights - Essentials": ["Cannabis program analytics", "Tracks licensing, sales and tax data for a cannabis program."],
};

// Rows that duplicate another tier or serve only federal buyers.
const HIDE = new Set(["SOC-PR-3|14400|SOC-PR-3", "SOC-PR-6|58639.8", "SOC-APP-OB|17587", "SOC-OB-3 (50k - 150k)|14400", "SOC-ODP-OPC|74227", "SOC-OD-Fed-B|77405"]);

const num = (s) => {
  const t = s.trim().replace(/,/g, "");
  if (/^\d+(\.\d+)?[km]$/i.test(t)) return Number(t.slice(0, -1)) * (/k/i.test(t.slice(-1)) ? 1e3 : 1e6);
  return Number(t);
};
const pretty = (n) => (n >= 1e6 ? `${n / 1e6} million` : n.toLocaleString("en-US"));

/** A tier label in plain words, from whichever form the catalog used. */
function tierLabel(item) {
  const v = (item.variant ?? "").trim();
  let m;
  if ((m = item.detail.match(/Per Sworn Officer Per Year \/ (\d+)(?:-(\d+)|\+)/))) return m[2] ? `${m[1]}–${m[2]} sworn officers` : `${m[1]}+ sworn officers`;
  if ((m = item.title.match(/^(\d+) Perspective Creation Licenses/))) return `${population(v)} · ${m[1]} licenses`;
  if ((m = v.match(/^Includes (.+) users$/i))) return `${m[1].replace("-", "–")} users`;
  if ((m = v.match(/^([<>]) 100 Users$/))) return m[1] === "<" ? "Under 100 users" : "Over 100 users";
  if ((m = v.match(/^Up to ([\d,]+) Summons Annually$/))) return `Up to ${m[1]} summonses a year`;
  if ((m = v.match(/^([\d,]+)\s*-\s*([\d,]+) Users, Includes up to ([\d,]+) Reminders$/))) return `${m[1]}–${m[2]} officers · ${m[3]} reminders`;
  if ((m = v.match(/^([\d,]+)\s*-\s*([\d,]+) Users$/))) return `${m[1]}–${m[2]} users`;
  if ((m = v.match(/^population (.+)$/i))) {
    const r = m[1];
    if ((m = r.match(/^>([\d,]+)/))) return `Population over ${m[1]}`;
    if ((m = r.match(/^0-([\d,]+)/))) return `Population up to ${m[1]}`;
    if ((m = r.match(/^([\d,]+)-([\d,]+)/))) return `Population ${m[1]}–${m[2]}`;
  }
  if ((m = v.match(/# Recorded Documents\/Yr ([\d,]+)\s*(?:-\s*([\d,]+)|\+)/))) {
    if (!m[2]) return `Over ${m[1]} recorded documents a year`;
    return m[1] === "0" ? `Up to ${m[2]} recorded documents a year` : `${m[1]}–${m[2]} recorded documents a year`;
  }
  if (/^\d+$/.test(v)) return `${v}-site subscription`;
  if (/^(Under |[\d.]+[kKmM]\s*-|[\d.]+[kKmM]\+)/.test(v)) return population(v);
  return null;
}

function population(v) {
  let m;
  if ((m = v.match(/^Under ([\d.]+[km])$/i))) return `Population under ${pretty(num(m[1]))}`;
  if ((m = v.match(/^([\d.]+[km])\s*-\s*([\d.]+[km])$/i))) {
    const [a, b] = [num(m[1]), num(m[2])];
    return a >= 1e6 ? `Population ${a / 1e6}–${b / 1e6} million` : `Population ${pretty(a)}–${pretty(b)}`;
  }
  if ((m = v.match(/^([\d.]+[km])\+$/i))) return `Population ${pretty(num(m[1]))}+`;
  return v;
}

const data = JSON.parse(readFileSync(FILE, "utf8"));
const featured = data.items.filter((i) => i.featured);
const firstTitle = new Map();
for (const i of featured) if (!firstTitle.has(i.family)) firstTitle.set(i.family, i.title);
const familySize = new Map();

let missing = [];
for (const i of featured) {
  delete i.name, delete i.tier, delete i.summary, delete i.hidden;
  const key = `${i.sku}|${i.unit_price}`;
  if (HIDE.has(key) || HIDE.has(`${key}|${i.variant}`)) {
    i.hidden = true;
    continue;
  }
  familySize.set(i.family, (familySize.get(i.family) ?? 0) + 1);
}
for (const i of featured) {
  if (i.hidden) continue;
  const entry = NAMES[firstTitle.get(i.family)];
  if (!entry) {
    missing.push(firstTitle.get(i.family));
    continue;
  }
  i.name = entry[0];
  if (entry[1]) i.summary = entry[1];
  if (familySize.get(i.family) > 1) {
    const t = tierLabel(i);
    if (!t) missing.push(`tier: ${i.title} [${i.variant}]`);
    i.tier = t ?? i.variant;
  }
}
missing = [...new Set(missing)];
if (missing.length) {
  console.error("Unnamed:\n  " + missing.join("\n  "));
  process.exit(1);
}
writeFileSync(FILE, JSON.stringify(data, null, 1) + "\n");
const shown = featured.filter((i) => !i.hidden);
console.log(`Named ${new Set(shown.map((i) => i.family)).size} products (${shown.length} price rows, ${featured.length - shown.length} hidden).`);
