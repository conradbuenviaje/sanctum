/* Offline checks of the accountability rules (js/accountability.js). Run: npm test */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTABILITY, RULES } from "../js/config.js";
import {
  configFrom, configValues, configWrites, isAdmin, samePerson, inScope, stageOf, applies, resolve, accountabilityItems,
  byPerson, byProject, fieldCounts, itemMatches, nextState, digestMessages, pack, telegramHandle, UNASSIGNED, ROW,
  dismissalsFrom, dismissalValue,
} from "../js/accountability.js";

const user = (id, name) => ({ id, name, en_name: name, email: `${id}@x.com` });
const rec = (id, fields) => ({ record_id: id, fields });
const seg = (text) => [{ type: "text", text }];
const MANILA = (d) => Date.parse(`${d}T00:00:00+08:00`);
const cols = { name: "Variable", value: "Value" };
const variable = (id, kind, value) => rec(id, { Variable: ACCOUNTABILITY.variables[kind], Value: JSON.stringify(value) });
const defaults = () => configFrom(ACCOUNTABILITY, [], cols);

test("the defaults are used until the Admin page saves something", () => {
  const cfg = defaults();
  assert.equal(cfg.since, "2025-01-01");
  assert.equal(cfg.rules.length, ACCOUNTABILITY.rules.length);
  assert.deepEqual(cfg.namedRoles, ["Universe Keeper", "Ops Lead", "Finance"]);
  assert.deepEqual(cfg.saved, { rule: false, role: false, person: false, setting: false, admin: false });
  assert.ok(cfg.rules.every(r => r.on && r.responsible && r.accountable));
});

test("saved Variables rows win over the defaults, kind by kind", () => {
  const cfg = configFrom(ACCOUNTABILITY, [
    variable("v1", "rule", { id: "pm", table: "andon", field: "PM (LEAD)", from: "For Pitching", lost: false, responsible: "AM", accountable: "Ops Lead" }),
    variable("v2", "role", { role: "Ops Lead", people: [{ id: "ou_ops", name: "Olive Ops" }] }),
    variable("v3", "setting", { since: "2026-01-01", skipTags: [], fallback: ["Ops Lead"] }),
    variable("v4", "person", { id: "ou_am", name: "Ana AM", telegram: "@ana_am" }),
    rec("v5", { Variable: "accountability_rule", Value: "{not json" }),
    rec("v6", { Variable: "custom_tag", Value: "No Revenue" }),
  ], cols);
  assert.equal(cfg.rules.length, 1);
  assert.equal(cfg.rules[0].from, "For Pitching");
  assert.equal(cfg.since, "2026-01-01");
  assert.deepEqual(cfg.skipTags, []);
  assert.deepEqual(cfg.roles["Ops Lead"].map(p => p.name), ["Olive Ops"]);
  assert.deepEqual(cfg.roles["Finance"], []);            // a default named role with nobody yet
  assert.equal(cfg.people.ou_am.telegram, "ana_am");
  assert.equal(cfg.problems.length, 1);
  assert.equal(cfg.rows.rule.length, 1);
});

test("Telegram handles are cleaned up", () => {
  assert.equal(telegramHandle("@juan_dc"), "juan_dc");
  assert.equal(telegramHandle("https://t.me/juan_dc"), "juan_dc");
  assert.equal(telegramHandle("ab"), "");
  assert.equal(telegramHandle("has space"), "");
});

test("saving writes only what changed", () => {
  const records = [
    variable("v1", "setting", { since: "2025-01-01", skipTags: ["Hidden"], fallback: ["AM", "BD", "Ops Lead"] }),
    variable("v2", "role", { role: "Ops Lead", people: [] }),
    variable("v3", "role", { role: "Ops Lead", people: [] }),   // a duplicate: removed
    variable("v4", "admin", { id: "ou_x", name: "Old Admin", email: "" }),
  ];
  const cfg = configFrom(ACCOUNTABILITY, records, cols);
  cfg.roles["Ops Lead"] = [{ id: "ou_ops", name: "Olive Ops", email: "" }];
  cfg.admins = [];
  const w = configWrites(cfg.rows, configValues(cfg));
  assert.deepEqual(w.update.map(u => u.id), ["v2"]);
  assert.deepEqual(w.remove.sort(), ["v3", "v4"]);
  // Every default rule and the other two named roles are new rows.
  assert.equal(w.create.filter(c => c.kind === "rule").length, ACCOUNTABILITY.rules.length);
  assert.equal(w.create.filter(c => c.kind === "role").length, 2);
  // Saved again, nothing changes.
  const after = configFrom(ACCOUNTABILITY, [
    ...configValues(cfg).map((v, i) => rec(`n${i}`, { Variable: ACCOUNTABILITY.variables[v.kind], Value: v.value })),
  ], cols);
  const again = configWrites(after.rows, configValues(after));
  assert.deepEqual(again, { create: [], update: [], remove: [] });
});

