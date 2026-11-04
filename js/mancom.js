/* The weekly Mancom sheet (the "4DX Management Scoreboard", a new file each week) →
   proposed changes to the Universe and ANDON. Pure: no DOM, no network.

   The sheet has no project codes, so each row is matched to a Universe project by
   name (and client): a match an admin confirmed is remembered (`memory`), a clear best
   name match is suggested, anything else waits for a person to pick. People are in it
   by nickname ("@Shanna", "Bopeep 🌸"): the Admin page's Nicknames say who they are.

   Which tabs feed what (cfg = ACCOUNTABILITY.mancom):
     Revenue - <Tribe>      the project is in that tribe          → ANDON TRIBE
     RFP-RFQ Pitch Pipeline Phase, Owner (the AM)                 → Universe Mancom Phase, AM
     Leads - BD Pipeline    BD, AM                                → Universe BD, AM
     any of them            Client, when the Universe has none    → Universe Client */

import { plain, clean, people, normCode, similarity, matchOption } from "./sync.js";
import { isBlankFor } from "./accountability.js";
import { ACCOUNTABILITY } from "./config.js";

/* "W45 - 4DX Management Scoreboard.xlsx" → "W45" ("" if the name has no week). */
export function weekOf(fileName) {
  const m = String(fileName || "").match(/\bW(?:eek)?\s*0?(\d{1,2})\b/i);
  return m ? `W${Number(m[1])}` : "";
}

