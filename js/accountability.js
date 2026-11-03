/* Accountability (Sanctum): which fields every project must have filled, and who is
   Responsible for filling each blank and Accountable for it being filled.

   Pure: no DOM, no network. The page (js/board.js, js/admin.js) and the daily digest
   (tools/notify.mjs) both work from these functions, so they always agree on what's
   missing. The defaults are ACCOUNTABILITY in js/config.js; what the Admin page saved
   in the Variables table wins over them (configFrom). */

import { plain, clean, people, normCode, allCodes, isBlank, tagsOf } from "./sync.js";

export const ROW = "@row";             // a rule's field: "the project has a row in that table"
export const TABLE_NAMES = { universe: "Universe", andon: "ANDON", collections: "Collections" };
export const UNASSIGNED = "unassigned";  // the person id of items nobody holds

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const numOf = (v) => num(v) ?? (v && typeof v === "object" && Array.isArray(v.value) ? num(v.value[0]) : null);

/* ======================= the configuration ======================= */

/* The configuration in force: the defaults (ACCOUNTABILITY), with what the Admin page
   saved in the Variables table (`records`, `cols` = which columns hold the variable's
   name and value: variableColumns in sync.js) on top. Each kind (rules, roles, people,
   settings, admins) comes from Variables as soon as it has one row there.
   Returns { since, skipTags, fallback, namedRoles, rules, roles, people, admins,
             saved: {kind: bool}, rows: {kind: [{id, key}]}, problems: [string] }. */
export function configFrom(defaults, records, cols) {
  const names = defaults.variables;
  const rows = { rule: [], role: [], person: [], setting: [], admin: [] };
  const problems = [];
  if (cols) {
    for (const r of records || []) {
      const f = r.fields || {};
      const kind = Object.keys(names).find(k => clean(f[cols.name]).toLowerCase() === names[k].toLowerCase());
      if (!kind) continue;
      const text = clean(f[cols.value]);
      let value;
      try { value = JSON.parse(text); } catch { problems.push(`A Variables row named “${names[kind]}” isn't valid JSON, so it was skipped: ${text.slice(0, 60)}`); continue; }
      if (!value || typeof value !== "object") { problems.push(`A Variables row named “${names[kind]}” has no settings in it.`); continue; }
      rows[kind].push({ id: r.record_id, value, text });
    }
  }
  const setting = rows.setting.length ? rows.setting[0].value : {};
  const rules = rows.rule.length ? rows.rule.map(x => normRule(x.value)).filter(Boolean) : defaults.rules.map(normRule);
  const roles = {};
  for (const n of defaults.namedRoles) roles[n] = [];
  for (const x of rows.role) {
    const name = clean(x.value.role);
    if (name) roles[name] = normPeople(x.value.people);
  }
  const peopleMap = {};
  for (const x of rows.person) {
    const id = clean(x.value.id);
    if (id) peopleMap[id] = { id, name: clean(x.value.name) || id, telegram: telegramHandle(x.value.telegram) };
  }
  return {
    since: /^\d{4}-\d{2}-\d{2}$/.test(setting.since || "") ? setting.since : defaults.since,
    skipTags: Array.isArray(setting.skipTags) ? setting.skipTags.map(clean).filter(Boolean) : [...defaults.skipTags],
    fallback: Array.isArray(setting.fallback) ? setting.fallback.map(clean).filter(Boolean) : [...defaults.fallback],
    pipeline: defaults.pipeline, lostStatuses: defaults.lostStatuses, phaseStages: defaults.phaseStages,
    projectRoles: defaults.projectRoles,
    namedRoles: Object.keys(roles),
    rules, roles, people: peopleMap,
    admins: rows.admin.map(x => normPeople([x.value])[0]).filter(Boolean),
    saved: Object.fromEntries(Object.keys(rows).map(k => [k, rows[k].length > 0])),
    rows: Object.fromEntries(Object.entries(rows).map(([k, list]) => [k, list.map(x => ({ id: x.id, key: rowKey(k, x.value), text: x.text }))])),
    problems,
  };
}