test("admins: everyone until one is saved, then only them", () => {
  const cfg = defaults();
  assert.equal(isAdmin(cfg, { name: "Anyone" }), true);
  cfg.admins = [{ id: "ou_a", name: "Ada Admin", email: "ada@x.com" }];
  assert.equal(isAdmin(cfg, { name: "Anyone", email: "any@x.com" }), false);
  assert.equal(isAdmin(cfg, { name: "Someone", email: "ADA@x.com" }), true);
  assert.equal(isAdmin(cfg, null), false);
  // Lark's login often sends no email: then every word of the admin's name must be in the user's.
  cfg.admins = [{ id: "", name: "Brian Buenviaje", email: "brian.buenviaje@x.com" }];
  assert.equal(isAdmin(cfg, { name: "Brian Michael Conrad Buenviaje", email: "" }), true);
  assert.equal(isAdmin(cfg, { name: "Brian Santos", email: "" }), false);
  assert.equal(isAdmin(cfg, { name: "Brian Michael Conrad Buenviaje", email: "other@x.com" }), false);   // both emails known: they decide
  assert.equal(samePerson({ name: "Brian", email: "" }, { name: "Brian Cruz" }), false);              // one word isn't enough
});

test("scope: RFP date, else Year, else the code's year", () => {
  const cfg = defaults();
  assert.equal(inScope({ "RFP Received Date": MANILA("2025-01-01") }, cfg), true);
  assert.equal(inScope({ "RFP Received Date": MANILA("2024-12-31") }, cfg), false);
  assert.equal(inScope({ "Year": "2024" }, cfg), false);
  assert.equal(inScope({ "Year": seg("2025") }, cfg), true);
  assert.equal(inScope({ "Project Code": "2024TEG-P0131" }, cfg), false);
  assert.equal(inScope({ "Project Code": "2025TEG-P0313 " }, cfg), true);
  assert.equal(inScope({}, cfg), true);
});

test("stage: the Status's place in the pipeline, moved on by a won Mancom Phase", () => {
  const cfg = defaults();
  assert.deepEqual(stageOf({ Status: "For Pitching" }, cfg), { status: "For Pitching", index: 1, lost: false, known: true });
  assert.equal(stageOf({ Status: "Lost" }, cfg).lost, true);
  assert.equal(stageOf({ Status: "For Pitching", "Mancom Phase": "7. Won" }, cfg).index, 2);
  assert.equal(stageOf({ Status: "Won?" }, cfg).index, 0);
  assert.equal(stageOf({ Status: "Won?" }, cfg).known, false);
  const amount = cfg.rules.find(r => r.id === "amount");
  assert.equal(applies(amount, stageOf({ Status: "For CE/Pitch Creation" }, cfg), cfg), false);
  assert.equal(applies(amount, stageOf({ Status: "Signed CE" }, cfg), cfg), true);
  assert.equal(applies(amount, stageOf({ Status: "Lost" }, cfg), cfg), false);
  assert.equal(applies(cfg.rules.find(r => r.id === "lossreason"), stageOf({ Status: "Stalled" }, cfg), cfg), true);
  assert.equal(applies(cfg.rules.find(r => r.id === "bd"), stageOf({ Status: "Archived" }, cfg), cfg), true);
});

test("who: the role's holder, else the fallback, else unassigned", () => {
  const cfg = defaults();
  const u = rec("u1", { BD: [user("ou_bd", "Ben BD")], AM: [] });
  const a = rec("a1", { "PM (LEAD)": [user("ou_pm", "Pia PM")] });
  assert.deepEqual(resolve("PM", { universe: u, andon: a }, cfg).people.map(p => p.name), ["Pia PM"]);
  const am = resolve("AM", { universe: u, andon: a }, cfg);
  assert.equal(am.via, "BD");
  assert.deepEqual(am.people.map(p => p.name), ["Ben BD"]);
  const keeper = resolve("Universe Keeper", { universe: rec("u2", {}), andon: null }, cfg);
  assert.equal(keeper.unassigned, true);
  cfg.roles["Ops Lead"] = [{ id: "ou_ops", name: "Olive Ops", email: "" }];
  assert.equal(resolve("Universe Keeper", { universe: rec("u2", {}), andon: null }, cfg).via, "Ops Lead");
});