/* A nickname as the sheet writes it ("@Bopeep 🌸", " Marcus Joaquin") → "bopeep", "marcus joaquin". */
export function nickKey(v) {
  return String(v || "").normalize("NFKD").replace(/^[\s@]+/, "").replace(/[^\p{L}\p{N}\s.'-]/gu, " ")
    .replace(/\s+/g, " ").trim().toLowerCase();
}
const nameKey = (v) => String(v || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/* What a sheet project is remembered by: its name, loosely (the same project is in several
   tabs, with the client spelled differently in each, so the client isn't part of it). */
export const matchKey = (project) => nameKey(project);

/* ======================= reading the tabs ======================= */

/* The tab's kind and, for a Revenue tab, its tribe ("Revenue - Moonton" → "Moonton"). */
export function tabKind(name, cfg) {
  for (const t of cfg.tabs) {
    const m = new RegExp(t.match, "i").exec(name);
    if (m) return { kind: t.kind, tribe: t.kind === "revenue" ? clean(m[1]) : "", spec: t };
  }
  return null;
}

/* Every project row of the workbook (readWorkbook in js/xlsx.js):
   [{ tab, row (1-based, as the sheet shows it), kind, project, client, values: { tribe, phase, am, bd } }].
   A tab can have several tables (Revenue has the live updates, then the locked board
   report): each header row (one with the tab's project column) starts one. Totals,
   section titles and rows without a project are left out. */
export function sheetEntries(sheets, cfg) {
  const out = [];
  for (const s of sheets) {
    const k = tabKind(s.name, cfg);
    if (!k) continue;
    let cols = null;
    s.rows.forEach((cells, i) => {
      const lower = cells.map(c => clean(c).toLowerCase());
      const pIdx = lower.indexOf(k.spec.project.toLowerCase());
      if (pIdx >= 0) { cols = Object.fromEntries(lower.map((h, j) => [h, j]).filter(([h]) => h)); return; }
      if (!cols) return;
      const get = (header) => { const j = cols[String(header || "").toLowerCase()]; return j === undefined ? "" : clean(cells[j]); };
      const project = get(k.spec.project);
      if (!project || /^total\b/i.test(project)) return;
      const values = {};
      if (k.tribe) values.tribe = k.tribe;
      for (const [key, header] of Object.entries(k.spec.columns || {})) {
        const v = get(header);
        if (v) values[key] = v;
      }
      out.push({ tab: s.name, row: i + 1, kind: k.kind, project, client: get("Client"), values });
    });
  }
  return out;
}

/* ======================= who and which project ======================= */

/* A nickname → a person: the Nicknames saved on the Admin page (`aliases`, key → person),
   else the one person in `pool` whose first name, or whole name, it is. Unknown → null. */
export function resolveNick(nick, aliases, pool) {
  const k = nickKey(nick);
  if (!k) return null;
  if (aliases[k]) return { person: aliases[k], how: "nickname" };
  const words = k.split(" ");
  const hits = (pool || []).filter(p => {
    const n = nameKey(p.name).split(" ");
    return words.length === 1 ? n[0] === words[0] : words.every(w => n.includes(w));
  });
  return hits.length === 1 ? { person: hits[0], how: "guess" } : null;
}

/* The Universe project a sheet row is about: the one remembered for it (`memory`: matchKey →
   { rowId }), else the best name match if it's clearly best (score ≥ cfg.autoMatch and
   ahead of the next by cfg.margin). { rowId, how: "remembered" | "suggested" | "", candidates }. */
export function matchProject(entry, universe, memory, cfg) {
  const remembered = memory.get(matchKey(entry.project));
  if (remembered && universe.some(u => u.record_id === remembered.rowId)) {
    return { rowId: remembered.rowId, how: "remembered", candidates: [] };
  }
  const scored = universe.map(u => {
    const f = u.fields || {};
    const score = similarity(entry.project, clean(f["Project"])) + (entry.client && similarity(entry.client, clean(f["Client"])) >= 0.5 ? 0.1 : 0);
    return { rowId: u.record_id, code: normCode(plain(f["Project Code"])), project: clean(f["Project"]), client: clean(f["Client"]), score };
  }).filter(c => c.score > 0).sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  const clear = best && best.score >= cfg.autoMatch && (!next || best.score - next.score >= cfg.margin);
  return { rowId: clear ? best.rowId : null, how: clear ? "suggested" : "", candidates: scored.slice(0, 6) };
}

/* ======================= what would change ======================= */

/* Every change the sheet asks for, against what Lark has now.
   ctx = { universe, andon, fields: {universe, andon}, aliases, pool, memory, picks }
   picks = matchKey(project) → a Universe row id the person chose, or "" to skip it (one pick
   covers every row of the sheet with that project name).
   Returns { changes, entries (each with .match), unknown: [nickname], notes }.
   A change: { id, table, recordId, field, projectId, code, project, from, to, write,
               kind: "fill" | "change", conflict, sources: [{ tab, row, value }] }. */
export function mancomChanges(entries, ctx, cfg) {
  const optionsOf = (table, field) => (((ctx.fields[table] || []).find(f => f.field_name === field) || {}).property || {}).options?.map(o => o.name) || [];
  const andonByCode = new Map();
  for (const r of ctx.andon || []) {
    const c = normCode(plain((r.fields || {})["Project Code"]));
    if (c && !andonByCode.has(c)) andonByCode.set(c, r);
  }
  const byId = new Map((ctx.universe || []).map(u => [u.record_id, u]));
  const changes = new Map(), unknown = new Set(), notes = new Set();
  const add = (c, source) => {
    const cur = changes.get(c.id);
    if (!cur) { changes.set(c.id, { ...c, conflict: false, sources: [source] }); return; }
    cur.sources.push(source);
    if (cur.toKey !== c.toKey) cur.conflict = true;   // two rows of the sheet disagree: a person decides
  };
  for (const e of entries) {
    const key = matchKey(e.project);
    const pick = ctx.picks && Object.prototype.hasOwnProperty.call(ctx.picks, key) ? ctx.picks[key] : undefined;
    e.key = key;
    e.match = pick !== undefined ? { rowId: pick || null, how: pick ? "picked" : "skipped", candidates: [] }
      : matchProject(e, ctx.universe || [], ctx.memory, cfg);
    const u = e.match.rowId && byId.get(e.match.rowId);
    if (!u) continue;
    const f = u.fields || {};
    const code = normCode(plain(f["Project Code"])), project = clean(f["Project"]);
    const base = { projectId: u.record_id, code, project };
    const source = (value) => ({ tab: e.tab, row: e.row, value });
    // Tribe (ANDON) from the Revenue tab's name.
    if (e.values.tribe) {
      const opt = optionsOf("andon", "TRIBE").find(o => o.toLowerCase().includes(e.values.tribe.toLowerCase()));
      const a = code && andonByCode.get(code);
      if (!opt) notes.add(`No ANDON tribe matches the “${e.tab}” tab.`);
      else if (!a) notes.add(`${code || project} has no ANDON row, so its tribe from “${e.tab}” wasn't set.`);
      else {
        const now = clean((a.fields || {})["TRIBE"]);
        if (now !== opt) add({ ...base, id: `andon:${a.record_id}:TRIBE`, table: "andon", recordId: a.record_id, field: "TRIBE",
          from: now, to: opt, toKey: opt, write: opt, kind: isBlankFor("TRIBE", now, ctx.cfgAcc || ACCOUNTABILITY) ? "fill" : "change" }, source(e.values.tribe));
      }
    }
    // Mancom Phase (Universe).
    if (e.values.phase) {
      const opt = matchOption(e.values.phase, optionsOf("universe", "Mancom Phase"));
      const now = clean(f["Mancom Phase"]);
      if (!opt) notes.add(`The Universe's Mancom Phase has no option “${e.values.phase}”.`);
      else if (now !== opt) add({ ...base, id: `universe:${u.record_id}:Mancom Phase`, table: "universe", recordId: u.record_id, field: "Mancom Phase",
        from: now, to: opt, toKey: opt, write: opt, kind: now ? "change" : "fill" }, source(e.values.phase));
    }
    // AM and BD (Universe people).
    for (const [key, field] of [["am", "AM"], ["bd", "BD"]]) {
      const nick = e.values[key];
      if (!nick) continue;
      const who = resolveNick(nick, ctx.aliases || {}, ctx.pool || []);
      if (!who) { unknown.add(nickKey(nick)); continue; }
      if (!/^ou_/.test(who.person.id || "")) { notes.add(`${who.person.name} has no Lark id yet (added by email), so they can't be put in ${field}.`); continue; }
      const now = people(f[field]);
      if (now.length === 1 && now[0].id === who.person.id) continue;
      add({ ...base, id: `universe:${u.record_id}:${field}`, table: "universe", recordId: u.record_id, field,
        from: now.map(p => p.name).join(", "), to: who.person.name, toKey: who.person.id, write: [{ id: who.person.id }],
        kind: now.length ? "change" : "fill", guessed: who.how === "guess" }, source(nick));
    }
    // Client: only where the Universe has none (the sheet's spelling varies).
    if (e.client && !clean(f["Client"])) {
      add({ ...base, id: `universe:${u.record_id}:Client`, table: "universe", recordId: u.record_id, field: "Client",
        from: "", to: e.client, toKey: e.client.toLowerCase(), write: e.client, kind: "fill" }, source(e.client));
    }
  }
  return { changes: [...changes.values()], entries, unknown: [...unknown].sort(), notes: [...notes] };
}

/* ======================= what's remembered and logged ======================= */

/* Variables rows named `name` with a JSON Value → [{ id, value }] (bad JSON skipped). */
export function jsonRows(records, cols, name) {
  if (!cols) return [];
  const out = [];
  for (const r of records || []) {
    const f = r.fields || {};
    if (clean(f[cols.name]).toLowerCase() !== name.toLowerCase()) continue;
    try { const value = JSON.parse(clean(f[cols.value])); if (value && typeof value === "object") out.push({ id: r.record_id, value }); } catch { /* skipped */ }
  }
  return out;
}

/* Confirmed matches: matchKey → { rowId, code, id (the Variables row) }. */
export function memoryFrom(records, cols, name) {
  const m = new Map();
  for (const { id, value } of jsonRows(records, cols, name)) if (value.key && value.rowId) m.set(value.key, { rowId: value.rowId, code: value.code || "", id });
  return m;
}

/* One line of the change log (a Variables row's Value). */
export function changeLogValue(change, { by, week, file, at = Date.now() }) {
  return JSON.stringify({ at, by, week, file, table: change.table, recordId: change.recordId, code: change.code, project: change.project,
    field: change.field, from: change.from, to: change.to, sources: change.sources.map(s => `${s.tab} row ${s.row}`) });
}
