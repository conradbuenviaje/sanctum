/* The transfer rules, as pure functions: no DOM, no network.

   The page (app.js) and the Node checks in tests/ both import this file, so
   what the tests verify is exactly what the page writes.

   Record shapes are Lark's: { record_id, fields: { "<field name>": <value> } },
   with values in Lark's read format (text as rich-text segments, people as
   objects, dates as ms timestamps). Builders return Lark's write format. */

/* ======================= reading cell values ======================= */

/* Reduce any Bitable cell value to plain text. */
export function plain(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    // Text fields arrive as rich-text segments ({type, text}); join those seamlessly.
    const segments = v.length > 0 && v.every(x => x && typeof x === "object"
                                              && typeof x.type === "string" && typeof x.text === "string");
    return v.map(plain).filter(s => s !== "").join(segments ? "" : ", ");
  }
  if (typeof v === "object") {
    if ("value" in v) return plain(v.value);                 // formula / lookup
    if (typeof v.text === "string") return v.text;            // text segment, URL field
    if (typeof v.name === "string") return v.name;            // person, attachment
    if (Array.isArray(v.text_arr)) return v.text_arr.join(", ");
  }
  return "";
}

/* Plain text with Windows line endings and outer whitespace removed. */
export const clean = (v) => plain(v).replace(/\r\n?/g, "\n").trim();

/* People fields → [{id, name, short, email}] (id is the open_id Lark expects on
   write; `short` is first + last name for tight spaces, e.g. "Carlos Coscolluela"
   for "Carlos Roberto Francisco, David, IV Coscolluela"). */
export function people(v) {
  return (Array.isArray(v) ? v : [])
    .filter(u => u && typeof u.id === "string" && u.id)
    .map(u => {
      const name = u.name || u.en_name || u.email || u.id;
      return { id: u.id, name, short: shortName(name), email: u.email || "" };
    });
}

const SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;
export function shortName(name) {
  const words = String(name || "").replace(/,/g, " ").split(/\s+/).filter(Boolean);
  while (words.length > 2 && SUFFIX.test(words[words.length - 1])) words.pop();
  return words.length > 2 ? `${words[0]} ${words[words.length - 1]}` : words.join(" ");
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/* A number from a number column or a formula ({type, value: [n]}). */
const numOf = (v) => num(v) ?? (v && typeof v === "object" && Array.isArray(v.value) ? num(v.value[0]) : null);

/* An approval's request number is the text of its "Request No." URL field. */
export const requestNo = (v) => clean(v);

/* Request numbers inside free text, e.g. a Universe PAR cell "202607030034, 202607080041". */
export const requestNos = (text) => String(text || "").match(/\d{12}/g) || [];

/* A request number starts with its filing date (202606030032 → 3 Jun 2026); as
   midnight in the given UTC offset, or null. */
export function requestDate(no, offsetHours) {
  const m = String(no || "").match(/^(\d{4})(\d{2})(\d{2})\d{4}$/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) - offsetHours * 3600000;
}

/* Project codes look like 2026TEG-P0286. Source tables are typed by hand, so
   codes arrive as "CE_2026TEG-P0091", "Project Code\n2024TEG-P0131" or with a
   trailing space; pull out the canonical form. */
const CODE_RE = /(\d{4}TEG-P\d{4,5})(?!\d)/gi;
export const allCodes = (text) => [...String(text || "").matchAll(CODE_RE)].map(m => m[1].toUpperCase());
export const normCode = (text) => allCodes(text)[0] || "";

/* ======================= small helpers ======================= */

export const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

const DAY_MS = 86400000;

/* Midnight of the same calendar day in the given UTC offset, as ms. Lark stores
   date-only fields this way (e.g. 2026-10-07 00:00 +08:00). */
export function dayStart(ms, offsetHours) {
  const off = offsetHours * 3600000;
  return Math.floor((ms + off) / DAY_MS) * DAY_MS - off;
}
export const yearIn = (ms, offsetHours) => new Date(ms + offsetHours * 3600000).getUTCFullYear();

/* A typed date → midnight of that day in the given UTC offset (Lark's date-only
   format). Accepts 2026-10-14, 2026/10/14, 10/14/2026 (month first, unless the
   first number can only be a day), Oct 14, 2026, 14 October 2026 and Oct 14
   (this year). Returns null for an empty text and NaN for one that isn't a date. */
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
export function parseDay(text, offsetHours, now = Date.now()) {
  const s = String(text || "").trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!s) return null;
  let y, m, d, x;
  if ((x = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) [y, m, d] = [+x[1], +x[2], +x[3]];
  else if ((x = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) {
    [m, d, y] = [+x[1], +x[2], +x[3]];
    if (m > 12 && d <= 12) [m, d] = [d, m];
  } else {
    // "oct", "octo", "october" (and "sept"), but not "octember"
    const word = (w) => (w.length < 3 ? 0 : MONTH_NAMES.findIndex(n => n.startsWith(w)) + 1);
    const thisYear = new Date(now + offsetHours * 3600000).getUTCFullYear();
    if ((x = s.match(/^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/)) && word(x[1])) [m, d, y] = [word(x[1]), +x[2], x[3] ? +x[3] : thisYear];
    else if ((x = s.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?(?: (\d{4}))?$/)) && word(x[2])) [d, m, y] = [+x[1], word(x[2]), x[3] ? +x[3] : thisYear];
    else return NaN;
  }
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d || y < 1900) return NaN;
  return t - offsetHours * 3600000;
}

/* Single-select options are matched loosely ("PDEI - Event Service" fits the
   option "PDEI-Event Service") but always written using the option's own name,
   so a write can never create a new option. */
const optionKey = (s) => String(s || "").toLowerCase().replace(/\s*-\s*/g, "-").replace(/\s+/g, " ").trim();
export function matchOption(value, options) {
  const k = optionKey(value);
  return k ? (options || []).find(o => optionKey(o) === k) || null : null;
}

/* Name similarity (Jaccard over meaningful words), used to flag briefs that look
   like a project already in the Universe under another code. */
const STOP = new Set(("the a an of and x for in at on with to by ph season addendum project " +
                      "2023 2024 2025 2026 2027 2028").split(" "));
function words(s) {
  return new Set((String(s || "").toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter(w => w.length > 1 && !STOP.has(w)));
}
export function similarity(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both);
}

/* ======================= indexes over the destination tables ======================= */

const push = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };

/* Universe, keyed by every project code found in each row's Project Code cell,
   and by every PAR request number in its PAR cell. */
export function indexUniverse(records, { ignoreField = "IGNORE" } = {}) {
  const rows = [], byCode = new Map(), byPar = new Map();
  for (const r of records) {
    const f = r.fields || {};
    const row = {
      id: r.record_id,
      codeText: clean(f["Project Code"]),
      project: clean(f["Project"]),
      client: clean(f["Client"]),
      par: clean(f["PAR"]),
      status: clean(f["Status"]),
      amountInc: numOf(f["Amount (VAT-Inc.)"]),
      businessUnit: clean(f["Business Unit"]),
      ignored: f[ignoreField] === true,
    };
    rows.push(row);
    for (const c of new Set(allCodes(row.codeText))) push(byCode, c, row);
    for (const n of new Set(requestNos(row.par))) push(byPar, n, row);
  }
  return { rows, byCode, byPar, parNos: new Set(byPar.keys()) };
}

/* ======================= inbox filters (Client, Status, BD, AM, Tribe) =======================
   Every card is about a project; its filter values are the project's, found by its
   code: Client, Status, BD and AM from its Universe row; Tribe from the Universe (a
   Tribe lookup, if the table has one) or else ANDON's TRIBE. A project that isn't in
   the Universe yet (a new brief) takes BD and AM from its brief. */
export const FILTER_KEYS = ["client", "status", "bd", "am", "tribe"];

/* The rows filter values come from, by project code. */
export function filterIndex(universe, andon) {
  const by = (records) => {
    const m = new Map();
    for (const r of records || []) {
      const f = r.fields || {};
      for (const c of new Set(allCodes(clean(f["Project Code"])))) if (!m.has(c)) m.set(c, f);
    }
    return m;
  };
  return { uni: by(universe), andon: by(andon) };
}

const tribeOf = (f) => {
  if (!f) return "";
  const k = Object.keys(f).find(n => /^tribe$/i.test(n.trim()));
  return k ? clean(f[k]) : "";
};

/* A card's filter values: { client: [..], status: [..], bd: [..], am: [..], tribe: [..], inUniverse }.
   Each a list (people can be several); an empty list means none. */
export function cardFacets(card, idx) {
  const code = normCode(card.code || "");
  const u = code ? idx.uni.get(code) : null;
  const a = code ? idx.andon.get(code) : null;
  // The brief, for a project the Universe doesn't have yet.
  const brief = card.kind === "brief" || card.kind === "andon" ? (card.record || {}).fields
    : card.brief ? (card.brief.record || {}).fields : null;
  const names = (v) => people(v).map(p => p.name);
  const list = (s) => (s ? [s] : []);
  const pick = (k) => { const fromU = u ? names(u[k]) : []; return fromU.length ? fromU : brief ? names(brief[k]) : []; };
  return {
    client: list(u ? clean(u["Client"]) : ""),
    status: list(u ? clean(u["Status"]) : ""),
    bd: pick("BD"),
    am: pick("AM"),
    tribe: list(tribeOf(u) || tribeOf(a)),
    inUniverse: !!u,
  };
}

/* Does a card pass the filters? `filters` = { key: value | NONE | null }: null (or
   missing) is any; NONE (the empty string) means "has none"; a value must be one of
   the card's (any case). */
export const NONE = "";
export function passesFilters(facets, filters) {
  if (!facets) return true;
  for (const k of FILTER_KEYS) {
    const want = filters && filters[k];
    if (want === null || want === undefined) continue;
    const have = facets[k] || [];
    if (want === NONE ? have.length : !have.some(v => v.toLowerCase() === want.toLowerCase())) return false;
  }
  return true;
}

/* The choices for one filter, from `cards` (as the other filters leave them): each
   value with how many cards have it, plus how many have none. `order` puts values in
   a given order first (the Status column's own); the rest go A-Z.
   → { values: [{ value, n }], none } */
export function filterChoices(cards, key, filters, order = []) {
  const others = { ...(filters || {}), [key]: null };
  const counts = new Map();
  let none = 0;
  for (const c of cards) {
    if (!passesFilters(c.facets, others)) continue;
    const vals = (c.facets && c.facets[key]) || [];
    if (!vals.length) none++;
    for (const v of new Set(vals)) counts.set(v, (counts.get(v) || 0) + 1);
  }
  const rank = (v) => { const i = order.indexOf(v); return i < 0 ? Infinity : i; };
  const values = [...counts].map(([value, n]) => ({ value, n }))
    .sort((a, b) => rank(a.value) - rank(b.value) || a.value.localeCompare(b.value));
  return { values, none };
}

/* The closest matches to what's typed, for a type-to-pick filter (Client): `values`
   = [{ value, n }]. Best first: the whole name, then names starting with it, then a
   word starting with it, then containing it, then its letters in order ("kstrl" →
   Kestrel Motors); ties go to the one with more cards, then A-Z. Nothing typed: the
   ones with the most cards. At most `limit`. */
export function closestMatches(values, query, limit = 8) {
  const q = String(query || "").trim().toLowerCase();
  const qq = q.replace(/\s+/g, "");
  const inOrder = (s) => { let i = 0; for (const ch of s) if (ch === qq[i]) i++; return i === qq.length; };
  const score = (v) => {
    const s = v.toLowerCase();
    if (!q) return 0;
    if (s === q) return 0;
    if (s.startsWith(q)) return 1;
    if (s.split(/[\s\-/&.,()]+/).some(w => w.startsWith(q))) return 2;
    if (s.includes(q)) return 3;
    return inOrder(s.replace(/\s+/g, "")) ? 4 : Infinity;
  };
  return values.map(v => ({ ...v, score: score(v.value) })).filter(v => v.score < Infinity)
    .sort((a, b) => a.score - b.score || b.n - a.n || a.value.localeCompare(b.value))
    .slice(0, limit).map(({ score, ...v }) => v);
}

