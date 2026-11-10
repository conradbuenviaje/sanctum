/* Every Lark read and write the page makes.

   Each function takes `call(method, url, body)`, which sends one Lark Open API
   request and resolves with its JSON body (or throws on a Lark error). The page
   passes one that goes through the CORS proxy with the signed-in user's token;
   the Node checks in tests/ pass one that calls Lark directly. Both therefore run
   exactly the same push logic. */

import {
  indexUniverse, indexCollections, verifyWritten, parAfterAdding, clean, fillPlan, invoiceChangedSince, editCheck,
  tagsWith, tagsWithout,
} from "./sync.js";
import { LARK } from "./config.js";
import { LarkError } from "./errors.js";

export const OPEN_API = LARK.api;
export const PAGE_SIZE = 500;   // Lark's max for records/search
const MAX_PAGES = 200;          // runaway guard: 100,000 records
const PAGE_DELAY_MS = 120;      // pause between pages to stay clear of rate limits
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ======================= tables ======================= */

/* "https://<tenant>.larksuite.com/base/<app>?table=<tbl>&view=<vew>" → {app, table, url} */
export function parseBaseLink(link) {
  const u = new URL(link);
  const app = (u.pathname.match(/\/base\/([A-Za-z0-9]+)/) || [])[1];
  const table = u.searchParams.get("table") || "";
  if (!app || !/^tbl[A-Za-z0-9]+$/.test(table)) throw new Error(`Not a Lark Base table link: ${link}`);
  return { app, table, url: link };
}

export const TABLE_TITLES = {
  universe: "Universe", collections: "Collections", brief: "Project Brief",
  par: "Project Approval", invoice: "Invoice Request", andon: "ANDON", variables: "Variables",
};

/* Lark field type ids. */
const T = { text: 1, number: 2, select: 3, multi: 4, date: 5, checkbox: 7, user: 11, url: 15, file: 17 };
/* Columns Lark fills itself (lookup, formula, link, stage, auto fields): never written. */
const COMPUTED = new Set([18, 19, 20, 21, 24, 1001, 1002, 1003, 1004, 1005]);
const TYPE_NAMES = { 1: "Text", 2: "Number", 3: "Single select", 4: "Multi select", 5: "Date",
                     7: "Checkbox", 11: "Person", 15: "URL", 17: "Attachment", 18: "Link",
                     19: "Lookup", 20: "Formula" };

/* Every field the page reads or writes, with its required type. Reads fetch these
   columns (plus, for the tables pushes write to, their lookups and formulas: see
   columnsToRead). `options` lists select values the page writes, which must exist. */