/* A small Universe, ANDON and Collections: one project at each interesting stage. */
function fixture() {
  const bd = [user("ou_bd", "Ben BD")], am = [user("ou_am", "Ana AM")], pm = [user("ou_pm", "Pia PM")];
  const full = { Client: "Kestrel Motors", "RFP Received Date": MANILA("2025-03-01"), "Amount (VAT-Ex.) (PHP)": 100,
                 "VAT%": "12%", "Project Start": 1, "Project End": 2, "Project Description": seg("x") };
  return {
    universe: [
      // New brief, no BD: BD is asked (Universe Keeper → fallback AM), and its ANDON row is missing.
      rec("u1", { ...full, "Project Code": "2025TEG-P0001", Project: "Brief", Status: "For CE/Pitch Creation", AM: am, "Amount (VAT-Ex.) (PHP)": null }),
      // Pitching: ANDON row exists but has no PM.
      rec("u2", { ...full, "Project Code": "2025TEG-P0002", Project: "Pitch", Status: "For Pitching", BD: bd, AM: am, "Project Description": "" }),
      // Signed: everything there but the signed CE and the Collections row.
      rec("u3", { ...full, "Project Code": "2026TEG-P0003", Project: "Signed", Status: "Signed CE", BD: bd, AM: am, PAR: "202601010001",
                  "Sign Date": 1, Month: 1 }),
      // Lost without a reason.
      rec("u4", { ...full, "Project Code": "2025TEG-P0004", Project: "Lost one", Status: "Lost", BD: bd, AM: am, "Loss Month": 1 }),
      // Out of scope: 2024.
      rec("u5", { "Project Code": "2024TEG-P0005", Project: "Old", Status: "For Pitching", "RFP Received Date": MANILA("2024-06-01") }),
      // Tagged Hidden.
      rec("u6", { "Project Code": "2025TEG-P0006", Project: "Hidden", Status: "For Pitching", Tags: "Hidden" }),
    ],
    andon: [
      rec("a2", { "Project Code": "2025TEG-P0002", "PM (LEAD)": [], TRIBE: "Alpha", "Business Unit": "X", Tools: ["Y"], "Event Start": 1, "Event End": 2 }),
      rec("a3", { "Project Code": "2026TEG-P0003", "PM (LEAD)": pm, TRIBE: "Alpha", "Business Unit": "X", Tools: ["Y"], "Event Start": 1, "Event End": 2,
                  Approval: { link: "https://x", text: "202601010001" } }),
    ],
    collections: [],
  };
}

test("items: each blank the rules ask for, with who's responsible and accountable", () => {
  const cfg = defaults();
  const res = accountabilityItems(fixture(), cfg, { forCollection: RULES.collectionStages.forCollection });
  const of = (code) => res.items.filter(it => it.code === code).map(it => it.label).sort();
  assert.deepEqual(of("2025TEG-P0001"), ["ANDON row", "BD"]);   // Amount isn't asked before pitching
  assert.deepEqual(of("2025TEG-P0002"), ["PM (LEAD)", "Project Description"]);
  assert.deepEqual(of("2026TEG-P0003"), ["Collections row", "Signed CE (PDF)"]);
  assert.deepEqual(of("2025TEG-P0004"), ["Reason for Loss"]);
  assert.deepEqual(res.skipped, { outOfScope: 1, tagged: 1, noCode: 0 });
  const bd = res.items.find(it => it.code === "2025TEG-P0001" && it.field === "BD");
  assert.equal(bd.responsible.via, "AM");                  // no Universe Keeper yet
  assert.equal(bd.accountable.people[0].name, "Ana AM");
  const pmItem = res.items.find(it => it.field === "PM (LEAD)");
  assert.equal(pmItem.rowTable, "andon");
  assert.equal(pmItem.rowId, "a2");
  const andonRow = res.items.find(it => it.field === ROW && it.table === "andon");
  assert.equal(andonRow.rowTable, "universe");
});