/* Collections, keyed by invoice request number and by project code. */
export function indexCollections(records) {
  const rows = [], byIr = new Map(), byCode = new Map();
  for (const r of records) {
    const f = r.fields || {};
    const ir = num(f["Invoice Request"]);
    const row = {
      id: r.record_id,
      ir: ir === null ? "" : String(Math.round(ir)),
      code: normCode(plain(f["Project Code"])),
      arName: clean(f["AR Name"]),
      amount: num(f["Invoice Amount"]),
      currency: clean(f["Currency"]),
      status: clean(f["Status"]),
      invoiceDate: num(f["Invoice Date"]),
    };
    rows.push(row);
    if (row.ir) push(byIr, row.ir, row);
    for (const c of new Set(allCodes(plain(f["Project Code"])))) push(byCode, c, row);
  }
  return { rows, byIr, byCode, irNos: new Set(byIr.keys()) };
}

/* ======================= cards ======================= */

const bySubmittedDesc = (a, b) => (b.submittedAt || 0) - (a.submittedAt || 0);

/* Filed by one of the departments Polaris covers (Account Managers, once called Sales). */
const inDepartment = (f, rules) => (rules.departments || [rules.department]).includes(clean(f["Initiator department"]));

function emptyHidden() {
  return { otherDept: 0, ignored: 0, done: 0, void: 0, noProject: 0 };
}

/* Project Briefs that should become Universe rows.
   Returns { cards, hidden } where hidden counts what was filtered out and why. */
export function briefCards(briefs, uni, rules, { allDepartments = false, ignoreField = "IGNORE", kind = "brief" } = {}) {
  const cards = [], hidden = emptyHidden();
  for (const r of briefs) {
    const f = r.fields || {};
    if (!allDepartments && !inDepartment(f, rules)) { hidden.otherDept++; continue; }
    if (f[ignoreField] === true) { hidden.ignored++; continue; }
    const code = normCode(plain(f["Project Code"]));
    if (code && uni.byCode.has(code)) { hidden.done++; continue; }
    const status = clean(f["Status"]);
    if (rules.voidStatuses.includes(status)) { hidden.void++; continue; }

    const name = clean(f["Project Name"]);
    const card = {
      kind, id: r.record_id, record: r, code, name, status,
      department: clean(f["Initiator department"]),
      requestNo: requestNo(f["Request No."]),
      submittedAt: num(f["Submitted at"]),
      value: num(f["Contract Value"]),
      currency: clean(f["Contract Value-Currency"]),
      am: people(f["AM"]),
      problems: [], similar: null,
    };
    if (!code) card.problems.push(`Project Code "${clean(f["Project Code"])}" isn't a valid code (e.g. 2026TEG-P0123).`);

    let best = null;
    for (const row of uni.rows) {
      const s = similarity(name, row.project);
      if (s >= rules.similarityHint && (!best || s > best.score)) best = { score: s, row };
    }
    if (best) card.similar = { project: best.row.project, code: normCode(best.row.codeText), score: best.score };
    cards.push(card);
  }
  cards.sort(bySubmittedDesc);
  return { cards, hidden };
}

/* Project Approvals whose request number isn't in the Universe yet. A PAR can
   only land on an existing Universe row, so PARs for a project that isn't there
   are hidden, unless that project's brief is waiting as a card (then the PAR
   shows as blocked until the brief is pushed).

   The project is found through the PAR's "Associated Project Brief" (which
   starts with the brief's request number) because PAR's own Project Code is
   free text and sometimes wrong; the typed code is the fallback. */
export function parCards(pars, briefs, uni, pendingCodes, rules) {
  const briefByReq = new Map();
  for (const b of briefs) briefByReq.set(requestNo((b.fields || {})["Request No."]), b);

  const cards = [], hidden = emptyHidden();
  for (const r of pars) {
    const f = r.fields || {};
    if (f["IGNORE"] === true) { hidden.ignored++; continue; }
    const reqNo = requestNo(f["Request No."]);
    if (reqNo && uni.parNos.has(reqNo)) { hidden.done++; continue; }
    const status = clean(f["Status"]);
    if (rules.voidStatuses.includes(status)) { hidden.void++; continue; }

    const linked = (clean(f["Associated Project Brief"]).match(/^(\d{12})/) || [])[1];
    const brief = linked ? briefByReq.get(linked) : null;
    const briefCode = brief ? normCode(plain(brief.fields["Project Code"])) : "";
    const typedCode = normCode(plain(f["Project Code"]));
    const options = [...new Set([briefCode, typedCode].filter(Boolean))];
    const code = options.find(c => uni.byCode.has(c)) || options.find(c => pendingCodes.has(c)) || "";

    const notes = [];
    if (briefCode && typedCode && briefCode !== typedCode) {
      notes.push(code === typedCode
        ? `Linked brief is ${briefCode}, which isn't in the Universe; using the PAR's typed code ${typedCode}.`
        : `PAR's typed code ${typedCode} differs from its linked brief's ${briefCode}; using ${briefCode}.`);
    }
    const targets = code ? uni.byCode.get(code) || [] : [];
    const blocked = !targets.length;
    if (blocked && !(code && pendingCodes.has(code))) { hidden.noProject++; continue; }

    const name = clean(f["Project Name"]);
    let target = targets[0] || null;
    if (targets.length > 1) {
      target = targets.reduce((a, b) => (similarity(name, b.project) > similarity(name, a.project) ? b : a));
      notes.push(`${targets.length} Universe rows share ${code}; check which one this PAR belongs to.`);
    }
    if (!reqNo) notes.push("This PAR has no request number.");
    cards.push({
      kind: "par", id: r.record_id, record: r, code, name, status, requestNo: reqNo,
      submittedAt: num(f["Submitted at"]),
      targets, target, blocked: blocked ? "Push this project's brief first." : (reqNo ? "" : "No request number to copy."),
      notes,
    });
  }
  cards.sort(bySubmittedDesc);
  return { cards, hidden };
}

/* ======================= what gets written ======================= */

export const defaultVat = (currency) => (currency === "USD" ? "0%" : "12%");

/* Sentences in the brief's Remarks that talk about VAT or tax, to show beside
   the VAT choice. They're too inconsistent ("all in with tax" briefs ended up
   0% in the Universe) to pick the VAT automatically. */
export function vatMentions(remarks, max = 2) {
  return (clean(remarks).match(/[^.!?\n]+[.!?]?/g) || [])
    .map(s => s.trim())
    .filter(s => /\bvat\b|\btax(es)?\b|zero[- ]?rated|vat[- ]?(ex|inc)/i.test(s))
    .slice(0, max);
}

/* Amount (VAT-Ex.) (PHP) from the brief's filed value. null if it can't be computed. */
export function vatExAmount(value, currency, vat, rules) {
  if (num(value) === null) return null;
  const rate = currency === "USD" ? rules.usdRate : currency === "PHP" ? 1 : null;
  if (rate === null) return null;
  return round2(value * rate / (vat === "12%" ? rules.vatDivisor : 1));
}

/* How the amount was derived, for the confirmation sheet. */
export function amountFormula(value, currency, vat, rules) {
  if (num(value) === null) return "no Contract Value on the brief";
  const parts = [`${currency || "?"} ${value.toLocaleString("en-US")}`];
  if (currency === "USD") parts.push(`× ${rules.usdRate}`);
  if (vat === "12%") parts.push(`÷ ${rules.vatDivisor}`);
  return parts.join(" ");
}

const userRefs = (list) => list.map(u => ({ id: u.id }));

/* Universe fields for a brief. `choices` = { vat: "12%" | "0%", client, bd, otherLinks }:
   Client, BD and Other Links come only from what the user enters (BD and Other
   Links are blank unless set). Empty values are left out, so nothing is
   written as blank. */
export function universeFromBrief(card, choices, rules) {
  const f = card.record.fields || {};
  const out = {};
  const put = (k, v) => {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return;
    out[k] = v;
  };
  put("Project Code", card.code);
  put("Project", card.name);
  put("Client", (choices.client || "").trim());
  put("AM", userRefs(people(f["AM"])));
  put("BD", userRefs(choices.bd || []));
  // (MKT isn't on the Project Brief any more, so a new row's MKT starts blank)
  const amount = vatExAmount(card.value, card.currency, choices.vat, rules);
  put("Amount (VAT-Ex.) (PHP)", amount);
  if (amount !== null) put("VAT%", choices.vat);
  put("Project Description", clean(f["Remarks"]));
  put("Project Start", num(f["Start date"]));
  put("Project End", num(f["End date"]));
  const submitted = num(f["Submitted at"]);
  if (submitted !== null) put("RFP Received Date", dayStart(submitted, rules.utcOffsetHours));
  put("Year", card.code ? card.code.slice(0, 4) : (submitted !== null ? String(yearIn(submitted, rules.utcOffsetHours)) : ""));
  put("Status", rules.newProjectStatus);
  put("Mancom Phase", rules.newProjectMancomPhase);
  put("Other Links", (choices.otherLinks || "").replace(/\r\n?/g, "\n").trim());
  return out;
}

/* ANDON fields for a brief (the Project Management board). `choices` =
   { pm: [person], tribe: string }: PM (LEAD) and TRIBE come only from what the
   user picks. `options` = ANDON's select options, so values never invent new
   ones. Empty values are left out. */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
                "September", "October", "November", "December"];
export function andonFromBrief(card, choices, rules, options) {
  const f = card.record.fields || {};
  const out = {};
  const put = (k, v) => {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return;
    out[k] = v;
  };
  const opt = (name, v) => matchOption(v, options[name] || []);
  put("Project", card.name);
  put("Project Code", card.code);
  put("AM", userRefs(people(f["AM"]).slice(0, 1)));                 // ANDON holds one AM
  put("PM (LEAD)", userRefs((choices.pm || []).slice(0, 1)));
  // (MKT (PITCH) stays blank: the Project Brief has no MKT column any more)
  put("Business Unit", opt("Business Unit", clean(f["Business Unit"])));
  put("Tools", (Array.isArray(f["Required Tools"]) ? f["Required Tools"] : [])
    .map(t => opt("Tools", t)).filter(Boolean));
  put("TRIBE", opt("TRIBE", choices.tribe));
  const value = num(f["Contract Value"]);
  const cur = opt("Brief Currency", card.currency);
  put("Brief Contract Value", value);
  if (cur) put("Brief Currency", [cur]);
  if (value !== null && (card.currency === "PHP" || card.currency === "USD")) {
    put("Contract Value (USD)", round2(card.currency === "USD" ? value : value / rules.usdRate));
  }
  const brief = f["Request No."];
  if (brief && brief.link) put("Brief", { link: brief.link, text: card.requestNo || brief.link });
  put("Brief Status", [opt("Brief Status", card.status)].filter(Boolean));
  const submitted = num(f["Submitted at"]);
  put("YEAR", card.code ? card.code.slice(0, 4) : (submitted !== null ? String(yearIn(submitted, rules.utcOffsetHours)) : ""));
  const start = num(f["Start date"]);
  const when = start !== null ? start : submitted;
  if (when !== null) put("MONTH", MONTHS[new Date(when + rules.utcOffsetHours * 3600000).getUTCMonth()]);
  put("Event Start", start);
  put("Event End", num(f["End date"]));
  put("Remarks", clean(f["Remarks"]));
  return out;
}

/* Everyone the BD picker can offer: people seen in the Universe's BD and AM
   columns and on the briefs, most frequent Universe BDs first. */
export function peoplePool(universe, briefs) {
  const pool = new Map();
  const add = (list, bd) => list.forEach(u => {
    const p = pool.get(u.id) || { id: u.id, name: u.name, email: u.email, bdCount: 0 };
    if (!p.email && u.email) p.email = u.email;
    if (bd) p.bdCount++;
    pool.set(u.id, p);
  });
  for (const r of universe) { const f = r.fields || {}; add(people(f["BD"]), true); add(people(f["AM"]), false); }
  for (const r of briefs) {
    const f = r.fields || {};
    for (const k of ["BD", "AM"]) add(people(f[k]), false);
  }
  return [...pool.values()].sort((a, b) => b.bdCount - a.bdCount || a.name.localeCompare(b.name));
}

