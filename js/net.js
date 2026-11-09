/* Talking to Lark through the CORS proxy (tech/lark-proxy).

   - The proxy runs in two places, SERVICES.lark.urls: Cloudflare Workers, then Render
     (the backup). One is in use at a time. Waking tries the one in use, then the other,
     and keeps whichever answers. A read that can't reach the one in use moves to the
     other at once. A write is never resent anywhere: if the proxy in use hasn't answered
     lately it's checked (and maybe swapped) BEFORE sending, and a write that fails only
     makes the NEXT call check again.
   - Render's proxy sleeps when idle, so it's woken on page load and reads are retried
     while it starts. Writes are never retried automatically.
   - Reads time out after 60 s, writes after 120 s, uploads after 180 s. A write
     that times out, or fails on the network, may still have landed: it throws an
     `uncertain` error and is never reported as "nothing was written".
   - Two instant network failures while online almost always mean an ad blocker
     or privacy extension; that's reported plainly with the host to allow.
   - A login Lark says is over (a dead-token code) is detected here, once, for
     every call: the handler set with onDeadToken() ends the session, and the
     call still throws (err.deadToken) so callers can roll back first.
   - A different proxy address is a developer override (settings.js): it only
     applies on localhost and is always shown while active. */

import { sleep } from "./ui.js";
import { APP, SERVICES, LARK } from "./config.js";
import { larkUrls } from "./settings.js";
import { serviceVerdict } from "./service.js";
import {
  LarkError, DEAD_TOKEN_CODES, isDeadToken, describeLark, uploadSizeProblem, uploadEntries, uploadToken,
} from "./errors.js";

export { LarkError, isDeadToken, isUncertain } from "./errors.js";

export const READ_TIMEOUT_MS = 60000;
export const WRITE_TIMEOUT_MS = 120000;
export const UPLOAD_TIMEOUT_MS = 180000;

const hostOf = (u) => { try { return new URL(u).host; } catch (e) { return u; } };
let active = 0;                     // which of larkUrls() is in use
export const proxyBase = () => { const l = larkUrls(); if (active >= l.length) active = 0; return l[active] || ""; };
export const proxyHost = () => hostOf(proxyBase());
/* Every address's host, in order; when they're all blocked, the ones this browser blocks. */
export const proxyHosts = () => larkUrls().filter(u => !conn.blocked || blockedUrls.has(u)).map(hostOf);
export const viaProxy = (url) => `${proxyBase()}/proxy?url=${encodeURIComponent(url)}`;

/* ---------- connection state (shown in Settings and in load errors) ---------- */
// proxy: unknown | waking | awake | down | outdated. blocked: this browser blocks every address.
// backup: the proxy in use isn't the first (the usual one can't be reached).
export const conn = { proxy: "unknown", blocked: false, detail: "", version: "", checkedAt: 0, backup: false };
const listeners = new Set();
export const onConn = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
function setConn(patch) {
  Object.assign(conn, patch, { checkedAt: Date.now() });
  listeners.forEach(fn => fn(conn));
}
const fresh = () => conn.proxy === "awake" && Date.now() - conn.checkedAt < 60000;
function useProxy(i) { active = i; conn.backup = i > 0; }

/* Move to the next address this browser doesn't block. True if there was one. It isn't known
   to be awake yet, so the next call checks it first. */
function failover() {
  const l = larkUrls();
  for (let step = 1; step < l.length; step++) {
    const i = (active + step) % l.length;
    if (!blockedUrls.has(l[i])) {
      useProxy(i);
      conn.checkedAt = 0;
      listeners.forEach(fn => fn(conn));
      return true;
    }
  }
  return false;
}

let deadHandler = null;
export const onDeadToken = (fn) => { deadHandler = fn; };
function flagDead(err, token) {
  if (token && isDeadToken(err)) { err.deadToken = true; if (deadHandler) deadHandler(err); }
  return err;
}

/* Two thrown errors within 600 ms in a row while online, for one address: probably a blocker.
   HTTP answers never count. A blocked address is left for the other one; with none left, the
   connection is "blocked". */
const quickFails = new Map(), blockedUrls = new Set();
const baseOf = (url) => larkUrls().find(b => url === b || url.startsWith(b + "/")) || proxyBase();
function answered(base) { quickFails.set(base, 0); blockedUrls.delete(base); }
function failed(started, base) {
  if (performance.now() - started < 600 && navigator.onLine !== false) {
    const n = (quickFails.get(base) || 0) + 1;
    quickFails.set(base, n);
    if (n >= 2) blockedUrls.add(base);
  }
  if (!blockedUrls.has(base)) return;
  if (base === proxyBase() && failover()) return;
  if (larkUrls().every(u => blockedUrls.has(u))) setConn({ proxy: "down", blocked: true, detail: "blocked by this browser" });
}

/* `timeout` (ms) gives up on a request that never answers (a stuck connection
   to a sleeping proxy can otherwise wait forever). `write`: the request may have
   landed when it fails, so the error says so (and a blocked request, which never
   left, doesn't). */