test("items: ANDON unreadable or a column missing is said, not guessed", () => {
  const cfg = defaults();
  const d = fixture();
  delete d.andon;
  const res = accountabilityItems(d, cfg, { fields: { universe: [{ field_name: "BD" }, { field_name: "AM" }] } });
  assert.ok(res.items.every(it => it.table !== "andon"));
  assert.ok(res.notes.some(n => /ANDON couldn't be read/.test(n)));
  assert.ok(res.notes.some(n => /no column “Client”/.test(n)));
  assert.ok(res.items.every(it => ["BD", "AM", "Collections row"].includes(it.label)));
});

test("invoice details are asked only of invoiced Collections rows", () => {
  const cfg = defaults();
  const d = fixture();
  d.universe[2].fields.Status = "For Collection";
  d.collections = [
    rec("c1", { "Project Code": "2026TEG-P0003", Status: "For Collection", "Invoice Number": "", "SI Number": "610", "Invoice Date": 1 }),
    rec("c2", { "Project Code": "2026TEG-P0003", Status: "For Invoicing" }),
  ];
  const res = accountabilityItems(d, cfg, { forCollection: "For Collection" });
  const mine = res.items.filter(it => it.code === "2026TEG-P0003").map(it => it.label).sort();
  assert.deepEqual(mine, ["Invoice Number", "Signed CE (PDF)"]);
  assert.equal(res.items.find(it => it.label === "Invoice Number").responsible.via, "AM");   // no Finance yet
});

test("grouping by person, project and field", () => {
  const cfg = defaults();
  const res = accountabilityItems(fixture(), cfg, {});
  const people = byPerson(res.items, cfg);
  assert.equal(people[0].name, "Ana AM");                  // most to fill
  assert.ok(people.every(p => p.id !== UNASSIGNED));        // the fallbacks reach someone for every item
  assert.equal(byProject(res.items).length, 4);
  assert.equal(fieldCounts(res.items)[0].n, 1);
  assert.ok(itemMatches(res.items[0], "ana"));
  assert.ok(!itemMatches(res.items[0], "zzz"));
});

test("the digest: a summary, then each person, new items marked, under Telegram's limit", () => {
  const cfg = defaults();
  cfg.people.ou_am = { id: "ou_am", name: "Ana AM", telegram: "ana_am" };
  const res = accountabilityItems(fixture(), cfg, {});
  const now = MANILA("2026-11-03");
  const previous = { firstSeen: { [res.items[0].key]: now - 3 * 86400000 } };
  const state = nextState(res.items, previous, now);
  assert.equal(state.firstSeen[res.items[0].key], previous.firstSeen[res.items[0].key]);
  const msgs = digestMessages(res.items, cfg, { now, state, previous, pageUrl: "https://ops.example/sanctum", notes: ["ANDON note"] });
  const text = msgs.join("\n");
  assert.match(text, /7 blanks on 4 projects/);
  assert.match(text, /6 new since the last digest/);
  assert.match(text, /Oldest open: 3 days/);
  assert.match(text, /<b>Ana AM<\/b> @ana_am/);
  assert.match(text, /🆕/);
  assert.match(text, /⚠️ ANDON note/);
  assert.match(text, /href="https:\/\/ops\.example\/sanctum\/#\/accountability"/);
  assert.doesNotMatch(text, /Kestrel/);                     // no client names
  assert.ok(msgs.every(m => m.length <= 3900));
  assert.match(digestMessages([], cfg, { now, state: nextState([], null, now) })[0], /Nothing is missing/);
});

test("pack() splits long digests into messages", () => {
  const blocks = Array.from({ length: 50 }, (_, i) => `block ${i} ` + "x".repeat(200));
  const msgs = pack(blocks, 1000);
  assert.ok(msgs.length > 10);
  assert.ok(msgs.every(m => m.length <= 1000));
  assert.equal(msgs.join("\n\n").split("block ").length - 1, 50);
});

test("dismissing a blank needs a reason; it leaves the lists and the digest but is kept with who and why", () => {
  const cfg = defaults();
  const first = accountabilityItems(fixture(), cfg, {});
  const it = first.items.find(x => x.code === "2025TEG-P0004" && x.label === "Reason for Loss");
  assert.throws(() => dismissalValue(it, "  ok ", "Ana"), /reason/);
  const value = dismissalValue(it, "Client cancelled;   reason is in the Mancom notes", "Brian Buenviaje", 1000);
  const name = ACCOUNTABILITY.dismissVariable;
  const map = dismissalsFrom([
    rec("d1", { Variable: name, Value: value }),
    rec("d0", { Variable: name, Value: JSON.stringify({ key: it.key, reason: "older one", by: "X", at: 1 }) }),
    rec("d2", { Variable: name, Value: JSON.stringify({ key: "x|y|z", reason: "" }) }),     // no reason: ignored
    rec("d3", { Variable: name, Value: "{broken" }),
  ], cols, name);
  assert.equal(map.size, 1);
  assert.equal(map.get(it.key).id, "d1");
  assert.equal(map.get(it.key).reason, "Client cancelled; reason is in the Mancom notes");
  const res = accountabilityItems(fixture(), cfg, { dismissed: map });
  assert.equal(res.items.length, first.items.length - 1);
  assert.ok(!res.items.some(x => x.key === it.key));
  assert.equal(res.dismissed.length, 1);
  assert.equal(res.dismissed[0].dismissal.by, "Brian Buenviaje");
  // Dismissals aren't settings: the Admin page's Save never touches them.
  const saved = configFrom(ACCOUNTABILITY, [rec("d1", { Variable: name, Value: value })], cols);
  assert.deepEqual(configWrites(saved.rows, configValues(saved)).remove, []);
  const text = digestMessages(res.items, cfg, { state: nextState(res.items, null, 1), dismissedCount: 1 }).join("\n");
  assert.match(text, /1 dismissed with a reason/);
});