/* Everyone the PM picker can offer: ANDON's PM (LEAD) and PM (SUPP) people first. */
export function pmPool(andon, universe) {
  const pool = new Map();
  const add = (list, pm) => list.forEach(u => {
    const p = pool.get(u.id) || { id: u.id, name: u.name, email: u.email, bdCount: 0 };
    if (pm) p.bdCount++;
    pool.set(u.id, p);
  });
  for (const r of andon) { const f = r.fields || {}; add(people(f["PM (LEAD)"]), true); add(people(f["PM (SUPP)"]), true); }
  for (const r of universe) add(people((r.fields || {})["PM"]), false);
  return [...pool.values()].sort((a, b) => b.bdCount - a.bdCount || a.name.localeCompare(b.name));
}

/* ======================= the audit: blanks a brief can fill =======================

   Universe and ANDON rows are compared with their Project Brief (matched by
   project code). A cell that's blank in the row but has a value from the brief
   is a gap; pushing fills the chosen gaps and never touches a cell that has a
   value. Columns a person decides (Client, BD, Other Links, Status, Mancom Phase,
   PM, TRIBE…) are never audited. */

/* Blank as Lark shows it: no value, empty text, an empty list. Zero isn't blank. */
export function isBlank(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return !v.trim();
  if (Array.isArray(v)) {
    return v.every(x => x === null || x === undefined || x === ""
      || (typeof x === "object" && !x.id && !x.file_token && plain(x).trim() === ""));
  }
  if (typeof v === "number") return Number.isNaN(v);
  if (typeof v === "object" && "value" in v) return isBlank(v.value);
  if (typeof v === "object" && "link" in v) return !v.link;
  return false;
}

/* The brief of each project code: the newest one that wasn't rejected or withdrawn. */
export function briefsByCode(briefs, rules) {
  const out = new Map();
  for (const b of briefs) {
    const f = b.fields || {};
    const code = normCode(plain(f["Project Code"]));
    if (!code || rules.voidStatuses.includes(clean(f["Status"]))) continue;
    const cur = out.get(code);
    if (!cur || (num(f["Submitted at"]) || 0) > (num(cur.fields["Submitted at"]) || 0)) out.set(code, b);
  }
  return out;
}

/* A brief in the shape universeFromBrief / andonFromBrief take. */
export function briefAsCard(b) {
  const f = b.fields || {};
  return {
    record: b, code: normCode(plain(f["Project Code"])), name: clean(f["Project Name"]),
    status: clean(f["Status"]), requestNo: requestNo(f["Request No."]),
    submittedAt: num(f["Submitted at"]), value: num(f["Contract Value"]), currency: clean(f["Contract Value-Currency"]),
  };
}

// Never audited: chosen by a person, or the key itself.
const AUDIT_SKIP = {
  universe: new Set(["Project Code", "Client", "BD", "Other Links", "Status", "Mancom Phase", "VAT%"]),
  andon: new Set(["Project Code", "PM (LEAD)", "TRIBE"]),
};

/* What the brief would put in each column of this row. For the Universe the
   amount uses the row's own VAT% (or `vat` when the row has none). */
function fromBrief(target, brief, row, rules, { vat, options, fields } = {}) {
  if (target === "universe") {
    const rowVat = clean((row.fields || {})["VAT%"]);
    return universeFromBrief(brief, { vat: rowVat || vat || defaultVat(brief.currency), client: "", bd: [], otherLinks: "" }, rules);
  }
  const all = andonFromBrief(brief, {}, rules, options || {});
  if (!fields) return all;
  const ok = new Map(fields.map(f => [f.field_name, f]));
  return Object.fromEntries(Object.entries(all).filter(([k]) => ok.has(k) && !AUDIT_COMPUTED.has(ok.get(k).type)));
}
const AUDIT_COMPUTED = new Set([18, 19, 20, 21, 24, 1001, 1002, 1003, 1004, 1005]);

/* A won Universe project (rules.auditRequired: by Status or Mancom Phase): it
   must have Sign Date and Month, which no brief has, so a person fills them. */
export function isWonProject(fields, rules) {
  const r = rules.auditRequired;
  if (!r) return false;
  const status = clean(fields["Status"]), phase = clean(fields["Mancom Phase"]);
  return r.statuses.some(s => s.trim() === status) || r.mancomPhases.some(p => p.trim() === phase);
}

/* The Month a Sign Date falls in, in the Month column's own type (`def`): a date
   is midnight on the 1st in the Base's zone; a select is the option for that month
   ("June 2026" or "June", as the column spells it); text is "June 2026". */
export function monthOf(signMs, def, rules) {
  if (typeof signMs !== "number" || Number.isNaN(signMs)) return null;
  const off = rules.utcOffsetHours * 3600000, d = new Date(signMs + off);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), name = MONTHS[m];
  const type = def ? def.type : 5;
  if (type === 5) return Date.UTC(y, m, 1) - off;
  if (type === 3) {
    const options = ((def.property && def.property.options) || []).map(o => o.name);
    return matchOption(`${name} ${y}`, options) || matchOption(name, options) || matchOption(name.slice(0, 3), options);
  }
  if (type === 1) return `${name} ${y}`;
  return null;
}

/* A lost, stalled or archived Universe project (rules.auditLost, by Status): it must
   have Loss Month and Reason for Loss. */
export function isLostProject(fields, rules) {
  const r = rules.auditLost;
  if (!r) return false;
  const status = clean(fields["Status"]);
  return r.statuses.some(s => s.trim() === status);
}

/* The columns a Universe row must have filled by a person, given its status: the
   lost rule (it wins: the Status says where the project is now), else the won rule.
   { rule: "lost" | "won" | "", fields: [its required columns, all of them], who } */
export function requiredRule(fields, rules) {
  if (isLostProject(fields, rules)) return { rule: "lost", fields: rules.auditLost.fields, who: rules.auditLost.who };
  if (isWonProject(fields, rules)) return { rule: "won", fields: rules.auditRequired.fields, who: rules.auditRequired.who || "A won project" };
  return { rule: "", fields: [], who: "" };
}

/* The required columns a Fill would still leave blank: refused while any are. */
export function auditMissing(card, patch) {
  return (card.required || []).filter(k => isBlank(patch[k]));
}

/* The sentence that refuses such a Fill: "A won project needs Sign Date and Month." */
export function requiredMessage(card, missing) {
  return `${card.requiredWho || "This project"} needs ${missing.join(" and ")}.`;
}

/* A Universe project that must have its signed CE on file (rules.auditFiles, by Status). */
export function needsSignedCe(fields, rules) {
  const r = rules.auditFiles;
  if (!r) return false;
  const status = clean(fields["Status"]);
  return r.statuses.some(s => s.trim() === status);
}

/* The attachment columns that are ticked in the sheet but have no file picked yet
   (`choices.files`): the Fill is refused while any are (untick to fill the rest). */
export function auditFilesMissing(card, choices) {
  const pick = choices.fields || card.gaps;
  const files = (choices.files || []).length;
  return (card.files || []).filter(k => pick.includes(k) && !files);
}

/* ======================= custom tags ("Mark as No Revenue") =======================
   A row's tags live in one plain-text column, separated by commas ("No Revenue,
   Hidden"). The custom tags themselves are rows of the Variables table. */

/* The tags in a Tags cell, trimmed, each once (compared without case). */
export function tagsOf(v) {
  const out = [];
  for (const t of clean(v).split(/[,\n;]+/).map(x => x.trim()).filter(Boolean)) {
    if (!out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}
const hasTag = (list, tag) => list.some(x => x.toLowerCase() === String(tag).trim().toLowerCase());
/* The cell with `tag` added (at the end; the cell's other tags kept as they are). */
export function tagsWith(v, tag) {
  const list = tagsOf(v);
  return (hasTag(list, tag) ? list : [...list, String(tag).trim()]).join(", ");
}
/* The cell with `tag` taken out (null when nothing's left). */
export function tagsWithout(v, tag) {
  const list = tagsOf(v).filter(x => x.toLowerCase() !== String(tag).trim().toLowerCase());
  return list.length ? list.join(", ") : null;
}

/* Which Variables columns hold the variable's name and its value. The configured
   names (rules.tags.nameColumn / valueColumn) if the table has them; otherwise the
   column where some row says `variable` ("custom_tag") is the name, and the value is
   a column called "Value", or else the first other text column. Null if neither. */
export function variableColumns(fields, records, cfg) {
  const names = (fields || []).map(f => f.field_name);
  if (names.includes(cfg.nameColumn) && names.includes(cfg.valueColumn)) return { name: cfg.nameColumn, value: cfg.valueColumn };
  const want = cfg.variable.toLowerCase();
  const name = names.find(n => (records || []).some(r => clean((r.fields || {})[n]).toLowerCase() === want));
  if (!name) return null;
  const texty = (fields || []).filter(f => f.field_name !== name && [1, 3].includes(f.type)).map(f => f.field_name);
  const value = texty.find(n => n === cfg.valueColumn) || texty.find(n => /^values?$/i.test(n)) || texty[0];
  return value ? { name, value } : null;
}

/* The custom tags, in the table's order: [{ tag, id }] (id = the Variables row). */
export function customTagsFrom(records, cols, variable) {
  if (!cols) return [];
  const out = [];
  for (const r of records || []) {
    const f = r.fields || {};
    if (clean(f[cols.name]).toLowerCase() !== variable.toLowerCase()) continue;
    const tag = clean(f[cols.value]);
    if (tag && !out.some(x => x.tag.toLowerCase() === tag.toLowerCase())) out.push({ tag, id: r.record_id });
  }
  return out;
}

/* ======================= the Tagging page ======================= */

// Letters and digits only, lowercased: "Federal-Land " and "federal land" are one tag.
const tagKey = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, "");
function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const was = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = was;
    }
  }
  return row[b.length];
}

/* The tags in `known` that `tag` is probably a misspelling of: the same letters
   ("Federal-Land"), or a letter or two off ("Federal Lnad"). Not `tag` itself. */
export function lookalikeTags(tag, known) {
  const k = tagKey(tag);
  if (!k) return [];
  const room = k.length >= 8 ? 2 : k.length >= 4 ? 1 : 0;
  return (known || []).filter(t => String(t).toLowerCase() !== String(tag).toLowerCase())
    .filter(t => { const o = tagKey(t); return o === k || (room && Math.abs(o.length - k.length) <= room && editDistance(o, k) <= room); });
}

/* A tag typed under an audit card's Hide > "Mark as another tag…": { tag, isNew, like }
   or { error }. `custom` = the custom tags, `inUse` = the tags already in Tags cells.
   A custom tag typed in any case is that tag (isNew false). Otherwise it becomes a new
   custom tag, spelled as it's already used if it is ("event" → "Event"); `like` = the
   tags it looks like a misspelling of, to ask about first. */
export function pickTag(raw, custom = [], inUse = []) {
  const typed = String(raw || "").replace(/\s+/g, " ").trim();
  if (!typed) return { error: "Type the tag first." };
  if (/[,;]/.test(typed)) return { error: "A tag can't have a comma or semicolon in it: the Tags column uses them to separate tags." };
  const same = (list) => list.find(t => String(t).toLowerCase() === typed.toLowerCase());
  const hit = same(custom);
  if (hit) return { tag: hit, isNew: false, like: [] };
  const tag = same(inUse) || typed;
  const all = [];
  for (const t of [...custom, ...inUse]) if (!all.some(x => x.toLowerCase() === String(t).toLowerCase())) all.push(String(t));
  return { tag, isNew: true, like: lookalikeTags(tag, all) };
}

/* Every Universe project and its tags, Project Code Z-A (newest first). `query`
   searches the code, name, status and tags; `tag` keeps the projects with that tag
   ("" none: every project; null-like "(none)": the untagged). Also every tag in use,
   most used first, each with its count and the tags it looks like a misspelling of. */