function normRule(r) {
  if (!r || !clean(r.field) || !TABLE_NAMES[r.table]) return null;
  return {
    id: clean(r.id) || `${r.table}:${clean(r.field)}`, table: r.table, field: clean(r.field),
    from: clean(r.from), lost: !!r.lost,
    responsible: clean(r.responsible), accountable: clean(r.accountable), on: r.on !== false,
  };
}
const normPeople = (list) => (Array.isArray(list) ? list : [])
  .filter(p => p && (clean(p.id) || clean(p.email) || clean(p.name)))
  .map(p => ({ id: clean(p.id), name: clean(p.name) || clean(p.email) || clean(p.id), email: clean(p.email) }));

/* "@juan_dc", "juan_dc" or "https://t.me/juan_dc" → "juan_dc" (Telegram's 5–32 letters, digits, _). "" if it isn't one. */
export function telegramHandle(v) {
  const s = clean(v).replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "");
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(s) ? s : "";
}

/* Which saved row an item of a kind matches when saving (one row per rule, role, person; one settings row). */
function rowKey(kind, v) {
  if (kind === "rule") return `rule:${clean(v.id) || `${v.table}:${clean(v.field)}`}`;
  if (kind === "role") return `role:${clean(v.role).toLowerCase()}`;
  if (kind === "person" || kind === "admin") return `${kind}:${clean(v.id) || clean(v.email) || clean(v.name)}`;
  return "setting";
}

/* What the Admin page saves: the Variables rows each kind should have, as
   { kind, key, value: JSON text }. Saving makes Variables match this list. */
export function configValues(cfg) {
  const out = [];
  const add = (kind, v) => out.push({ kind, key: rowKey(kind, v), value: JSON.stringify(v) });
  add("setting", { since: cfg.since, skipTags: cfg.skipTags, fallback: cfg.fallback });
  for (const r of cfg.rules) add("rule", { id: r.id, table: r.table, field: r.field, from: r.from, lost: r.lost,
                                           responsible: r.responsible, accountable: r.accountable, on: r.on });
  for (const name of cfg.namedRoles) add("role", { role: name, people: (cfg.roles[name] || []).map(p => ({ id: p.id, name: p.name, email: p.email })) });
  for (const p of Object.values(cfg.people)) if (p.telegram) add("person", { id: p.id, name: p.name, telegram: p.telegram });
  for (const a of cfg.admins) add("admin", { id: a.id, name: a.name, email: a.email });
  return out;
}

/* The writes that make the Variables table hold `wanted` (configValues): rows to
   create, rows to update (same key, new value) and rows to delete (no longer wanted,
   or a second row with the same key). `existing` = configFrom(...).rows with each
   row's current text (`text`), by kind. Returns { create: [{kind, value}], update:
   [{id, value}], remove: [id] }. */
export function configWrites(existing, wanted) {
  const create = [], update = [], remove = [];
  const have = new Map();
  for (const [kind, list] of Object.entries(existing)) {
    for (const row of list) {
      if (have.has(row.key)) remove.push(row.id);
      else have.set(row.key, { ...row, kind });
    }
  }
  const used = new Set();
  for (const w of wanted) {
    const row = have.get(w.key);
    if (!row) { create.push({ kind: w.kind, value: w.value }); continue; }
    used.add(w.key);
    if (row.text !== w.value) update.push({ id: row.id, value: w.value });
  }
  for (const [key, row] of have) if (!used.has(key)) remove.push(row.id);
  return { create, update, remove };
}

/* Is this person (the signed-in user: {name, email}) an admin? With no admins saved
   yet, everyone is (someone has to add the first). */
export function isAdmin(cfg, user) {
  if (!cfg.admins.length) return true;
  if (!user) return false;
  const email = clean(user.email).toLowerCase(), name = clean(user.name).toLowerCase();
  return cfg.admins.some(a => (email && a.email.toLowerCase() === email) || (name && a.name.toLowerCase() === name));
}

