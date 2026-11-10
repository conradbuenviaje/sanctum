/* Offline checks of the pure parts of the networking: errors as facts and the
   sentences for them (js/errors.js), and the rules for the connection service
   (js/service.js). Run: npm test */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LarkError, DEAD_TOKEN_CODES, MAPPED_CODES, isDeadToken, isUncertain, describeLark,
  uploadSizeProblem, uploadEntries, uploadToken,
} from "../js/errors.js";
import { isLocalHostname, isServiceUrl, cmpVersion, serviceVerdict } from "../js/service.js";
import { SERVICES } from "../js/config.js";

const lark = (code, msg = "msg", extra = {}) => new LarkError("Lark error", { status: 200, json: { code, msg, ...extra } });
const O = { app: "Polaris", host: "lark-proxy.example", address: "http://127.0.0.1:9123/" };

test("the dead-token set is the shared one", () => {
  assert.deepEqual(DEAD_TOKEN_CODES, [20005, 99991661, 99991663, 99991668, 99991671, 99991677]);
  for (const code of DEAD_TOKEN_CODES) {
    assert.equal(isDeadToken(lark(code)), true, `code ${code}`);
    assert.equal(describeLark(lark(code), O), "Your login has ended. Log in again.");
  }
  assert.equal(isDeadToken(lark(1254045)), false);
  assert.equal(isDeadToken(new LarkError("x", { network: true })), false);
  assert.equal(isDeadToken(new LarkError("x", { deadToken: true })), true);   // flagged by the client
  assert.equal(isDeadToken(null), false);
});

test("every mapped code has its own sentence, never the fallback", () => {
  for (const code of MAPPED_CODES) {
    const said = describeLark(lark(code, "detail"), O);
    assert.ok(said && !said.startsWith("Lark said:"), `code ${code}: ${said}`);
    assert.ok(!/[—–]/.test(said), `code ${code} has a dash: ${said}`);
    assert.ok(!/js\/config|\.py|setup_lark/.test(said), `code ${code} talks to the developer: ${said}`);
  }
  // the codes the guide lists, so a dropped mapping fails here
  for (const code of [20001, 20002, 20063, 20003, 20004, 20065, 20049, 20071, 20010, 20029, 99991679, 91403, 1254302,
                      91402, 1254003, 1254040, 1254004, 1254041, 1254045, 1254006, 1254043, 1254290, 99991400, 1254291,
                      1254060, 1254061, 1254062, 1254063, 1254064, 1254065, 1254066, 1254067, 1254068]) {
    assert.ok(MAPPED_CODES.includes(code), `code ${code} isn't mapped`);
  }
});