export const UNTAGGED = "(no tags)";
export function taggingView(records, field, { query = "", tag = "" } = {}) {
  const all = (records || []).map(r => {
    const f = r.fields || {};
    return { id: r.record_id, code: normCode(plain(f["Project Code"])) || clean(f["Project Code"]), name: clean(f["Project"]),
             status: clean(f["Status"]), year: clean(f["Year"]), tags: tagsOf(f[field]) };
  });
  const counts = new Map();   // lowercased → { tag (first spelling seen), count }
  for (const r of all) for (const t of r.tags) {
    const k = t.toLowerCase();
    if (counts.has(k)) counts.get(k).count++; else counts.set(k, { tag: t, count: 1 });
  }
  const tags = [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  const names = tags.map(t => t.tag);
  for (const t of tags) t.like = lookalikeTags(t.tag, names);
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const want = String(tag || "").toLowerCase();
  const rows = all.filter(r => (!want ? true : want === UNTAGGED ? !r.tags.length : r.tags.some(t => t.toLowerCase() === want))
      && words.every(w => `${r.code} ${r.name} ${r.status} ${r.tags.join(" ")}`.toLowerCase().includes(w)))
    .sort((a, b) => (!a.code) - (!b.code) || b.code.localeCompare(a.code, "en", { numeric: true }));
  return { rows, tags, total: all.length, untagged: all.filter(r => !r.tags.length).length };
}

/* The custom tag a row is marked with (the first, in the custom tags' order), or null. */
export function customTagOf(fields, tagField, tags) {
  const mine = tagsOf((fields || {})[tagField]);
  const hit = (tags || []).find(t => hasTag(mine, t));
  return hit || null;
}

/* Every row in `records` (Universe or ANDON, `target`) with gaps its brief can
   fill, and, in the Universe, every won project missing a required column
   (`required`, filled by a person; such a row gets a card even without a brief),
   and every signed project with no signed CE on file (`files`, uploaded by a
   person; also without a brief).
   `hide` = keys of cards hidden on this device. `options`/`fields` = the table's
   select options and columns (only typed columns are ever written; a required
   column the table doesn't have isn't asked for). `tags` = the custom tags: a row
   marked with one (in `tagField`) leaves the list for `tagged`, card.tag saying which.
   Returns { cards, tagged, hidden: { noBrief, hidden } }. */
/* ======================= PAR → ANDON Approval ======================= */

/* Each project's Project Approval, by project code: the newest PAR that wasn't
   rejected or withdrawn (an Approved one wins over one still under review), with
   its Request No. as ANDON's Approval takes it ({link, text}: the approval in Lark,
   shown as its request number). */
export function parApprovals(pars, rules) {
  const best = new Map();
  for (const r of pars || []) {
    const f = r.fields || {};
    const code = normCode(plain(f["Project Code"]));
    const req = f["Request No."];
    const link = req && typeof req.link === "string" ? req.link : "";
    const status = clean(f["Status"]);
    if (!code || !/^https:\/\//.test(link) || rules.voidStatuses.includes(status)) continue;
    const at = num(f["Submitted at"]) || 0, approved = status === rules.approvedStatus ? 1 : 0;
    const cur = best.get(code);
    if (cur && (cur.approved > approved || (cur.approved === approved && cur.submittedAt >= at))) continue;
    const no = requestNo(req);
    best.set(code, { approved, submittedAt: at, status, requestNo: no, name: clean(f["Project Name"]),
                     value: { link, text: no || link }, record: r });
  }
  return best;
}

/* The ANDON tab's approval cards: an ANDON row whose Project Code has a Project
   Approval, and whose Approval (rules.andonApproval.field, a link column) is blank,
   gets that PAR's Request No. One card per ANDON row. An ANDON without the column
   gets none. Returns { cards, hidden: { done } }. */
export function approvalCards(andon, pars, rules, { fields } = {}) {
  const field = rules.andonApproval && rules.andonApproval.field;
  const hidden = { done: 0 };
  if (!field || (fields && !fields.some(f => f.field_name === field))) return { cards: [], hidden };
  const best = parApprovals(pars, rules);
  const cards = [];
  for (const row of andon || []) {
    const f = row.fields || {};
    const code = normCode(plain(f["Project Code"]));
    const b = code && best.get(code);
    if (!b) continue;
    if (!isBlank(f[field])) { hidden.done++; continue; }
    cards.push({
      kind: "approval", id: `approval:${row.record_id}`, rowId: row.record_id, field, code,
      name: clean(f["Project"]) || b.name, requestNo: b.requestNo, status: b.status,
      submittedAt: b.submittedAt || null, link: b.value, par: b.record, notes: [], blocked: "",
    });
  }
  cards.sort(bySubmittedDesc);
  return { cards, hidden };
}

/* ======================= the brief's files → the Universe ======================= */

/* The Universe tab's file cards: a Universe row whose rules.briefFiles.to (an
   attachment column) is blank, and whose project's Project Brief links to its files
   in Lark Approval (rules.briefFiles.link, on the newest brief with the code that
   wasn't voided). Polaris can't read Lark Approval, so the card links there: the
   person downloads the files and uploads them through Polaris. No card for a row
   whose Status is in rules.briefFiles.skipStatuses, nor when either table lacks its
   column (in `fields`). Newest brief first. */
export function fileCards(universe, briefs, rules, { fields = {} } = {}) {
  const cfg = rules.briefFiles;
  const has = (table, col) => !fields[table] || fields[table].some(f => f.field_name === col);
  if (!cfg || !has("universe", cfg.to) || !has("brief", cfg.link)) return { cards: [] };
  const best = new Map();
  for (const r of briefs || []) {
    const f = r.fields || {};
    const code = normCode(plain(f["Project Code"]));
    const v = f[cfg.link];
    const link = v && typeof v.link === "string" && /^https:\/\//.test(v.link) ? v.link : "";
    if (!code || !link || rules.voidStatuses.includes(clean(f["Status"]))) continue;
    const at = num(f["Submitted at"]) || 0;
    if (best.has(code) && best.get(code).submittedAt >= at) continue;
    best.set(code, { link, label: clean(v.text), submittedAt: at, requestNo: requestNo(f["Request No."]), name: clean(f["Project Name"]) });
  }
  const cards = [];
  for (const row of universe || []) {
    const f = row.fields || {};
    const code = normCode(plain(f["Project Code"]));
    const b = code && best.get(code);
    const status = clean(f["Status"]);
    if (!b || !isBlank(f[cfg.to]) || (cfg.skipStatuses || []).includes(status)) continue;
    cards.push({
      kind: "files", id: `files:${row.record_id}`, rowId: row.record_id, code, field: cfg.to,
      name: clean(f["Project"]) || b.name, status, link: b.link, label: b.label, requestNo: b.requestNo,
      submittedAt: b.submittedAt || null, notes: [], blocked: "",
    });
  }
  cards.sort(bySubmittedDesc);
  return { cards };
}

export function auditCards(target, records, briefs, rules, { hide = new Set(), options, fields, byCode, tags = [], tagField } = {}) {
  const briefFor = byCode || briefsByCode(briefs, rules);
  const cards = [], tagged = [], hidden = { noBrief: 0, hidden: 0 };
  const seen = new Set();
  for (const row of records) {
    const f = row.fields || {};
    const code = normCode(plain(f["Project Code"]));
    if (!code) continue;
    const has = fields ? new Set(fields.map(d => d.field_name)) : null;
    // Won: Sign Date and Month. Lost / stalled / archived: Loss Month and Reason for Loss.
    const req = target === "universe" ? requiredRule(f, rules) : { rule: "", fields: [], who: "" };
    const required = req.fields.filter(k => (!has || has.has(k)) && isBlank(f[k]));
    const af = rules.auditFiles;
    const files = target === "universe" && af && needsSignedCe(f, rules) && (!has || has.has(af.field)) && isBlank(f[af.field])
      ? [af.field] : [];
    const b = briefFor.get(code);
    if (!b && !required.length && !files.length) { hidden.noBrief++; continue; }
    const brief = b ? briefAsCard(b) : null;
    const want = brief ? fromBrief(target, brief, row, rules, { options, fields }) : {};
    const gaps = [...new Set([...Object.keys(want).filter(k => !AUDIT_SKIP[target].has(k) && isBlank(f[k])), ...required, ...files])];
    if (!gaps.length) continue;
    const id = `${target}:${row.record_id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const card = {
      kind: "audit", target, id, rowId: row.record_id, code,
      name: clean(f["Project"]) || (brief && brief.name) || "", status: target === "universe" ? clean(f["Status"]) : "",
      submittedAt: brief ? brief.submittedAt : null, requestNo: brief ? brief.requestNo : "", brief, gaps, required, files,
      requiredRule: required.length ? req.rule : "", requiredWho: required.length ? req.who : "",
      // Stalled, Lost or Archived: the sheet offers to change which (statusChange).
      lost: target === "universe" && isLostProject(f, rules),
      // The amount needs a VAT rate; the row has none, so the sheet asks for it.
      needsVat: !!brief && target === "universe" && gaps.includes("Amount (VAT-Ex.) (PHP)") && !clean(f["VAT%"]),
      notes: [], blocked: "",
    };
    card.hideKey = `${id}|${gaps.join(",")}`;
    // Marked with a custom tag: it goes to that tag's group (shared, unlike Hide).
    const tag = tagField && tags.length ? customTagOf(f, tagField, tags) : null;
    if (tag) { card.tag = tag; tagged.push(card); continue; }
    if (hide.has(card.hideKey)) { hidden.hidden++; continue; }
    cards.push(card);
  }
  cards.sort(bySubmittedDesc);
  tagged.sort(bySubmittedDesc);
  return { cards, tagged, hidden };
}

/* The tagged cards of every table, one group per custom tag (in the tags' order,
   empty ones left out): [{ tag, cards }]. */
export function tagGroups(tagged, tags) {
  return (tags || []).map(tag => ({ tag, cards: tagged.filter(c => c.tag === tag).sort(bySubmittedDesc) }))
    .filter(g => g.cards.length);
}

/* The cells a push writes: the chosen gaps (`choices.fields`, default all),
   valued from the brief unless edited in the sheet (`choices.values`, in write
   format: briefs go out of date). A value left blank is never written.
   `choices.vat` = the VAT rate when the row has none (then VAT% is written with the amount).
   `choices.files` = the files for an attachment gap (card.files): [{name, size, file_token?}]. */
export function auditPatch(card, row, choices, rules, { options, fields } = {}) {
  const want = card.brief ? fromBrief(card.target, card.brief, row, rules, { vat: choices.vat, options, fields }) : {};
  const pick = choices.fields || card.gaps;
  const out = {};
  for (const k of pick) {
    if (!card.gaps.includes(k)) continue;
    // An attachment (the signed CE): the files picked in the sheet. Uploaded ones
    // go out by file_token; one not uploaded yet shows by name (the push uploads
    // every file before it writes, so a name is never sent to Lark).
    if ((card.files || []).includes(k)) {
      const files = choices.files || [];
      if (files.length) out[k] = files.map(f => (f.file_token ? { file_token: f.file_token } : { name: f.name }));
      continue;
    }
    const v = choices.values && k in choices.values ? choices.values[k] : want[k];
    if (!isBlank(v)) out[k] = typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : v;
  }
  if (card.needsVat && "Amount (VAT-Ex.) (PHP)" in out) out["VAT%"] = choices.vat || defaultVat(card.brief.currency);
  // Month defaults from the Sign Date (typed in the sheet, or already on the row).
  const mo = rules.auditRequired && rules.auditRequired.month;
  if (mo && (card.required || []).includes(mo.field) && isBlank(choices.values && choices.values[mo.field])) {
    const sign = choices.values && !isBlank(choices.values[mo.from]) ? choices.values[mo.from] : num((row.fields || {})[mo.from]);
    const def = (fields || []).find(f => f.field_name === mo.field);
    const month = monthOf(sign, def, rules);
    if (month !== null && month !== undefined) out[mo.field] = month;
  }
  // A required column is always written: it can't be unticked (the sheet keeps it ticked).
  for (const k of card.required || []) {
    const v = choices.values && choices.values[k];
    if (!(k in out) && !isBlank(v)) out[k] = typeof v === "string" ? v.trim() : v;
  }
  // A lost, stalled or archived project marked with the wrong one of those: the sheet's
  // Status picks another of them (choices.status), written with the Fill.
  const st = statusChange(card, choices, rules);
  if (st) out["Status"] = st;
  return out;
}

/* The Status a lost-project card's sheet changes to, or null: only to another of
   rules.auditLost.statuses (Stalled ↔ Lost ↔ Archived), never to the same one. */
export function statusChange(card, choices, rules) {
  const s = choices && choices.status;
  if (!card.lost || !s || s === card.status || !rules.auditLost || !rules.auditLost.statuses.includes(s)) return null;
  return s;
}

/* Which cells of an audit patch may still be written, given the row as Lark has it
   now (`nowFields`): only cells that are still blank. VAT% is derived: it goes out
   together with the amount, only if it's still blank, and if someone set a different
   VAT% meanwhile the amount (worked out with the chosen one) is held back too.
   `overwrite` = cells the patch may change even though they have a value ({Status:
   what the card showed}): written only if the row still says that; if Lark already
   has the new value, nothing to do; anything else means someone changed it: skipped.
   Returns {written, skipped}: what to write, and the columns someone filled meanwhile. */
export function fillPlan(patch, nowFields, overwrite = {}) {
  const now = nowFields || {};
  const AMOUNT = "Amount (VAT-Ex.) (PHP)";
  const written = {}, skipped = [];
  for (const [k, v] of Object.entries(patch)) {
    if (k === "VAT%") continue;
    if (k in overwrite) {
      const there = clean(now[k]);
      if (there === clean(v)) continue;                       // already so
      if (there === clean(overwrite[k])) written[k] = v; else skipped.push(k);
      continue;
    }
    if (isBlank(now[k])) written[k] = v; else skipped.push(k);
  }
  if ("VAT%" in patch) {
    const there = clean(now["VAT%"]);
    if (there && there !== patch["VAT%"] && AMOUNT in written) { delete written[AMOUNT]; skipped.push(AMOUNT); }
    if (!there && AMOUNT in written) written["VAT%"] = patch["VAT%"];
    else if (there && there !== patch["VAT%"]) skipped.push("VAT%");
    // (blank VAT% but no amount going out: nothing derives it, so it stays blank, unreported)
  }
  return { written, skipped };
}

/* ======================= the Universe view ======================= */

/* One Universe record as a table row. */
export function universeRow(r) {
  const f = r.fields || {};
  return {
    id: r.record_id,
    client: clean(f["Client"]),
    project: clean(f["Project"]),
    amount: num(f["Amount (VAT-Ex.) (PHP)"]),
    bd: people(f["BD"]),
    am: people(f["AM"]),
    code: clean(f["Project Code"]),
    rfp: num(f["RFP Received Date"]),
    status: clean(f["Status"]),
    year: clean(f["Year"]),
  };
}

/* Everything a row says, as lower-case text for search: every cell (people by
   name, files by name, lookups by value), whether or not the table shows it. */
export function recordText(fields) {
  return Object.values(fields || {}).map(v => plain(v)).filter(Boolean).join(" \u2002").toLowerCase();
}

/* Does a search match this record? Every word of the query must be somewhere in
   the row ("tegami 2026" finds a row that says both, in any columns). */
export function matchesQuery(fields, query) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = recordText(fields);
  return words.every(w => text.includes(w));
}

/* The Universe the way the team reads it: one Year (or "all"), grouped by Status in
   the column's option order, each group sorted by RFP Received Date (rows without
   one go last). The statuses in `folded` (Stalled, Lost, Archived) come last, as
   groups marked `folded` (the table shows them folded until opened), and aren't in
   `count` or `amount` (the pipeline's totals): `foldedCount` says how many there are.
   `query` searches every column of every row of that year. */
export function universeView(records, { year = "all", folded = [], statusOrder = [], sort = "desc", query = "" } = {}) {
  const all = records.map(r => [universeRow(r), r.fields]);
  const years = [...new Set(all.map(([r]) => r.year).filter(y => /^\d{4}$/.test(y)))].sort().reverse();
  const q = query.trim();
  const picked = all.filter(([r, f]) => (year === "all" || r.year === String(year)) && (!q || matchesQuery(f, q))).map(([r]) => r);

  const byStatus = new Map();
  for (const r of picked) {
    if (!byStatus.has(r.status)) byStatus.set(r.status, []);
    byStatus.get(r.status).push(r);
  }
  // Option order first, then any status the options don't list, then rows with no status;
  // the folded statuses after all of those, in the same order.
  const order = [...statusOrder, ...[...byStatus.keys()].filter(s => s && !statusOrder.includes(s)), ""];
  const isFolded = (s) => folded.includes(s);
  const dir = sort === "asc" ? 1 : -1;
  const byDate = (a, b) => (a.rfp === null) - (b.rfp === null) || dir * ((a.rfp || 0) - (b.rfp || 0))
                           || a.project.localeCompare(b.project);
  const groups = [...order.filter(s => !isFolded(s)), ...order.filter(isFolded)].filter(s => byStatus.has(s)).map(status => {
    const rows = byStatus.get(status).sort(byDate);
    return { status, rows, folded: isFolded(status), amount: round2(rows.reduce((s, r) => s + (r.amount || 0), 0)) };
  });
  const live = groups.filter(g => !g.folded);
  return { groups, years, count: live.reduce((n, g) => n + g.rows.length, 0),
           amount: round2(live.reduce((s, g) => s + g.amount, 0)),
           foldedCount: groups.filter(g => g.folded).reduce((n, g) => n + g.rows.length, 0) };
}

/* ======================= the source tables' view ======================= */
/* Project Brief, Project Approval and Invoice Request (filled by Lark Approval), as
   a table beside the list: every row, newest submitted first. */

/* One approval record as a table row (each table has some of these columns). */
export function sourceRow(r) {
  const f = r.fields || {};
  const value = num(f["Contract Value"]) ?? num(f["Amount"]);
  return {
    id: r.record_id,
    requestNo: requestNo(f["Request No."]),
    link: (f["Request No."] && f["Request No."].link) || "",
    code: clean(f["Project Code"]),
    name: clean(f["Project Name"]),
    status: clean(f["Status"]),
    dept: clean(f["Initiator department"]),
    am: people(f["AM"]),
    amount: value,
    currency: clean(f["Contract Value-Currency"]) || clean(f["Amount-Currency"]),
    submittedAt: num(f["Submitted at"]),
  };
}

/* The rows, newest submitted first (`sort` "asc" flips it; no date last). `query`
   searches every column read (see matchesQuery). Only the first `limit` rows are
   returned (a long table stays quick to draw); `count` is how many matched. */
export function sourceView(records, { sort = "desc", query = "", limit = Infinity } = {}) {
  const dir = sort === "asc" ? 1 : -1;
  const rows = (records || []).filter(r => matchesQuery(r.fields, query)).map(sourceRow)
    .sort((a, b) => (a.submittedAt === null) - (b.submittedAt === null) || dir * ((a.submittedAt || 0) - (b.submittedAt || 0))
                    || b.requestNo.localeCompare(a.requestNo));
  return { rows: rows.slice(0, limit), count: rows.length };
}

/* ======================= the ANDON view ======================= */

/* One ANDON record as a table row. */
export function andonRow(r) {
  const f = r.fields || {};
  return {
    id: r.record_id,
    project: clean(f["Project"]),
    code: clean(f["Project Code"]),
    am: people(f["AM"]),
    pm: people(f["PM (LEAD)"]),
    tribe: clean(f["TRIBE"]),
    unit: clean(f["Business Unit"]),
    start: num(f["Event Start"]),
    end: num(f["Event End"]),
  };
}

/* ANDON sorted by Project Code, Z-A by default: codes start with the year and run
   up (2026TEG-P0127), so the newest projects come first. Numbers compare as numbers
   (P0999 before P1000); rows without a code go last. `query` searches every column. */
export function andonView(records, { sort = "desc", query = "" } = {}) {
  const dir = sort === "asc" ? 1 : -1;
  const rows = records.filter(r => matchesQuery(r.fields, query)).map(andonRow)
    .sort((a, b) => (!a.code) - (!b.code) || dir * a.code.localeCompare(b.code, "en", { numeric: true, sensitivity: "base" })
                    || a.project.localeCompare(b.project));
  return { rows, count: rows.length };
}

/* The Universe PAR cell after adding a request number, or null if it's already there. */
export function parAfterAdding(current, reqNo) {
  const cur = clean(current);
  if (requestNos(cur).includes(reqNo)) return null;
  return cur ? `${cur}, ${reqNo}` : reqNo;
}

/* ======================= Collections: the invoice lifecycle =======================

   A Collections row moves through three stages (rules.collectionStages):
     For Invoicing   the project is won (it has a PAR and an amount); nothing is filed yet
     Pending …       an invoice request has been filed for it
     For Collection  the request was approved and the invoice issued
   A row can skip Pending when its request is approved straight away.

   Each card is one change Polaris can push with a click:
     won        a won project with no Collections row yet → a new For Invoicing row
     filed      an invoice request under review → its row becomes Pending (or a new Pending row)
     approved   an approved request → its row becomes For Collection (or a new row)
     withdrawn  a request on a row was recalled or rejected → the row goes back to For Invoicing
   So the same invoice request can come up twice: when it's filed, and again when it's approved.

   A card's `targets` are the existing rows it can go on, each with an action:
     attach   a row waiting for a request takes this one
     advance  the row already carries this request; only its stage moves
     link     an older row that's already invoiced but never got a request number:
              only the number is added
     reset    a withdrawn request comes off its row
   `target` is the default (a row id, or "new" for a new row). */

/* The Collections status a card's step leads to. */
export function stepStatus(step, rules) {
  const st = rules.collectionStages;
  return { won: st.forInvoicing, filed: st.pending, approved: st.forCollection, withdrawn: st.forInvoicing }[step];
}

/* How well a free row fits a request: the same currency first, then the closest amount. */
function fitScore(row, card) {
  const gap = row.amount === null || card.amount === null ? 1e6
    : Math.abs(row.amount - card.amount) / Math.max(Math.abs(card.amount), 1);
  return (row.currency === card.currency ? 0 : 1e7) + gap;
}

const moneyOf = (row) => `${row.currency || "?"} ${row.amount === null ? "?" : row.amount.toLocaleString("en-US")}`;
const near = (a, b, tol = 0.01) => a !== null && b !== null && Math.abs(a - b) < tol;

/* Every change Collections needs, newest first. `invoices` = Invoice Request
   records; `uni`/`coll` = the indexes above; `pendingCodes` = codes of briefs
   still waiting as cards. Returns { cards, hidden } like the other lists. */
export function collectionCards(invoices, uni, coll, pendingCodes, rules) {
  const st = rules.collectionStages;
  const cards = [], hidden = { ...emptyHidden(), closed: 0 };
  const early = (row) => row.status === st.forInvoicing || row.status === st.pending;
  const voidNos = new Set(invoices.filter(r => rules.voidStatuses.includes(clean((r.fields || {})["Status"])))
    .map(r => requestNo(r.fields["Request No."])).filter(Boolean));
  // A row waiting for a request: an early stage, with no live request on it.
  const isFree = (row) => early(row) && (!row.ir || voidNos.has(row.ir));
  // An older row that's already invoiced but has no (live) request number.
  const isLegacy = (row) => !early(row) && !(rules.invalidStatuses || []).includes(row.status)
                            && (!row.ir || voidNos.has(row.ir));
  const projects = (code) => uni.byCode.get(code) || [];
  const isClosed = (code) => projects(code).length > 0 && projects(code).every(u => rules.closedStatuses.includes(u.status));

  const withdrawn = [];   // added last: a replacement request may take the row instead
  const fresh = [];       // requests not in Collections yet, to be matched with free rows

  for (const r of invoices) {
    const f = r.fields || {};
    const reqNo = requestNo(f["Request No."]);
    const status = clean(f["Status"]);
    const isVoid = rules.voidStatuses.includes(status);
    const approved = status === rules.approvedStatus;
    const card = {
      kind: "invoice", id: r.record_id, record: r, source: "invoice", ignoreField: "IGNORE",
      step: isVoid ? "withdrawn" : approved ? "approved" : "filed",
      code: "", name: clean(f["Project Name"]), status, requestNo: reqNo,
      submittedAt: num(f["Submitted at"]), completedAt: num(f["Completed at"]),
      amount: num(f["Amount"]), currency: clean(f["Amount-Currency"]), businessUnit: clean(f["Business Unit"]),
      targets: [], target: "new", canCreate: false, noNew: "", notes: [], blocked: "", existing: 0,
    };

    // Already on a row: move that row along, whichever department filed the request.
    const carrying = reqNo ? coll.byIr.get(reqNo) || [] : [];
    if (carrying.length) {
      const row = isVoid || approved ? carrying.find(early) : carrying.find(x => x.status === st.forInvoicing);
      if (!row) { if (isVoid) hidden.void++; else hidden.done++; continue; }
      if (f["IGNORE"] === true) { hidden.ignored++; continue; }
      card.code = row.code || normCode(plain(f["Project Code"]));
      card.targets = [{ id: row.id, row, action: isVoid ? "reset" : "advance" }];
      card.target = row.id;
      (isVoid ? withdrawn : cards).push(card);
      continue;
    }

    if (!inDepartment(f, rules)) { hidden.otherDept++; continue; }
    if (f["IGNORE"] === true) { hidden.ignored++; continue; }
    if (isVoid) { hidden.void++; continue; }

    // The project: the typed code, or failing that, the one its PAR is on in the Universe.
    const typed = normCode(plain(f["Project Code"]));
    const parNo = (clean(f["Associated Project Approval"]).match(/^(\d{12})/) || [])[1] || "";
    const viaPar = [...new Set((uni.byPar.get(parNo) || []).flatMap(u => allCodes(u.codeText)))];
    let code = typed;
    if (!(typed && uni.byCode.has(typed)) && viaPar.length === 1) {
      code = viaPar[0];
      card.notes.push(`Its project code ${typed || `"${clean(f["Project Code"])}"`} isn't in the Universe; ` +
                      `using ${code}, the project its PAR ${parNo} is on.`);
    } else if (typed && viaPar.length && !viaPar.includes(typed)) {
      card.notes.push(`Its PAR ${parNo} is on ${viaPar.join(", ")} in the Universe, not ${typed}. Check the project code.`);
    }
    card.code = code;
    if (!code || !uni.byCode.has(code)) {
      if (code && !pendingCodes.has(code)) { hidden.noProject++; continue; }
      card.blocked = code ? "Push this project's brief first." : `Project Code "${clean(f["Project Code"])}" isn't a valid code.`;
      cards.push(card);
      continue;
    }

    const rows = coll.byCode.get(code) || [];
    const free = rows.filter(isFree);
    const legacy = approved ? rows.filter(isLegacy) : [];
    if (isClosed(code) && !free.length) { hidden.closed++; continue; }
    card.targets = [...free.map(row => ({ id: row.id, row, action: "attach" })),
                    ...legacy.map(row => ({ id: row.id, row, action: "link" }))];
    card.canCreate = true;
    card.existing = rows.length;
    if (!projects(code).some(u => u.par)) card.noNew = "Add this project's PAR to the Universe first.";
    else if (card.amount === null) card.noNew = "The request has no Amount.";
    if (!reqNo) card.blocked = "No request number to copy.";
    fresh.push({ card, free, legacy });
    cards.push(card);
  }

  // Each request takes at most one existing row and each row at most one request,
  // best fits first. An invoiced row with no request number and exactly the
  // request's amount (as filed, or VAT-ex) was recorded by hand before requests
  // were tracked: it is that invoice (ties go to the request completed closest to
  // the row's Invoice Date, then the older request). Then rows waiting in For
  // Invoicing: the same currency first, then the closest amount.
  const pairs = [];
  for (const x of fresh) {
    const c = x.card;
    for (const row of x.legacy) {
      if (c.amount === null || row.currency !== c.currency) continue;
      if (!near(row.amount, c.amount) && !near(row.amount, round2(c.amount / rules.vatDivisor))) continue;
      const gap = row.invoiceDate && c.completedAt ? Math.abs(row.invoiceDate - c.completedAt) / DAY_MS / 1e4 : 0.5;
      pairs.push({ x, row, score: gap + (c.submittedAt || 0) / 1e16, link: true });
    }
    for (const row of x.free) pairs.push({ x, row, score: 1 + fitScore(row, c) });
  }
  pairs.sort((a, b) => a.score - b.score);
  const taken = new Set(), placed = new Map();
  for (const p of pairs) {
    if (taken.has(p.row.id) || placed.has(p.x)) continue;
    taken.add(p.row.id);
    placed.set(p.x, p);
    p.x.card.target = p.row.id;
  }
  for (const x of fresh) {
    const c = x.card, p = placed.get(x);
    if (p && p.link) {
      c.notes.push(`“${p.row.arName}” (${moneyOf(p.row)}, ${p.row.status}) is most likely this invoice: it has ` +
                   "the same amount and was recorded without a request number.");
    } else if (p) {
      if (c.amount !== null && (!near(p.row.amount, c.amount, 0.005) || (c.currency && p.row.currency !== c.currency))) {
        c.notes.push(`“${p.row.arName}” is ${moneyOf(p.row)}; it becomes the request's ${moneyOf(c)}.`);
      }
    } else {
      const left = x.legacy.filter(e => !taken.has(e.id));
      if (left.length) {
        c.notes.push(`Collections has ${left.length} older row${left.length === 1 ? "" : "s"} for this project ` +
                     `without a request number (${left.slice(0, 2).map(e => `“${e.arName}” ${moneyOf(e)}`).join(", ")}` +
                     `${left.length > 2 ? ", …" : ""}). Check this invoice isn't one of them.`);
      }
      if (c.noNew && !c.blocked) c.blocked = c.noNew;
    }
  }

  // A withdrawn request's row goes back to For Invoicing, unless a new request is taking it.
  for (const w of withdrawn) {
    const row = w.targets[0].row;
    const taker = cards.find(c => c.target === row.id);
    if (taker) {
      taker.notes.push(`It replaces request ${w.requestNo} (${w.status.toLowerCase()}) on “${row.arName}”.`);
      hidden.void++;
      continue;
    }
    cards.push(w);
  }

  // Won projects (with a PAR) that have no Collections row and no request on its way.
  const busy = new Set(cards.map(c => c.code).filter(Boolean));
  const seen = new Set();
  for (const u of uni.rows) {
    if (!rules.wonStatuses.includes(u.status) || !u.par) continue;
    const codes = [...new Set(allCodes(u.codeText))];
    // Any row counts, Invalid included: that's how a won project is kept out of Collections.
    if (!codes.length || codes.some(c => coll.byCode.has(c) || busy.has(c) || seen.has(c))) continue;
    codes.forEach(c => seen.add(c));
    if (u.ignored) { hidden.ignored++; continue; }
    const code = codes[0];
    const dates = requestNos(u.par).map(n => requestDate(n, rules.utcOffsetHours)).filter(d => d !== null);
    const card = {
      kind: "invoice", id: u.id, record: null, source: "universe", ignoreField: rules.universeIgnoreField,
      step: "won", code, name: u.project, status: u.status, requestNo: "",
      submittedAt: dates.length ? Math.max(...dates) : null,
      amount: u.amountInc ? round2(u.amountInc) : null, currency: "PHP", businessUnit: u.businessUnit,
      targets: [], target: "new", canCreate: true, noNew: "", notes: [], blocked: "",
    };
    if (card.amount === null) card.blocked = card.noNew = "The Universe row has no amount yet.";
    if (projects(code).length > 1) card.notes.push(`${projects(code).length} Universe rows share ${code}; this uses “${u.project}”.`);
    cards.push(card);
  }

  cards.sort(bySubmittedDesc);
  return { cards, hidden };
}