/* ======================= which projects, at which stage ======================= */

/* The year a project belongs to, and whether it's in scope (on or after cfg.since):
   its RFP Received Date, else its Year, else the year in its project code. A project
   with none of them is in scope (better asked about than missed). */
export function inScope(f, cfg) {
  const since = Date.parse(`${cfg.since}T00:00:00+08:00`);
  const rfp = numOf(f["RFP Received Date"]);
  if (rfp !== null) return rfp >= since;
  const sinceYear = Number(cfg.since.slice(0, 4));
  const year = Number((clean(f["Year"]).match(/\b(\d{4})\b/) || [])[1]);
  if (year) return year >= sinceYear;
  const code = allCodes(plain(f["Project Code"]))[0];
  if (code) return Number(code.slice(0, 4)) >= sinceYear;
  return true;
}

/* Where a Universe project is: { status, index (in cfg.pipeline; -1 when lost),
   lost, known (its Status is in the pipeline or lost) }. A Mancom Phase in
   cfg.phaseStages moves it at least that far. A blank or unknown Status counts as
   the first stage, so only the rules that apply from the start are asked. */
export function stageOf(f, cfg) {
  const status = clean(f["Status"]);
  if (cfg.lostStatuses.includes(status)) return { status, index: -1, lost: true, known: true };
  let index = cfg.pipeline.indexOf(status);
  const known = index >= 0;
  const phase = cfg.phaseStages[clean(f["Mancom Phase"])];
  if (phase) index = Math.max(index, cfg.pipeline.indexOf(phase));
  return { status, index: Math.max(index, 0), lost: false, known };
}

/* Does a rule apply to a project at this stage? */
export function applies(rule, stage, cfg) {
  if (!rule.on) return false;
  if (stage.lost) return rule.lost;
  const from = cfg.pipeline.indexOf(rule.from);
  return from >= 0 && stage.index >= from;
}

/* ======================= who ======================= */

/* The people holding a role on a project: a project role from the project's rows
   (BD and AM on its Universe row, PM on its ANDON row), else a named role
   (cfg.roles). `rows` = { universe, andon } records for the project (or null). */
export function holders(role, rows, cfg) {
  const src = cfg.projectRoles[role];
  if (src) {
    const rec = rows[src.table];
    return rec ? people((rec.fields || {})[src.field]) : [];
  }
  return (cfg.roles[role] || []).map(p => ({ ...p, id: p.id || p.email || p.name, short: p.name }));
}

/* Who an item goes to for a role: its holders, or else the first role in
   cfg.fallback that has someone. { role, via, people, unassigned } — `via` is the
   role it fell back to ("" when the role itself has someone). */
export function resolve(role, rows, cfg) {
  const own = holders(role, rows, cfg);
  if (own.length) return { role, via: "", people: own, unassigned: false };
  for (const fb of cfg.fallback) {
    if (fb === role) continue;
    const list = holders(fb, rows, cfg);
    if (list.length) return { role, via: fb, people: list, unassigned: false };
  }
  return { role, via: "", people: [], unassigned: true };
}

/* ======================= what's missing ======================= */

/* Every blank the rules ask for, on every Universe project in scope.
   data = { universe, andon?, collections?, variables? } (records as read); andon is
   missing when it couldn't be read (then the ANDON rules aren't checked and `notes`
   says so). fields = { table: [field defs] } when known: a rule naming a column the
   table doesn't have is skipped (and listed in `notes`). tags = the custom tags (a row
   marked with one of cfg.skipTags is left out). forCollection = the Collections
   Status of an invoiced row (only those rows are asked for invoice details).
   read = { table: [column names] } for tables read by name only (null = every column):
   a rule on a column that wasn't read is skipped too, since it would look blank.
   Returns { items, projects, notes, skipped: { outOfScope, tagged, noCode } }. */