test("the sentences for the codes", () => {
  assert.match(describeLark(lark(20001), O), /couldn't complete the login/);
  assert.match(describeLark(lark(20002), O), /couldn't complete the login/);
  assert.match(describeLark(lark(20004), O), /expired or was already used/);
  assert.match(describeLark(lark(20029), O), /This address \(http:\/\/127\.0\.0\.1:9123\/\) isn't registered on the Lark app\./);
  assert.equal(describeLark(lark(1254302), O), "Your account isn't allowed to change this table (its permissions are restricted). Ask the Base owner.");
  assert.equal(describeLark(lark(91403), O), "Lark says your account can't open or edit this Base. Ask its owner for edit access.");
  assert.equal(describeLark(lark(1254003), O), "Polaris is pointed at a Base that doesn't exist. Tell the tool owner.");
  assert.equal(describeLark(lark(1254041), O), "Polaris is pointed at a table that doesn't exist. Tell the tool owner.");
  assert.equal(describeLark(lark(1254045, "Tribe"), O), "A column Polaris needs doesn't exist: Tribe. Tell the tool owner.");
  assert.equal(describeLark(lark(1254043), O), "That row isn't in Lark any more. The list refreshed.");
  assert.equal(describeLark(lark(1254064, "Status is not valid"), O), "Lark didn't accept a value for a column (Status is not valid).");
  assert.equal(describeLark(lark(1254290), O), "Lark is getting too many requests. Wait a moment and try again.");
  assert.equal(describeLark(lark(1254291), O), "Someone else is changing this table right now. Try again in a moment.");
  assert.equal(describeLark(lark(99991679, "no", { error: { permission_violations: [{ subject: "bitable:app" }] } }), O),
    "Your login is missing a permission Polaris needs (bitable:app). Log out, then log in again.");
  assert.equal(describeLark(lark(99991679), O), "Your login is missing a permission Polaris needs. Log out, then log in again.");
});

test("network facts come before the code table", () => {
  assert.match(describeLark(new LarkError("x", { network: true }), O), /^Polaris can't reach its connection service \(lark-proxy\.example\)\./);
  assert.match(describeLark(new LarkError("x", { network: true }), { ...O, blocked: true }), /blocking lark-proxy\.example/);
  assert.match(describeLark(new LarkError("outdated", { outdated: true, detail: "v1.0.0, needs 1.2.0" }), O),
    /out of date \(v1\.0\.0, needs 1\.2\.0\)\. Ask the admin to redeploy it\./);
  assert.equal(describeLark(new LarkError("x", { raw: "<html>", status: 502 }), O),
    "The connection service answered with an error (HTTP 502). Try again in a moment.");
  assert.match(describeLark(new LarkError("x", { json: { error: "not found" }, status: 404 }), O), /doesn't support logging in yet/);
  assert.equal(describeLark(lark(1254060 + 100, "odd"), O), "Lark said: odd (code 1254160)");
  assert.equal(describeLark(lark(1, "FAIL: SyncTable not writable"), O), "This table is synced from elsewhere, so it's read-only in Lark.");
  assert.equal(describeLark(null, O), "Something went wrong. Try again.");
  assert.equal(describeLark(Object.assign(new Error("It's already there."), { name: "AlreadyDone" }), O), "It's already there.");
});

test("a write whose outcome is unknown is never called 'nothing was written'", () => {
  const timeout = new LarkError("no answer in time", { network: true, timedOut: true, uncertain: true });
  assert.equal(isUncertain(timeout), true);
  assert.equal(describeLark(timeout, O), "Polaris couldn't confirm the save. Refresh before trying again.");
  assert.equal(isUncertain(lark(1254045)), false);
  assert.equal(isUncertain(new LarkError("x", { network: true })), false);   // a read that failed
  assert.ok(!/Nothing was written/.test(describeLark(timeout, O)));
  // a blocked request never left the browser: that is a fact, not an unknown
  assert.match(describeLark(timeout, { ...O, blocked: true }), /blocking/);
});

test("uploads: size, form fields, and the answer", () => {
  const big = { name: "scan.pdf", size: 11 * 1024 * 1024 }, small = { name: "a.pdf", size: 1024 };
  assert.equal(uploadSizeProblem(small, 10), "");
  assert.equal(uploadSizeProblem(big, 10), "“scan.pdf” is over 10 MB, the most the connection service takes. Compress it first.");
  const e = Object.fromEntries(uploadEntries(small, { app: "APP1", table: "tblX" }));
  assert.equal(e.parent_type, "bitable_file");
  assert.equal(e.parent_node, "APP1");
  assert.equal(e.size, "1024");
  assert.deepEqual(JSON.parse(e.extra), { bitablePerm: { tableId: "tblX" } });   // advanced-permission Bases
  assert.equal(uploadToken(200, JSON.stringify({ code: 0, data: { file_token: "box123" } }), "a.pdf"), "box123");
  assert.throws(() => uploadToken(413, "<html>Request Entity Too Large</html>", "a.pdf"),
    (err) => err instanceof LarkError && describeLark(err, O) === "“a.pdf” is too large for the connection service. Compress it first.");
  assert.throws(() => uploadToken(200, JSON.stringify({ code: 413, error: "body too large" }), "a.pdf"), /too large/);
  assert.throws(() => uploadToken(200, JSON.stringify({ code: 99991663, msg: "invalid" }), "a.pdf"),
    (err) => isDeadToken(err));                                                  // dead login found in an upload answer
  assert.throws(() => uploadToken(502, "<html>bad gateway</html>", "a.pdf"),
    (err) => err.raw !== undefined && err.status === 502);
  assert.throws(() => uploadToken(200, JSON.stringify({ code: 0, data: {} }), "a.pdf"), /upload failed/);
});

test("which addresses may override the connection service", () => {
  for (const ok of ["https://lark-proxy-dwiw.onrender.com", "http://127.0.0.1:8001", "http://localhost:8001/", "https://x.localhost"]) {
    assert.equal(isServiceUrl(ok), true, ok);
  }
  for (const no of ["http://evil.example", "ftp://127.0.0.1", "javascript:alert(1)", "lark-proxy", "", "//x.com"]) {
    assert.equal(isServiceUrl(no), false, no);
  }
  assert.equal(isLocalHostname("127.0.0.1"), true);
  assert.equal(isLocalHostname("localhost"), true);
  assert.equal(isLocalHostname("mineski.github.io"), false);
  assert.equal(isLocalHostname("localhost.evil.com"), false);
});

test("versions compare as numbers", () => {
  assert.ok(cmpVersion("1.10.0", "1.4.0") > 0);
  assert.ok(cmpVersion("1.3.0", "1.4.0") < 0);
  assert.equal(cmpVersion("v1.0.0", "1.0.0"), 0);
  assert.equal(cmpVersion("1.0", "1.0.0"), 0);
  assert.ok(cmpVersion("2.0.0", "1.99.99") > 0);
});

test("awake means the right service, then the right version", () => {
  const want = SERVICES.lark;
  assert.equal(serviceVerdict(null, want).state, "wrong");
  assert.equal(serviceVerdict({ error: "x" }, want).state, "wrong");
  assert.equal(serviceVerdict({ service: "gemini-brief-proxy" }, want).state, "wrong");   // another service's answer
  // the Lark proxy today: names itself, reports no version
  const now = serviceVerdict({ service: "lark-cors-proxy", endpoints: ["/health", "/proxy"] }, want);
  assert.deepEqual(now, { state: "awake", version: "", detail: "" });
  assert.equal(serviceVerdict({ service: "lark-cors-proxy", version: want.min }, want).state, "awake");
  assert.equal(serviceVerdict({ service: "lark-cors-proxy", version: "9.0.0" }, want).state, "awake");
  const old = serviceVerdict({ service: "lark-cors-proxy", version: "0.9.0" }, want);
  assert.equal(old.state, "outdated");
  assert.equal(old.detail, `v0.9.0, needs ${want.min}`);
  // a CORS list without Authorization: an old proxy that looks awake and then fails every real request
  const noAuth = serviceVerdict({ service: "lark-cors-proxy", version: want.min, cors: { allow_headers: ["Content-Type"] } }, want);
  assert.equal(noAuth.state, "outdated");
  assert.match(noAuth.detail, /doesn't allow Authorization/);
  assert.equal(serviceVerdict({ service: "lark-cors-proxy", version: want.min, cors: { allow_headers: ["content-type", "authorization"] } }, want).state, "awake");
});

test("the Lark proxy has a backup: Cloudflare first, then Render, both 2.0.0 or newer", () => {
  assert.deepEqual(SERVICES.lark.urls, ["https://lark-proxy.stephen-lin.workers.dev", "https://lark-proxy-dwiw.onrender.com"]);
  assert.equal(SERVICES.lark.min, "2.0.0");
  for (const u of SERVICES.lark.urls) assert.ok(isServiceUrl(u), u);
});