/* What pushing a Collections card writes. `choices` = { targetId, arName, invalid }
   (`invalid`: a new row marked Invalid, for a won project that shouldn't be billed);
   `options` = Collections' select options, so values never invent new ones.
   Returns { mode: "create" | "update", rowId, action, fields, before, expect }:
   `fields` in Lark's write format (null clears a cell), `before` the row's
   current values of those fields, `expect` what the row must still say when
   the push happens (else someone changed it meanwhile). */
export function collectionsChange(card, choices, options, rules) {
  const invalid = !!choices.invalid && card.step === "won";
  const to = invalid ? rules.invalidStatuses[0] : stepStatus(card.step, rules);
  const t = invalid ? null : card.targets.find(x => x.id === (choices.targetId || card.target)) || null;
  const currency = matchOption(card.currency, options["Currency"]);
  if (!t) {
    const out = { "AR Name": (choices.arName || "").trim() || card.name, "Project Code": card.code };
    if (card.amount !== null) out["Invoice Amount"] = card.amount;
    if (currency) out["Currency"] = currency;
    if (card.requestNo) out["Invoice Request"] = Number(card.requestNo);
    out["Status"] = to;
    const bu = matchOption(card.businessUnit, options["Business Unit"]);
    if (bu) out["Business Unit"] = bu;
    return { mode: "create", rowId: null, action: "create", fields: out, before: {}, expect: null };
  }
  const row = t.row, out = {};
  if (t.action === "reset") {
    out["Invoice Request"] = null;
    if (row.status !== to) out["Status"] = to;
  } else if (t.action === "link") {
    out["Invoice Request"] = Number(card.requestNo);
  } else {
    if (row.ir !== card.requestNo) out["Invoice Request"] = Number(card.requestNo);
    if (row.status !== to) out["Status"] = to;
    // The row takes the request's amount and currency: For Invoicing rows start as the
    // Universe's PHP amount, and the invoice as filed or issued may differ from that.
    if (card.step === "filed" || card.step === "approved") {
      if (card.amount !== null && !near(row.amount, card.amount, 0.005)) out["Invoice Amount"] = card.amount;
      if (currency && currency !== row.currency) out["Currency"] = currency;
    }
  }
  const was = { "Invoice Request": row.ir ? Number(row.ir) : null, "Status": row.status || null,
                "Invoice Amount": row.amount, "Currency": row.currency || null };
  return { mode: "update", rowId: row.id, action: t.action, fields: out,
           before: Object.fromEntries(Object.keys(out).map(k => [k, was[k]])),
           expect: { status: row.status, ir: row.ir } };
}