async function send(url, init, timeout = 0, write = false) {
  const started = performance.now();
  const base = baseOf(url);
  const ctl = timeout ? new AbortController() : null;
  const timer = ctl && setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, ctl ? { ...init, signal: ctl.signal } : init);
    answered(base);
    return res;
  } catch (e) {
    const timedOut = !!(ctl && ctl.signal.aborted);
    failed(started, base);
    if (base === proxyBase()) conn.checkedAt = 0;   // the next call checks it (and may move to the other) first
    throw new LarkError(timedOut ? "no answer in time" : e.message, { network: true, timedOut, uncertain: write && !conn.blocked });
  } finally {
    clearTimeout(timer);
  }
}

/* One Lark call through the proxy. Resolves with the JSON body; throws LarkError
   carrying {network | status, json | raw, uncertain, deadToken}. `read` calls are
   retried while the proxy wakes up (and twice after a rate limit); `write` calls
   never are. Without a `timeout`: 60 s for reads, 120 s for writes. */
export async function lark(method, url, { token, body, read = false, write = false, timeout } = {}) {
  const init = { method, headers: {}, cache: "no-store" };
  if (token) init.headers.Authorization = "Bearer " + token;
  if (method !== "GET") {
    init.headers["Content-Type"] = "application/json; charset=utf-8";
    init.body = JSON.stringify(body || {});
  }
  if (timeout === undefined) timeout = write ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS;
  const waits = read ? [1500, 3000, 6000, 12000, 20000] : [];
  // Sent once, to one proxy (a write, the login exchange): make sure of the proxy BEFORE
  // sending, so moving to the other one can never send anything twice.
  if (!read && !fresh() && !await wake()) throw unreachable();
  let hops = 0;   // a read's moves to the other proxy during this call
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await send(viaProxy(url), init, timeout, write);
    } catch (e) {
      if (!read) throw e;   // never resent
      if (hops < larkUrls().length - 1 && failover()) { hops++; continue; }   // the other proxy, at once
      if (conn.blocked || attempt >= waits.length) throw e;
      setConn({ proxy: "waking", detail: "" });
      await sleep(waits[attempt]);
      continue;
    }
    if (read && (res.status === 502 || res.status === 503 || res.status === 504)) {
      if (hops < larkUrls().length - 1 && failover()) { hops++; continue; }
      if (attempt < waits.length) {
        setConn({ proxy: "waking", detail: "" });
        await sleep(waits[attempt]);
        continue;
      }
    }
    if (conn.proxy !== "awake" && conn.proxy !== "outdated") setConn({ proxy: "awake", blocked: false, detail: "" });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) {}
    if (!json || typeof json !== "object") {
      throw new LarkError(`HTTP ${res.status}, not JSON`, { status: res.status, raw: text.slice(0, 2000), uncertain: write });
    }
    // Lark reports failures in the body (code ≠ 0); bodies without a code are the proxy's own.
    const ok = json.code !== undefined ? Number(json.code) === 0 : !json.error;
    if (ok) return json;
    if (read && [1254290, 99991400].includes(Number(json.code)) && attempt < 2) { await sleep(1200); continue; }
    throw flagDead(new LarkError("Lark error", { status: res.status, json, uncertain: write && json.code === undefined && res.status >= 500 }), token);
  }
}

/* Upload a file as an attachment for a Base (Lark's drive "upload_all", through the
   proxy as multipart). Resolves with the file_token to put in an attachment field.
   XHR, not fetch, so the page can show progress: onProgress(0..1). Gives up after
   180 s. Never retried; a failed upload writes nothing, so a retry is safe. */
export async function uploadToBase(file, table, token, { onProgress, timeout = UPLOAD_TIMEOUT_MS } = {}) {
  const tooBig = uploadSizeProblem(file, LARK.maxUploadMb);
  if (tooBig) throw new LarkError("too large", { userMessage: tooBig });
  if (!fresh() && !await wake()) throw unreachable();   // sent once: make sure of the proxy first
  const base = proxyBase();
  const fd = new FormData();
  for (const [k, v] of uploadEntries(file, table)) fd.append(k, v);
  fd.append("file", file, file.name);
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const xhr = new XMLHttpRequest();
    xhr.open("POST", viaProxy(`${LARK.api}/drive/v1/medias/upload_all`));
    xhr.timeout = timeout;
    xhr.setRequestHeader("Authorization", "Bearer " + token);
    if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      answered(base);
      try { resolve(uploadToken(xhr.status, xhr.responseText, file.name)); } catch (e) { reject(flagDead(e, token)); }
    };
    xhr.onerror = () => { failed(started, base); conn.checkedAt = 0; reject(new LarkError("network error", { network: true })); };
    xhr.ontimeout = () => { conn.checkedAt = 0; reject(new LarkError("no answer in time", { network: true, timedOut: true })); };
    xhr.send(fd);
  });
}

