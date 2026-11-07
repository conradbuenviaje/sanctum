/* Offline checks of the transfer rules (js/sync.js). Run: npm test
   The fixtures copy shapes and quirks seen in the real tables. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { RULES } from "../js/config.js";
import {
  plain, normCode, allCodes, dayStart, vatExAmount, defaultVat, parAfterAdding, matchOption,
  indexUniverse, indexCollections, briefCards, parCards, collectionCards, collectionsChange,
  universeFromBrief, verifyWritten, similarity, vatMentions,
  peoplePool, universeView, shortName, andonFromBrief, collectionsView, collectionRow, invoiceDetailsPatch,
  auditCards, auditPatch, parseDay, fillPlan, invoiceChangedSince, draftsToJSON, draftsFromJSON, queueToJSON, queueFromJSON, cellText, parApprovals, approvalCards, pmCards, fileCards, attachmentRequest, attachmentLinkRequest, attachmentLink, isWonProject, auditMissing, monthOf,
  needsSignedCe, auditFilesMissing, isBlank,
  matchesQuery, andonView, canEditField, editChanges, editWrite, editCheck, editKey, writeValueOf,
  tagsOf, tagsWith, tagsWithout, variableColumns, customTagsFrom, customTagOf, tagGroups,
  isLostProject, requiredMessage, sourceView, statusChange,
  filterIndex, cardFacets, passesFilters, filterChoices, NONE, closestMatches,
  ceCards, ceWrites, linkIn, validLink, lookalikeTags, taggingView, UNTAGGED, pickTag,
} from "../js/sync.js";
import { writableOnly } from "../js/ops.js";

const seg = (text) => [{ type: "text", text }];
const url = (text, link = `https://applink.larksuite.com/x?instanceId=${text}`) => ({ link, text, type: "url" });
const user = (id, name) => ({ id, name, en_name: name, email: `${id}@x.com`, avatar_url: "" });
const rec = (id, fields) => ({ record_id: id, fields });

test("plain() flattens Lark read formats", () => {
  assert.equal(plain(seg("Hello")), "Hello");
  assert.equal(plain([{ type: "text", text: "DECK - " }, { type: "url", text: "https://a", link: "https://a" }]), "DECK - https://a");
  assert.equal(plain({ type: 1, value: [{ type: "text", text: "Lost" }] }), "Lost");
  assert.equal(plain([user("ou_1", "A"), user("ou_2", "B")]), "A, B");
  assert.equal(plain(url("202610080005")), "202610080005");
  assert.equal(plain(null), "");
});

test("project codes are pulled out of messy text", () => {
  assert.equal(normCode("2026TEG-P0286"), "2026TEG-P0286");
  assert.equal(normCode("2025TEG-P0313 "), "2025TEG-P0313");
  assert.equal(normCode("CE_2026TEG-P0091"), "2026TEG-P0091");
  assert.equal(normCode("CE-2026TEG-P0223"), "2026TEG-P0223");
  assert.equal(normCode("Project Code\n2024TEG-P0131"), "2024TEG-P0131");
  assert.equal(normCode("Project2024TEG-P0434"), "2024TEG-P0434");
  assert.equal(normCode("2026teg-p0001"), "2026TEG-P0001");
  assert.equal(normCode("P0432"), "");
  assert.equal(normCode("2026"), "");
  assert.deepEqual(allCodes("2025TEG-P0082, 2025TEG-P0128, 2025TEG-P0139"),
                   ["2025TEG-P0082", "2025TEG-P0128", "2025TEG-P0139"]);
});

test("dates become midnight Manila time", () => {
  // 2026-10-07 10:52 +08:00 → 2026-10-07 00:00 +08:00
  assert.equal(dayStart(1791341556036, 8), 1791302400000);
  // 2026-10-07 23:30 +08:00 stays on the 7th; 00:30 on the 8th moves to the 8th
  assert.equal(dayStart(1791302400000 + 23.5 * 3600000, 8), 1791302400000);
  assert.equal(dayStart(1791302400000 + 24.5 * 3600000, 8), 1791302400000 + 86400000);
});

test("Amount (VAT-Ex.) (PHP) follows the stated rule", () => {
  assert.equal(vatExAmount(1120000, "PHP", "12%", RULES), 1000000);           // ÷ 1.12
  assert.equal(vatExAmount(1500000, "PHP", "0%", RULES), 1500000);            // as filed
  assert.equal(vatExAmount(2200, "USD", "0%", RULES), 125400);                // × 57
  assert.equal(vatExAmount(45000, "USD", "12%", RULES), 2290178.57);          // × 57 ÷ 1.12, 2 dp
  assert.equal(vatExAmount(39564866.25, "PHP", "0%", RULES), 39564866.25);
  assert.equal(vatExAmount(1000, "PHP", "12%", RULES), 892.86);
  assert.equal(vatExAmount(null, "PHP", "12%", RULES), null);
  assert.equal(vatExAmount(100, "EUR", "0%", RULES), null);
  assert.equal(defaultVat("USD"), "0%");
  assert.equal(defaultVat("PHP"), "12%");
});

test("PAR numbers are appended, never duplicated", () => {
  assert.equal(parAfterAdding("", "202610080029"), "202610080029");
  assert.equal(parAfterAdding(seg("202607030034"), "202610080029"), "202607030034, 202610080029");
  assert.equal(parAfterAdding("202607030034, 202610080029", "202610080029"), null);
});

test("select options match loosely but write the option's own name", () => {
  const opts = ["PDEI-Event Service", "PDEI-Game Marketing", "PDEI-IP", "GG-Event Service"];
  assert.equal(matchOption("PDEI - Event Service", opts), "PDEI-Event Service");
  assert.equal(matchOption("GG - Event Service", opts), "GG-Event Service");
  assert.equal(matchOption("PDEI - Talent Service", opts), null);
  assert.equal(matchOption("", opts), null);
});

/* ---------- a small world: Universe, Collections, sources ---------- */

const universe = [
  rec("recU1", { "Project Code": seg("2026TEG-P0240"), "Project": seg("FUNaloMAX Social Media"), "PAR": seg("202606010001") }),
  rec("recU2", { "Project Code": seg("2025TEG-P0313 "), "Project": seg("OKGames Barangay Caravan") }),
  rec("recU3", { "Project Code": seg("2026TEG-P0092"), "Project": seg("Color Game (CasinoPlus PH Rebranding)") }),
  rec("recU4", { "Project Code": seg("2026TEG-P0092"), "Project": seg("MPGL 2026") }),
  rec("recU5", { "Project Code": seg("2026TEG-P0098"), "Project": seg("RaizeSquad GG Truck Rental") }),
  rec("recU6", { "Project Code": seg("2026TEG-P0036"), "Project": seg("GG Truck KIS4 HoK") }),
];
const collections = [
  rec("recC1", { "Project Code": seg("2026TEG-P0240"), "Invoice Request": 202609010001, "AR Name": seg("FUNaloMAX DP"),
                 "Invoice Amount": 100, "Currency": "PHP" }),
  rec("recC2", { "Project Code": seg("2026TEG-P0036"), "AR Name": seg("GG Truck KIS4 HoK Full Payment"),
                 "Invoice Amount": 62500, "Currency": "PHP" }),          // legacy row: no request number, VAT-ex amount
  rec("recC3", { "Project Code": seg("2026TEG-P0098"), "AR Name": seg("RaizeSquad Full Payment"),
                 "Invoice Amount": 18303.57, "Currency": "PHP" }),       // legacy row, different amount
];
const brief = (id, code, extra = {}) => rec(id, {
  "Request No.": url(`2026100800${id.slice(-2)}`), "Project Code": seg(code), "Project Name": seg(`Project ${code}`),
  "Initiator department": seg("Account Managers"), "Status": "Approved", "Submitted at": 1791341556036,
  "Contract Value": 1120000, "Contract Value-Currency": "PHP", ...extra,
});
const briefs = [
  brief("recB01", "2026TEG-P0286", { "Submitted at": 1791400000000 }),
  brief("recB02", "2026TEG-P0240"),                                              // already in Universe
  brief("recB03", "2025TEG-P0313"),                                              // in Universe with trailing space
  brief("recB04", "2026TEG-P0300", { "IGNORE": true }),
  brief("recB05", "2026TEG-P0301", { "Initiator department": seg("Finance") }),
  brief("recB09", "2025TEG-P0110", { "Initiator department": seg("Sales"), "Submitted at": 1700000000001 }),   // Account Managers' old name
  brief("recB06", "2026TEG-P0302", { "Status": "Rejected" }),
  brief("recB07", "2026TEG-P0093", { "Project Name": seg("Color Game (CasinoPlus PH Rebranding & After Party)"),
                                     "Submitted at": 1700000000000 }),
  brief("recB08", "2026TEG-P0098", { "Request No.": url("202604150001") }),
];

test("brief cards: scope, filters and newest first", () => {
  const uni = indexUniverse(universe);
  const { cards, hidden } = briefCards(briefs, uni, RULES);
  // "Sales" (Account Managers' old name) counts; other departments don't.
  assert.deepEqual(cards.map(c => c.code), ["2026TEG-P0286", "2025TEG-P0110", "2026TEG-P0093"]);
  assert.deepEqual(hidden, { otherDept: 1, ignored: 1, done: 3, void: 1, noProject: 0 });
  assert.equal(cards[2].similar.code, "2026TEG-P0092");      // likely re-filing flagged
  assert.equal(cards[0].similar, null);
});

test("PAR cards: linked brief beats a typo'd code; pending briefs block; shared codes flagged", () => {
  const uni = indexUniverse(universe);
  const pending = new Set(["2026TEG-P0286"]);
  const par = (id, req, fields) => rec(id, { "Request No.": url(req), "Status": "Approved", "Submitted at": 1, ...fields });
  const pars = [
    par("recP1", "202606010001", { "Project Code": seg("2026TEG-P0240") }),                             // already recorded
    par("recP2", "202610080029", { "Project Code": seg("2025TEG-P0098"),                               // typo: year
                                   "Associated Project Brief": seg("202604150001-Someone-Project Brief-2026-04-15") }),
    par("recP3", "202610080030", { "Project Code": seg("2026TEG-P0286") }),                             // brief pending
    par("recP4", "202610080031", { "Project Code": seg("2023TEG-P0001") }),                             // project not in Universe
    par("recP5", "202610080032", { "Project Code": seg("2026TEG-P0092"), "Project Name": seg("MPGL 2026") }),
    par("recP6", "202610080033", { "Project Code": seg("2026TEG-P0240"), "IGNORE": true }),
  ];
  const { cards, hidden } = parCards(pars, briefs, uni, pending, RULES);
  const by = Object.fromEntries(cards.map(c => [c.id, c]));
  assert.deepEqual(Object.keys(by).sort(), ["recP2", "recP3", "recP5"]);
  assert.equal(by.recP2.code, "2026TEG-P0098");
  assert.equal(by.recP2.target.id, "recU5");
  assert.match(by.recP2.notes[0], /differs/);
  assert.equal(by.recP3.blocked, "Push this project's brief first.");
  assert.equal(by.recP5.targets.length, 2);
  assert.equal(by.recP5.target.id, "recU4");                  // best name match among rows sharing the code
  assert.deepEqual(hidden, { otherDept: 0, ignored: 1, done: 1, void: 0, noProject: 1 });
});

/* ---------- Collections: the invoice lifecycle ---------- */