/* ======================= read-back verification ======================= */

/* Compare what was written (write format) with the record Lark returns (read
   format). Returns [{field, want, got}] for every field that didn't land as sent. */
export function verifyWritten(expected, actualFields) {
  const bad = [];
  for (const [name, want] of Object.entries(expected)) {
    const got = (actualFields || {})[name];
    if (!sameValue(want, got)) bad.push({ field: name, want: show(want), got: show(got) });
  }
  return bad;
}

function sameValue(want, got) {
  if (want === null) return got === null || got === undefined || got === "" || (Array.isArray(got) && !got.length);
  const isObj = (x) => x !== null && typeof x === "object";
  if (Array.isArray(want) && want.every(x => typeof x === "string")) {   // multi-select: compare the option names
    const names = (a) => (Array.isArray(a) ? a : isObj(a) && Array.isArray(a.value) ? a.value : [])
      .map(x => (typeof x === "string" ? x : plain(x))).filter(Boolean).sort().join("\n");
    return names(want) === names(got);
  }
  if (isObj(want) && !Array.isArray(want) && "link" in want) return isObj(got) && got.link === want.link;   // URL
  if (Array.isArray(want) && want.every(x => isObj(x) && "file_token" in x)) {   // attachments: compare tokens
    const toks = (a) => (Array.isArray(a) ? a : []).map(x => isObj(x) && x.file_token).filter(Boolean).sort().join(",");
    return toks(want) === toks(got);
  }
  if (Array.isArray(want)) {                                    // people: compare ids
    const ids = (a) => (Array.isArray(a) ? a : []).map(u => u && u.id).filter(Boolean).sort().join(",");
    return ids(want) === ids(got);
  }
  if (typeof want === "number") return typeof got === "number" && Math.abs(got - want) < 0.005;
  if (typeof want === "boolean") return (got === true) === want;
  return clean(got) === String(want).replace(/\r\n?/g, "\n").trim();
}

function show(v) {
  if (v === null || v === undefined) return "(empty)";
  if (Array.isArray(v) && v.every(u => u && typeof u === "object" && "id" in u)) {
    return v.map(u => u.name || u.id).join(", ") || "(empty)";
  }
  if (typeof v === "number") return String(v);
  return plain(v) || "(empty)";
}