export function accountabilityItems(data, cfg, { fields = {}, read = {}, tagField = "Tags", forCollection = "For Collection", invalid = [] } = {}) {
  const notes = [], items = [];
  const skipped = { outOfScope: 0, tagged: 0, noCode: 0 };
  const has = (table, name) => !fields[table] || fields[table].some(f => f.field_name === name);
  const andonOk = Array.isArray(data.andon), collOk = Array.isArray(data.collections);
  const rules = cfg.rules.filter(r => {
    if (!r.on) return false;
    if (r.table === "andon" && !andonOk) return false;
    if (r.table === "collections" && !collOk) return false;
    if (r.field !== ROW && !has(r.table, r.field)) {
      notes.push(`${TABLE_NAMES[r.table]} has no column “${r.field}”, so that rule is skipped.`);
      return false;
    }
    if (r.field !== ROW && Array.isArray(read[r.table]) && !read[r.table].includes(r.field)) {
      notes.push(`Sanctum doesn't read ${TABLE_NAMES[r.table]}'s “${r.field}” yet, so that rule is skipped (add it to the table's read list in js/ops.js).`);
      return false;
    }
    return true;
  });
  if (!andonOk && cfg.rules.some(r => r.on && r.table === "andon")) {
    notes.push("ANDON couldn't be read, so PM (LEAD), TRIBE and the other ANDON fields weren't checked.");
  }
  const byCode = (records) => {
    const m = new Map();
    for (const r of records || []) {
      const c = normCode(plain((r.fields || {})["Project Code"]));
      if (c) (m.get(c) || m.set(c, []).get(c)).push(r);
    }
    return m;
  };
  const andonBy = byCode(data.andon), collBy = byCode(data.collections);
  const projects = [];
  for (const u of data.universe || []) {
    const f = u.fields || {};
    if (!inScope(f, cfg)) { skipped.outOfScope++; continue; }
    if (cfg.skipTags.length && tagsOf(f[tagField]).some(t => cfg.skipTags.some(s => s.toLowerCase() === t.toLowerCase()))) { skipped.tagged++; continue; }
    const code = normCode(plain(f["Project Code"]));
    const stage = stageOf(f, cfg);
    const andonRows = code ? andonBy.get(code) || [] : [];
    const collRows = (code ? collBy.get(code) || [] : []).filter(r => !invalid.includes(clean((r.fields || {})["Status"])));
    const rows = { universe: u, andon: andonRows[0] || null };
    const project = {
      id: u.record_id, code, name: clean(f["Project"]), client: clean(f["Client"]), status: stage.status,
      stage, bd: people(f["BD"]), am: people(f["AM"]), pm: rows.andon ? people((rows.andon.fields || {})["PM (LEAD)"]) : [],
      andonId: rows.andon ? rows.andon.record_id : null, items: [],
    };
    if (!code) skipped.noCode++;
    for (const rule of rules) {
      if (!applies(rule, stage, cfg)) continue;
      const hit = blankFor(rule, { u, andonRows, collRows, code, forCollection });
      if (!hit) continue;
      const item = {
        key: `${u.record_id}|${rule.table}|${rule.field}`, ruleId: rule.id, projectId: u.record_id, code,
        project: project.name, client: project.client, status: stage.status, lost: stage.lost, stageIndex: stage.index,
        table: rule.table, field: rule.field, label: fieldLabel(rule), rowTable: hit.table, rowId: hit.rowId,
        responsible: resolve(rule.responsible, rows, cfg), accountable: resolve(rule.accountable, rows, cfg),
      };
      items.push(item);
      project.items.push(item);
    }
    if (project.items.length) projects.push(project);
  }
  return { items, projects, notes: [...new Set(notes)], skipped };
}

/* Is the rule's field blank for this project? → { table, rowId } of the row to open
   (to fill it), or null when it's filled. A field in ANDON or Collections when the
   project has no row there counts as filled: the "@row" rule asks for the row once,
   instead of every one of its columns asking. */
