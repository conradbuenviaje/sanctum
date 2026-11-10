/* Offline checks of the admin tools: reading the app's credentials (tests/lark-node.mjs),
   the setup and repair script (tools/setup.mjs, with a fake Lark: a dry run changes
   nothing, --apply only adds) and the shell checks (tools/check-shell.mjs). Run: npm test */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import { RULES } from "../js/config.js";
import { schemaSpec } from "../js/ops.js";
import { parseEnv, credentials } from "./lark-node.mjs";
import { planRepair, runSetup } from "../tools/setup.mjs";
import { importMapFiles, findSecrets } from "../tools/check-shell.mjs";

const NO_FILE = new URL("./no-such.env", import.meta.url);

test(".env lines become credentials", () => {
  assert.deepEqual(parseEnv('# the app\nLARK_APP_ID=cli_x\nLARK_APP_SECRET="abc def"\n\nexport OTHER=\'q\'\r\nBAD LINE\n'),
    { LARK_APP_ID: "cli_x", LARK_APP_SECRET: "abc def", OTHER: "q" });
  assert.deepEqual(parseEnv("# LARK_APP_SECRET=nope"), {});
});

test("the app secret comes from the environment, never from the proxy; the id defaults to the app's own", () => {
  const c = credentials({ LARK_APP_SECRET: "s3cret" }, NO_FILE);
  assert.equal(c.appSecret, "s3cret");
  assert.equal(c.appId, "cli_aab0716138b8ded3");
  assert.equal(credentials({ LARK_APP_ID: "cli_other", LARK_APP_SECRET: "x" }, NO_FILE).appId, "cli_other");
  assert.throws(() => credentials({}, NO_FILE), /LARK_APP_SECRET isn't set/);
  const src = readFileSync(new URL("./lark-node.mjs", import.meta.url), "utf8");
  assert.ok(!/onrender\.com|\/proxy\?url/.test(src), "lark-node.mjs must not go through the proxy");
});

/* A fake Lark with one table's fields; records every call. */
function fakeFields(byTable) {
  const calls = [];
  const call = async (method, url, body) => {
    calls.push({ method, url, body });
    const table = url.match(/\/tables\/(tbl\w+)\/fields/)[1];
    if (method === "GET") return { code: 0, data: { items: byTable[table], has_more: false } };
    return { code: 0, data: {} };
  };
  return { call, calls, changes: () => calls.filter(c => c.method !== "GET") };
}
const opt = (name, id = "opt" + name) => ({ name, id, color: 1 });
const TABLES = { universe: { app: "APP", table: "tblUni" }, collections: { app: "APP", table: "tblCol" } };

/* Every column the spec needs, with the right type, but "Mancom Phase" missing, and "Status" without the new-project option. */
function liveUniverse() {
  const spec = schemaSpec(RULES).universe;
  const fields = Object.entries(spec.fields).filter(([n]) => n !== "Mancom Phase").map(([n, type], i) => ({
    field_id: "fld" + i, field_name: n, type,
    property: type === 3 ? { options: [opt("Won"), ...(spec.options[n] || []).filter(o => n !== "Status").map(o => opt(o))] } : undefined,
  }));
  return fields;
}
function liveCollections() {
  const spec = schemaSpec(RULES).collections;
  return Object.entries(spec.fields).map(([n, type], i) => ({
    field_id: "fld" + i, field_name: n, type,
    property: type === 3 ? { options: (spec.options[n] || []).map(o => opt(o)) } : undefined,
  }));
}

test("setup: the plan lists missing columns and options, and ignores what's fine", () => {
  const spec = schemaSpec(RULES).universe;
  const plan = planRepair("universe", spec, liveUniverse());
  assert.deepEqual(plan.columns.map(c => c.name), ["Mancom Phase"]);
  assert.deepEqual(plan.columns[0].options, [RULES.newProjectMancomPhase]);   // a new select column gets the options the page writes
  assert.deepEqual(plan.options.map(o => [o.field, o.add]), [["Status", [RULES.newProjectStatus]]]);
  assert.deepEqual(plan.wrongType, []);
  assert.ok(plan.notes.some(n => /IGNORE/.test(n)), "the optional IGNORE column is mentioned");
  assert.deepEqual(planRepair("universe", spec, liveUniverse(), { optional: true }).columns.map(c => c.name),
    ["Mancom Phase", "IGNORE", RULES.auditFiles.field, RULES.briefFiles.to, RULES.tags.field]);
  assert.equal(planRepair("collections", schemaSpec(RULES).collections, liveCollections()).columns.length, 0);
});

test("setup: a column of the wrong type is reported, never retyped", () => {
  const spec = schemaSpec(RULES).collections;
  const live = liveCollections().map(f => (f.field_name === "Invoice Amount" ? { ...f, type: 1 } : f));
  const plan = planRepair("collections", spec, live);
  assert.equal(plan.wrongType.length, 1);
  assert.match(plan.wrongType[0], /“Invoice Amount” is Text, expected Number/);
  assert.equal(plan.columns.length, 0);
});

test("setup: a dry run writes nothing", async () => {
  const lark = fakeFields({ tblUni: liveUniverse(), tblCol: liveCollections() });
  const lines = [];
  const res = await runSetup({ call: lark.call, tables: TABLES, log: (l) => lines.push(l) });
  assert.equal(lark.changes().length, 0);
  assert.equal(res.changes, 0);
  const out = lines.join("\n");
  assert.match(out, /would add column “Mancom Phase”/);
  assert.match(out, /would add option “For CE\/Pitch Creation” to “Status”/);
  assert.match(out, /dry run/);
});

test("setup --apply adds what's missing, keeps every existing option, and never deletes", async () => {
  const lark = fakeFields({ tblUni: liveUniverse(), tblCol: liveCollections() });
  const res = await runSetup({ call: lark.call, tables: TABLES, apply: true, log: () => {} });
  assert.equal(res.changes, 2);
  const [create, update] = lark.changes();
  assert.equal(create.method, "POST");
  assert.match(create.url, /\/tables\/tblUni\/fields$/);
  assert.deepEqual(create.body, { field_name: "Mancom Phase", type: 3, property: { options: [{ name: RULES.newProjectMancomPhase }] } });
  assert.equal(update.method, "PUT");
  assert.match(update.url, /\/fields\/fld\d+$/);
  assert.equal(update.body.field_name, "Status");
  const names = update.body.property.options.map(o => o.name);
  assert.ok(names.includes("Won") && names.includes(RULES.newProjectStatus), "old options kept, new one added");
  assert.ok(update.body.property.options.find(o => o.name === "Won").id, "an existing option keeps its id");
  assert.ok(!lark.calls.some(c => c.method === "DELETE"));
});

test("setup only creates in the tables Polaris owns; others are reported", async () => {
  const brief = [{ field_id: "f1", field_name: "Project Code", type: 1 }];
  const lark = fakeFields({ tblBr: brief });
  const lines = [];
  await runSetup({ call: lark.call, tables: { brief: { app: "APP", table: "tblBr" } }, apply: true, only: ["brief"], log: (l) => lines.push(l) });
  assert.equal(lark.changes().length, 0);
  assert.match(lines.join("\n"), /Lark Approval fills this table/);
});

test("check:shell: the import map in index.html lists every module", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const listed = importMapFiles(html).sort();
  const mods = readdirSync(new URL("../js/", import.meta.url)).filter(f => f.endsWith(".js")).map(f => `js/${f}`).sort();
  assert.deepEqual(listed, mods);
  assert.deepEqual(importMapFiles("<script>nothing</script>"), []);
});