/* ======================= the Collections view ======================= */

/* One Collections record as a table row. */
export function collectionRow(r) {
  const f = r.fields || {};
  return {
    id: r.record_id,
    arName: clean(f["AR Name"]),
    code: clean(f["Project Code"]),
    amount: num(f["Invoice Amount"]),
    currency: clean(f["Currency"]),
    remarks: clean(f["Sales Remarks"]),
    status: clean(f["Status"]),
    am: people(Array.isArray(f["AM"]) ? f["AM"] : (f["AM"] && f["AM"].value) || (f["AM"] && f["AM"].users) || []),
    request: num(f["Invoice Request"]) === null ? "" : String(Math.round(f["Invoice Request"])),
    invoiceNo: clean(f["Invoice Number"]),
    siNo: clean(f["SI Number"]),
    invoiceDate: num(f["Invoice Date"]),
    files: (Array.isArray(f["Invoice"]) ? f["Invoice"] : []).filter(a => a && a.file_token)
      .map(a => ({ file_token: a.file_token, name: a.name || "file", size: a.size || 0 })),
  };
}

/* Invoice numbers sort by their number part ("INV-1670" after "INV-0177"); rows
   without one go last. */
const invNo = (s) => { const m = String(s || "").match(/\d+/g); return m ? Number(m[m.length - 1]) : null; };
export function compareInvoiceNo(a, b, dir = 1) {
  const x = invNo(a), y = invNo(b);
  if (x === null || y === null) return (x === null) - (y === null);
  return dir * (x - y) || dir * String(a).localeCompare(String(b));
}

/* Collections grouped by Status (in the column's option order), each group sorted
   by Invoice Number. `query` searches every column (see matchesQuery). */
export function collectionsView(records, { statusOrder = [], sort = "desc", query = "" } = {}) {
  const rows = records.filter(r => matchesQuery(r.fields, query)).map(collectionRow);
  const byStatus = new Map();
  for (const r of rows) {
    if (!byStatus.has(r.status)) byStatus.set(r.status, []);
    byStatus.get(r.status).push(r);
  }
  const order = [...statusOrder, ...[...byStatus.keys()].filter(s => s && !statusOrder.includes(s)), ""];
  const dir = sort === "asc" ? 1 : -1;
  const groups = order.filter(s => byStatus.has(s)).map(status => ({
    status, rows: byStatus.get(status).sort((a, b) => compareInvoiceNo(a.invoiceNo, b.invoiceNo, dir) || a.arName.localeCompare(b.arName)),
  }));
  return { groups, count: rows.length };
}

/* Only the invoice details that changed, in Lark's write format. `files` are the
   attachments to keep plus newly uploaded ones ({file_token}). */
export function invoiceDetailsPatch(row, edit) {
  const out = {};
  const text = (k, before, after) => { if ((after || "").trim() !== (before || "")) out[k] = (after || "").trim() || null; };
  text("Invoice Number", row.invoiceNo, edit.invoiceNo);
  text("SI Number", row.siNo, edit.siNo);
  if ((edit.invoiceDate || null) !== (row.invoiceDate || null)) out["Invoice Date"] = edit.invoiceDate || null;
  const keep = (edit.files || []).map(f => f.file_token);
  if (keep.join(",") !== row.files.map(f => f.file_token).join(",")) out["Invoice"] = keep.map(t => ({ file_token: t }));
  return out;
}

/* The cells of `patch` (Invoice Number, SI Number, Invoice Date, Invoice) that someone
   changed in Lark since `loaded` (the row as the list showed it, collectionRow format):
   compare it with the record just re-read. Empty when it's still safe to write. */
export function invoiceChangedSince(patch, loaded, nowRecord) {
  const now = collectionRow(nowRecord);
  const tokens = (files) => files.map(f => f.file_token).join(",");
  const out = [];
  if ("Invoice Number" in patch && now.invoiceNo !== loaded.invoiceNo) out.push("Invoice Number");
  if ("SI Number" in patch && now.siNo !== loaded.siNo) out.push("SI Number");
  if ("Invoice Date" in patch && (now.invoiceDate || null) !== (loaded.invoiceDate || null)) out.push("Invoice Date");
  if ("Invoice" in patch && tokens(now.files) !== tokens(loaded.files)) out.push("Invoice");
  return out;
}

/* ======================= the row editor: any cell of a row, changed by hand =======================

   A row opened from the Universe, Collections or ANDON table can have any typed
   cell changed. What Lark computes (formulas, lookups, links, auto fields) and
   types the page can't write are shown but not editable. Values are kept in Lark's
   write format; an attachment is the list of files it will hold ({file_token,
   name, size}; a file picked but not uploaded yet has no token). */

const EDIT_TYPES = new Set([1, 2, 3, 4, 5, 7, 11, 15, 17]);
export const canEditField = (def) => !!def && EDIT_TYPES.has(def.type);

/* A cell as Lark reads it → the value the editor holds (write format; null = empty). */
export function writeValueOf(def, v) {
  const type = def ? def.type : 1;
  if (type === 1 || type === 3) return clean(v) || null;
  if (type === 2) return numOf(v);
  if (type === 4) {
    const list = (Array.isArray(v) ? v : []).map(x => (typeof x === "string" ? x : plain(x))).filter(Boolean);
    return list.length ? list : null;
  }
  if (type === 5) return num(v);
  if (type === 7) return v === true;
  if (type === 11) { const ids = people(v).map(u => ({ id: u.id })); return ids.length ? ids : null; }
  if (type === 15) {
    if (!v) return null;
    const link = typeof v === "object" ? String(v.link || "") : String(v);
    return link ? { link, text: (typeof v === "object" && v.text) || link } : null;
  }
  if (type === 17) {
    const files = (Array.isArray(v) ? v : []).filter(f => f && (f.file_token || f.name))
      .map(f => ({ file_token: f.file_token, name: f.name || "file", size: f.size || 0 }));
    return files.length ? files : null;
  }
  return v === undefined ? null : v;
}

/* One string per value, so two values compare equal when Lark would hold the same
   thing (people by id, files by token, multi-select in any order). */
export function editKey(w) {
  if (w === null || w === undefined) return "";
  if (Array.isArray(w)) {
    return w.map(x => (typeof x === "string" ? x : x.id || x.file_token || `new:${x.name}`)).sort().join("\u0001");
  }
  if (typeof w === "object") return "link" in w ? `${w.link}\u0001${w.text || ""}` : JSON.stringify(w);
  if (typeof w === "string") return w.replace(/\r\n?/g, "\n").trim();
  return String(w);
}

/* The cells the editor changes: `choices.edits` ({field: value}, an attachment's
   value being the files it keeps) plus `choices.files` (new files, [{field, name,
   size, file_token?}]), compared with the row as it was opened (`loaded`, read
   format). Only real changes are returned, in the editor's format. */
export function editChanges(defs, loaded, choices) {
  const byName = new Map((defs || []).map(d => [d.field_name, d]));
  const edits = choices.edits || {}, fresh = choices.files || [];
  const out = {};
  for (const k of new Set([...Object.keys(edits), ...fresh.map(f => f.field)])) {
    const def = byName.get(k);
    if (!canEditField(def)) continue;
    const was = writeValueOf(def, (loaded || {})[k]);
    let v = k in edits ? edits[k] : was;
    if (def.type === 17) {
      const add = fresh.filter(f => f.field === k).map(f => ({ file_token: f.file_token, name: f.name, size: f.size || 0 }));
      v = [...(v || []), ...add];
      if (!v.length) v = null;
    }
    if (typeof v === "string") v = v.replace(/\r\n?/g, "\n").trim() || null;
    if (Array.isArray(v) && !v.length) v = null;
    if (editKey(v) !== editKey(was)) out[k] = v;
  }
  return out;
}

/* The changes as Lark takes them: attachments by file_token only (every file must
   have uploaded by now). */
export function editWrite(changes, defs) {
  const byName = new Map((defs || []).map(d => [d.field_name, d]));
  const out = {};
  for (const [k, v] of Object.entries(changes)) {
    const def = byName.get(k);
    if (def && def.type === 17 && Array.isArray(v)) {
      const missing = v.find(f => !f.file_token);
      if (missing) throw Object.assign(new Error("not uploaded"), { userMessage: `“${missing.name}” hasn't uploaded. Try again.` });
      out[k] = v.map(f => ({ file_token: f.file_token }));
    } else {
      out[k] = v;
    }
  }
  return out;
}

/* Before writing: compare the row as it was opened (`loaded`) with the row as Lark
   has it now. `stale` = cells being changed that someone else changed meanwhile (to
   something other than what this edit writes): nothing may be written. `done` =
   true when Lark already holds every value this edit writes. */
export function editCheck(write, defs, loaded, now) {
  const byName = new Map((defs || []).map(d => [d.field_name, d]));
  const stale = [];
  let same = 0;
  for (const [k, v] of Object.entries(write)) {
    const def = byName.get(k);
    const before = editKey(writeValueOf(def, (loaded || {})[k])), after = editKey(writeValueOf(def, (now || {})[k]));
    if (after === editKey(v)) { same++; continue; }
    if (after !== before) stale.push(k);
  }
  return { stale, done: same === Object.keys(write).length };
}

/* ======================= drafts (kept across a reload) ======================= */

/* What was typed in a push sheet that was cancelled or interrupted, with the
   client_token of the create, so a reload-then-retry can't add a second row.
   Files can't be kept (they're in memory), nor can maps and sets; the rest is JSON. */
const DRAFT_TTL_MS = 7 * 24 * 3600 * 1000;
const DRAFT_MAX = 50;

export function draftsToJSON(drafts, now = Date.now()) {
  const keep = (k, v) => (k === "files" ? [] : v instanceof Map || v instanceof Set ? undefined : v);
  const items = {};
  const newest = [...drafts].sort((a, b) => ((b[1] && b[1].at) || now) - ((a[1] && a[1].at) || now)).slice(0, DRAFT_MAX);
  for (const [key, d] of newest) {
    if (!d || !d.clientToken) continue;
    items[key] = { at: d.at || now, clientToken: d.clientToken, targetId: d.targetId || null,
                   choices: JSON.parse(JSON.stringify(d.choices || {}, keep)) };
  }
  return { v: 1, items };
}

/* The drafts worth restoring, as [key, draft] pairs: valid, and under a week old. */
export function draftsFromJSON(data, now = Date.now()) {
  const out = [];
  if (!data || data.v !== 1 || !data.items || typeof data.items !== "object") return out;
  for (const [key, d] of Object.entries(data.items)) {
    if (!d || typeof d.clientToken !== "string" || !d.clientToken || !d.choices || typeof d.choices !== "object") continue;
    if (!(now - d.at <= DRAFT_TTL_MS)) continue;
    out.push([key, { at: d.at, clientToken: d.clientToken, targetId: d.targetId || null, choices: d.choices }]);
  }
  return out;
}

/* ---------------------------------------------------------------- the push queue */
/* Pushes waiting in the queue (js/queue.js), kept in this browser (polaris.queue)
   so a re-login, which reloads the page, doesn't lose them. Finished ones aren't
   kept. A push that was running when the page closed may have landed: it comes
   back as "checking", so the page looks at Lark before anything is sent again.
   Files that hadn't uploaded can't be kept (they're in memory): the item is
   marked lostFiles and fails with a sentence instead of running without them. */
const QUEUE_STATES = new Set(["waiting", "running", "checking", "failed"]);
const QUEUE_TTL_MS = 2 * 24 * 3600 * 1000;

export function queueToJSON(items, now = Date.now()) {
  let lost = false;
  const keep = (k, v) => {
    if (v instanceof Map || v instanceof Set) return undefined;
    if (k === "files" && Array.isArray(v)) {
      return v.map(f => {
        if (!f.file_token) lost = true;
        return f.file_token ? { name: f.name, size: f.size, file_token: f.file_token } : { name: f.name, size: f.size };
      });
    }
    return v;
  };
  const out = [];
  for (const it of items) {
    if (!it || !QUEUE_STATES.has(it.state) || !it.job || !it.job.clientToken) continue;
    lost = false;
    const job = JSON.parse(JSON.stringify(it.job, keep));
    out.push({
      id: it.id, key: it.key, kind: it.kind, cardId: it.cardId, step: it.step || "", code: it.code || "", name: it.name || "",
      verb: it.verb || "", table: it.table, rowId: it.rowId || null, fields: it.fields || {}, names: it.names || {},
      job, state: it.state === "running" ? "checking" : it.state, error: it.error || "",
      lostFiles: !!it.lostFiles || lost, at: it.at || now,
    });
  }
  return { v: 1, items: out };
}