export function schemaSpec(rules) {
  // Custom tags only where rules.tags.tables says there's a Tags column.
  const tagsIn = (key) => (rules.tags.tables || []).includes(key);
  // Extra columns read when the table has them: the approval links (URL columns named
  // like rules.filesPage.approvalColumns) the Files page lists.
  const approvalLinks = (f) => f.type === T.url && f.field_name !== "Request No." && !!(rules.filesPage && rules.filesPage.approvalColumns
    && rules.filesPage.approvalColumns.test(f.field_name));
  return {
    universe: {
      // Everything the cards and the Universe view need; `index` is the lean set
      // re-read just before a push to rule out duplicates.
      read: ["Project Code", "Project", "Client", "PAR", "Amount (VAT-Ex.) (PHP)", "BD", "AM",
             "RFP Received Date", "Status", "Year", "Amount (VAT-Inc.)", "Business Unit", rules.universeIgnoreField,
             // …and what the audit compares with the brief
             "MKT", "VAT%", "Project Description", "Project Start", "Project End",
             // …and the PM, which must match ANDON's PM (LEAD) (the PM audit)
             rules.pmSync.universe,
             // …and the CE link, which must match ANDON's (the CE audit)
             rules.ceSync.universe,
             // …and the rest a push writes, so the push sheet can show the whole row
             "Mancom Phase", "Other Links",
             // …and what the team notes on a project, shown in the push sheet's row (read only)
             "Quick Remarks",
             // …and what a won (or lost) project must have (the audit asks for these)
             ...rules.auditRequired.fields, ...rules.auditLost.fields, rules.auditFiles.field,
             // …and the brief's files, uploaded by hand
             rules.briefFiles.to,
             // …and the custom tags an audit card is marked with
             ...(tagsIn("universe") ? [rules.tags.field] : [])],
      index: ["Project Code", "Project", "Client", "PAR"],
      fields: {
        "Client": T.text, "Project": T.text, "Project Code": T.text, "PAR": T.text,
        "AM": T.user, "BD": T.user, "MKT": T.user,
        "Amount (VAT-Ex.) (PHP)": T.number, "VAT%": T.select,
        "Project Description": T.text, "Project Start": T.date, "Project End": T.date,
        "RFP Received Date": T.date, "Year": T.text, "Status": T.select,
        "Mancom Phase": T.select, "Other Links": T.text,
      },
      // Hides a won project from the Invoices list, if the Universe has this column.
      // The signed CE: an attachment the audit uploads to (its type is checked if it's there).
      // Custom tags (plain text, comma-separated): "Mark as …" on an audit card writes here.
      optional: { [rules.universeIgnoreField]: T.checkbox, [rules.auditFiles.field]: T.file, [rules.briefFiles.to]: T.file,
                  ...(tagsIn("universe") ? { [rules.tags.field]: T.text } : {}) },
      options: {
        "VAT%": ["12%", "0%"],
        "Status": [rules.newProjectStatus],
        "Mancom Phase": [rules.newProjectMancomPhase],
      },
      // Read-only columns (formulas, lookups) that only the Invoices list needs:
      // if one is missing, only invoice pushes stop.
      neededBy: { invoice: ["Amount (VAT-Inc.)", "Business Unit"],
                  // the audit can't ask for a column the Universe doesn't have
                  "audit:universe": [...rules.auditRequired.fields, ...rules.auditLost.fields, rules.auditFiles.field],
                  // the brief's files are uploaded into this one
                  files: [rules.briefFiles.to],
                  // the CE audit's Fill writes the link here (and in ANDON)
                  ce: [rules.ceSync.universe],
                  // without a Tags column, only "Mark as …" stops (Hide on this device still works)
                  ...(tagsIn("universe") ? { "tag:universe": [rules.tags.field] } : {}) },
    },
    collections: {
      read: ["Project Code", "Invoice Request", "AR Name", "Invoice Amount", "Currency", "Sales Remarks", "Status",
             "AM", "Invoice Number", "SI Number", "Invoice", "Invoice Date", "Collection Date"],
      index: ["Project Code", "Invoice Request", "AR Name", "Invoice Amount", "Currency", "Status"],
      fields: {
        "AR Name": T.text, "Project Code": T.text, "Invoice Amount": T.number,
        "Currency": T.select, "Status": T.select, "Business Unit": T.select, "Invoice Request": T.number,
        "Sales Remarks": T.text, "Invoice Number": T.text, "SI Number": T.text, "Invoice": T.file, "Invoice Date": T.date,
        "Collection Date": T.date,   // asked for when an approved request moves its row to For Collection
      },
      options: {
        "Status": [...Object.values(rules.collectionStages), ...rules.invalidStatuses],
      },
    },
    brief: {
      fields: {
        "Request No.": T.url, "Project Code": T.text, "Project Name": T.text, "Remarks": T.text,
        "Status": T.select, "Submitted at": T.date, "Initiator department": T.text,
        "Contract Value": T.number, "Contract Value-Currency": T.select,
        "Attachment (Project Brief, Pitch Deck)": T.url,
        "AM": T.user, "BD": T.user, "Start date": T.date, "End date": T.date,   // (no MKT since Oct 2026)
        "IGNORE": T.checkbox,
        "Business Unit": T.select,
      },
      optional: { "Required Tools": T.multi },
      readAlso: approvalLinks,   // the Files page's approval links
    },
    andon: {
      // What a person types into an ANDON row. ANDON fills the rest (Brief, Brief Status,
      // amounts, YEAR, MONTH…) itself from the Project Code and dates.
      read: "*",   // every column: the audit compares the row with its brief
      index: ["Project Code", "Project"],
      fields: {
        "Project": T.text, "Project Code": T.text, "AM": T.user, "PM (LEAD)": T.user, "MKT (PITCH)": T.user,
        "Business Unit": T.select, "Tools": T.multi, "TRIBE": T.select, "Event Start": T.date, "Event End": T.date,
      },
      // Custom tags, only if rules.tags.tables lists ANDON (it doesn't: no Tags column there).
      ...(tagsIn("andon") ? { optional: { [rules.tags.field]: T.text } } : {}),
      // The CE audit's Fill writes the link here (and in the Universe).
      neededBy: { ce: [rules.ceSync.andon], ...(tagsIn("andon") ? { "tag:andon": [rules.tags.field] } : {}) },
    },
    variables: {
      // Settings the team keeps in Lark, one row per value (RULES.tags). Every column is
      // read; which two hold the name and the value is worked out from them (customTagsFrom).
      read: "*",
      optionalTable: true,   // if it can't be read, only the custom tags are off
      fields: {},
    },
    par: {
      fields: {
        "Request No.": T.url, "Project Code": T.text, "Project Name": T.text, "Status": T.select,
        "Submitted at": T.date, "Associated Project Brief": T.text, "IGNORE": T.checkbox,
      },
      readAlso: approvalLinks,
    },
    invoice: {
      fields: {
        "Request No.": T.url, "Status": T.select, "Submitted at": T.date, "Initiator department": T.text,
        "Business Unit": T.select, "Project Name": T.text, "Project Code": T.text,
        "Amount": T.number, "Amount-Currency": T.select, "IGNORE": T.checkbox,
      },
      // Used when present: the PAR a request belongs to (to find its project when
      // the typed code is wrong) and when it was approved (to match older rows).
      optional: { "Associated Project Approval": T.text, "Completed at": T.date },
      readAlso: approvalLinks,
    },
  };
}