test("check:shell: secret-shaped strings are found, ordinary text isn't", () => {
  const fake = (...parts) => parts.join("");
  assert.deepEqual(findSecrets(`key = "${fake("AI", "za", "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q")}"`), ["a Google API key (AIza…)"]);
  assert.ok(findSecrets(`{"${fake("app", "_secret")}": "abcdEFGH12345678wxyz"}`).length);
  assert.ok(findSecrets(fake("LARK_APP", "_SECRET=", "abcdef123456")).length);
  assert.ok(findSecrets(fake("-----BEGIN RSA PRI", "VATE KEY-----")).length);
  assert.ok(findSecrets(fake("t-", "g1042abc9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a")).length);
  assert.deepEqual(findSecrets(["LARK_APP_SECRET=", "app_secret: creds.appSecret", "const url = 'https://open.larksuite.com/open-apis'"].join("\n")), []);
});

/* Run the one-time storage move from index.html's <head> against fake storage. */
function migrate(local = {}, session = {}) {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const code = html.match(/<script>\s*(\(function \(\) \{\s*function area[\s\S]*?\}\)\(\);)\s*<\/script>/)[1];
  const store = (data) => ({ getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } });
  vm.runInNewContext(code, { window: { localStorage: store(local), sessionStorage: store(session) } });
  return { local, session };
}