export function queueFromJSON(data, now = Date.now()) {
  if (!data || data.v !== 1 || !Array.isArray(data.items)) return [];
  return data.items.filter(it => it && typeof it.key === "string" && it.job && typeof it.job.clientToken === "string"
                                 && it.job.choices && typeof it.job.choices === "object"
                                 && QUEUE_STATES.has(it.state) && now - it.at <= QUEUE_TTL_MS)
    .map(it => ({ ...it, state: it.state === "running" ? "checking" : it.state }));
}

/* ---------------------------------------------------------------- a cell as text */
/* Any cell, in Lark's read format or as a push writes it, as the text a person
   reads: people by name, dates as the Manila day, amounts with separators (₱ for
   PHP columns), files by name. Lookups and formulas arrive as {type, value: [...]}
   where `type` is the looked-up column's own type, so they're formatted by it
   (a date lookup reads as a date, not a number). `def` is the column ({field_name,
   type, property}); `nameOf(id)` names a person the cell only has the id of. */
const CELL_PEOPLE = new Set([11, 1003, 1004]);
const isRichText = (v) => Array.isArray(v) && v.length > 0
  && v.every(x => x && typeof x === "object" && typeof x.type === "string" && typeof x.text === "string");

export function cellText(def, v, { nameOf = () => "", offsetHours = 8 } = {}) {
  if (isBlank(v)) return "";
  const type = def ? def.type : 0, name = def ? def.field_name : "";
  if (v && typeof v === "object" && !Array.isArray(v) && "value" in v) {      // lookup / formula
    return cellText({ ...def, type: typeof v.type === "number" ? v.type : 0 }, Array.isArray(v.value) ? v.value : [v.value],
                    { nameOf, offsetHours });
  }
  if (isRichText(v)) return plain(v);
  if (Array.isArray(v) && (CELL_PEOPLE.has(type) || v.some(x => x && typeof x === "object" && x.id && !x.file_token))) {
    return v.map(u => (u && (u.name || nameOf(u.id))) || "").filter(Boolean).join(", ");
  }
  if (type === 17 && Array.isArray(v)) {
    const named = v.map(f => f && f.name).filter(Boolean);
    return named.length === v.length ? named.join(", ") : `${v.length} file${v.length === 1 ? "" : "s"}`;
  }
  const formatter = (def && def.property && def.property.formatter) || "";
  const one = (x) => {
    if (x === null || x === undefined || x === "") return "";
    if (typeof x === "boolean") return x ? "Yes" : "";
    if (typeof x === "number") {
      if (type === 5 || type === 1001 || type === 1002) {
        return new Date(x + offsetHours * 3600000).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
      }
      if (/\(PHP\)/.test(name)) return "₱" + x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (formatter.includes(",") || /amount|value|price|cost|total/i.test(name)) return x.toLocaleString("en-US", { maximumFractionDigits: 2 });
      return String(Math.round(x * 100) / 100);
    }
    if (typeof x === "object") {
      if ("value" in x) return cellText(def, x, { nameOf, offsetHours });
      if ("link" in x) return x.text || x.link;
      return plain(x);
    }
    return String(x);
  };
  return (Array.isArray(v) ? v : [v]).map(one).filter(Boolean).join(", ");
}

/* ======================= attachments ======================= */
/* Where to fetch an attachment's bytes (through the proxy, as the person): the cell's
   own download address when Lark gave one, else Lark's media download with the
   Base's permission context, which an advanced-permission Base needs. */
export function attachmentRequest(file, tableId, api) {
  const endpoint = `${api}/drive/v1/medias/${encodeURIComponent(file.file_token)}/download`;
  if (typeof file.url === "string" && (file.url === endpoint || file.url.startsWith(`${endpoint}?`))) return file.url;
  return `${endpoint}?extra=${encodeURIComponent(JSON.stringify({ bitablePerm: { tableId } }))}`;
}
/* The fallback when Lark won't hand the bytes to the proxy: ask for a temporary
   download link (valid about a day) instead. */
export function attachmentLinkRequest(file, tableId, api) {
  const base = `${api}/drive/v1/medias/batch_get_tmp_download_url`;
  if (typeof file.tmp_url === "string" && file.tmp_url.startsWith(`${base}?`)) return file.tmp_url;
  return `${base}?file_tokens=${encodeURIComponent(file.file_token)}&extra=${encodeURIComponent(JSON.stringify({ bitablePerm: { tableId } }))}`;
}
export function attachmentLink(json, fileToken) {
  const urls = (json && json.data && json.data.tmp_download_urls) || [];
  const hit = urls.find(u => u && u.file_token === fileToken) || (urls.length === 1 ? urls[0] : null);
  const link = hit && typeof hit.tmp_download_url === "string" ? hit.tmp_download_url : "";
  return /^https:\/\//.test(link) ? link : "";
}

/* ======================= PM: the same in the Universe and ANDON ======================= */
/* A project in both the Universe and ANDON whose Universe PM (rules.pmSync.universe)
   and ANDON PM (LEAD) (rules.pmSync.andon, in every ANDON row with its code) differ,
   or where either is blank, gets an Audit card. The card suggests ANDON's PM (it's
   Project Management's board), else the Universe's. A table without its PM column
   (in `fields`) gives no cards. `loaded` keeps each PM cell as the card saw it, so
   the push can tell if it changed in Lark meanwhile. */
export function pmCards(universe, andon, rules, { fields = {}, hide, tags, tagField } = {}) {
  const cfg = rules.pmSync;
  const out = { cards: [], tagged: [], hidden: 0 };
  if (!cfg) return out;
  const has = (table, col) => !fields[table] || fields[table].some(f => f.field_name === col);
  if (!has("universe", cfg.universe) || !has("andon", cfg.andon)) return out;
  const byCode = new Map();
  for (const r of andon || []) {
    const code = normCode(plain((r.fields || {})["Project Code"]));
    if (code) byCode.set(code, [...(byCode.get(code) || []), r]);
  }
  const key = (list) => list.map(u => u.id).sort().join(",");
  for (const row of universe || []) {
    const f = row.fields || {};
    const code = normCode(plain(f["Project Code"]));
    const rows = code && byCode.get(code);
    if (!rows) continue;
    const uPm = people(f[cfg.universe]);
    const aPms = rows.map(r => people((r.fields || {})[cfg.andon]));
    const blank = !uPm.length || aPms.some(p => !p.length);
    const differ = aPms.some(p => key(p) !== key(uPm));
    if (!blank && !differ) continue;
    const suggestion = (aPms.find(p => p.length) || uPm).slice(0, 1);
    sortOut({
      kind: "pm", id: `pm:${row.record_id}`, rowId: row.record_id, code,
      name: clean(f["Project"]) || clean((rows[0].fields || {})["Project"]), status: clean(f["Status"]),
      universePm: uPm, andonPm: aPms, andonRows: rows.map(r => r.record_id), blank, suggestion,
      loaded: { universe: { [cfg.universe]: f[cfg.universe] },
                andon: Object.fromEntries(rows.map(r => [r.record_id, { [cfg.andon]: (r.fields || {})[cfg.andon] }])) },
      submittedAt: null, notes: [], blocked: "",
      // Hidden on this device until either PM changes.
      hideKey: `pm:${row.record_id}|${key(uPm)}|${aPms.map(key).join("/")}`,
    }, f, { hide, tags, tagField }, out);
  }
  return byCodeDesc(out);
}

/* PM and CE cards are tagged on the project's Universe row (ANDON has no Tags column):
   a row marked with a custom tag sends its card to that tag's group (card.tag), one
   hidden on this device (card.hideKey in `hide`) is counted, the rest are listed. */
function sortOut(card, universeFields, { hide, tags, tagField }, out) {
  const tag = tagField && tags && tags.length ? customTagOf(universeFields, tagField, tags) : null;
  if (tag) { card.tag = tag; out.tagged.push(card); return; }
  if (hide && hide.has(card.hideKey)) { out.hidden++; return; }
  out.cards.push(card);
}
function byCodeDesc(out) {
  const order = (a, b) => b.code.localeCompare(a.code, "en", { numeric: true });
  out.cards.sort(order);
  out.tagged.sort(order);
  return out;
}

/* The cells a PM Fill writes: the chosen person (one) in both tables. */
export function pmWrites(person, rules) {
  const v = person && person.id ? [{ id: person.id }] : null;
  return { universe: { [rules.pmSync.universe]: v }, andon: { [rules.pmSync.andon]: v } };
}

/* ======================= the CE: the same link in the Universe and ANDON ======================= */
/* The link in a URL cell ({link, text}), or a text cell holding one; "" when blank. */
export function linkIn(v) {
  if (v && typeof v === "object" && !Array.isArray(v) && typeof v.link === "string") return v.link.trim();
  return clean(v);
}
// Compared without a trailing slash: the same sheet, pasted twice.
const sameLink = (a, b) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

/* A project in both the Universe and ANDON whose Universe CE (rules.ceSync.universe) and
   ANDON CE (rules.ceSync.andon, in every ANDON row with its code) aren't the same link,
   or where either is blank, gets an Audit card, like the PM's. The card suggests
   ANDON's link, else the Universe's; with both blank, the person pastes it. A table
   without its column (in `fields`) gives no cards. */
export function ceCards(universe, andon, rules, { fields = {}, hide, tags, tagField } = {}) {
  const cfg = rules.ceSync;
  const out = { cards: [], tagged: [], hidden: 0 };
  if (!cfg) return out;
  const has = (table, col) => !fields[table] || fields[table].some(f => f.field_name === col);
  if (!has("universe", cfg.universe) || !has("andon", cfg.andon)) return out;
  const byCode = new Map();
  for (const r of andon || []) {
    const code = normCode(plain((r.fields || {})["Project Code"]));
    if (code) byCode.set(code, [...(byCode.get(code) || []), r]);
  }
  for (const row of universe || []) {
    const f = row.fields || {};
    const code = normCode(plain(f["Project Code"]));
    const rows = code && byCode.get(code);
    if (!rows) continue;
    const uLink = linkIn(f[cfg.universe]);
    const aLinks = rows.map(r => linkIn((r.fields || {})[cfg.andon]));
    const blank = !uLink || aLinks.some(l => !l);
    const differ = aLinks.some(l => !sameLink(l, uLink));
    if (!blank && !differ) continue;
    sortOut({
      kind: "ce", id: `ce:${row.record_id}`, rowId: row.record_id, code,
      name: clean(f["Project"]) || clean((rows[0].fields || {})["Project"]), status: clean(f["Status"]),
      universeLink: uLink, andonLinks: aLinks, andonRows: rows.map(r => r.record_id), blank,
      suggestion: aLinks.find(Boolean) || uLink,
      loaded: { universe: { [cfg.universe]: f[cfg.universe] },
                andon: Object.fromEntries(rows.map(r => [r.record_id, { [cfg.andon]: (r.fields || {})[cfg.andon] }])) },
      submittedAt: null, notes: [], blocked: "",
      // Hidden on this device until either link changes.
      hideKey: `ce:${row.record_id}|${uLink}|${aLinks.join("/")}`,
    }, f, { hide, tags, tagField }, out);
  }
  return byCodeDesc(out);
}

/* The cells a CE Fill writes: the one link in both tables (URL columns take {link, text}). */
export function ceWrites(link, rules) {
  const v = link ? { link, text: link } : null;
  return { universe: { [rules.ceSync.universe]: v }, andon: { [rules.ceSync.andon]: v } };
}

/* A link a person typed: https only (so it opens), else "". */
export const validLink = (s) => (/^https:\/\/[^\s/]+\.[^\s]+$/i.test(String(s || "").trim()) ? String(s).trim() : "");