/* Lookups, formulas and links: read-only, but part of the row a person compares
   against in the push sheet (js/rowdoc.js), so a destination table reads them too. */
const SHOWN_COMPUTED = new Set([18, 19, 20, 21]);
const MAX_FIELD_NAMES = 50;   // Lark's limit on a records/search field list
const MAX_FIELD_NAME_LEN = 50;   // …and on each name in it (PAR's attachment column is longer)

/* The columns to read for a table, from its live field list: the spec's (only
   those the table has: Lark refuses a list naming a missing one) and, for the
   tables pushes write to, every lookup and formula. Past Lark's 50-name limit, or
   for read "*", or with a name over 50 characters (Lark refuses those in the list):
   undefined, meaning every column. */
export function columnsToRead(key, fields, rules) {
  const t = schemaSpec(rules)[key];
  if (!t || t.read === "*") return undefined;
  const present = new Set(fields.map(f => f.field_name));
  const base = t.read || [...Object.keys(t.fields), ...Object.keys(t.optional || {})];
  const computed = t.read ? fields.filter(f => SHOWN_COMPUTED.has(f.type)).map(f => f.field_name) : [];
  const also = t.readAlso ? fields.filter(t.readAlso).map(f => f.field_name) : [];
  const names = [...new Set([...base, ...computed, ...also])].filter(n => present.has(n));
  return names.length > MAX_FIELD_NAMES || names.some(n => n.length > MAX_FIELD_NAME_LEN) ? undefined : names;
}

const tableUrl = (t) => `${OPEN_API}/bitable/v1/apps/${encodeURIComponent(t.app)}/tables/${encodeURIComponent(t.table)}`;