test("storage move: the raw proxy address becomes polaris.settings, the login keys move to polaris.auth.*", () => {
  const token = JSON.stringify({ access_token: "x", scope: "bitable:app", expires_at: 1 });
  const user = JSON.stringify({ name: "A", avatar: "", email: "" });
  const { local, session } = migrate({ "polaris.proxyOverride": "http://127.0.0.1:8001", "polaris.theme": '"dark"' },
    { "polaris.token": token, "polaris.user": user, "polaris.pending": '{"state":"s"}' });
  assert.deepEqual(JSON.parse(local["polaris.settings"]), { larkUrl: "http://127.0.0.1:8001" });
  assert.ok(!("polaris.proxyOverride" in local));
  assert.equal(local["polaris.theme"], '"dark"');                      // other keys are left alone
  assert.equal(session["polaris.auth.token"], token);
  assert.equal(session["polaris.auth.user"], user);
  assert.deepEqual(Object.keys(session).sort(), ["polaris.auth.token", "polaris.auth.user"]);   // old keys and the half-done login are gone
});

test("storage move: safe to run again, the new key wins, nothing is guessed", () => {
  const first = migrate({ "polaris.proxyOverride": "https://x.example" }, {});
  const again = migrate(first.local, first.session);
  assert.deepEqual(JSON.parse(again.local["polaris.settings"]), { larkUrl: "https://x.example" });
  // a newer value already saved: the old key is dropped, the new one kept
  const wins = migrate({ "polaris.proxyOverride": "https://old.example", "polaris.settings": '{"larkUrl":"https://new.example"}' }, {});
  assert.deepEqual(JSON.parse(wins.local["polaris.settings"]), { larkUrl: "https://new.example" });
  assert.ok(!("polaris.proxyOverride" in wins.local));
  // a value that isn't an address is dropped, not copied; an unreadable login is left for the next load
  assert.deepEqual(migrate({ "polaris.proxyOverride": "not an address" }, {}).local, {});
  assert.equal(migrate({}, { "polaris.token": "{broken" }).session["polaris.token"], "{broken");
  assert.deepEqual(migrate({}, {}), { local: {}, session: {} });
});
test("the digest's service token: GET /token, a retry if it fails, a plain sentence if it can't", async () => {
  const { serviceToken } = await import("../tools/service-token.mjs");
  const calls = [];
  const reply = (obj) => ({ status: 200, json: async () => obj });
  const ok = await serviceToken("https://svc.example/", { fetch: async (u) => { calls.push(u); return reply({ code: 0, tenant_access_token: "t-abc", expire: 7000 }); } });
  assert.equal(ok, "t-abc");
  assert.deepEqual(calls, ["https://svc.example/token"]);
  let n = 0;
  const second = await serviceToken("https://svc.example", { fetch: async () => (++n === 1 ? Promise.reject(new Error("socket hang up")) : reply({ code: 0, app_access_token: "t-app" })) });
  assert.equal(second, "t-app");
  await assert.rejects(serviceToken("https://svc.example", { fetch: async () => reply({ code: 10014, msg: "app secret invalid" }) }),
    /connection service \(https:\/\/svc\.example\/token\): Lark said app secret invalid \(code 10014\)/);
});
