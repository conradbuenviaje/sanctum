/* Offline checks of reading the weekly Mancom sheet (js/xlsx.js) and turning it into
   proposed changes (js/mancom.js). The workbook is built here, not a real one. Run: npm test */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTABILITY } from "../js/config.js";
import { readWorkbook, cellRef, xmlText } from "../js/xlsx.js";
import { weekOf, nickKey, matchKey, tabKind, sheetEntries, resolveNick, matchProject, mancomChanges, memoryFrom, changeLogValue } from "../js/mancom.js";

const CFG = ACCOUNTABILITY.mancom;
const te = new TextEncoder();

/* A minimal .xlsx: a zip (stored, or deflated with `deflate`) of the parts readWorkbook reads. */
async function makeXlsx(tabs, { deflate = false } = {}) {
  const shared = [];
  const si = (t) => { let i = shared.indexOf(t); if (i < 0) { i = shared.length; shared.push(t); } return i; };
  const col = (n) => { let s = ""; n++; while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const files = {};
  tabs.forEach((t, i) => {
    const rows = t.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => v === null || v === undefined ? "" :
      typeof v === "number" ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="s"><v>${si(v)}</v></c>`).join("")}</row>`).join("");
    files[`xl/worksheets/sheet${i + 1}.xml`] = `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
  });
  files["xl/workbook.xml"] = `<workbook><sheets>${tabs.map((t, i) => `<sheet name="${esc(t.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`;
  files["xl/_rels/workbook.xml.rels"] = `<Relationships>${tabs.map((t, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`;
  files["xl/sharedStrings.xml"] = `<sst>${shared.map(s => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`;
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    let data = te.encode(text);
    if (deflate) data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    const nameB = te.encode(name);
    const local = new Uint8Array(30 + nameB.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, deflate ? 8 : 0, true); lv.setUint32(18, data.length, true); lv.setUint16(26, nameB.length, true);
    local.set(nameB, 30);
    const cen = new Uint8Array(46 + nameB.length), cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, deflate ? 8 : 0, true); cv.setUint32(20, data.length, true);
    cv.setUint16(28, nameB.length, true); cv.setUint32(42, offset, true); cen.set(nameB, 46);
    parts.push(local, data); central.push(cen);
    offset += local.length + data.length;
  }
  const cenSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true);
  ev.setUint32(12, cenSize, true); ev.setUint32(16, offset, true);
  return new Uint8Array(await new Blob([...parts, ...central, end]).arrayBuffer());
}

/* The W45 layout, in small. */
const TABS = [
  { name: "Revenue - Moonton", rows: [
    ["Moonton — 2026 Target"], ["WEEKLY UPDATES — LIVE"],
    ["Week", "Project", "Client", "Status", "Amount (PHP)"],
    ["2026-10-16", "MPL PH S18 - Running Addendum", "Moonton", "WON", 1190427.19],
    [], ["BOARD REPORTED — LOCKED"],
    [null, "Project", null, null, "Amount (PHP)"],
    [null, "Evermalls Grassroots Tour", null, "Closed", 89285.23],
    [null, "Total (2)", null, null, 1279712.42],
  ] },
  { name: "RFP-RFQ - Pitch Pipeline", rows: [
    ["One row per RFP/RFQ pitch."],
    ["Project", "Client", "Est. Value (PHP)", "Notes", "Phase", "Owner"],
    ["Korea Tourism Travel Expo", "Korea Tourism Organization", 2565000, "Oct 22: R2", "3. Creative Development", "@Marcus Joaquin"],
    ["MPL PH S18 - Running Addendum", "Moonton Philippines", 1158752, "", "7. Won", "@Bopeep 🌸"],
  ] },
  { name: "Leads - BD Pipeline", rows: [
    ["BD", "AM", "Client", "Project Name", "Type", "Status"],
    ["Ella", "Carla", "ArenaSocial", "ArenaSocial Cafe Campaign", "RFP", "Won"],
    ["Kewen", "Shanna", "Mixue PH", "Mixue PH Mall Activation", "RFP", "7. RFP/RFQ Provided"],
    ["Ella", "", "BingoPlus", "", "RFP", "6. Deferred/Cancelled"],
  ] },
  { name: "Notes", rows: [["Project"], ["not a tab Sanctum reads"]] },
];

test("the .xlsx reader: tabs in order, cells by position, stored or deflated", async () => {
  for (const deflate of [false, true]) {
    const sheets = await readWorkbook(await makeXlsx(TABS, { deflate }));
    assert.deepEqual(sheets.map(s => s.name), TABS.map(t => t.name));
    assert.equal(sheets[0].rows[3][1], "MPL PH S18 - Running Addendum");
    assert.equal(sheets[0].rows[3][4], "1190427.19");
    assert.equal(sheets[1].rows[3][5], "@Bopeep 🌸");
    assert.deepEqual(sheets[0].rows[4], []);
  }
  await assert.rejects(readWorkbook(te.encode("not a zip at all")), /isn't an \.xlsx/);
  assert.deepEqual(cellRef("AB12"), { col: 27, row: 11 });
  assert.equal(xmlText("Tom &amp; Jerry &#8369;"), "Tom & Jerry ₱");
});

test("reading the tabs: each table, its project rows, the values each tab gives", async () => {
  const entries = sheetEntries(await readWorkbook(await makeXlsx(TABS)), CFG);
  assert.equal(weekOf("W45 - 4DX Management Scoreboard.xlsx"), "W45");
  assert.equal(weekOf("Week 7 scoreboard.xlsx"), "W7");
  assert.equal(tabKind("Revenue - Esports", CFG).tribe, "Esports");
  assert.equal(tabKind("Notes", CFG), null);
  const rev = entries.filter(e => e.kind === "revenue");
  assert.deepEqual(rev.map(e => e.project), ["MPL PH S18 - Running Addendum", "Evermalls Grassroots Tour"]);   // both tables; no Total
  assert.deepEqual(rev[0].values, { tribe: "Moonton" });
  assert.equal(rev[0].row, 4);
  const pitch = entries.find(e => e.kind === "pitch" && e.project.startsWith("Korea"));
  assert.deepEqual(pitch.values, { phase: "3. Creative Development", am: "@Marcus Joaquin" });
  const leads = entries.filter(e => e.kind === "leads");
  assert.equal(leads.length, 2);                                   // the row without a project name is left out
  assert.deepEqual(leads[0].values, { bd: "Ella", am: "Carla" });
});

test("nicknames: the saved ones, else the one person with that first (or whole) name", () => {
  assert.equal(nickKey("@Bopeep 🌸"), "bopeep");
  assert.equal(nickKey("  @Marcus  Joaquin "), "marcus joaquin");
  const pool = [{ id: "ou_s", name: "Shanna Mae Sacsi" }, { id: "ou_m1", name: "Marcus Joaquin Gonzales" }, { id: "ou_m2", name: "Marcus Lee" }];
  const aliases = { bopeep: { id: "ou_b", name: "Bea Peep", email: "" } };
  assert.equal(resolveNick("@Bopeep 🌸", aliases, pool).person.name, "Bea Peep");
  assert.equal(resolveNick("Shanna", aliases, pool).how, "guess");
  assert.equal(resolveNick("@Marcus Joaquin", aliases, pool).person.id, "ou_m1");
  assert.equal(resolveNick("Marcus", aliases, pool), null);       // two Marcuses: ask
  assert.equal(resolveNick("Ella", aliases, pool), null);
});

const rec = (id, fields) => ({ record_id: id, fields });
const UNI = [
  rec("u1", { "Project Code": "2026TEG-P0101", Project: "MPL PH S18 - Running Addendum", Client: "Moonton", "Mancom Phase": "5. Final Approval", AM: [{ id: "ou_old", name: "Old AM" }] }),
  rec("u2", { "Project Code": "2026TEG-P0102", Project: "KTO x Travel Tour Expo 2027", Client: "" }),
  rec("u3", { "Project Code": "2026TEG-P0103", Project: "Mixue PH Mall Activation", Client: "Mixue" }),
  rec("u4", { "Project Code": "2026TEG-P0104", Project: "Evermalls Grassroots Tour", Client: "SM" }),
];
const ANDON = [rec("a1", { "Project Code": "2026TEG-P0101", TRIBE: "NO TRIBE ASSIGNED" }), rec("a4", { "Project Code": "2026TEG-P0104", TRIBE: "TRIBE A - Moonton" })];
const FIELDS = {
  universe: [{ field_name: "Mancom Phase", type: 3, property: { options: ["1. Client Brief Kickoff", "3. Creative Development", "5. Final Approval", "7. Won"].map(name => ({ name })) } }],
  andon: [{ field_name: "TRIBE", type: 3, property: { options: ["NO TRIBE ASSIGNED", "TRIBE A - Moonton", "TRIBE B - Tencent"].map(name => ({ name })) } }],
};

test("matching a sheet project: remembered, else a clear best name match, else a person picks", () => {
  const e = { project: "MPL PH S18 - Running Addendum", client: "Moonton Philippines" };
  assert.equal(matchProject(e, UNI, new Map(), CFG).rowId, "u1");
  assert.equal(matchProject(e, UNI, new Map(), CFG).how, "suggested");
  const vague = matchProject({ project: "Korea Tourism Travel Expo", client: "" }, UNI, new Map(), CFG);
  assert.equal(vague.rowId, null);                                  // not clear enough: a person picks
  assert.equal(vague.candidates[0].rowId, "u2");
  const memory = new Map([[matchKey("Korea Tourism Travel Expo"), { rowId: "u2" }]]);
  assert.deepEqual(matchProject({ project: "Korea Tourism Travel Expo" }, UNI, memory, CFG).how, "remembered");
  assert.equal(matchKey("MPL PH  S18 – Running Addendum!"), matchKey("mpl ph s18 running addendum"));
});

test("the changes: tribe, phase, AM, BD and a blank client, against what Lark has, with where each came from", async () => {
  const entries = sheetEntries(await readWorkbook(await makeXlsx(TABS)), CFG);
  const pool = [{ id: "ou_carla", name: "Carla Reyes" }, { id: "ou_shanna", name: "Shanna Mae Sacsi" }, { id: "ou_kewen", name: "Kewen Sy" }];
  const aliases = { bopeep: { id: "ou_bopeep", name: "Bea Peep", email: "" } };
  const ctx = { universe: UNI, andon: ANDON, fields: FIELDS, aliases, pool, memory: new Map(), picks: { [matchKey("Korea Tourism Travel Expo")]: "u2" } };
  const res = mancomChanges(entries, ctx, CFG);
  const get = (code, field) => res.changes.find(c => c.code === code && c.field === field);
  // MPL S18: tribe from the Revenue tab (the placeholder counts as blank), phase and AM from the pitch.
  assert.deepEqual([get("2026TEG-P0101", "TRIBE").to, get("2026TEG-P0101", "TRIBE").kind], ["TRIBE A - Moonton", "fill"]);
  assert.deepEqual([get("2026TEG-P0101", "Mancom Phase").from, get("2026TEG-P0101", "Mancom Phase").to], ["5. Final Approval", "7. Won"]);
  const am = get("2026TEG-P0101", "AM");
  assert.deepEqual([am.from, am.to, am.kind, am.write], ["Old AM", "Bea Peep", "change", [{ id: "ou_bopeep" }]]);
  assert.deepEqual(am.sources, [{ tab: "RFP-RFQ - Pitch Pipeline", row: 4, value: "@Bopeep 🌸" }]);
  // The picked project: its phase, and its blank client filled.
  assert.equal(get("2026TEG-P0102", "Mancom Phase").to, "3. Creative Development");
  assert.equal(get("2026TEG-P0102", "Client").to, "Korea Tourism Organization");
  // Mixue: BD (Kewen, guessed) and AM (Shanna, guessed); its client isn't blank, so it stays.
  assert.equal(get("2026TEG-P0103", "BD").to, "Kewen Sy");
  assert.equal(get("2026TEG-P0103", "BD").guessed, true);
  assert.equal(get("2026TEG-P0103", "Client"), undefined);
  // Already right: Evermalls is in TRIBE A.
  assert.equal(get("2026TEG-P0104", "TRIBE"), undefined);
  // Who isn't known is asked, not guessed; only for rows matched to a project (Ella's row isn't).
  assert.deepEqual(res.unknown, ["marcus joaquin"]);
  assert.ok(res.changes.every(c => !c.conflict));
  // Skipping a project drops its changes.
  const skipped = mancomChanges(entries, { ...ctx, picks: { [matchKey("MPL PH S18 - Running Addendum")]: "" } }, CFG);
  assert.ok(!skipped.changes.some(c => c.code === "2026TEG-P0101"));
});

test("two rows of the sheet that disagree are a conflict, left for a person", () => {
  const entries = [
    { tab: "RFP-RFQ - Pitch Pipeline", row: 3, kind: "pitch", project: "Mixue PH Mall Activation", client: "", values: { am: "Shanna" } },
    { tab: "Leads - BD Pipeline", row: 9, kind: "leads", project: "Mixue PH Mall Activation", client: "", values: { am: "Carla" } },
  ];
  const pool = [{ id: "ou_carla", name: "Carla Reyes" }, { id: "ou_shanna", name: "Shanna Mae Sacsi" }];
  const res = mancomChanges(entries, { universe: UNI, andon: [], fields: FIELDS, aliases: {}, pool, memory: new Map(), picks: {} }, CFG);
  const am = res.changes.find(c => c.field === "AM");
  assert.equal(am.conflict, true);
  assert.equal(am.sources.length, 2);
});

test("remembered matches and the change log read and write as JSON rows", () => {
  const cols = { name: "Variable", value: "Value" };
  const rows = [
    rec("v1", { Variable: CFG.matchVariable, Value: JSON.stringify({ key: "kto expo", rowId: "u2", code: "2026TEG-P0102" }) }),
    rec("v2", { Variable: CFG.matchVariable, Value: "{broken" }),
    rec("v3", { Variable: "custom_tag", Value: "Hidden" }),
  ];
  const m = memoryFrom(rows, cols, CFG.matchVariable);
  assert.deepEqual([...m.keys()], ["kto expo"]);
  assert.equal(m.get("kto expo").id, "v1");
  const log = JSON.parse(changeLogValue({ table: "universe", recordId: "u1", code: "C1", project: "P", field: "AM", from: "A", to: "B",
    sources: [{ tab: "Leads - BD Pipeline", row: 7, value: "B" }] }, { by: "Brian", week: "W45", file: "W45.xlsx", at: 5 }));
  assert.deepEqual(log, { at: 5, by: "Brian", week: "W45", file: "W45.xlsx", table: "universe", recordId: "u1", code: "C1", project: "P",
    field: "AM", from: "A", to: "B", sources: ["Leads - BD Pipeline row 7"] });
});