/* ======================= reads ======================= */

export async function loadFields(call, t) {
  const out = [];
  let pageToken = "";
  for (let i = 0; i < MAX_PAGES; i++) {
    const j = await call("GET", `${tableUrl(t)}/fields?page_size=100` +
                                (pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""));
    const d = j.data || {};
    out.push(...(d.items || []));
    if (!d.has_more || !d.page_token) return out;
    pageToken = d.page_token;
  }
  return out;
}

/* All records of a table (never through a view: views filter rows, and a
   missing Universe row would look like a project that still needs pushing). */
export async function loadRecords(call, t, fieldNames, onPage) {
  const items = [];
  let pageToken = "";
  for (let pages = 1; pages <= MAX_PAGES; pages++) {
    const j = await call("POST", `${tableUrl(t)}/records/search?page_size=${PAGE_SIZE}` +
                                 (pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""),
                         { field_names: fieldNames, automatic_fields: false });
    const d = j.data || {};
    items.push(...(d.items || []));
    if (onPage) onPage(items.length, typeof d.total === "number" ? d.total : null);
    if (!d.has_more) return items;
    if (!d.page_token) throw new Error("Lark said there are more records but gave no page token.");
    pageToken = d.page_token;
    await sleep(PAGE_DELAY_MS);
  }
  throw new Error(`Stopped after ${MAX_PAGES} pages; the table is larger than this page supports.`);
}

/* Check one table's fields against the spec. Returns a list of problems (strings). */
export function checkSchema(key, fields, spec) {
  const title = TABLE_TITLES[key];
  const byName = new Map(fields.map(f => [f.field_name, f]));
  const problems = [];
  for (const [name, type] of Object.entries(spec.fields)) {
    const f = byName.get(name);
    if (!f) { problems.push(`${title}: column “${name}” is missing.`); continue; }
    if (f.type !== type) {
      problems.push(`${title}: column “${name}” is ${TYPE_NAMES[f.type] || "type " + f.type}, expected ${TYPE_NAMES[type]}.`);
    }
  }
  for (const [name, type] of Object.entries(spec.optional || {})) {
    const f = byName.get(name);
    if (f && f.type !== type) {
      problems.push(`${title}: column “${name}” is ${TYPE_NAMES[f.type] || "type " + f.type}, expected ${TYPE_NAMES[type]}.`);
    }
  }
  for (const [name, wanted] of Object.entries(spec.options || {})) {
    const have = selectOptions(byName.get(name));
    for (const w of wanted) {
      if (byName.has(name) && !have.includes(w)) problems.push(`${title}: “${name}” has no option “${w}”.`);
    }
  }
  return problems;
}

/* Problems with columns only one kind of push needs (spec.neededBy), by kind. */
export function checkNeeded(key, fields, spec) {
  const names = new Set(fields.map(f => f.field_name));
  const out = {};
  for (const [kind, list] of Object.entries(spec.neededBy || {})) {
    out[kind] = list.filter(n => !names.has(n)).map(n => `${TABLE_TITLES[key]}: column “${n}” is missing.`);
  }
  return out;
}

export const computedTypes = COMPUTED;
export const selectOptions = (field) => ((field && field.property && field.property.options) || []).map(o => o.name);

/* Load the schema and every record the page needs, all tables in parallel.
   Returns { fields: {key: [field]}, problems: [string], data: {key: [record]} }. */