const formula = (n) => ({ type: 2, value: [n] });
const lookup = (s) => ({ type: 3, value: [s] });
const proj = (id, code, status, extra = {}) => rec(id, {
  "Project Code": seg(code), "Project": seg(`Project ${code.slice(-4)}`), "Status": status,
  "PAR": seg(`2026090100${code.slice(-2)}`), "Amount (VAT-Inc.)": formula(100000),
  "Business Unit": lookup("PDEI - Event Service"), ...extra,
});
const lifeUniverse = [
  proj("uA", "2026TEG-P0500", "Signed CE", { "Project": seg("Alpha Fest"), "Amount (VAT-Inc.)": formula(1120000.0000001) }),
  proj("uB", "2026TEG-P0501", "For Collection"),
  proj("uC", "2026TEG-P0502", "For Collection"),
  proj("uD", "2026TEG-P0503", "Won - Awaiting CE Signature"),
  proj("uE", "2026TEG-P0504", "For Collection"),
  proj("uF", "2026TEG-P0505", "Fully Closed"),
  proj("uG", "2026TEG-P0506", "For Collection", { "PAR": null }),
  proj("uH", "2026TEG-P0507", "For Collection"),
  proj("uI", "2026TEG-P0508", "For CE/Pitch Creation"),
  proj("uJ", "2026TEG-P0509", "Signed CE", { "Amount (VAT-Inc.)": formula(0) }),
  proj("uK", "2026TEG-P0510", "For Collection", { "PAR": seg("202609015555") }),
  proj("uL", "2026TEG-P0511", "Signed CE", { "IGNORE": true }),
];
const D = 1789920000000;   // an Invoice Date (midnight Manila)
const crow = (id, code, status, amount, extra = {}) => rec(id, {
  "Project Code": seg(code), "AR Name": seg(`Row ${id}`), "Status": status, "Invoice Amount": amount, "Currency": "PHP", ...extra,
});
const lifeCollections = [
  crow("cB1", "2026TEG-P0501", "For Invoicing", 200000, { "AR Name": seg("Bravo (Tranche 1)") }),
  crow("cB2", "2026TEG-P0501", "For Invoicing", 300000, { "AR Name": seg("Bravo (Tranche 2)") }),
  crow("cC1", "2026TEG-P0502", "For Collection", 421850, { "AR Name": seg("Charlie (First tranche)"), "Invoice Date": D }),
  crow("cC2", "2026TEG-P0502", "For Invoicing", 421850, { "AR Name": seg("Charlie (Second tranche)") }),
  crow("cD1", "2026TEG-P0503", "Pending Invoice Request Approval", 50000, { "Invoice Request": 202609200001 }),
  crow("cE1", "2026TEG-P0504", "Pending Invoice Request Approval", 60000, { "Invoice Request": 202609200002 }),
  crow("cH1", "2026TEG-P0507", "For Invoicing", 100, { "Invoice Request": 202609200004 }),
  crow("cX1", "2026TEG-P0507", "For Collection", 999, { "Invoice Request": 202609200009 }),
  crow("cZ1", "2026TEG-P0510", "Invalid", 1000),                       // same amount as iK, but marked invalid
];
const inv = (id, req, code, status, amount, extra = {}) => rec(id, {
  "Request No.": url(req), "Project Code": seg(code), "Status": status, "Amount": amount, "Amount-Currency": "PHP",
  "Initiator department": seg("Account Managers"), "Project Name": seg(`Invoice ${req}`),
  "Business Unit": "PDEI - Event Service", "Submitted at": 1789000000000 + Number(req.slice(-4)) * 1000, ...extra,
});
const lifeInvoices = [
  inv("iB1", "202610010001", "2026TEG-P0501", "Under Review", 210000),          // tranche 1 (amount changed)
  inv("iB2", "202610010002", "2026TEG-P0501", "Under Review", 290000),          // tranche 2
  inv("iC1", "202609110032", "2026TEG-P0502", "Approved", 421850, { "Completed at": D }),   // the hand-recorded first tranche
  inv("iC2", "202610060020", "2026TEG-P0502", "Under Review", 421850),          // the second tranche
  inv("iD", "202609200001", "2026TEG-P0503", "Recalled", 50000),                // withdrawn; nothing replaces it
  inv("iEold", "202609200002", "2026TEG-P0504", "Recalled", 60000),             // withdrawn…
  inv("iEnew", "202610010005", "2026TEG-P0504", "Under Review", 60000),         // …and filed again
  inv("iF", "202610010006", "2026TEG-P0505", "Approved", 5000),                 // project closed
  inv("iG", "202610010007", "2026TEG-P0506", "Approved", 7000),                 // project has no PAR
  inv("iH", "202609200004", "2026TEG-P0507", "Approved", 120),                  // on its row already: amount changed
  inv("iX", "202609200009", "2026TEG-P0507", "Approved", 999),                  // already For Collection
  inv("iK", "202610010008", "2025TEG-P0510", "Approved", 1000,                  // typo'd code, right PAR
      { "Associated Project Approval": seg("202609015555-Someone-Project Approval-2026-09-01 10:00:00") }),
  inv("iS", "202610010009", "2026TEG-P0501", "Approved", 1, { "Initiator department": seg("Finance") }),
  inv("iI", "202610010010", "2026TEG-P0501", "Approved", 1, { "IGNORE": true }),
  inv("iV", "202610010011", "2026TEG-P0501", "Rejected", 1),
  inv("iN", "202610010012", "2023TEG-P0001", "Approved", 1),                    // project not in the Universe
];
const OPTS = { "Currency": ["PHP", "USD"], "Business Unit": ["PDEI-Event Service", "GG-Event Service"] };
const life = () => collectionCards(lifeInvoices, indexUniverse(lifeUniverse), indexCollections(lifeCollections), new Set(), RULES);

test("Collections cards: one change per step, filters counted", () => {
  const { cards, hidden } = life();
  const by = Object.fromEntries(cards.map(c => [c.id, c]));
  assert.deepEqual(Object.keys(by).sort(), ["iB1", "iB2", "iC1", "iC2", "iD", "iEnew", "iG", "iH", "iK", "uA", "uJ"]);
  assert.deepEqual(hidden, { otherDept: 1, ignored: 2, done: 1, void: 2, noProject: 1, closed: 1 });
  assert.deepEqual(Object.fromEntries(cards.map(c => [c.id, c.step])), {
    uA: "won", uJ: "won", iB1: "filed", iB2: "filed", iC2: "filed", iEnew: "filed",
    iC1: "approved", iG: "approved", iH: "approved", iK: "approved", iD: "withdrawn",
  });
  assert.ok(cards.every((c, i) => !i || (cards[i - 1].submittedAt || 0) >= (c.submittedAt || 0)));   // newest first
  assert.equal(by.uA.source, "universe");                             // a won project's IGNORE is on the Universe
  assert.equal(by.iB1.source, "invoice");
});

test("won project → a new For Invoicing row with Amount (VAT-Inc.)", () => {
  const { cards } = life();
  const won = cards.find(c => c.id === "uA");
  assert.equal(won.code, "2026TEG-P0500");
  assert.equal(won.submittedAt, Date.UTC(2026, 8, 1) - 8 * 3600000);  // from its PAR number's date
  assert.deepEqual(collectionsChange(won, {}, OPTS, RULES), {
    mode: "create", rowId: null, action: "create", before: {}, expect: null,
    fields: { "AR Name": "Alpha Fest", "Project Code": "2026TEG-P0500", "Invoice Amount": 1120000,
              "Currency": "PHP", "Status": "For Invoicing", "Business Unit": "PDEI-Event Service" },
  });
  assert.equal(collectionsChange(won, { arName: " Alpha Fest DP " }, OPTS, RULES).fields["AR Name"], "Alpha Fest DP");
  assert.equal(cards.find(c => c.id === "uJ").blocked, "The Universe row has no amount yet.");
  // "Mark invalid": a new row with Status Invalid, allowed even without an amount.
  assert.deepEqual(collectionsChange(cards.find(c => c.id === "uJ"), { invalid: true }, OPTS, RULES).fields, {
    "AR Name": "Project 0509", "Project Code": "2026TEG-P0509", "Currency": "PHP", "Status": "Invalid",
    "Business Unit": "PDEI-Event Service" });
  // Only won projects can be marked invalid; a request's change is unaffected.
  assert.equal(collectionsChange(cards.find(c => c.id === "iB1"), { invalid: true }, OPTS, RULES).fields["Status"],
               "Pending Invoice Request Approval");
});