function blankFor(rule, { u, andonRows, collRows, code, forCollection }) {
  if (rule.table === "universe") {
    if (rule.field === ROW) return null;
    return isBlank((u.fields || {})[rule.field]) ? { table: "universe", rowId: u.record_id } : null;
  }
  if (!code) return rule.field === ROW ? { table: "universe", rowId: u.record_id } : null;
  if (rule.table === "andon") {
    if (rule.field === ROW) return andonRows.length ? null : { table: "universe", rowId: u.record_id };
    const row = andonRows.find(r => isBlank((r.fields || {})[rule.field]));
    return row ? { table: "andon", rowId: row.record_id } : null;
  }
  if (rule.field === ROW) return collRows.length ? null : { table: "universe", rowId: u.record_id };
  // Invoice details: only rows that have been invoiced (For Collection) are asked.
  const row = collRows.find(r => clean((r.fields || {})["Status"]) === forCollection && isBlank((r.fields || {})[rule.field]));
  return row ? { table: "collections", rowId: row.record_id } : null;
}

/* How a rule's field reads in a list: "PM (LEAD)", or "ANDON row" for "@row". */
export function fieldLabel(rule) {
  return rule.field === ROW ? `${TABLE_NAMES[rule.table]} row` : rule.field;
}

/* ======================= grouping ======================= */

/* The items by person: [{ id, name, telegram, responsible: [item], accountable: [item] }],
   most to fill first. Items nobody holds (no one in the role or its fallbacks) go to
   one { id: UNASSIGNED } group. */
export function byPerson(items, cfg) {
  const map = new Map();
  const get = (p) => {
    if (!map.has(p.id)) {
      const known = cfg.people[p.id];
      map.set(p.id, { id: p.id, name: p.name || (known && known.name) || p.id, email: p.email || "", telegram: known ? known.telegram : "", responsible: [], accountable: [] });
    }
    return map.get(p.id);
  };
  for (const it of items) {
    for (const [side, r] of [["responsible", it.responsible], ["accountable", it.accountable]]) {
      const list = r.unassigned ? [{ id: UNASSIGNED, name: "Nobody (unassigned)" }] : r.people;
      for (const p of list) if (!get(p)[side].includes(it)) get(p)[side].push(it);
    }
  }
  return [...map.values()].sort((a, b) => (a.id === UNASSIGNED) - (b.id === UNASSIGNED)
    || b.responsible.length - a.responsible.length || b.accountable.length - a.accountable.length || a.name.localeCompare(b.name));
}

/* Items grouped by project, in first-seen order: [{ code, project, status, items }]. */
export function byProject(items) {
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.projectId)) map.set(it.projectId, { id: it.projectId, code: it.code, project: it.project, status: it.status, items: [] });
    map.get(it.projectId).items.push(it);
  }
  return [...map.values()];
}

/* How many items each field has: [{ field: label, n }], most first. */
export function fieldCounts(items) {
  const m = new Map();
  for (const it of items) m.set(it.label, (m.get(it.label) || 0) + 1);
  return [...m.entries()].map(([field, n]) => ({ field, n })).sort((a, b) => b.n - a.n || a.field.localeCompare(b.field));
}

/* Does an item match a search: code, project, client, field, status or a person's name. */
export function itemMatches(it, query) {
  const q = clean(query).toLowerCase();
  if (!q) return true;
  const who = [...it.responsible.people, ...it.accountable.people].map(p => p.name).join(" ");
  return [it.code, it.project, it.client, it.label, it.status, who, it.responsible.role, it.accountable.role]
    .some(s => String(s || "").toLowerCase().includes(q));
}

/* ======================= the daily digest ======================= */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const DAY = 86400000;

/* When each open item was first seen: the previous run's state ({ firstSeen: {key: ms} })
   carried over for items still open, `now` for new ones. Closed items drop out. */
export function nextState(items, previous, now) {
  const before = (previous && previous.firstSeen) || {};
  const firstSeen = {};
  for (const it of items) firstSeen[it.key] = before[it.key] || now;
  return { firstSeen, at: now };
}