export async function loadEverything(call, tables, rules, onProgress) {
  const spec = schemaSpec(rules);
  const keys = Object.keys(spec);
  const fields = {}, data = {}, columns = {}, tableProblems = {}, kindProblems = {};
  await Promise.all(keys.filter(k => tables[k]).map(async (k) => {
    try {
      fields[k] = await loadFields(call, tables[k]);
      tableProblems[k] = checkSchema(k, fields[k], spec[k]);
      for (const [kind, list] of Object.entries(checkNeeded(k, fields[k], spec[k]))) {
        kindProblems[kind] = [...(kindProblems[kind] || []), ...list];
      }
      const want = columnsToRead(k, fields[k], rules);
      columns[k] = want || null;      // null: every column
      data[k] = await loadRecords(call, tables[k], want, (n, total) => onProgress && onProgress(k, n, total));
    } catch (e) {
      // A table only some features use (spec.optionalTable: the Variables) can't stop
      // the page: its features are off, and Settings says why. A dead login still ends it.
      if (!spec[k].optionalTable || (e && e.deadToken)) throw e;
      fields[k] = []; data[k] = null;
      tableProblems[k] = [`${TABLE_TITLES[k]}: couldn't be read (${(e && e.message) || "error"}).`];
    }
  }));
  for (const k of Object.keys(data)) if (data[k] === null) delete data[k];
  // `problems`: every table; `tableProblems`: by table, so a broken ANDON only stops ANDON
  // pushes; `kindProblems`: columns only one kind of push needs.
  return { fields, problems: [...Object.values(tableProblems).flat(), ...Object.values(kindProblems).flat()],
           tableProblems, kindProblems, data, columns };
}

/* ======================= writes ======================= */

/* A push the destination already has, or a row that changed since the list was
   loaded (someone else got there first). Nothing was written. */
export class AlreadyDone extends Error {
  constructor(message, detail) { super(message); this.name = "AlreadyDone"; this.detail = detail || ""; }
}

export function newClientToken() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* client_token makes the create idempotent: retrying after a lost response
   with the same token returns the first record instead of adding another. */
export async function createRecord(call, t, fields, clientToken) {
  const j = await call("POST", `${tableUrl(t)}/records` +
                               (clientToken ? `?client_token=${encodeURIComponent(clientToken)}` : ""),
                       { fields });
  const rec = j.data && j.data.record;
  // Lark said yes but sent no record: the row is probably there, so this is an unknown outcome.
  if (!rec || !rec.record_id) throw new LarkError("Lark didn't return the new record.", { uncertain: true });
  return rec;
}

/* batch_get, not GET …/records/{id}: the single-record GET returns a display
   format (numbers as strings, text unsegmented) that doesn't match what search
   returns or what was written. batch_get returns the same format as search. */
export async function findRecord(call, t, recordId) {
  const j = await call("POST", `${tableUrl(t)}/records/batch_get`, { record_ids: [recordId] });
  return ((j.data && j.data.records) || []).find(r => r.record_id === recordId) || null;
}
export async function getRecord(call, t, recordId) {
  const rec = await findRecord(call, t, recordId);
  if (!rec) throw new Error(`Couldn't read back record ${recordId}.`);
  return rec;
}

/* batch_update is a POST, so every write uses the proxy's POST route. */
export async function updateRecord(call, t, recordId, fields) {
  await call("POST", `${tableUrl(t)}/records/batch_update`, { records: [{ record_id: recordId, fields }] });
}

const universeIndex = async (call, tables, rules) =>
  indexUniverse(await loadRecords(call, tables.universe, schemaSpec(rules).universe.index));

/* The Universe again, fresh from Lark, with every column the page shows. */
export async function loadUniverse(call, tables, rules) {
  return loadRecords(call, tables.universe, columnsToRead("universe", await loadFields(call, tables.universe), rules));
}

/* After a write has succeeded: read the record back and compare. A failed read
   doesn't undo the write, so it's reported as `readBackError`, not thrown. */
async function readBack(call, t, recordId, written) {
  try {
    const back = await getRecord(call, t, recordId);
    return { mismatches: verifyWritten(written, back.fields), readBackError: null };
  } catch (e) {
    return { mismatches: null, readBackError: e };
  }
}

/* Brief → new Universe row. Re-reads the Universe first so a project someone
   else just added is never added twice; then creates, reads back and compares. */
