/* Errors as facts, and the words for them. Pure (no DOM, no network), so the Node
   tests run the exact code the page runs.

   A LarkError carries what happened: {network, timedOut, uncertain, outdated,
   deadToken, status, json, raw}. describeLark() turns one into one plain
   sentence at display time. A write whose outcome is unknown is `uncertain`:
   it must never be reported as "nothing was written". */

export class LarkError extends Error {
  constructor(message, extra = {}) { super(message); Object.assign(this, extra); }
}

/* Codes that mean the login is over (one shared set, also used by the tool proxies). */
export const DEAD_TOKEN_CODES = [20005, 99991661, 99991663, 99991668, 99991671, 99991677];
export const isDeadToken = (err) => !!(err && (err.deadToken
  || (err.json && DEAD_TOKEN_CODES.includes(Number(err.json.code)))));
/* The request may have reached Lark: a timeout or a network error while writing. */
export const isUncertain = (err) => !!(err && err.uncertain);

const LOGIN_FAILED = "The connection service couldn't complete the login. Try again; if it keeps happening, tell the admin.";
const CODE_EXPIRED = "That login code expired or was already used. Log in again.";
const NO_BASE = (o) => `${o.app} is pointed at a Base that doesn't exist. Tell the tool owner.`;
const NO_TABLE = (o) => `${o.app} is pointed at a table that doesn't exist. Tell the tool owner.`;
const GONE = "That row isn't in Lark any more. The list refreshed.";
const NO_VALUE = (o, j) => `Lark didn't accept a value for a column (${j.msg}).`;
const TOO_MANY = "Lark is getting too many requests. Wait a moment and try again.";

/* Code → sentence. Every mapped code is listed here, so the tests can check them all. */
const BY_CODE = new Map();
const map = (codes, say) => codes.forEach(c => BY_CODE.set(c, say));
map([20001, 20002, 20063], () => LOGIN_FAILED);
map([20003, 20004, 20065], () => CODE_EXPIRED);
map([20049], () => "The login check failed, probably because it started in another tab. Log in again here.");
map([20071], () => "Lark sent the login back to a different address. Log in again from this page.");
map([20010], () => "Your Lark account isn't allowed to use this app yet. Ask the app admin to add you.");
map([20029], (o) => `This address${o.address ? ` (${o.address})` : ""} isn't registered on the Lark app.`);
map(DEAD_TOKEN_CODES, () => "Your login has ended. Log in again.");
map([99991679], (o, j) => {
  const need = ((j.error && j.error.permission_violations) || []).map(v => v && v.subject).filter(Boolean).join(", ");
  return `Your login is missing a permission ${o.app} needs${need ? ` (${need})` : ""}. Log out, then log in again.`;
});
map([91403], () => "Lark says your account can't open or edit this Base. Ask its owner for edit access.");
map([1254302], () => "Your account isn't allowed to change this table (its permissions are restricted). Ask the Base owner.");
map([91402, 1254003, 1254040], NO_BASE);
map([1254004, 1254041], NO_TABLE);
map([1254045], (o, j) => `A column ${o.app} needs doesn't exist: ${j.msg}. Tell the tool owner.`);
map([1254006, 1254043], () => GONE);
map([1254060, 1254061, 1254062, 1254063, 1254064, 1254065, 1254066, 1254067, 1254068], NO_VALUE);
map([1254290, 99991400], () => TOO_MANY);
map([1254291], () => "Someone else is changing this table right now. Try again in a moment.");
export const MAPPED_CODES = [...BY_CODE.keys()];

/* Turn a failure into one plain sentence: what happened, and what to do.
   o = { app, host, blocked, address }. Layers: network facts, then the code table. */
export function describeLark(err, o = {}) {
  o = { app: "Polaris", host: "", ...o };
  if (!err) return "Something went wrong. Try again.";
  if (err.name === "AlreadyDone" || err.userMessage) return err.userMessage || err.message;
  if (o.blocked) {
    return `Your browser is blocking ${o.host}, probably an ad blocker or privacy extension. ` +
           "Allow that site (or pause the blocker on this page), then reload.";
  }
  if (err.outdated) {
    return `The connection service is out of date${err.detail ? ` (${err.detail})` : ""}. Ask the admin to redeploy it.`;
  }
  if (err.uncertain) return `${o.app} couldn't confirm the save. Refresh before trying again.`;
  if (err.network) {
    return `${o.app} can't reach its connection service${o.host ? ` (${o.host})` : ""}. It may still be waking up; ` +
           "try again in a moment.";
  }
  const j = err.json || {};
  const code = Number(j.code);
  if (j.code === undefined && j.error === "not found") {
    return "The connection service doesn't support logging in yet. Ask the admin to update it.";
  }
  if (BY_CODE.has(code)) return BY_CODE.get(code)(o, j);
  if (/syncTable|ConnectorSyncTable/i.test(j.msg || "")) return "This table is synced from elsewhere, so it's read-only in Lark.";
  if (err.raw !== undefined) return `The connection service answered with an error (HTTP ${err.status}). Try again in a moment.`;
  const msg = j.error_description || j.msg || j.error || err.message;
  return `Lark said: ${msg}${Number.isNaN(code) ? "" : ` (code ${code})`}`;
}

/* ---------- uploads (Lark drive "upload_all") ---------- */

/* A sentence if the file is over the limit, else "". */
export function uploadSizeProblem(file, maxMb) {
  return file.size > maxMb * 1024 * 1024
    ? `“${file.name}” is over ${maxMb} MB, the most Lark takes in one upload. Compress it first.` : "";
}

/* The form fields of an upload. `extra` is required on Bases with advanced
   permissions and harmless elsewhere. */
export function uploadEntries(file, { app, table }) {
  return [
    ["file_name", file.name], ["parent_type", "bitable_file"], ["parent_node", app],
    ["size", String(file.size)], ["extra", JSON.stringify({ bitablePerm: { tableId: table } })],
  ];
}

/* The response of an upload → its file_token, or a LarkError (HTTP 413 included). */
export function uploadToken(status, text, name) {
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  const said = json ? String(json.error || json.msg || "") : "";
  if (status === 413 || (json && Number(json.code) === 413) || /too large/i.test(said)) {
    throw new LarkError("too large", { status, userMessage: `“${name}” is too large for the connection service. Compress it first.` });
  }
  if (!json) throw new LarkError("upload failed", { status, raw: String(text || "").slice(0, 2000) });
  if (Number(json.code) !== 0 || !json.data || !json.data.file_token) throw new LarkError("upload failed", { status, json });
  return json.data.file_token;
}