/* The digest as Telegram messages (HTML, each under Telegram's 4096 characters):
   a summary, then each person with what they're Responsible for (by project, new
   ones marked) and how many more they're Accountable for. No amounts or client
   names: only codes, project names, fields and stages.
   opts = { now, state: nextState(...), previous (the last run's state, or null),
            perPerson, pageUrl, notes, sinceLabel } */
export function digestMessages(items, cfg, { now = Date.now(), state, previous, perPerson = 8, pageUrl = "", notes = [], dateLabel = "" } = {}) {
  const seen = (state && state.firstSeen) || {};
  const before = (previous && previous.firstSeen) || null;
  const isNew = (it) => !!before && !before[it.key];
  const age = (it) => Math.floor((now - (seen[it.key] || now)) / DAY);
  const projects = new Set(items.map(it => it.projectId)).size;
  const fresh = items.filter(isNew).length;
  const link = (hash, text) => (pageUrl ? `<a href="${esc(pageUrl.replace(/\/?$/, "/") + hash)}">${esc(text)}</a>` : esc(text));
  const head = [
    `<b>Sanctum · accountability digest</b>${dateLabel ? ` · ${esc(dateLabel)}` : ""}`,
    items.length
      ? `${items.length} blank${items.length === 1 ? "" : "s"} on ${projects} project${projects === 1 ? "" : "s"} (from ${esc(cfg.since)} on)` +
        (before ? ` · ${fresh} new since the last digest` : "")
      : "Nothing is missing. Every project has its owners and fields filled. 🎉",
  ];
  if (items.length) {
    const oldest = Math.max(...items.map(age));
    if (oldest > 0) head.push(`Oldest open: ${oldest} day${oldest === 1 ? "" : "s"}`);
  }
  const blocks = [head.join("\n")];
  for (const p of byPerson(items, cfg)) {
    if (!p.responsible.length && !p.accountable.length) continue;
    const name = p.id === UNASSIGNED ? "<b>Nobody (unassigned)</b>" : `<b>${esc(p.name)}</b>${p.telegram ? ` @${esc(p.telegram)}` : ""}`;
    const lines = [`${name} · responsible for ${p.responsible.length}, accountable for ${p.accountable.length}`];
    const groups = byProject(p.responsible);
    for (const g of groups.slice(0, perPerson)) {
      const anyNew = g.items.some(isNew);
      lines.push(`• ${esc(g.code || "(no code)")} ${esc(g.project.slice(0, 48))} · ${esc(g.status || "no status")}: ` +
                 `${g.items.map(it => esc(it.label)).join(", ")}${anyNew ? " 🆕" : ""}`);
    }
    if (groups.length > perPerson) lines.push(`  …and ${groups.length - perPerson} more project${groups.length - perPerson === 1 ? "" : "s"}`);
    const onlyA = p.accountable.filter(it => !p.responsible.includes(it));
    if (onlyA.length) lines.push(`  Accountable for ${onlyA.length} more on others' lists`);
    blocks.push(lines.join("\n"));
  }
  const foot = [...notes.map(n => `⚠️ ${esc(n)}`), pageUrl ? link("#/accountability", "Open Sanctum") : ""].filter(Boolean);
  if (foot.length) blocks.push(foot.join("\n"));
  return pack(blocks, 3900);
}

/* Blocks joined with blank lines into as few messages as fit `max` characters each
   (a block longer than that is cut at a line). */
export function pack(blocks, max) {
  const out = [];
  let cur = "";
  for (const b of blocks.flatMap(b => (b.length > max ? splitLines(b, max) : [b]))) {
    if (cur && cur.length + 2 + b.length > max) { out.push(cur); cur = ""; }
    cur = cur ? `${cur}\n\n${b}` : b;
  }
  if (cur) out.push(cur);
  return out;
}
function splitLines(text, max) {
  const out = [];
  let cur = "";
  for (const line of text.split("\n")) {
    const l = line.slice(0, max);
    if (cur && cur.length + 1 + l.length > max) { out.push(cur); cur = ""; }
    cur = cur ? `${cur}\n${l}` : l;
  }
  if (cur) out.push(cur);
  return out;
}