export async function pushBrief(call, tables, rules, card, fields, clientToken) {
  const uni = await universeIndex(call, tables, rules);
  if (uni.byCode.has(card.code)) throw new AlreadyDone(`${card.code} is already in the Universe.`);
  const rec = await createRecord(call, tables.universe, fields, clientToken);
  return { recordId: rec.record_id, written: fields,
           ...await readBack(call, tables.universe, rec.record_id, fields) };
}

/* PAR → the PAR cell of an existing Universe row (appended if it already has one). */
export async function pushPar(call, tables, rules, card, targetId) {
  const uni = await universeIndex(call, tables, rules);
  if (uni.parNos.has(card.requestNo)) throw new AlreadyDone(`PAR ${card.requestNo} is already in the Universe.`);
  const row = uni.rows.find(r => r.id === targetId);
  if (!row) throw new Error("That Universe row no longer exists. Refresh and try again.");
  const next = parAfterAdding(row.par, card.requestNo);
  if (next === null) throw new AlreadyDone(`PAR ${card.requestNo} is already on that row.`);
  const written = { PAR: next };
  await updateRecord(call, tables.universe, targetId, written);
  return { recordId: targetId, before: clean(row.par), written,
           ...await readBack(call, tables.universe, targetId, written) };
}

/* Only the columns a person can type into (lookups, formulas and the like are
   filled by Lark), and only columns the table has. */
export function writableOnly(payload, fields) {
  const byName = new Map(fields.map(f => [f.field_name, f]));
  return Object.fromEntries(Object.entries(payload).filter(([k]) => byName.has(k) && !COMPUTED.has(byName.get(k).type)));
}

/* Brief → new ANDON row, with the same re-check, idempotent create and read-back as the Universe. */
export async function pushAndon(call, tables, rules, card, fields, clientToken) {
  const andon = indexUniverse(await loadRecords(call, tables.andon, schemaSpec(rules).andon.index));
  if (andon.byCode.has(card.code)) throw new AlreadyDone(`${card.code} is already in ANDON.`);
  const rec = await createRecord(call, tables.andon, fields, clientToken);
  return { recordId: rec.record_id, written: fields, ...await readBack(call, tables.andon, rec.record_id, fields) };
}

/* One Collections change (built by collectionsChange in sync.js, plus any invoice
   details): a new row, or an update to the row the card was built from.

   Collections is re-read first, and nothing is written if the change no longer
   applies: the request is already on a row (for a new row or another row), the
   won project already has a row, or the target row's Status or request number
   changed since the list was loaded. Then it writes, reads back and compares. */
export async function pushCollections(call, tables, rules, card, change, clientToken) {
  const coll = indexCollections(await loadRecords(call, tables.collections, schemaSpec(rules).collections.index));
  const n = card.requestNo;
  const carrying = n ? coll.byIr.get(n) || [] : [];
  if (change.mode === "create") {
    if (carrying.length) throw new AlreadyDone(`Request ${n} is already in Collections.`);
    if (card.step === "won" && coll.byCode.has(card.code)) throw new AlreadyDone(`${card.code} is already in Collections.`);
    const rec = await createRecord(call, tables.collections, change.fields, clientToken);
    return { mode: "create", recordId: rec.record_id, written: change.fields, before: {},
             ...await readBack(call, tables.collections, rec.record_id, change.fields) };
  }
  const row = coll.rows.find(r => r.id === change.rowId);
  if (!row) throw new Error("That Collections row no longer exists. Refresh and try again.");
  if (row.status !== change.expect.status || row.ir !== change.expect.ir) {
    throw new AlreadyDone(`“${row.arName || "That row"}” changed since the list was loaded.`,
      `It now says ${row.status || "no status"}${row.ir ? `, request ${row.ir}` : ", no request"}. Nothing was written; the list has been refreshed.`);
  }
  // A request goes on one row: stop if another row picked it up meanwhile.
  if (change.fields["Invoice Request"] && carrying.some(r => r.id !== row.id)) {
    throw new AlreadyDone(`Request ${n} is already on another Collections row.`);
  }
  if (!Object.keys(change.fields).length) throw new AlreadyDone(`“${row.arName}” already says this.`);
  await updateRecord(call, tables.collections, row.id, change.fields);
  return { mode: "update", recordId: row.id, written: change.fields, before: change.before,
           ...await readBack(call, tables.collections, row.id, change.fields) };
}