/* Download an attachment's bytes from Lark through the proxy (it passes them through
   as they are). Resolves with a Blob; Lark answering with JSON instead (an error, or
   a file it won't hand over) throws a LarkError with that JSON. A read: safe to retry. */
export async function downloadFromBase(url, token, { timeout = UPLOAD_TIMEOUT_MS } = {}) {
  const get = () => send(viaProxy(url), { method: "GET", headers: { Authorization: "Bearer " + token }, cache: "no-store" }, timeout);
  let res;
  try {
    res = await get();
  } catch (e) {
    if (!failover()) throw e;   // a read: once more through the other proxy
    res = await get();
  }
  const type = res.headers.get("content-type") || "";
  if (res.ok && !/json/i.test(type)) return res.blob();
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  throw flagDead(new LarkError(json ? "Lark error" : `HTTP ${res.status}, not a file`,
    { status: res.status, json: json || undefined, raw: json ? undefined : text.slice(0, 2000) }), token);
}

/* One GET / of one address: { r: "ok" | "retry" | "stop", proxy, detail, version }. */
async function checkProxy(base) {
  try {
    const res = await send(base + "/", { method: "GET", cache: "no-store" }, 20000);
    let info = null;
    try { info = await res.json(); } catch (e) {}
    const v = serviceVerdict(info, SERVICES.lark);
    if (res.ok && v.state !== "wrong") return { r: "ok", proxy: v.state, detail: v.detail, version: v.version };
    if (res.ok && info && typeof info === "object" && info.service) return { r: "stop", proxy: "down", detail: "that address isn't the connection service" };
    if (res.status >= 400 && res.status < 500) return { r: "stop", proxy: "down", detail: `answered HTTP ${res.status}` };
    return { r: "retry" };   // Render's "starting" page, or a 5xx (the Worker answers 503 when misconfigured)
  } catch (e) {
    return blockedUrls.has(base) ? { r: "stop", proxy: "down", blocked: true, detail: "blocked by this browser" } : { r: "retry" };
  }
}

/* Wake the proxy (free Render instances sleep). Tries the address in use, then the other,
   and keeps whichever answers. Resolves true once one answers as the Lark proxy, false if
   none does for about three minutes, or the only answer is out of date (conn.proxy says
   which). Pings "/" because blockers list paths like /health on onrender.com. "Awake" is
   strict: JSON naming the service (Render's "starting" page and a wrong address aren't). */
let waking = null;
export function wake() {
  if (Date.now() - conn.checkedAt < 60000 && (conn.proxy === "awake" || conn.proxy === "outdated")) {
    return Promise.resolve(conn.proxy === "awake");
  }
  if (waking) return waking;
  waking = (async () => {
    const until = Date.now() + 180000;
    const stopped = new Map();   // address -> why it won't answer (this wake)
    let wait = 2000;
    const slow = setTimeout(() => conn.proxy !== "awake" && setConn({ proxy: "waking", detail: "" }), 1200);
    try {
      for (;;) {
        const l = larkUrls(), start = active;
        let outdated = null, retrying = false;
        for (let step = 0; step < l.length; step++) {
          const i = (start + step) % l.length;
          if (stopped.has(l[i])) continue;
          const c = await checkProxy(l[i]);
          if (c.r === "ok" && c.proxy === "awake") {
            useProxy(i);
            setConn({ proxy: "awake", blocked: false, detail: "", version: c.version });
            return true;
          }
          if (c.r === "ok") outdated = outdated || { i, c };
          else if (c.r === "stop") stopped.set(l[i], c);
          else retrying = true;
        }
        // None awake. Out of date counts once nothing else might still wake up.
        if (outdated && !retrying) {
          useProxy(outdated.i);
          setConn({ proxy: "outdated", blocked: false, detail: outdated.c.detail, version: outdated.c.version });
          return false;
        }
        if (stopped.size >= l.length) {
          const why = [...stopped.values()];
          const all = why.every(c => c.blocked);
          setConn(all ? { proxy: "down", blocked: true, detail: "blocked by this browser" }
                      : { proxy: "down", blocked: false, detail: why.find(c => !c.blocked).detail });
          return false;
        }
        if (Date.now() > until) { setConn({ proxy: "down", detail: "no answer for 3 minutes" }); return false; }
        setConn({ proxy: "waking", detail: "" });
        await sleep(wait);
        wait = Math.min(wait * 1.6, 15000);
      }
    } finally {
      clearTimeout(slow);
      waking = null;
    }
  })();
  return waking;
}

/* The error for a proxy that never woke (or is out of date), for load errors. */
export const unreachable = () => (conn.proxy === "outdated"
  ? new LarkError("outdated", { outdated: true, detail: conn.detail })
  : new LarkError("unreachable", { network: true }));

/* Turn a failure into one plain sentence: what happened, and what to do. */
export const describe = (err) => describeLark(err, {
  app: APP.name, host: proxyHost(), blocked: conn.blocked,
  address: location.origin + location.pathname.replace(/index\.html?$/i, ""),
});

export { DEAD_TOKEN_CODES };