test("request filed → its row becomes Pending, with the request's amount and currency", () => {
  const { cards } = life();
  const by = Object.fromEntries(cards.map(c => [c.id, c]));
  // Two tranches, two requests: each takes the row closest to its amount.
  assert.equal(by.iB1.target, "cB1");
  assert.equal(by.iB2.target, "cB2");
  const ch = collectionsChange(by.iB1, {}, OPTS, RULES);
  assert.deepEqual(ch, {
    mode: "update", rowId: "cB1", action: "attach",
    fields: { "Invoice Request": 202610010001, "Status": "Pending Invoice Request Approval", "Invoice Amount": 210000 },
    before: { "Invoice Request": null, "Status": "For Invoicing", "Invoice Amount": 200000 },
    expect: { status: "For Invoicing", ir: "" },
  });
  assert.match(by.iB1.notes.join(" "), /“Bravo \(Tranche 1\)” is PHP 200,000; it becomes the request's PHP 210,000\./);
  // A request in USD on a row the Universe put in PHP: both change.
  const usd = { ...by.iB1, amount: 4000, currency: "USD" };
  assert.deepEqual(collectionsChange(usd, {}, OPTS, RULES).fields,
    { "Invoice Request": 202610010001, "Status": "Pending Invoice Request Approval", "Invoice Amount": 4000, "Currency": "USD" });
  // Or as a new row, if that's what the user picks.
  const fresh = collectionsChange(by.iB1, { targetId: "new" }, OPTS, RULES);
  assert.equal(fresh.mode, "create");
  assert.equal(fresh.fields["Status"], "Pending Invoice Request Approval");
  assert.equal(fresh.fields["Invoice Amount"], 210000);
  assert.equal(fresh.fields["Invoice Request"], 202610010001);
});

test("request approved → For Collection, the amount as invoiced", () => {
  const { cards } = life();
  const by = Object.fromEntries(cards.map(c => [c.id, c]));
  // Already on its row: only the stage (and the changed amount) move.
  assert.deepEqual(collectionsChange(by.iH, {}, OPTS, RULES).fields, { "Status": "For Collection", "Invoice Amount": 120 });
  assert.equal(by.iH.targets[0].action, "advance");
  // Two equal tranches: the approved one is the row recorded by hand (same amount, invoiced
  // the day it was approved); the second tranche's request gets the row still waiting.
  assert.equal(by.iC1.target, "cC1");
  assert.deepEqual(collectionsChange(by.iC1, {}, OPTS, RULES).fields, { "Invoice Request": 202609110032 });
  assert.match(by.iC1.notes.join(" "), /“Charlie \(First tranche\)”.*most likely this invoice/);
  assert.equal(by.iC2.target, "cC2");
  // No PAR in the Universe: no new row.
  assert.equal(by.iG.blocked, "Add this project's PAR to the Universe first.");
  // The typed code is wrong; the request's PAR says which project it is. Its only
  // Collections row is marked Invalid, so it gets a new row rather than that one.
  assert.equal(by.iK.code, "2026TEG-P0510");
  assert.equal(by.iK.target, "new");
  assert.deepEqual(by.iK.targets, []);
  assert.match(by.iK.notes[0], /2025TEG-P0510 isn't in the Universe; using 2026TEG-P0510/);
  assert.deepEqual(collectionsChange(by.iK, {}, OPTS, RULES).fields, {
    "AR Name": "Invoice 202610010008", "Project Code": "2026TEG-P0510", "Invoice Amount": 1000, "Currency": "PHP",
    "Invoice Request": 202610010008, "Status": "For Collection", "Business Unit": "PDEI-Event Service",
  });
});

test("request withdrawn → back to For Invoicing, unless a new request takes the row", () => {
  const { cards } = life();
  const by = Object.fromEntries(cards.map(c => [c.id, c]));
  assert.deepEqual(collectionsChange(by.iD, {}, OPTS, RULES).fields, { "Invoice Request": null, "Status": "For Invoicing" });
  assert.equal(by.iD.targets[0].action, "reset");
  // Recalled and filed again: the new request goes on the same row (still Pending).
  assert.equal(by.iEnew.target, "cE1");
  assert.deepEqual(collectionsChange(by.iEnew, {}, OPTS, RULES).fields, { "Invoice Request": 202610010005 });
  assert.match(by.iEnew.notes.join(" "), /replaces request 202609200002 \(recalled\)/);
});

test("a request already on a row follows it, whichever department filed it", () => {
  const sales = inv("iS2", "202609200004", "2026TEG-P0507", "Approved", 100, { "Initiator department": seg("Finance") });
  const { cards } = collectionCards([sales], indexUniverse(lifeUniverse), indexCollections(lifeCollections), new Set(), RULES);
  assert.deepEqual(cards.filter(c => c.step !== "won").map(c => [c.id, c.step, c.target]), [["iS2", "approved", "cH1"]]);
  // No request on its way for these; uK isn't one because its Invalid row keeps it out.
  assert.deepEqual(cards.filter(c => c.step === "won").map(c => c.id).sort(), ["uA", "uJ"]);
  assert.deepEqual(collectionsChange(cards[0], {}, OPTS, RULES).fields, { "Status": "For Collection" });
});

test("universeFromBrief maps every transferable field", () => {
  const uni = indexUniverse(universe);
  const b = rec("recB99", {
    "Request No.": url("202610080069", "https://applink.larksuite.com/approval?instanceId=1"),
    "Project Code": seg("2026TEG-P0286 "), "Project Name": seg("  Korea Tourism Expo  "),
    "Initiator department": seg("Account Managers"), "Status": "Under Review",
    "Submitted at": 1791341556036, "Contract Value": 45000, "Contract Value-Currency": "USD",
    "Remarks": seg("Line 1\r\nLine 2"), "Start date": 1794326400000, "End date": 1794412800000,
    "AM": [user("ou_am", "Am")], "BD": [user("ou_bd", "Bd")],
    "Attachment (Project Brief, Pitch Deck)": { link: "https://www.larksuite.com/approval/admin/previewAttachment?key=K", text: "1 attachment(s)" },
  });
  const [card] = briefCards([b], uni, RULES).cards;
  const out = universeFromBrief(card, {
    vat: "0%", client: " Korea Tourism Organization ",
    bd: [{ id: "ou_picked", name: "Picked BD" }], otherLinks: " Deck: https://x\r\n",
  }, RULES);
  assert.deepEqual(out, {
    "Project Code": "2026TEG-P0286",
    "Project": "Korea Tourism Expo",
    "Client": "Korea Tourism Organization",
    "AM": [{ id: "ou_am" }],
    "BD": [{ id: "ou_picked" }],                  // what the user picked, not the brief's BD
    "Amount (VAT-Ex.) (PHP)": 2565000,
    "VAT%": "0%",
    "Project Description": "Line 1\nLine 2",
    "Project Start": 1794326400000,
    "Project End": 1794412800000,
    "RFP Received Date": 1791302400000,
    "Year": "2026",
    "Status": "For CE/Pitch Creation",
    "Mancom Phase": "1. Client Brief Kickoff",
    "Other Links": "Deck: https://x",
  });
  // No MKT on the brief → no MKT key at all (nothing written as blank).
  assert.equal("MKT" in out, false);
  // By default Client, BD and Other Links stay blank: not written at all.
  const defaults = universeFromBrief(card, { vat: "12%" }, RULES);
  for (const k of ["Client", "BD", "Other Links"]) assert.equal(k in defaults, false, k);
  assert.equal(defaults["Amount (VAT-Ex.) (PHP)"], 2290178.57);
});

test("short names keep first and last name", () => {
  assert.equal(shortName("Carlos Roberto Francisco, David, IV Coscolluela"), "Carlos Coscolluela");
  assert.equal(shortName("Marinella M. Casabuena"), "Marinella Casabuena");
  assert.equal(shortName("Pepito Laureola Garcia Jr."), "Pepito Garcia");
  assert.equal(shortName("Kirk Agcaoili"), "Kirk Agcaoili");
  assert.equal(shortName("Vince"), "Vince");
});

test("the BD picker offers frequent Universe BDs first", () => {
  const u = [
    rec("u1", { "BD": [user("ou_kirk", "Kirk")], "AM": [user("ou_pat", "Pat")] }),
    rec("u2", { "BD": [user("ou_kirk", "Kirk"), user("ou_ella", "Ella")] }),
  ];
  // (an old brief that still has MKT: the brief has no MKT column now, so it's not read)
  const b = [rec("b1", { "MKT": [user("ou_mkt", "Mika")], "BD": [user("ou_ella", "Ella")] })];
  const pool = peoplePool(u, b);
  assert.deepEqual(pool.map(p => [p.name, p.bdCount]), [["Kirk", 2], ["Ella", 1], ["Pat", 0]]);
  assert.equal(pool[0].email, "ou_kirk@x.com");
});

test("Universe view: one year, grouped in option order, newest RFP first; Stalled/Lost/Archived last, folded, not in the totals", () => {
  const row = (id, f) => rec(id, { "Project": seg(`P ${id}`), "Client": seg(`C ${id}`), "Year": seg("2026"), ...f });
  const recs = [
    row("a", { "Status": "For CE/Pitch Creation", "RFP Received Date": 300, "Amount (VAT-Ex.) (PHP)": 100 }),
    row("b", { "Status": "For CE/Pitch Creation", "RFP Received Date": 500, "Amount (VAT-Ex.) (PHP)": 50.5 }),
    row("c", { "Status": "For CE/Pitch Creation" }),                                   // no RFP date: last
    row("d", { "Status": "Fully Closed", "RFP Received Date": 100 }),
    row("e", { "Status": "Lost", "RFP Received Date": 900, "Amount (VAT-Ex.) (PHP)": 1000 }),   // folded, last
    row("f", { "Status": "Archived" }),                                                // folded, last
    row("g", { "Status": "For CE/Pitch Creation", "Year": seg("2025"), "RFP Received Date": 999 }),
    row("h", { "RFP Received Date": 50 }),                                             // no status
    row("i", { "Status": "Brand New Status", "RFP Received Date": 70 }),
  ];
  const order = ["Fully Closed", "For CE/Pitch Creation", "Stalled", "Lost", "Archived"];
  const v = universeView(recs, { year: "2026", folded: ["Stalled", "Lost", "Archived"], statusOrder: order });
  // the folded statuses come after everything else (even rows with no status), in the column's order
  assert.deepEqual(v.groups.map(g => [g.status, g.folded]),
    [["Fully Closed", false], ["For CE/Pitch Creation", false], ["Brand New Status", false], ["", false], ["Lost", true], ["Archived", true]]);
  assert.deepEqual(v.groups[1].rows.map(r => r.id), ["b", "a", "c"]);
  assert.equal(v.groups[1].amount, 150.5);
  assert.equal(v.count, 6);                         // the totals leave them out (not pipeline)…
  assert.equal(v.amount, 150.5);
  assert.equal(v.foldedCount, 2);                   // …and say how many there are
  assert.deepEqual(v.years, ["2026", "2025"]);
  const asc = universeView(recs, { year: "2026", folded: [], statusOrder: order, sort: "asc" });
  assert.deepEqual(asc.groups.find(g => g.status === "For CE/Pitch Creation").rows.map(r => r.id), ["a", "b", "c"]);
  const all = universeView(recs, { year: "all", folded: [], statusOrder: order });
  assert.equal(all.count, 9);
  const found = universeView(recs, { year: "all", statusOrder: order, query: "c g" });
  assert.deepEqual(found.groups.flatMap(g => g.rows.map(r => r.id)), ["g"]);
});

test("verifyWritten compares write format against read format", () => {
  const written = {
    "Project": "Korea", "AM": [{ id: "ou_1" }, { id: "ou_2" }], "Amount (VAT-Ex.) (PHP)": 892.86,
    "VAT%": "12%", "Project Start": 1794326400000, "IGNORE": true, "Other Links": "A: https://x\nB",
  };
  const readBack = {
    "Project": seg("Korea"), "AM": [user("ou_2", "B"), user("ou_1", "A")], "Amount (VAT-Ex.) (PHP)": 892.86,
    "VAT%": "12%", "Project Start": 1794326400000, "IGNORE": true,
    "Other Links": [{ type: "text", text: "A: " }, { type: "url", text: "https://x", link: "https://x" }, { type: "text", text: "\nB" }],
  };
  assert.deepEqual(verifyWritten(written, readBack), []);
  const bad = verifyWritten(written, { ...readBack, "VAT%": "0%", "AM": [user("ou_1", "A")] });
  assert.deepEqual(bad.map(b => b.field), ["AM", "VAT%"]);
  assert.deepEqual(verifyWritten({ IGNORE: false }, {}), []);
});

test("VAT sentences are quoted from the remarks", () => {
  assert.deepEqual(vatMentions(seg("Budget is inclusive of VAT. \n\nSOW\n- Pavilion")), ["Budget is inclusive of VAT."]);
  assert.deepEqual(vatMentions("Estimated budget : Php 200-250k VAT-ex"), ["Estimated budget : Php 200-250k VAT-ex"]);
  assert.deepEqual(vatMentions("Budget: $150,000 (all in with tax and ASF)"), ["Budget: $150,000 (all in with tax and ASF)"]);
  assert.deepEqual(vatMentions("Activation at the venue. No pricing yet."), []);
});

test("similarity spots re-filed projects", () => {
  assert.ok(similarity("MPL PH S18 - Media Day", "MPL PH S18 - Media Day") === 1);
  assert.ok(similarity("FunaloMax, FunaloMax Studios, Solaire Online Social Media Ad",
                       "FUNaloMAX, FUNaloMAX Studios, Solaire Online - (Social Media, Paid Media)") >= RULES.similarityHint);
  assert.ok(similarity("Korea Tourism Organization - Travel Tour Expo 2027", "COD:M KOL Tour") < RULES.similarityHint);
});

test("ANDON: briefs from every department, the shared IGNORE box, typed columns only", () => {
  const andon = indexUniverse([rec("a1", { "Project Code": seg("2026TEG-P0240"), "Project": seg("FUNaloMAX Social Media") })]);
  const briefs = [
    brief("recB01", "2026TEG-P0286", { "Initiator department": seg("Project Management") }),
    brief("recB02", "2026TEG-P0240"),                                         // already in ANDON
    brief("recB03", "2026TEG-P0301", { "IGNORE": true }),                     // ignored: hidden here too
  ];
  const { cards, hidden } = briefCards(briefs, andon, RULES, { allDepartments: true, kind: "andon" });
  assert.deepEqual(cards.map(c => c.code), ["2026TEG-P0286"]);
  assert.equal(cards[0].kind, "andon");
  assert.deepEqual(hidden, { otherDept: 0, ignored: 1, done: 1, void: 0, noProject: 0 });

  const b = rec("recB99", {
    "Request No.": url("202610080069", "https://applink.larksuite.com/approval?instanceId=1"),
    "Project Code": seg("2026TEG-P0286"), "Project Name": seg("Korea Tourism Expo"), "Status": "Under Review",
    "Initiator department": seg("Account Managers"), "Submitted at": 1791341556036,
    "Contract Value": 5700, "Contract Value-Currency": "PHP", "Business Unit": "PDEI - Marketing",
    "Required Tools": ["None", "Mystery Tool"], "Remarks": seg("Notes"),
    "Start date": 1794326400000, "End date": 1794412800000,       // Nov 11 / Nov 12 2026, Manila
    "AM": [user("ou_am1", "Am One"), user("ou_am2", "Am Two")], "MKT": [user("ou_mkt", "Mika")],
  });
  const [card] = briefCards([b], indexUniverse([]), RULES, { allDepartments: true, kind: "andon" }).cards;
  const options = { "Business Unit": ["PDEI - Marketing"], "Tools": ["None", "Slash"], "TRIBE": ["TRIBE D - Marketing"],
                    "Brief Currency": ["PHP", "USD"], "Brief Status": ["Approved", "Under Review"] };
  const out = andonFromBrief(card, { pm: [{ id: "ou_pm", name: "Pam" }], tribe: "TRIBE D - Marketing" }, RULES, options);
  assert.deepEqual(out, {
    "Project": "Korea Tourism Expo", "Project Code": "2026TEG-P0286",
    "AM": [{ id: "ou_am1" }],                      // ANDON holds one AM
    "PM (LEAD)": [{ id: "ou_pm" }],                // no MKT (PITCH): the brief has no MKT column now
    "Business Unit": "PDEI - Marketing", "Tools": ["None"],     // unknown options are left out
    "TRIBE": "TRIBE D - Marketing",
    "Brief Contract Value": 5700, "Brief Currency": ["PHP"], "Contract Value (USD)": 100,
    "Brief": { link: "https://applink.larksuite.com/approval?instanceId=1", text: "202610080069" },
    "Brief Status": ["Under Review"], "YEAR": "2026", "MONTH": "November",
    "Event Start": 1794326400000, "Event End": 1794412800000, "Remarks": "Notes",
  });
  const blank = andonFromBrief(card, {}, RULES, options);
  assert.equal("PM (LEAD)" in blank, false);
  assert.equal("TRIBE" in blank, false);

  // The live ANDON fills Brief, YEAR, MONTH… itself: those are never sent there.
  const live = [
    { field_name: "Project", type: 1 }, { field_name: "Project Code", type: 1 }, { field_name: "AM", type: 11 },
    { field_name: "Brief", type: 19 }, { field_name: "YEAR", type: 20 }, { field_name: "MONTH", type: 20 },
    { field_name: "Event Start", type: 5 }, { field_name: "Main Project", type: 18 },
  ];
  assert.deepEqual(Object.keys(writableOnly(out, live)).sort(), ["AM", "Event Start", "Project", "Project Code"]);
});

test("Collections view: grouped by status in option order, newest invoice number first", () => {
  const row = (id, f) => rec(id, { "AR Name": seg(`AR ${id}`), "Project Code": seg("2026TEG-P0001"), ...f });
  const recs = [
    row("a", { "Status": "Collected", "Invoice Number": seg("INV-1520") }),
    row("b", { "Status": "Collected", "Invoice Number": seg("INV-0177") }),
    row("c", { "Status": "Collected", "Invoice Number": seg("INV-1670") }),
    row("d", { "Status": "Collected" }),                                   // not invoiced yet: last
    row("e", { "Status": "For Invoicing", "Invoice Request": 202610080005, "AM": { type: 11, value: [user("ou_am", "Am Person")] } }),
  ];
  const order = ["Invalid", "Collected", "For Collection", "For Invoicing"];
  const v = collectionsView(recs, { statusOrder: order });
  assert.deepEqual(v.groups.map(g => g.status), ["Collected", "For Invoicing"]);
  assert.deepEqual(v.groups[0].rows.map(r => r.id), ["c", "a", "b", "d"]);
  assert.deepEqual(collectionsView(recs, { statusOrder: order, sort: "asc" }).groups[0].rows.map(r => r.id), ["b", "a", "c", "d"]);
  assert.equal(v.groups[1].rows[0].request, "202610080005");
  assert.equal(v.groups[1].rows[0].am[0].name, "Am Person");
  assert.deepEqual(collectionsView(recs, { statusOrder: order, query: "1670" }).count, 1);
});

test("invoice details: only what changed is written; clearing sends null", () => {
  const row = collectionRow(rec("x", { "Invoice Number": seg("INV-1"), "SI Number": seg("600"),
    "Invoice": [{ file_token: "t1", name: "a.pdf", size: 3 }] }));
  assert.deepEqual(invoiceDetailsPatch(row, { invoiceNo: "INV-1", siNo: "600", files: row.files }), {});
  assert.deepEqual(invoiceDetailsPatch(row, { invoiceNo: " INV-2 ", siNo: "", invoiceDate: 1791302400000,
    files: [...row.files, { file_token: "t2", name: "b.pdf" }] }), {
    "Invoice Number": "INV-2", "SI Number": null, "Invoice Date": 1791302400000,
    "Invoice": [{ file_token: "t1" }, { file_token: "t2" }],
  });
});

/* ---------- the audit: blanks the brief can fill ---------- */

test("audit: Universe blanks the brief can fill, never cells that have a value", () => {
  const b = rec("recBA", {
    "Request No.": url("202601050001"), "Project Code": seg("2026TEG-P0600"), "Project Name": seg("Audit Fest"),
    "Initiator department": seg("Sales"), "Status": "Approved", "Submitted at": 1790000000000,
    "Contract Value": 1120000, "Contract Value-Currency": "PHP", "Remarks": seg("Three-day event."),
    "AM": [user("ou_am", "Ana Manager")], "MKT": [user("ou_mk", "Mika Market")],
    "Start date": 1790100000000, "End date": 1790300000000,
  });
  const older = rec("recBO", { ...b.fields, "Remarks": seg("old"), "Submitted at": 1700000000000 });
  const recalled = rec("recBR", { ...b.fields, "Status": "Recalled", "Submitted at": 1799000000000 });
  const rows = [
    rec("uX", { "Project Code": seg("2026TEG-P0600"), "Project": seg("Audit Fest (typed)"), "Status": "Signed CE",
                "AM": [user("ou_other", "Someone Else")], "Year": seg("2026"), "Project Description": seg("  "),
                "Sign Date": 1790500000000, "Month": "October",
                [RULES.auditFiles.field]: [{ file_token: "boxCE", name: "CE.pdf" }] }),   // a won project that has what it needs
    rec("uY", { "Project Code": seg("2026TEG-P0601"), "Project": seg("No brief") }),
  ];
  const { cards, hidden } = auditCards("universe", rows, [older, b, recalled], RULES);
  assert.equal(hidden.noBrief, 1);
  assert.equal(cards.length, 1);
  const c = cards[0];
  assert.equal(c.brief.requestNo, "202601050001");             // newest brief that wasn't withdrawn
  // Filled: blank cells only. Project, AM and Year have values; Client, BD, Status… are never audited.
  // (not MKT: the brief has no MKT column now, so it can't fill one, even if an old brief record says so)
  assert.deepEqual(c.gaps, ["Amount (VAT-Ex.) (PHP)", "Project Description", "Project Start", "Project End", "RFP Received Date"]);
  assert.equal(c.needsVat, true);
  const all = auditPatch(c, rows[0], { vat: "12%" }, RULES);
  assert.equal(all["Amount (VAT-Ex.) (PHP)"], 1000000);
  assert.equal(all["VAT%"], "12%");                              // written with the amount, since the row had none
  assert.equal(all["Project Description"], "Three-day event.");
  assert.ok(!("MKT" in all));
  assert.ok(!("AM" in all) && !("Project" in all) && !("Year" in all) && !("Status" in all));
  // Only the ticked ones; no VAT% without the amount.
  assert.deepEqual(auditPatch(c, rows[0], { fields: ["Project End"], vat: "0%" }, RULES), { "Project End": 1790300000000 });
  // Hidden on this device until another cell goes blank.
  assert.equal(auditCards("universe", rows, [b], RULES, { hide: new Set([c.hideKey]) }).cards.length, 0);
  assert.equal(auditCards("universe", [rec("uX", { ...rows[0].fields, "Project": null })], [b], RULES,
    { hide: new Set([c.hideKey]) }).cards.length, 1);
});

test("audit: ANDON only gets typed columns, and the row's own VAT stays", () => {
  const b = rec("recBB", { "Request No.": url("202601050002"), "Project Code": seg("2026TEG-P0602"), "Project Name": seg("Andon Audit"),
    "Status": "Approved", "Submitted at": 1, "Business Unit": "PDEI - Event Service", "Start date": 5, "End date": 6,
    "AM": [user("ou_am", "Ana")], "Contract Value": 100, "Contract Value-Currency": "PHP" });
  const fields = [["Project", 1], ["Project Code", 1], ["AM", 11], ["Business Unit", 3], ["Event Start", 5], ["Event End", 5],
                  ["MONTH", 20], ["PM (LEAD)", 11]].map(([field_name, type]) => ({ field_name, type }));
  const row = rec("aZ", { "Project Code": seg("2026TEG-P0602"), "Project": seg("Andon Audit"), "Event Start": 5 });
  const { cards } = auditCards("andon", [row], [b], RULES, { fields, options: { "Business Unit": ["PDEI-Event Service"] } });
  assert.deepEqual(cards[0].gaps, ["AM", "Business Unit", "Event End"]);   // not MONTH (a formula), not PM (LEAD) (picked by a person)
  // A Universe row with a VAT% keeps it: the amount uses it, VAT% isn't written.
  const u = rec("uV", { "Project Code": seg("2026TEG-P0602"), "VAT%": "0%" });
  const uc = auditCards("universe", [u], [b], RULES).cards[0];
  assert.equal(uc.needsVat, false);
  const p = auditPatch(uc, u, { vat: "12%" }, RULES);
  assert.equal(p["Amount (VAT-Ex.) (PHP)"], 100);
  assert.ok(!("VAT%" in p));
});

test("verifyWritten checks multi-select values (e.g. ANDON Tools) without crashing", () => {
  assert.deepEqual(verifyWritten({ "Tools": ["None"] }, { "Tools": ["None"] }), []);
  assert.deepEqual(verifyWritten({ "Tools": ["LED Wall", "Sound"] }, { "Tools": ["Sound", "LED Wall"] }), []);
  assert.deepEqual(verifyWritten({ "Tools": ["None"] }, { "Tools": { type: 4, value: ["None"] } }), []);
  assert.equal(verifyWritten({ "Tools": ["None"] }, { "Tools": ["Sound"] }).length, 1);
  assert.equal(verifyWritten({ "Tools": ["None"] }, {}).length, 1);
});

test("typed dates become midnight Manila; anything else is flagged", () => {
  const oct14 = Date.UTC(2026, 9, 14) - 8 * 3600000;
  for (const t of ["2026-10-14", "2026/10/14", "10/14/2026", "14/10/2026", "Oct 14, 2026", "October 14 2026",
                   "14 Oct 2026", "oct. 14th, 2026", " Oct 14 2026 "]) {
    assert.equal(parseDay(t, 8), oct14, t);
  }
  assert.equal(parseDay("Oct 14", 8, Date.UTC(2026, 5, 1)), oct14);     // no year: this year
  assert.equal(parseDay("", 8), null);
  for (const t of ["2026-02-30", "13/13/2026", "next week", "14", "Octember 14 2026"]) assert.ok(Number.isNaN(parseDay(t, 8)), t);
});

test("audit: values edited in the sheet are written instead of the brief's; blanks never are", () => {
  const b = rec("recBE", { "Request No.": url("202601050003"), "Project Code": seg("2026TEG-P0603"), "Project Name": seg("Edit Me"),
    "Status": "Approved", "Submitted at": 1, "Remarks": seg("Old remarks."), "AM": [user("ou_m", "Old Am")],
    "Start date": 10, "End date": 20, "Contract Value": 112, "Contract Value-Currency": "PHP" });
  const row = rec("uE2", { "Project Code": seg("2026TEG-P0603"), "Project": seg("Edit Me"), "VAT%": "12%" });
  const c = auditCards("universe", [row], [b], RULES).cards[0];
  const p = auditPatch(c, row, { values: {
    "Project Description": "  New remarks.\r\n",          // edited: trimmed, Windows line ends fixed
    "AM": [{ id: "ou_new" }],                              // a different person
    "MKT": [{ id: "ou_x" }],                               // not a gap (the brief has no MKT): never written
    "Project End": null,                                   // cleared: not written
    "Amount (VAT-Ex.) (PHP)": 250,                         // typed over the brief's
  } }, RULES);
  assert.equal(p["Project Description"], "New remarks.");
  assert.deepEqual(p["AM"], [{ id: "ou_new" }]);
  assert.ok(!("MKT" in p));
  assert.ok(!("Project End" in p));
  assert.equal(p["Amount (VAT-Ex.) (PHP)"], 250);
  assert.equal(p["Project Start"], 10);                    // not edited: from the brief
  assert.ok(!("VAT%" in p));                               // the row has one
});

test("fill blanks plan: only still-blank cells, VAT% follows its amount", () => {
  const AMOUNT = "Amount (VAT-Ex.) (PHP)";
  // nothing filled meanwhile
  assert.deepEqual(fillPlan({ [AMOUNT]: 100, "VAT%": "12%", MKT: [{ id: "ou_1" }] }, {}),
    { written: { [AMOUNT]: 100, "VAT%": "12%", MKT: [{ id: "ou_1" }] }, skipped: [] });
  // someone filled the amount: it's skipped, and VAT% (which only goes with it) stays out without being reported
  assert.deepEqual(fillPlan({ [AMOUNT]: 100, "VAT%": "12%" }, { [AMOUNT]: 90 }), { written: {}, skipped: [AMOUNT] });
  // someone set a different VAT%: both are held back (the amount was worked out at 12%)
  assert.deepEqual(fillPlan({ [AMOUNT]: 100, "VAT%": "12%" }, { "VAT%": "0%" }), { written: {}, skipped: [AMOUNT, "VAT%"] });
  // the same VAT% was set: the amount still goes, VAT% needs no write
  assert.deepEqual(fillPlan({ [AMOUNT]: 100, "VAT%": "12%" }, { "VAT%": "12%" }), { written: { [AMOUNT]: 100 }, skipped: [] });
  // zero isn't blank; empty text and an empty list are
  assert.deepEqual(fillPlan({ A: 1, B: 2, C: 3 }, { A: 0, B: seg("  "), C: [] }), { written: { B: 2, C: 3 }, skipped: ["A"] });
  assert.deepEqual(fillPlan({ A: 1 }, null), { written: { A: 1 }, skipped: [] });
});

test("invoice details: which cells changed in Lark since the list loaded", () => {
  const f = (o) => rec("recC", { "AR Name": seg("T1"), "Invoice Number": seg("INV-1"), "SI Number": seg("5"), "Invoice Date": 1791302400000,
    Invoice: [{ file_token: "a", name: "a.pdf", size: 1 }], ...o });
  const loaded = collectionRow(f({}));
  assert.deepEqual(invoiceChangedSince({ "Invoice Number": "INV-2" }, loaded, f({})), []);
  assert.deepEqual(invoiceChangedSince({ "Invoice Number": "INV-2" }, loaded, f({ "Invoice Number": seg("INV-9") })), ["Invoice Number"]);
  assert.deepEqual(invoiceChangedSince({ "Invoice Number": "INV-2" }, loaded, f({ "SI Number": seg("6") })), []);   // not a cell we write
  assert.deepEqual(invoiceChangedSince({ "SI Number": null, "Invoice Date": 1 }, loaded, f({ "SI Number": seg("6"), "Invoice Date": 1791388800000 })),
    ["SI Number", "Invoice Date"]);
  assert.deepEqual(invoiceChangedSince({ Invoice: [] }, loaded, f({ Invoice: [{ file_token: "a" }, { file_token: "b" }] })), ["Invoice"]);
  assert.deepEqual(invoiceChangedSince({ Invoice: [] }, loaded, f({ Invoice: undefined })), ["Invoice"]);
});

test("drafts keep their client_token across a reload, without files", () => {
  const now = 1791302400000;
  const drafts = new Map([
    ["brief::recB1", { clientToken: "tok-1", targetId: null, at: now, choices: { vat: "0%", client: "Acme", bd: [{ id: "ou_1", name: "A" }] } }],
    ["invoice:approved:recI1", { clientToken: "tok-2", targetId: "recC9", at: now - 1000,
      choices: { invoiceNo: "INV-7", files: [{ name: "a.pdf", size: 5, file: { fake: "File" } }], names: new Map([["ou_1", "A"]]) } }],
    ["par::bad", { clientToken: "", choices: {} }],                       // no token: nothing to keep
  ]);
  const saved = JSON.parse(JSON.stringify(draftsToJSON(drafts, now)));    // through storage
  assert.deepEqual(Object.keys(saved.items), ["brief::recB1", "invoice:approved:recI1"]);
  assert.deepEqual(saved.items["invoice:approved:recI1"].choices, { invoiceNo: "INV-7", files: [] });
  const back = new Map(draftsFromJSON(saved, now + 60000));
  assert.equal(back.get("brief::recB1").clientToken, "tok-1");
  assert.deepEqual(back.get("brief::recB1").choices, { vat: "0%", client: "Acme", bd: [{ id: "ou_1", name: "A" }] });
  assert.equal(back.get("invoice:approved:recI1").targetId, "recC9");
  // old, malformed and foreign data is dropped
  assert.equal(draftsFromJSON(saved, now + 8 * 24 * 3600 * 1000).length, 0);
  assert.deepEqual(draftsFromJSON(null), []);
  assert.deepEqual(draftsFromJSON({ v: 2, items: {} }), []);
  assert.deepEqual(draftsFromJSON({ v: 1, items: { k: { clientToken: 5, choices: {} }, j: "x" } }, now), []);
  // only the newest are kept
  const many = new Map(Array.from({ length: 60 }, (_, i) => [`k${i}`, { clientToken: `t${i}`, at: now + i, choices: {} }]));
  const kept = Object.keys(draftsToJSON(many, now + 100).items);
  assert.equal(kept.length, 50);
  assert.ok(kept.includes("k59") && !kept.includes("k0"));
});
test("queue: waiting and failed pushes survive storage; finished ones and files in memory don't", () => {
  const now = Date.UTC(2026, 9, 16);
  const file = { name: "INV-1.pdf", size: 1000, file: {} };            // not uploaded yet: can't be kept
  const sent = { name: "INV-2.pdf", size: 2000, file: {}, file_token: "boxA" };
  const items = [
    { id: "q1", key: "audit::rec1", kind: "audit", cardId: "rec1", state: "waiting", at: now, table: "universe",
      job: { clientToken: "t1", choices: { fields: ["Client"], names: new Map([["ou1", "Ana"]]) } } },
    { id: "q2", key: "invoice:approved:rec2", kind: "invoice", cardId: "rec2", state: "running", at: now, table: "collections",
      job: { clientToken: "t2", choices: { files: [file, sent] } } },
    { id: "q3", key: "brief::rec3", kind: "brief", cardId: "rec3", state: "done", at: now, job: { clientToken: "t3", choices: {} } },
    { id: "q4", key: "par::rec4", kind: "par", cardId: "rec4", state: "failed", error: "Nothing was written.", at: now,
      job: { clientToken: "t4", choices: {} } },
  ];
  const back = queueFromJSON(JSON.parse(JSON.stringify(queueToJSON(items, now))), now + 60000);
  assert.deepEqual(back.map(i => [i.id, i.state]), [["q1", "waiting"], ["q2", "checking"], ["q4", "failed"]]);
  assert.equal(back[0].job.choices.names, undefined);                 // maps are rebuilt by the sheet
  assert.equal(back[0].lostFiles, false);
  assert.deepEqual(back[1].job.choices.files, [{ name: "INV-1.pdf", size: 1000 }, { name: "INV-2.pdf", size: 2000, file_token: "boxA" }]);
  assert.equal(back[1].lostFiles, true);                              // INV-1 has to be added again
  assert.equal(back[2].error, "Nothing was written.");
});

test("queue: old, broken or foreign data restores nothing", () => {
  const now = Date.UTC(2026, 9, 16);
  assert.deepEqual(queueFromJSON(null, now), []);
  assert.deepEqual(queueFromJSON({ v: 2, items: [] }, now), []);
  const old = { v: 1, items: [{ id: "q1", key: "k", state: "waiting", at: now - 3 * 24 * 3600 * 1000, job: { clientToken: "t", choices: {} } }] };
  assert.deepEqual(queueFromJSON(old, now), []);
  const bad = { v: 1, items: [{ id: "q1", key: "k", state: "done", at: now, job: { clientToken: "t", choices: {} } }, { id: "q2" }] };
  assert.deepEqual(queueFromJSON(bad, now), []);
});

test("cellText: lookups and formulas read by their inner type, like the cells they look up", () => {
  const col = (field_name, type, property) => ({ field_name, type, property });
  const oct14 = Date.UTC(2026, 9, 13, 16);                                   // midnight Oct 14 in Manila
  // formula numbers (with float noise), amounts and PHP columns
  assert.equal(cellText(col("Amount (VAT-Inc.)", 20), { type: 2, value: [1120000.0000001] }), "1,120,000");
  assert.equal(cellText(col("Contract Value (USD)", 20), { type: 2, value: [9824.56] }), "9,824.56");
  assert.equal(cellText(col("Amount (VAT-Ex.) (PHP)", 2), 535714.29), "₱535,714.29");
  assert.equal(cellText(col("Days open", 20), { type: 2, value: [12] }), "12");
  // a lookup of a date, a select, people, text, a URL, a checkbox
  assert.equal(cellText(col("Brief Submitted", 19), { type: 5, value: [oct14] }), "Oct 14, 2026");
  assert.equal(cellText(col("Business Unit", 19), { type: 3, value: ["PDEI - Event Service"] }), "PDEI - Event Service");
  assert.equal(cellText(col("AM", 19), { type: 11, value: [{ id: "ou_1", name: "Ana Reyes" }, { id: "ou_2" }] },
    { nameOf: (id) => (id === "ou_2" ? "Ben Cruz" : "") }), "Ana Reyes, Ben Cruz");
  assert.equal(cellText(col("Brief Status", 19), { type: 1, value: [{ type: "text", text: "Appro" }, { type: "text", text: "ved" }] }), "Approved");
  assert.equal(cellText(col("Brief", 19), { type: 15, value: [{ link: "https://x.example/1", text: "202605260047" }] }), "202605260047");
  assert.equal(cellText(col("Won?", 19), { type: 7, value: [true] }), "Yes");
  // a link field, and a lookup of a lookup
  assert.equal(cellText(col("Project", 18), [{ record_ids: ["rec1"], table_id: "tbl1", text: "Alpha Fest", type: "text" }]), "Alpha Fest");
  assert.equal(cellText(col("Client", 19), { type: 19, value: [{ type: 1, value: [{ type: "text", text: "Acme" }] }] }), "Acme");
  // ordinary cells, and blanks stay blank
  assert.equal(cellText(col("Event Start", 5), oct14), "Oct 14, 2026");
  assert.equal(cellText(col("Invoice Request", 2), 202609090084), "202609090084");
  assert.equal(cellText(col("Invoice", 17), [{ file_token: "a", name: "INV-1.pdf" }, { file_token: "b" }]), "2 files");
  assert.equal(cellText(col("Tools", 4), ["Sound System", "LED Wall"]), "Sound System, LED Wall");
  assert.equal(cellText(col("Brief Status", 19), { type: 1, value: [] }), "");
  assert.equal(cellText(col("PAR", 1), null), "");
  assert.equal(cellText(col("Amount", 2), 0), "0");
});

test("audit: a won project must have Sign Date and Month; the Fill is refused while either is blank", () => {
  const cols = ["Project Code", "Project", "Status", "Mancom Phase", "Sign Date", "Month"].map(field_name => ({ field_name, type: 1 }));
  const b = rec("recBW", {
    "Request No.": url("202602010001"), "Project Code": seg("2026TEG-P0700"), "Project Name": seg("Won Fest"),
    "Initiator department": seg("Sales"), "Status": "Approved", "Submitted at": 1790000000000,
    "Contract Value": 1120000, "Contract Value-Currency": "PHP", "Remarks": seg("Two-day event."),
  });
  const rows = [
    rec("w1", { "Project Code": seg("2026TEG-P0700"), "Project": seg("Won Fest"), "Status": "For Collection", "Project Description": seg("x") }),
    rec("w2", { "Project Code": seg("2026TEG-P0701"), "Project": seg("No brief, won"), "Status": "For Pitching", "Mancom Phase": "7. Won",
                "Sign Date": 1790500000000 }),
    rec("w3", { "Project Code": seg("2026TEG-P0702"), "Project": seg("Not won"), "Status": "For Pitching" }),
    rec("w4", { "Project Code": seg("2026TEG-P0703"), "Project": seg("Closed, complete"), "Status": "Fully Closed",
                "Sign Date": 1790500000000, "Month": "October" }),
  ];
  // the rule: by Status (each listed one) or by Mancom Phase
  for (const status of RULES.auditRequired.statuses) assert.ok(isWonProject({ "Status": status }, RULES), status);
  assert.ok(isWonProject({ "Status": "For Pitching", "Mancom Phase": "7. Won" }, RULES));
  assert.ok(!isWonProject({ "Status": "For Pitching", "Mancom Phase": "2. Pitch Review" }, RULES));

  const { cards } = auditCards("universe", rows, [b], RULES, { fields: cols });
  const by = Object.fromEntries(cards.map(c => [c.rowId, c]));
  assert.deepEqual(by.w1.required, ["Sign Date", "Month"]);
  assert.ok(by.w1.gaps.includes("Sign Date") && by.w1.gaps.includes("Month"));
  assert.deepEqual(by.w2.required, ["Month"]);                    // no brief, still asked: only what's blank
  assert.equal(by.w2.brief, null);
  assert.equal(by.w3, undefined);                                  // not won, no brief: nothing to do
  assert.equal(by.w4, undefined);                                  // won and complete
  // a Universe without the column: not asked for (the column check reports it instead)
  const noMonth = auditCards("universe", rows, [b], RULES, { fields: cols.filter(c => c.field_name !== "Month") }).cards;
  assert.deepEqual(noMonth.find(c => c.rowId === "w2"), undefined);

  // the Fill: refused while a required column is blank, whatever else is ticked
  const sign = 1791000000000;
  const half = auditPatch(by.w1, rows[0], { fields: by.w1.gaps, values: { "Month": "" } }, RULES);
  assert.deepEqual(auditMissing(by.w1, half), ["Sign Date", "Month"]);   // no Sign Date, so no Month to default to
  const none = auditPatch(by.w1, rows[0], { fields: [] }, RULES);          // unticking can't drop them
  assert.deepEqual(auditMissing(by.w1, none), ["Sign Date", "Month"]);
  const full = auditPatch(by.w1, rows[0], { fields: by.w1.gaps, values: { "Sign Date": sign, "Month": " October " } }, RULES);
  assert.deepEqual(auditMissing(by.w1, full), []);
  assert.equal(full["Sign Date"], sign);
  assert.equal(full["Month"], "October");
  const onlyMonth = auditPatch(by.w2, rows[1], { fields: ["Month"], values: { "Month": "November" } }, RULES);
  assert.deepEqual(onlyMonth, { "Month": "November" });             // nothing from a brief it doesn't have
});

test("audit: Month defaults to the 1st of the Sign Date's month, in the Month column's own type", () => {
  const manila = (y, m, d) => Date.UTC(y, m, d) - 8 * 3600000;          // midnight in Manila
  const signed = manila(2026, 5, 17) + 15 * 3600000;                    // Jun 17, 2026, 3 PM Manila
  // the column's type decides the value
  assert.equal(monthOf(signed, { field_name: "Month", type: 5 }, RULES), manila(2026, 5, 1));
  assert.equal(monthOf(manila(2026, 0, 1), { type: 5 }, RULES), manila(2026, 0, 1));      // the 1st itself (not the day before in UTC)
  assert.equal(monthOf(manila(2026, 11, 31) + 23 * 3600000, { type: 5 }, RULES), manila(2026, 11, 1));
  const opts = (...names) => ({ type: 3, property: { options: names.map(name => ({ name })) } });
  assert.equal(monthOf(signed, opts("May 2026", "June 2026"), RULES), "June 2026");
  assert.equal(monthOf(signed, opts("May", "June"), RULES), "June");
  assert.equal(monthOf(signed, opts("Q1", "Q2"), RULES), null);              // no such option: left for a person
  assert.equal(monthOf(signed, { type: 1 }, RULES), "June 2026");
  assert.equal(monthOf(null, { type: 5 }, RULES), null);

  const fields = [{ field_name: "Sign Date", type: 5 }, { field_name: "Month", type: 5 }];
  const card = { kind: "audit", target: "universe", gaps: ["Sign Date", "Month"], required: ["Sign Date", "Month"], brief: null };
  // a Sign Date typed in the sheet
  const typed = auditPatch(card, { fields: {} }, { fields: card.gaps, values: { "Sign Date": signed } }, RULES, { fields });
  assert.deepEqual(typed, { "Sign Date": signed, "Month": manila(2026, 5, 1) });
  assert.deepEqual(auditMissing(card, typed), []);
  // a Sign Date already on the row (only Month is missing)
  const onRow = { ...card, gaps: ["Month"], required: ["Month"] };
  assert.deepEqual(auditPatch(onRow, { fields: { "Sign Date": signed } }, { fields: ["Month"] }, RULES, { fields }), { "Month": manila(2026, 5, 1) });
  // a Month picked by hand wins
  const picked = manila(2026, 6, 1);
  assert.equal(auditPatch(card, { fields: {} }, { fields: card.gaps, values: { "Sign Date": signed, "Month": picked } }, RULES, { fields })["Month"], picked);
});

/* ---------- the audit: the signed CE (an attachment a person uploads) ---------- */

test("audit: a signed project with no Signed CE (PDF) gets a card, even without a brief", () => {
  const CE = RULES.auditFiles.field;
  const cols = ["Project Code", "Project", "Status", "Mancom Phase", "Sign Date", "Month", CE].map(field_name => ({ field_name, type: 1 }));
  const done = { "Sign Date": 1790500000000, "Month": "October" };   // nothing else blank, so only the CE is asked for
  const pdf = [{ file_token: "boxA", name: "CE.pdf", size: 1000 }];
  const rows = [
    rec("s1", { "Project Code": seg("2026TEG-P0800"), "Project": seg("Signed, no CE"), "Status": "Signed CE", ...done }),
    rec("s2", { "Project Code": seg("2026TEG-P0801"), "Project": seg("Closed, CE on file"), "Status": "Fully Closed", ...done, [CE]: pdf }),
    rec("s3", { "Project Code": seg("2026TEG-P0802"), "Project": seg("Awaiting signature"), "Status": "Won - Awaiting CE Signature", ...done }),
    rec("s4", { "Project Code": seg("2026TEG-P0803"), "Project": seg("For closing"), "Status": "For Closing", ...done, [CE]: [] }),
    rec("s5", { "Project Code": seg("2026TEG-P0804"), "Project": seg("Pitching"), "Status": "For Pitching" }),
  ];
  // the rule: exactly these four statuses (not "Won - Awaiting CE Signature": nothing is signed yet)
  for (const s of ["Fully Closed", "For Closing", "For Collection", "Signed CE"]) assert.ok(needsSignedCe({ "Status": s }, RULES), s);
  assert.ok(!needsSignedCe({ "Status": "Won - Awaiting CE Signature" }, RULES));
  assert.ok(!needsSignedCe({ "Status": "For Pitching", "Mancom Phase": "7. Won" }, RULES));

  const { cards, hidden } = auditCards("universe", rows, [], RULES, { fields: cols });
  const by = Object.fromEntries(cards.map(c => [c.rowId, c]));
  assert.deepEqual(by.s1.gaps, [CE]);
  assert.deepEqual(by.s1.files, [CE]);
  assert.deepEqual(by.s1.required, []);                // not a required column: it can be unticked
  assert.equal(by.s1.brief, null);
  assert.equal(by.s2, undefined);                      // already on file
  assert.equal(by.s3, undefined);                      // not signed yet
  assert.deepEqual(by.s4.files, [CE]);                 // an empty attachment list is blank
  assert.equal(by.s5, undefined);
  assert.equal(hidden.noBrief, 3);
  // a Universe without the column: not asked for (the column check reports it instead)
  assert.equal(auditCards("universe", rows, [], RULES, { fields: cols.filter(c => c.field_name !== CE) }).cards.length, 0);
  // ANDON never gets it
  assert.equal(auditCards("andon", rows, [], RULES, { fields: cols }).cards.length, 0);
});

test("audit: the signed CE is written as the uploaded files' tokens, and needs a file while ticked", () => {
  const CE = RULES.auditFiles.field;
  const card = { kind: "audit", target: "universe", gaps: ["Sign Date", "Month", CE], required: ["Sign Date", "Month"], files: [CE], brief: null };
  const values = { "Sign Date": 1790500000000, "Month": "October" };
  // ticked, no file: refused (untick it to fill the rest)
  assert.deepEqual(auditFilesMissing(card, { fields: card.gaps, files: [] }), [CE]);
  assert.ok(!(CE in auditPatch(card, { fields: {} }, { fields: card.gaps, values, files: [] }, RULES)));
  assert.deepEqual(auditFilesMissing(card, { fields: ["Sign Date", "Month"], files: [] }), []);
  assert.deepEqual(auditPatch(card, { fields: {} }, { fields: ["Sign Date", "Month"], values, files: [{ name: "x.pdf" }] }, RULES),
    values);                                           // unticked: the files aren't written
  // before the upload: by name (never sent: the push uploads first); after: by token only
  const files = [{ name: "CE p1.pdf", size: 10 }, { name: "CE p2.pdf", size: 20 }];
  assert.deepEqual(auditPatch(card, { fields: {} }, { fields: card.gaps, values, files }, RULES)[CE],
    [{ name: "CE p1.pdf" }, { name: "CE p2.pdf" }]);
  files[0].file_token = "boxA"; files[1].file_token = "boxB";
  const p = auditPatch(card, { fields: {} }, { fields: card.gaps, values, files }, RULES);
  assert.deepEqual(p, { ...values, [CE]: [{ file_token: "boxA" }, { file_token: "boxB" }] });
  assert.deepEqual(auditFilesMissing(card, { fields: card.gaps, files }), []);
  assert.deepEqual(auditMissing(card, p), []);
  // a file someone attached meanwhile: left alone (only blank cells are filled)
  assert.deepEqual(fillPlan({ [CE]: p[CE] }, { [CE]: [{ file_token: "other", name: "theirs.pdf" }] }), { written: {}, skipped: [CE] });
  assert.ok(isBlank([]) && !isBlank([{ file_token: "boxA" }]));
  // a reload keeps no file: the queued push is flagged so it can't run without it
  const q = queueToJSON([{ id: "q1", key: "audit::s1", kind: "audit", cardId: "universe:s1", state: "waiting", at: Date.now(),
    table: "universe", job: { clientToken: "t", choices: { fields: card.gaps, files: [{ name: "CE.pdf", size: 1, file: {} }] } } }]);
  assert.equal(q.items[0].lostFiles, true);
  assert.deepEqual(q.items[0].job.choices.files, [{ name: "CE.pdf", size: 1 }]);
});

/* ---------- search: every column, every status ---------- */

test("search: the Universe finds a project in any column and any status; the default view is unchanged", () => {
  const rows = [
    rec("a", { "Project": seg("Lumen Fest"), "Status": "Lost", "Year": seg("2026"), "PAR": seg("202607030034"),
               "Project Description": seg("Hybrid stage, LED wall") }),
    rec("b", { "Project": seg("Harbor Run"), "Status": "Signed CE", "Year": seg("2026"), "MKT": [user("ou_m", "Mika Market")] }),
    rec("c", { "Project": seg("Old Lumen"), "Status": "Lost", "Year": seg("2025") }),
  ];
  const opts = { year: "2026", folded: ["Lost"], statusOrder: [] };
  const ids = (v) => v.groups.flatMap(g => g.rows.map(r => r.id));
  // nothing typed: Lost is its own folded group, out of the totals
  const plain = universeView(rows, opts);
  assert.equal(plain.count, 1);
  assert.equal(plain.foldedCount, 1);
  // a search looks everywhere: a folded status, the PAR, the description, a person in any column
  assert.deepEqual(ids(universeView(rows, { ...opts, query: "lumen" })), ["a"]);   // the year still applies
  assert.deepEqual(ids(universeView(rows, { ...opts, query: "202607030034" })), ["a"]);
  assert.deepEqual(ids(universeView(rows, { ...opts, query: "led wall" })), ["a"]);
  assert.deepEqual(ids(universeView(rows, { ...opts, query: "mika" })), ["b"]);
  assert.deepEqual(ids(universeView(rows, { ...opts, year: "all", query: "lumen" })).sort(), ["a", "c"]);
  assert.ok(matchesQuery(rows[0].fields, "fest hybrid"));                  // every word, in any column
  assert.ok(!matchesQuery(rows[0].fields, "fest harbor"));
});

test("search: Collections and ANDON search every column too", () => {
  const coll = [rec("c1", { "AR Name": seg("Tranche 1"), "Sales Remarks": seg("waiting on PO 7781"), "Status": "For Collection" }),
                rec("c2", { "AR Name": seg("Tranche 2"), "Status": "For Invoicing" })];
  assert.deepEqual(collectionsView(coll, { query: "7781" }).groups.flatMap(g => g.rows.map(r => r.id)), ["c1"]);
  const andon = [rec("n1", { "Project": seg("Expo"), "Project Code": seg("2025TEG-P0999"), "TRIBE": "Tribe A" }),
                 rec("n2", { "Project": seg("Summit"), "Project Code": seg("2026TEG-P0127"), "TRIBE": "Tribe B" }),
                 rec("n3", { "Project": seg("No code") }),
                 rec("n4", { "Project": seg("Big Fest"), "Project Code": seg("2025TEG-P1000"), "TRIBE": "Tribe A" })];
  // Project Code Z-A: this year's first, and P1000 above P0999 (numbers as numbers); no code last
  assert.deepEqual(andonView(andon).rows.map(r => r.id), ["n2", "n4", "n1", "n3"]);
  assert.deepEqual(andonView(andon, { sort: "asc" }).rows.map(r => r.id), ["n1", "n4", "n2", "n3"]);
  assert.deepEqual(andonView(andon, { query: "tribe b" }).rows.map(r => r.id), ["n2", "n4", "n1"]);   // "b" is in "tribe": every word, anywhere
  assert.deepEqual(andonView(andon, { query: "summit tribe" }).rows.map(r => r.id), ["n2"]);
});

/* ---------- the row editor ---------- */

const EDIT_DEFS = [
  { field_name: "Project", type: 1 }, { field_name: "Amount", type: 2 }, { field_name: "Status", type: 3 },
  { field_name: "Tools", type: 4 }, { field_name: "Start", type: 5 }, { field_name: "Done", type: 7 },
  { field_name: "AM", type: 11 }, { field_name: "Link", type: 15 }, { field_name: "Files", type: 17 },
  { field_name: "Total", type: 20 }, { field_name: "Brief", type: 19 },
];
const LOADED = {
  "Project": seg("Lumen Fest"), "Amount": 1000, "Status": "Signed CE", "Tools": ["LED Wall", "Sound"],
  "Start": 1790000000000, "AM": [user("ou_a", "Ana")], "Link": { link: "https://x.test/a", text: "a" },
  "Files": [{ file_token: "boxA", name: "CE.pdf", size: 10 }], "Total": { type: 2, value: [1120] }, "Brief": { type: 1, value: ["x"] },
};

test("row editor: only real changes count; formulas and lookups never do", () => {
  const def = (n) => EDIT_DEFS.find(d => d.field_name === n);
  for (const n of ["Project", "Amount", "Status", "Tools", "Start", "Done", "AM", "Link", "Files"]) assert.ok(canEditField(def(n)), n);
  assert.ok(!canEditField(def("Total")) && !canEditField(def("Brief")));
  // values put back as they were, re-ordered, or re-typed with spaces aren't changes
  const same = { "Project": "  Lumen Fest ", "Amount": 1000, "Tools": ["Sound", "LED Wall"], "AM": [{ id: "ou_a" }], "Done": false,
                 "Files": [{ file_token: "boxA", name: "CE.pdf" }], "Total": 5, "Brief": "y" };
  assert.deepEqual(editChanges(EDIT_DEFS, LOADED, { edits: same, files: [] }), {});
  // real changes, in write format; a cleared cell is null
  const ch = editChanges(EDIT_DEFS, LOADED, { edits: { "Project": "Lumen Festival", "Status": null, "AM": [{ id: "ou_b" }], "Done": true,
    "Files": [] }, files: [{ field: "Files", name: "new.pdf", size: 5 }] });
  assert.deepEqual(Object.keys(ch).sort(), ["AM", "Done", "Files", "Project", "Status"]);
  assert.equal(ch["Status"], null);
  assert.deepEqual(ch["Files"], [{ file_token: undefined, name: "new.pdf", size: 5 }]);   // the old file removed, a new one added
  // the write: files by token only, and never before they've uploaded
  assert.throws(() => editWrite(ch, EDIT_DEFS), (e) => /new\.pdf/.test(e.userMessage));
  ch["Files"][0].file_token = "boxN";
  assert.deepEqual(editWrite(ch, EDIT_DEFS)["Files"], [{ file_token: "boxN" }]);
  assert.equal(editKey(writeValueOf(def("Link"), LOADED["Link"])), editKey({ link: "https://x.test/a", text: "a" }));
});

test("row editor: a cell someone else changed meanwhile stops the write; one already as wanted is fine", () => {
  const write = { "Project": "Lumen Festival", "Amount": 2000 };
  assert.deepEqual(editCheck(write, EDIT_DEFS, LOADED, LOADED), { stale: [], done: false });
  // someone changed Amount in Lark after the row was opened
  assert.deepEqual(editCheck(write, EDIT_DEFS, LOADED, { ...LOADED, "Amount": 1500 }).stale, ["Amount"]);
  // a cell this edit doesn't touch changing is nobody's business
  assert.deepEqual(editCheck(write, EDIT_DEFS, LOADED, { ...LOADED, "Status": "Fully Closed" }).stale, []);
  // someone made the same change: not a conflict; all of it there already: done
  assert.deepEqual(editCheck(write, EDIT_DEFS, LOADED, { ...LOADED, "Amount": 2000 }), { stale: [], done: false });
  assert.equal(editCheck(write, EDIT_DEFS, LOADED, { ...LOADED, "Project": seg("Lumen Festival"), "Amount": 2000 }).done, true);
});

/* ---------- custom tags ---------- */

test("tags: a Tags cell is comma-separated text; adding and removing keep the other tags", () => {
  assert.deepEqual(tagsOf(seg(" No Revenue,Hidden , no revenue,, ")), ["No Revenue", "Hidden"]);   // trimmed, once each (any case)
  assert.deepEqual(tagsOf(null), []);
  assert.equal(tagsWith(seg("Client A"), "No Revenue"), "Client A, No Revenue");
  assert.equal(tagsWith(seg("no revenue"), "No Revenue"), "no revenue");                         // already there: unchanged
  assert.equal(tagsWith(null, "Hidden"), "Hidden");
  assert.equal(tagsWithout(seg("Client A, No Revenue"), "no revenue"), "Client A");
  assert.equal(tagsWithout(seg("Hidden"), "Hidden"), null);                                      // nothing left: an empty cell
});

test("tags: the custom tags come from the Variables table, whatever its columns are called", () => {
  const rows = [rec("v1", { "Variable": seg("custom_tag"), "Value": seg("No Revenue") }),
                rec("v2", { "Variable": seg("custom_tag"), "Value": seg("Hidden") }),
                rec("v3", { "Variable": seg("usd_rate"), "Value": seg("57") }),
                rec("v4", { "Variable": seg("custom_tag"), "Value": seg("hidden") }),   // a repeat (any case): once
                rec("v5", { "Variable": seg("custom_tag"), "Value": seg("") })];
  const f = (field_name, type = 1) => ({ field_name, type });
  const cols = variableColumns([f("Variable"), f("Value")], rows, RULES.tags);
  assert.deepEqual(cols, { name: "Variable", value: "Value" });
  assert.deepEqual(customTagsFrom(rows, cols, "custom_tag"), [{ tag: "No Revenue", id: "v1" }, { tag: "Hidden", id: "v2" }]);
  // other names: found by where "custom_tag" is
  const other = rows.map(r => rec(r.record_id, { "Key": r.fields["Variable"], "Notes": seg(""), "Values": r.fields["Value"] }));
  assert.deepEqual(variableColumns([f("Key"), f("Notes"), f("Values")], other, RULES.tags), { name: "Key", value: "Values" });
  assert.equal(variableColumns([f("A"), f("B")], [rec("x", { "A": seg("nope") })], RULES.tags), null);
  assert.deepEqual(customTagsFrom(rows, null, "custom_tag"), []);
});

test("tags: a marked row leaves the audit list for its tag's group", () => {
  const cols = ["Project Code", "Project", "Status", "Sign Date", "Month", RULES.auditFiles.field, "Tags"].map(field_name => ({ field_name, type: 1 }));
  const won = { "Status": "Signed CE" };   // blank Sign Date, Month and signed CE: an audit card
  const rows = [
    rec("t1", { "Project Code": seg("2026TEG-P0901"), "Project": seg("Free event"), ...won, "Tags": seg("Client A, no revenue") }),
    rec("t2", { "Project Code": seg("2026TEG-P0902"), "Project": seg("Parked"), ...won, "Tags": seg("Hidden") }),
    rec("t3", { "Project Code": seg("2026TEG-P0903"), "Project": seg("Normal"), ...won, "Tags": seg("Client A") }),
  ];
  const tags = ["No Revenue", "Hidden"];
  const res = auditCards("universe", rows, [], RULES, { fields: cols, tags, tagField: "Tags", hide: new Set() });
  assert.deepEqual(res.cards.map(c => c.rowId), ["t3"]);                    // a tag that isn't a custom tag doesn't count
  assert.deepEqual(res.tagged.map(c => [c.rowId, c.tag]), [["t1", "No Revenue"], ["t2", "Hidden"]]);   // the tag's own spelling
  assert.equal(customTagOf(rows[1].fields, "Tags", tags), "Hidden");
  // groups in the tags' order; empty ones left out
  assert.deepEqual(tagGroups(res.tagged, ["Hidden", "Gone", "No Revenue"]).map(g => [g.tag, g.cards.length]), [["Hidden", 1], ["No Revenue", 1]]);
  // no custom tags (or no Tags column): everything stays in the list
  assert.equal(auditCards("universe", rows, [], RULES, { fields: cols, tags: [], tagField: "Tags" }).cards.length, 3);
});

/* ---------- the audit: lost, stalled and archived projects ---------- */

test("audit: a lost, stalled or archived project must have Loss Month and Reason for Loss", () => {
  const cols = ["Project Code", "Project", "Status", "Mancom Phase", "Sign Date", "Month", "Loss Month", "Reason for Loss"]
    .map(field_name => ({ field_name, type: 1 }));
  const rows = [
    rec("l1", { "Project Code": seg("2026TEG-P0950"), "Project": seg("Lost pitch"), "Status": "Lost" }),
    rec("l2", { "Project Code": seg("2026TEG-P0951"), "Project": seg("Stalled"), "Status": "Stalled", "Loss Month": "March" }),
    rec("l3", { "Project Code": seg("2026TEG-P0952"), "Project": seg("Archived, complete"), "Status": "Archived",
                "Loss Month": "May", "Reason for Loss": seg("Budget cut") }),
    // won by phase, but the Status says lost: the lost rule wins (no Sign Date asked)
    rec("l4", { "Project Code": seg("2026TEG-P0953"), "Project": seg("Won then lost"), "Status": "Lost", "Mancom Phase": "7. Won" }),
    rec("l5", { "Project Code": seg("2026TEG-P0954"), "Project": seg("Pitching"), "Status": "For Pitching" }),
  ];
  for (const s of ["Stalled", "Lost", "Archived"]) assert.ok(isLostProject({ "Status": s }, RULES), s);
  assert.ok(!isLostProject({ "Status": "Fully Closed" }, RULES));
  const { cards } = auditCards("universe", rows, [], RULES, { fields: cols });
  const by = Object.fromEntries(cards.map(c => [c.rowId, c]));
  assert.deepEqual(by.l1.required, ["Loss Month", "Reason for Loss"]);
  assert.equal(by.l1.requiredRule, "lost");
  assert.deepEqual(by.l2.required, ["Reason for Loss"]);            // only what's blank
  assert.equal(by.l3, undefined);                                    // complete
  assert.deepEqual(by.l4.required, ["Loss Month", "Reason for Loss"]);
  assert.equal(by.l5, undefined);
  // the Fill: refused while either is blank, with the right sentence
  const half = auditPatch(by.l1, rows[0], { fields: by.l1.gaps, values: { "Loss Month": "June" } }, RULES);
  assert.deepEqual(auditMissing(by.l1, half), ["Reason for Loss"]);
  assert.equal(requiredMessage(by.l1, ["Reason for Loss"]), "A lost, stalled or archived project needs Reason for Loss.");
  const full = auditPatch(by.l1, rows[0], { fields: [], values: { "Loss Month": "June", "Reason for Loss": " Client went with another agency " } }, RULES);
  assert.deepEqual(full, { "Loss Month": "June", "Reason for Loss": "Client went with another agency" });   // can't be unticked
  // a won project's sentence is unchanged; a Universe without the columns isn't asked
  const won = auditCards("universe", [rec("w", { "Project Code": seg("2026TEG-P0955"), "Status": "Signed CE" })], [], RULES, { fields: cols }).cards[0];
  assert.equal(requiredMessage(won, ["Month"]), "A won project needs Month.");
  assert.equal(auditCards("universe", rows, [], RULES, { fields: cols.filter(c => !/Loss/.test(c.field_name)) }).cards.length, 0);
});

test("source tables: newest submitted first, every column searched, long tables capped", () => {
  const rows = [
    rec("p1", { "Request No.": url("202601010001"), "Project Code": seg("2026TEG-P0001"), "Project Name": seg("Old one"), "Status": "Approved", "Submitted at": 100 }),
    rec("p2", { "Request No.": url("202602020002"), "Project Code": seg("2026TEG-P0002"), "Project Name": seg("New one"), "Status": "Under Review",
                "Submitted at": 300, "Amount": 1120, "Amount-Currency": "PHP", "Initiator department": seg("Account Managers") }),
    rec("p3", { "Request No.": url("202603030003"), "Project Name": seg("Undated") }),
  ];
  const v = sourceView(rows);
  assert.deepEqual(v.rows.map(r => r.id), ["p2", "p1", "p3"]);
  assert.deepEqual(sourceView(rows, { sort: "asc" }).rows.map(r => r.id), ["p1", "p2", "p3"]);
  assert.equal(v.rows[0].requestNo, "202602020002");
  assert.equal(v.rows[0].link, "https://applink.larksuite.com/x?instanceId=202602020002");
  assert.deepEqual([v.rows[0].amount, v.rows[0].currency, v.rows[0].dept], [1120, "PHP", "Account Managers"]);
  assert.deepEqual(sourceView(rows, { query: "account managers" }).rows.map(r => r.id), ["p2"]);   // a column the table doesn't show
  const capped = sourceView(rows, { limit: 2 });
  assert.deepEqual([capped.rows.length, capped.count], [2, 3]);
});

test("audit: a lost project's Status can be changed among Stalled, Lost and Archived", () => {
  const cols = ["Project Code", "Project", "Status", "Loss Month", "Reason for Loss"].map(field_name => ({ field_name, type: 1 }));
  const row = rec("s1", { "Project Code": seg("2026TEG-P0960"), "Project": seg("Marked lost"), "Status": "Lost" });
  const [c] = auditCards("universe", [row], [], RULES, { fields: cols }).cards;
  assert.equal(c.lost, true);
  const values = { "Loss Month": "June", "Reason for Loss": "Paused by client" };
  // picked Stalled: written with the Fill
  assert.deepEqual(auditPatch(c, row, { fields: c.gaps, values, status: "Stalled" }, RULES),
    { ...values, "Status": "Stalled" });
  // the same one, or something outside the three: nothing changes
  assert.equal(statusChange(c, { status: "Lost" }, RULES), null);
  assert.equal(statusChange(c, { status: "Fully Closed" }, RULES), null);
  assert.equal(statusChange(c, {}, RULES), null);
  // a won project's card never changes Status
  const won = auditCards("universe", [rec("w", { "Project Code": seg("2026TEG-P0961"), "Status": "Signed CE" })], [], RULES,
    { fields: [...cols, { field_name: "Sign Date", type: 5 }, { field_name: "Month", type: 5 }] }).cards[0];
  assert.equal(statusChange(won, { status: "Stalled" }, RULES), null);

  // Status isn't a blank: written only if the row still says what the card showed
  const patch = { "Reason for Loss": "Paused by client", "Status": "Stalled" };
  assert.deepEqual(fillPlan(patch, { "Status": "Lost" }, { Status: "Lost" }), { written: patch, skipped: [] });
  assert.deepEqual(fillPlan(patch, { "Status": "Archived" }, { Status: "Lost" }),      // someone changed it meanwhile
    { written: { "Reason for Loss": "Paused by client" }, skipped: ["Status"] });
  assert.deepEqual(fillPlan(patch, { "Status": "Stalled" }, { Status: "Lost" }),       // already what we want
    { written: { "Reason for Loss": "Paused by client" }, skipped: [] });
  assert.deepEqual(fillPlan({ "Status": "Stalled" }, { "Status": "Lost" }), { written: {}, skipped: ["Status"] });   // never without the guard
});

/* ---------- inbox filters ---------- */

test("filters: a card takes its project's Client, Status, BD, AM and Tribe; a new brief its own BD and AM", () => {
  const universe = [rec("u1", { "Project Code": seg("2026TEG-P0700"), "Client": seg("Acme"), "Status": "Signed CE",
    "BD": [user("ou_b", "Bea Dee")], "AM": [user("ou_a", "Ana Em")] })];
  const andon = [rec("a1", { "Project Code": seg("2026TEG-P0700"), "TRIBE": "Tribe A" }),
                 rec("a2", { "Project Code": seg("2026TEG-P0701"), "TRIBE": "Tribe B" })];
  const idx = filterIndex(universe, andon);
  // a card for a project in the Universe (any kind: an invoice, a PAR, an audit card…)
  const f1 = cardFacets({ kind: "invoice", code: "2026TEG-P0700" }, idx);
  assert.deepEqual(f1, { client: ["Acme"], status: ["Signed CE"], bd: ["Bea Dee"], am: ["Ana Em"], tribe: ["Tribe A"], inUniverse: true });
  // a brief not in the Universe yet: its own BD and AM, ANDON's tribe, no client or status
  const brief = { kind: "brief", code: "2026TEG-P0701", record: rec("b", { "BD": [user("ou_x", "Xu")], "AM": [user("ou_y", "Yo")] }) };
  const f2 = cardFacets(brief, idx);
  assert.deepEqual(f2, { client: [], status: [], bd: ["Xu"], am: ["Yo"], tribe: ["Tribe B"], inUniverse: false });
  // a Universe Tribe column (a lookup) wins over ANDON's
  const withTribe = filterIndex([rec("u", { "Project Code": seg("2026TEG-P0700"), "Tribe": { type: 3, value: ["Tribe Z"] } })], andon);
  assert.deepEqual(cardFacets({ kind: "par", code: "2026TEG-P0700" }, withTribe).tribe, ["Tribe Z"]);

  // passing: any (null), a value (any case), or none
  assert.ok(passesFilters(f1, { client: null, am: "ana em" }));
  assert.ok(!passesFilters(f1, { client: "Other" }));
  assert.ok(passesFilters(f2, { client: NONE, status: NONE }));
  assert.ok(!passesFilters(f1, { status: NONE }));
  assert.ok(passesFilters(f1, { client: "Acme", status: "Signed CE", bd: "Bea Dee", am: "Ana Em", tribe: "Tribe A" }));   // all together
});

test("filters: each list offers what the cards have, counted as the other filters leave them", () => {
  const card = (client, status, am) => ({ facets: { client: client ? [client] : [], status: status ? [status] : [], bd: [], am, tribe: [] } });
  const cards = [card("Acme", "Lost", ["Ana"]), card("Acme", "Signed CE", ["Ana", "Bo"]), card("Zeta", "Signed CE", ["Bo"]), card("", "", [])];
  assert.deepEqual(filterChoices(cards, "client", {}), { values: [{ value: "Acme", n: 2 }, { value: "Zeta", n: 1 }], none: 1 });
  // the Status column's order first
  assert.deepEqual(filterChoices(cards, "status", {}, ["Signed CE", "Lost"]).values.map(v => v.value), ["Signed CE", "Lost"]);
  // with AM = Bo picked, the client counts only cover Bo's cards (and the AM list ignores its own pick)
  assert.deepEqual(filterChoices(cards, "client", { am: "Bo" }).values, [{ value: "Acme", n: 1 }, { value: "Zeta", n: 1 }]);
  assert.deepEqual(filterChoices(cards, "am", { am: "Bo" }).values, [{ value: "Ana", n: 2 }, { value: "Bo", n: 2 }]);
});

test("filters: the Client box offers the closest matches to what's typed", () => {
  const v = (value, n) => ({ value, n });
  const clients = [v("Kestrel Motors", 3), v("Acme Kestrel", 1), v("Lumen Bank", 5), v("Bluepeak Telecom", 2), v("Kes", 1), v("Orchid Cosmetics", 1)];
  const names = (q, limit) => closestMatches(clients, q, limit).map(x => x.value);
  assert.deepEqual(names("kes"), ["Kes", "Kestrel Motors", "Acme Kestrel"]);    // whole name, starts with, then a word starts with
  assert.deepEqual(names("bank"), ["Lumen Bank"]);
  assert.deepEqual(names("tele"), ["Bluepeak Telecom"]);
  assert.deepEqual(names("lmnbk"), ["Lumen Bank"]);                             // letters in order
  assert.deepEqual(names("zzz"), []);
  assert.deepEqual(names("", 2), ["Lumen Bank", "Kestrel Motors"]);              // nothing typed: the most cards
  assert.deepEqual(names(" KESTREL "), ["Kestrel Motors", "Acme Kestrel"]);    // any case, spaces trimmed
});

test("ANDON approval: an ANDON row with a Project Approval for its code gets that PAR's Request No.", () => {
  const par = (id, code, no, status, at) => rec(id, { "Project Code": seg(code), "Status": status, "Submitted at": at,
    "Project Name": seg(`PAR ${code}`), "Request No.": { link: `https://example.larksuite.com/approval/${no}`, text: no } });
  const pars = [
    par("p1", "2026TEG-P0800", "202609010001", "Under Review", 1790000000000),
    par("p2", "2026TEG-P0800", "202608010001", "Approved", 1780000000000),   // approved beats a newer one under review
    par("p3", "2026TEG-P0801", "202609020001", "Rejected", 1790000000000),   // void: never used
    par("p4", "2026TEG-P0802", "202609030001", "Under Review", 1790000000000),
    par("p5", "2026TEG-P0802", "202609040001", "Under Review", 1791000000000),   // the newer of two under review
  ];
  const best = parApprovals(pars, RULES);
  assert.deepEqual(best.get("2026TEG-P0800").value, { link: "https://example.larksuite.com/approval/202608010001", text: "202608010001" });
  assert.equal(best.get("2026TEG-P0802").requestNo, "202609040001");
  assert.equal(best.has("2026TEG-P0801"), false);

  const cols = ["Project", "Project Code", "Approval"].map(field_name => ({ field_name, type: field_name === "Approval" ? 15 : 1 }));
  const andon = [
    rec("a1", { "Project Code": seg("2026TEG-P0800"), "Project": seg("Has a PAR") }),
    rec("a2", { "Project Code": seg("2026TEG-P0800 "), "Project": seg("Same project, second row") }),   // a stray space still matches
    rec("a3", { "Project Code": seg("2026TEG-P0801"), "Project": seg("Only a rejected PAR") }),
    rec("a4", { "Project Code": seg("2026TEG-P0899"), "Project": seg("No PAR") }),
    rec("a5", { "Project Code": seg("2026TEG-P0802"), "Project": seg("Already has it"), "Approval": { link: "https://x.example/1", text: "1" } }),
  ];
  const { cards, hidden } = approvalCards(andon, pars, RULES, { fields: cols });
  assert.deepEqual(cards.map(c => c.rowId).sort(), ["a1", "a2"]);   // won or not doesn't matter: only the PAR does
  assert.equal(hidden.done, 1);
  const c = cards.find(x => x.rowId === "a1");
  assert.equal(c.kind, "approval");
  assert.equal(c.field, "Approval");
  assert.equal(c.requestNo, "202608010001");
  assert.deepEqual(c.link, { link: "https://example.larksuite.com/approval/202608010001", text: "202608010001" });
  // an ANDON without the column gets no cards
  assert.equal(approvalCards(andon, pars, RULES, { fields: cols.slice(0, 2) }).cards.length, 0);
});

test("attachments: download addresses carry the Base's permission context", () => {
  const api = "https://open.larksuite.com/open-apis";
  const extra = encodeURIComponent(JSON.stringify({ bitablePerm: { tableId: "tblX" } }));
  assert.equal(attachmentRequest({ file_token: "boxA" }, "tblX", api), `${api}/drive/v1/medias/boxA/download?extra=${extra}`);
  const own = `${api}/drive/v1/medias/boxA/download?extra=abc`;
  assert.equal(attachmentRequest({ file_token: "boxA", url: own }, "tblX", api), own);                 // the cell's own address
  assert.equal(attachmentRequest({ file_token: "boxA", url: "https://evil.example/x" }, "tblX", api),  // never a foreign one
    `${api}/drive/v1/medias/boxA/download?extra=${extra}`);
  assert.equal(attachmentLinkRequest({ file_token: "boxA" }, "tblX", api),
    `${api}/drive/v1/medias/batch_get_tmp_download_url?file_tokens=boxA&extra=${extra}`);
  const json = { code: 0, data: { tmp_download_urls: [{ file_token: "boxA", tmp_download_url: "https://dl.example/boxA" }] } };
  assert.equal(attachmentLink(json, "boxA"), "https://dl.example/boxA");
  assert.equal(attachmentLink({ data: { tmp_download_urls: [{ file_token: "boxA", tmp_download_url: "javascript:alert(1)" }] } }, "boxA"), "");
  assert.equal(attachmentLink(null, "boxA"), "");
});

test("PM audit: a project whose PM differs between the Universe and ANDON, or is blank in either, gets a card", () => {
  const p = (id, name) => [{ id, name }];
  const uni = [
    rec("u1", { "Project Code": seg("2026TEG-P0900"), "Project": seg("Same"), "PM": p("ou_a", "Ana") }),
    rec("u2", { "Project Code": seg("2026TEG-P0901"), "Project": seg("Differs"), "PM": p("ou_a", "Ana") }),
    rec("u3", { "Project Code": seg("2026TEG-P0902"), "Project": seg("Universe blank") }),
    rec("u4", { "Project Code": seg("2026TEG-P0903"), "Project": seg("ANDON blank"), "PM": p("ou_a", "Ana") }),
    rec("u5", { "Project Code": seg("2026TEG-P0904"), "Project": seg("Not in ANDON") }),
    rec("u6", { "Project Code": seg("2026TEG-P0905"), "Project": seg("One of two ANDON rows differs"), "PM": p("ou_a", "Ana") }),
  ];
  const andon = [
    rec("a1", { "Project Code": seg("2026TEG-P0900"), "PM (LEAD)": p("ou_a", "Ana") }),
    rec("a2", { "Project Code": seg("2026TEG-P0901"), "PM (LEAD)": p("ou_b", "Ben") }),
    rec("a3", { "Project Code": seg("2026TEG-P0902"), "PM (LEAD)": p("ou_b", "Ben") }),
    rec("a4", { "Project Code": seg("2026TEG-P0903") }),
    rec("a5", { "Project Code": seg("2026TEG-P0905"), "PM (LEAD)": p("ou_a", "Ana") }),
    rec("a6", { "Project Code": seg("2026TEG-P0905"), "PM (LEAD)": p("ou_c", "Cara") }),
  ];
  const { cards } = pmCards(uni, andon, RULES);
  const by = Object.fromEntries(cards.map(c => [c.rowId, c]));
  assert.deepEqual(Object.keys(by).sort(), ["u2", "u3", "u4", "u6"]);       // same PM, or not in ANDON: no card
  assert.deepEqual(by.u2.suggestion.map(u => u.id), ["ou_b"]);              // ANDON's PM is suggested
  assert.deepEqual(by.u4.suggestion.map(u => u.id), ["ou_a"]);              // ANDON blank: the Universe's
  assert.deepEqual(by.u6.andonRows, ["a5", "a6"]);                           // every ANDON row gets the PM
  assert.deepEqual(by.u2.loaded.andon.a2, { "PM (LEAD)": p("ou_b", "Ben") });
  // a table without its PM column: no cards
  assert.equal(pmCards(uni, andon, RULES, { fields: { universe: [{ field_name: "Project" }] } }).cards.length, 0);
});

test("brief files: a blank Other Attachments gets a card linking to the brief's files in Lark Approval", () => {
  const seg = (text) => [{ type: "text", text }];
  const link = (n) => ({ link: `https://www.larksuite.com/approval/admin/previewAttachment?key=K${n}`, text: `${n} attachment(s)`, type: "url" });
  const L = "Attachment (Project Brief, Pitch Deck)";
  const briefs = [
    { record_id: "b1", fields: { "Project Code": seg("2026TEG-P0001"), "Status": "Approved", "Submitted at": 100, [L]: link(1) } },
    { record_id: "b2", fields: { "Project Code": seg("2026teg-p0001"), "Status": "Approved", "Submitted at": 200, [L]: link(2) } },   // newer: this one
    { record_id: "b3", fields: { "Project Code": seg("2026TEG-P0002"), "Status": "Approved", "Submitted at": 300, [L]: link(3) } },
    { record_id: "b4", fields: { "Project Code": seg("2026TEG-P0003"), "Status": "Recalled", "Submitted at": 400, [L]: link(4) } },   // voided
    { record_id: "b5", fields: { "Project Code": seg("2026TEG-P0004"), "Status": "Approved", "Submitted at": 500 } },                 // no link
    { record_id: "b6", fields: { "Project Code": seg("2026TEG-P0005"), "Status": "Approved", "Submitted at": 600, [L]: link(6) } },
  ];
  const universe = [
    { record_id: "u1", fields: { "Project Code": seg("2026TEG-P0001"), "Project": seg("Summer Cup"), "Status": "Signed CE" } },
    { record_id: "u2", fields: { "Project Code": seg("2026TEG-P0002"), "Other Attachments": [{ file_token: "x", name: "a.pdf", size: 1 }] } },   // has files
    { record_id: "u3", fields: { "Project Code": seg("2026TEG-P0003") } },
    { record_id: "u4", fields: { "Project Code": seg("2026TEG-P0004") } },
    { record_id: "u5", fields: { "Project Code": seg("2026TEG-P0005"), "Status": "Lost", "Other Attachments": [] } },   // lost projects count too
  ];
  const { cards } = fileCards(universe, briefs, RULES);
  assert.deepEqual(cards.map(c => c.rowId), ["u5", "u1"]);
  // …unless their status is left out
  const skip = { ...RULES, briefFiles: { ...RULES.briefFiles, skipStatuses: ["Lost"] } };
  assert.deepEqual(fileCards(universe, briefs, skip).cards.map(c => c.rowId), ["u1"]);
  const c = cards[1];
  assert.equal(c.kind, "files");
  assert.equal(c.link, link(2).link);
  assert.equal(c.label, "2 attachment(s)");
  assert.equal(c.field, "Other Attachments");
  // a table without its column gives no cards
  const fields = { universe: [{ field_name: "Project Code" }], brief: [{ field_name: L }] };
  assert.equal(fileCards(universe, briefs, RULES, { fields }).cards.length, 0);
});

test("CE audit: the Universe's Internal CE (Sheet) and ANDON's Working CE must be the same link", () => {
  const seg = (text) => [{ type: "text", text }];
  const url = (link) => ({ link, text: link, type: "url" });
  const A = "https://docs.google.com/spreadsheets/d/AAA/edit", B = "https://docs.google.com/spreadsheets/d/BBB/edit";
  const U = RULES.ceSync.universe, N = RULES.ceSync.andon;
  const universe = [
    { record_id: "u1", fields: { "Project Code": seg("2026TEG-P0001"), "Project": seg("Same"), [U]: url(A) } },
    { record_id: "u2", fields: { "Project Code": seg("2026TEG-P0002"), "Project": seg("Different"), [U]: url(A) } },
    { record_id: "u3", fields: { "Project Code": seg("2026TEG-P0003"), "Project": seg("Universe blank") } },
    { record_id: "u4", fields: { "Project Code": seg("2026TEG-P0004"), "Project": seg("Both blank") } },
    { record_id: "u5", fields: { "Project Code": seg("2026TEG-P0005"), "Project": seg("Not in ANDON") } },
    { record_id: "u6", fields: { "Project Code": seg("2026TEG-P0006"), "Project": seg("Trailing slash"), [U]: url(A + "/") } },
  ];
  const andon = [
    { record_id: "a1", fields: { "Project Code": seg("2026TEG-P0001"), [N]: url(A) } },
    { record_id: "a2", fields: { "Project Code": seg("2026TEG-P0002"), [N]: url(B) } },
    { record_id: "a3", fields: { "Project Code": seg("2026TEG-P0003"), [N]: url(B) } },
    { record_id: "a4", fields: { "Project Code": seg("2026TEG-P0004") } },
    { record_id: "a6", fields: { "Project Code": seg("2026TEG-P0006"), [N]: url(A) } },
  ];
  const { cards } = ceCards(universe, andon, RULES);
  const by = Object.fromEntries(cards.map(c => [c.rowId, c]));
  assert.deepEqual(cards.map(c => c.rowId), ["u4", "u3", "u2"]);   // newest code first
  assert.equal(by.u2.suggestion, B);                               // ANDON's first
  assert.equal(by.u3.suggestion, B);
  assert.equal(by.u4.suggestion, "");                              // both blank: pasted by hand
  assert.deepEqual(by.u2.andonRows, ["a2"]);
  assert.deepEqual(ceWrites(B, RULES), { universe: { [U]: { link: B, text: B } }, andon: { [N]: { link: B, text: B } } });
  // A table without its column gives no cards.
  assert.equal(ceCards(universe, andon, RULES, { fields: { universe: [{ field_name: "Project Code" }], andon: [{ field_name: N }] } }).cards.length, 0);
  assert.equal(linkIn(url(A)), A);
  assert.equal(linkIn(seg(A)), A);
  assert.equal(validLink(" " + A + " "), A);
  assert.equal(validLink("docs.google.com/x"), "");
  assert.equal(validLink("http://x.com/a"), "");
});

test("Tagging: every project and its tags, tag counts, filters, and tags that look misspelt", () => {
  const seg = (text) => [{ type: "text", text }];
  const rec = (id, code, tags) => ({ record_id: id, fields: { "Project Code": seg(code), "Project": seg(`P ${id}`), "Status": "Signed CE", ...(tags ? { Tags: seg(tags) } : {}) } });
  const records = [rec("r1", "2026TEG-P0001", "Booth,Event"), rec("r2", "2026TEG-P0003", "booth"), rec("r3", "2026TEG-P0002", ""),
                   rec("r4", "2026TEG-P0004", "Federal Land"), rec("r5", "2026TEG-P0005", "Federal Lnad, Event")];
  const v = taggingView(records, "Tags");
  assert.deepEqual(v.rows.map(r => r.id), ["r5", "r4", "r2", "r3", "r1"]);
  assert.deepEqual(v.tags.map(t => [t.tag, t.count]), [["Booth", 2], ["Event", 2], ["Federal Land", 1], ["Federal Lnad", 1]]);
  assert.deepEqual(v.tags.find(t => t.tag === "Federal Lnad").like, ["Federal Land"]);
  assert.deepEqual(v.tags.find(t => t.tag === "Booth").like, []);
  assert.equal(v.untagged, 1);
  assert.deepEqual(taggingView(records, "Tags", { tag: "BOOTH" }).rows.map(r => r.id), ["r2", "r1"]);
  assert.deepEqual(taggingView(records, "Tags", { tag: UNTAGGED }).rows.map(r => r.id), ["r3"]);
  assert.deepEqual(taggingView(records, "Tags", { query: "event p0005" }).rows.map(r => r.id), ["r5"]);
  assert.deepEqual(lookalikeTags("federal-land", ["Federal Land", "Event"]), ["Federal Land"]);
  assert.deepEqual(lookalikeTags("Evnt", ["Event", "Booth"]), ["Event"]);
  assert.deepEqual(lookalikeTags("Expo", ["Event", "Booth"]), []);
});

test("pickTag: a custom tag in any case, a new tag spelled as used, lookalikes, bad input", () => {
  const custom = ["No Revenue", "Hidden"], inUse = ["Event", "Federal Land", "No Revenue"];
  assert.deepEqual(pickTag("  no   revenue ", custom, inUse), { tag: "No Revenue", isNew: false, like: [] });
  assert.deepEqual(pickTag("event", custom, inUse), { tag: "Event", isNew: true, like: [] });
  assert.deepEqual(pickTag("Federal Lnad", custom, inUse), { tag: "Federal Lnad", isNew: true, like: ["Federal Land"] });
  assert.deepEqual(pickTag("Hiden", custom, inUse).like, ["Hidden"]);
  assert.deepEqual(pickTag("On Hold", custom, inUse), { tag: "On Hold", isNew: true, like: [] });
  assert.ok(pickTag("   ", custom, inUse).error);
  assert.ok(pickTag("A, B", custom, inUse).error);
});