/* The Collections table again, fresh from Lark. */
export async function loadCollections(call, tables, rules) {
  return loadRecords(call, tables.collections, columnsToRead("collections", await loadFields(call, tables.collections), rules));
}

/* Invoice details typed in by finance (Invoice Number, SI Number, Invoice Date, the
   invoice file): `row` is the Collections row as the list showed it (collectionRow).
   The row is re-read first, and nothing is written if a cell being changed was changed
   in Lark meanwhile. Then it writes only what changed and reads it back. */
export async function saveInvoiceDetails(call, tables, row, patch) {
  const now = await findRecord(call, tables.collections, row.id);
  if (!now) throw new Error("That Collections row no longer exists. Refresh and try again.");
  const stale = invoiceChangedSince(patch, row, now);
  if (stale.length) {
    throw new AlreadyDone(`“${row.arName || "That row"}” changed since the list was loaded.`,
      `${stale.join(", ")} changed in Lark. Nothing was written; the list has been refreshed.`);
  }
  await updateRecord(call, tables.collections, row.id, patch);
  return { recordId: row.id, written: patch, ...await readBack(call, tables.collections, row.id, patch) };
}

/* Fill blank cells of a Universe or ANDON row (the audit). The row is re-read
   first: a cell someone filled meanwhile is left alone (`skipped`; VAT% counts too,
   see fillPlan), and if nothing is still blank nothing is written. Then it writes,
   reads back and compares. `overwrite` = cells that may be changed though not blank,
   if they still say what the card showed ({Status: "Lost"}; see fillPlan). */
export async function fillGaps(call, t, recordId, patch, overwrite = {}) {
  const now = await findRecord(call, t, recordId);
  if (!now) throw new Error("That row no longer exists. Refresh and try again.");
  const { written, skipped } = fillPlan(patch, now.fields, overwrite);
  if (!Object.keys(written).length) {
    throw new AlreadyDone("Those cells aren't blank anymore.", "Someone filled them meanwhile. Nothing was written; the list has been refreshed.");
  }
  await updateRecord(call, t, recordId, written);
  return { recordId, written, skipped, ...await readBack(call, t, recordId, written) };
}

/* The row editor: write the cells a person changed (`write`, Lark's write format)
   to one row of any table. `loaded` is the row as it was when they opened it (read
   format) and `defs` the table's columns. The row is re-read first: if a cell being
   changed was changed in Lark meanwhile (to something else), nothing is written; if
   Lark already holds every value, nothing is written either. Then it writes and
   reads back. Resolves { recordId, written, record, mismatches, readBackError }. */
export class EditConflict extends Error {
  constructor(fields) {
    // (the queue puts "Nothing was written." in front)
    super(`${fields.join(", ")} changed in Lark since the row was opened. Edit it to see what Lark has now.`);
    this.name = "EditConflict";
    this.fields = fields;
    this.userMessage = this.message;
  }
}
export async function saveEdit(call, t, recordId, write, loaded, defs) {
  const now = await findRecord(call, t, recordId);
  if (!now) throw Object.assign(new Error("gone"), { userMessage: "That row no longer exists in Lark." });
  const { stale, done } = editCheck(write, defs, loaded, now.fields);
  if (stale.length) throw new EditConflict(stale);
  if (done) throw new AlreadyDone("Those changes are already in Lark.");
  await updateRecord(call, t, recordId, write);
  let record = null, mismatches = null, readBackError = null;
  try {
    record = await getRecord(call, t, recordId);
    mismatches = verifyWritten(write, record.fields);
  } catch (e) {
    readBackError = e;
  }
  return { recordId, written: write, record, mismatches, readBackError };
}

/* One PM for a project in the Universe and ANDON (the PM audit): `rows` =
   [{ table, rowId, loaded (its fields as the card saw them) }], `writes` = { table:
   { column: [{id}] } }. Every row is re-read FIRST: if any of the PM cells changed in
   Lark since the card was made, nothing is written anywhere (no half-done project).
   Rows that already have that PM are left alone; if all do, AlreadyDone. Then each
   remaining row is written and read back.
   Resolves { recordId (the first row), written (the first row's write), results:
   [{ table, recordId, written, mismatches, readBackError }], mismatches, readBackError }. */
export async function syncPm(call, tables, rows, writes, defsOf, doneMessage = "Both already have that PM.") {
  const todo = [];
  for (const r of rows) {
    const now = await findRecord(call, tables[r.table], r.rowId);
    if (!now) throw Object.assign(new Error("gone"), { userMessage: `A ${TABLE_TITLES[r.table]} row of this project isn't in Lark any more. Refresh, then try again.` });
    const { stale, done } = editCheck(writes[r.table], defsOf(r.table), r.loaded, now.fields);
    if (stale.length) throw new EditConflict(stale.map(k => `${TABLE_TITLES[r.table]}'s ${k}`));
    if (!done) todo.push(r);
  }
  if (!todo.length) throw new AlreadyDone(doneMessage);
  const results = [];
  for (const r of todo) {
    const t = tables[r.table], written = writes[r.table];
    await updateRecord(call, t, r.rowId, written);
    results.push({ table: r.table, recordId: r.rowId, written, ...await readBack(call, t, r.rowId, written) });
  }
  const first = results[0];
  return { recordId: first.recordId, written: first.written, results,
           mismatches: results.flatMap(x => (x.mismatches || []).map(m => ({ ...m, field: `${TABLE_TITLES[x.table]}'s ${m.field}` }))),
           readBackError: (results.find(x => x.readBackError) || {}).readBackError || null };
}

/* Mark a row with a custom tag (add = true) or take it off. The Tags cell is plain
   text, so the row is re-read first and the tag added to (or taken out of) what's
   there NOW: tags someone else added meanwhile stay. If the cell already says so,
   nothing is written. Then it writes and reads back.
   Resolves { recordId, written, unchanged, mismatches, readBackError }. */
export async function setTag(call, t, recordId, field, tag, add) {
  const now = await findRecord(call, t, recordId);
  if (!now) throw Object.assign(new Error("gone"), { userMessage: "That row isn't in Lark any more." });
  const before = (now.fields || {})[field];
  const after = add ? tagsWith(before, tag) : tagsWithout(before, tag);
  if ((after || "") === clean(before)) return { recordId, written: { [field]: after }, unchanged: true, mismatches: [], readBackError: null };
  const written = { [field]: after };
  await updateRecord(call, t, recordId, written);
  return { recordId, written, unchanged: false, ...await readBack(call, t, recordId, written) };
}

/* Settings > Custom tags: add a value to the Variables table (one new row), or delete
   that row. `cols` = which columns hold the name and the value (variableColumns). */
export async function addVariable(call, t, cols, name, value) {
  return createRecord(call, t, { [cols.name]: name, [cols.value]: value }, newClientToken());
}
export async function deleteVariable(call, t, recordId) {
  await call("POST", `${tableUrl(t)}/records/batch_delete`, { records: [recordId] });
}

/* Tick (or untick) a source row's IGNORE box, then confirm it stuck. */
export async function setIgnore(call, t, recordId, value, field = "IGNORE") {
  const written = { [field]: value };
  await updateRecord(call, t, recordId, written);
  return { recordId, written, ...await readBack(call, t, recordId, written) };
}
