/* Lark login: OAuth 2.0 + PKCE, the same flow as Fetch, Suppliers and tech/lark-user-login.

   The browser gets a user_access_token through the proxy (which adds the app secret), and
   every Lark call then runs as the signed-in person. The token is shared by every Mineski tool
   on this site (js/session.js): log in to Polaris, Fetch or Suppliers and you're logged in to
   all three, in every tab, with one timer. Lark gives about 2 hours; there is no refresh
   token, so after that the user logs in again. The login in progress (PKCE state and verifier)
   stays in this tab's sessionStorage, so it finishes where it began.

   The clock lives in app.js (tickSession); this file keeps the in-flight count (track) so a
   write already running is never cut off, here or by another tab logging out. */

import { lark, LarkError, viaProxy, wake, onDeadToken, unreachable } from "./net.js";
import { store, recall } from "./ui.js";
import { LARK } from "./config.js";
import * as shared from "./session.js";

export const APP_ID = LARK.appId;
// Lark returns to this page's own address (minus query, hash and index.html),
// which must exactly match a redirect URL registered on the app.
export const REDIRECT_URI = location.origin + location.pathname.replace(/index\.html?$/i, "");
export const SCOPES = LARK.scopes;

const PENDING_KEY = "polaris.auth.pending";   // sessionStorage: a login in progress finishes in the tab that started it
const PENDING_MAX_MS = 10 * 60 * 1000;   // a login started longer ago than this is refused
const ENDED = "Your login ended after about 2 hours. Log in again to keep going.";
const ENDED_ELSEWHERE = "Your login ended in another tab. Log in again to keep going.";

// A login this tab kept for itself before logins were shared moves to the shared one.
shared.adopt("polaris");

/* ---------- the session ---------- */
// memo: the last login this tab saw. Work already running (track) finishes with it, even if
// another tab logs out meanwhile (Lark still accepts the token until it really expires).
let memo = null;
const raw = () => { const t = shared.readToken(); if (t) memo = t; return t; };
// seen: the login this tab last acted on (at load, its own login, or a change it heard). Only those
// move it, never a plain read, so a read between another tab's write and its event can't hide it.
let seen = shared.readToken();
/* The token, if it has more than 30 s left (for new work). */
export function currentToken() {
  const t = raw();
  return shared.isLive(t) ? t : null;
}
/* The token for work already running (inside track()): Lark still accepts it during the last 30 s. */
export function workToken() {
  const t = raw() || (inflight ? memo : null);
  return t && t.expires_at > Date.now() ? t : null;
}
export const hadSession = () => !!raw();
export const msLeft = () => { const t = raw(); return t ? Math.max(0, t.expires_at - Date.now()) : 0; };
export const endsAt = () => { const t = raw(); return t ? t.expires_at : 0; };
/* Writing needs bitable:app (an empty scope string means Lark didn't say). */
export function canWrite() {
  const t = currentToken();
  return !!t && (!t.scope || t.scope.split(" ").includes("bitable:app"));
}
/* Forget the login: in every Mineski tool and tab (they share it). */
export function clearSession() {
  shared.clear();
  memo = seen = null;
}

/* The one way a session ends (the clock, a dead-token code, Log out, or any of these in another
   tab or tool). Whoever registered with onEnded() drops what's on screen: fn(message, { elsewhere }),
   elsewhere meaning another tab or tool ended it early. Calling it again for a session that's
   already over, with nothing new to say, does nothing. */
const enders = new Set();
export const onEnded = (fn) => { enders.add(fn); return () => enders.delete(fn); };
export function end(message, { elsewhere = false } = {}) {
  const had = hadSession() || !!memo;
  clearSession();
  if (!had && !message) return;
  enders.forEach(fn => fn(message, { elsewhere }));
}
/* Log out: of every Mineski tool in this browser, since they share the login. Local only
   (Lark has no revoke call). */
export const logout = () => end("You've logged out of every Mineski tool in this browser. You're still logged in to Lark itself.");
onDeadToken(() => end());

/* ---------- the login shared with the other tabs and tools ---------- */
/* fn({ renewed }) runs when another tab or tool logs in or renews the login. renewed: this tab
   was already logged in (only the time left, and maybe the person, changed). */
const sharers = new Set();
export const onShared = (fn) => { sharers.add(fn); return () => sharers.delete(fn); };
let endAfterWork = null;
shared.onChange((t) => {
  const before = seen;
  if (shared.isLive(t)) {
    seen = memo = t;
    if (before && before.access_token === t.access_token) return;
    endAfterWork = null;   // logged in again before running work settled: nothing to end any more
    sharers.forEach(fn => fn({ renewed: shared.isLive(before) }));
    return;
  }
  seen = null;
  if (!before) return;   // this tab wasn't logged in: nothing to end
  const elsewhere = before.expires_at > Date.now() + 30000;   // ended early, so not by the clock
  const message = elsewhere ? ENDED_ELSEWHERE : ENDED;
  if (inflight) { endAfterWork = { message, elsewhere }; return; }   // a running write finishes first (with memo)
  end(message, { elsewhere });
});

/* ---------- work in flight ---------- */
/* Wrap a write or upload: its calls may use the token until its real expiry (workToken), even
   if the clock runs out or another tab logs out meanwhile. A login that ended elsewhere during
   the work ends here when it settles. The app's clock waits for busyWorking() to be false. */
let inflight = 0;
export async function track(work) {
  inflight++;
  try {
    return await work();
  } finally {
    if (--inflight === 0 && endAfterWork) {
      const { message, elsewhere } = endAfterWork;
      endAfterWork = null;
      end(message, { elsewhere });
    }
  }
}
export const busyWorking = () => inflight > 0;

/* ---------- login ---------- */
function b64url(bytes) {
  let s = "";
  bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* Send the browser to Lark. `returnTo` (a #/route) is restored after login. */
export async function startLogin(returnTo) {
  if (!window.crypto || !crypto.subtle) {
    throw new Error("This page needs https (or http://127.0.0.1) to log in. Open it from its normal address.");
  }
  // PKCE: the proxy adds the app secret for anyone, so the verifier is what stops
  // an intercepted login code from being used by someone else.
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  if (!store("session", PENDING_KEY, { state, verifier, returnTo: returnTo || "", createdAt: Date.now() })) {
    throw new Error("This browser is blocking site storage, so the login can't finish. Allow it for this site.");
  }
  const q = new URLSearchParams({
    client_id: APP_ID, redirect_uri: REDIRECT_URI, scope: SCOPES, state,
    code_challenge: b64url(new Uint8Array(digest)), code_challenge_method: "S256",
  });
  location.assign(`${LARK.authorize}?${q.toString().replace(/\+/g, "%20")}`);
}

/* Handle Lark's redirect back (?code=…&state=… or ?error=…).
   Resolves {ok, returnTo} or {ok: false, message, err}. */
export async function finishLogin(params) {
  const pending = recall("session", PENDING_KEY);
  store("session", PENDING_KEY, undefined);
  const returnTo = pending && /^#\/[\w\-\/%.]*$/.test(pending.returnTo || "") ? pending.returnTo : "";
  if (params.has("error")) {
    return { ok: false, returnTo, message: params.get("error") === "access_denied"
      ? "Login cancelled. Polaris needs your OK on Lark's page to read and write the tables."
      : `Lark couldn't log you in (${params.get("error")}). Try again.` };
  }
  if (!pending || pending.state !== params.get("state")) {
    return { ok: false, returnTo, message: "That login started in another tab. Log in again here." };
  }
  if (Date.now() - (pending.createdAt || 0) > PENDING_MAX_MS) {
    return { ok: false, returnTo, message: "That login took too long. Log in again." };
  }
  try {
    // The proxy may have fallen asleep while the person was on Lark's page: wait
    // for it first (the busy screen says so), then give the exchange a time limit
    // so a stuck connection ends in a message instead of an endless spinner.
    if (!await wake()) throw unreachable();
    const j = await lark("POST", `${LARK.api}/authen/v2/oauth/token`, { timeout: 45000, body: {
      grant_type: "authorization_code",
      client_id: APP_ID,                 // no client_secret: the proxy adds it
      code: params.get("code"),
      redirect_uri: REDIRECT_URI,
      code_verifier: pending.verifier,
    } });
    if (!j.access_token) throw new LarkError("no access_token in response", { json: j });
    shared.writeUser(undefined);   // another account must not inherit the last name and picture
    const t = { access_token: j.access_token, scope: j.scope || "", expires_at: Date.now() + (Number(j.expires_in) || 7200) * 1000 };
    shared.writeToken(t);          // every other open tab of every tool hears about it
    memo = seen = t;
    return { ok: true, returnTo };
  } catch (err) {
    return { ok: false, returnTo, err };
  }
}

/* The signed-in person's name and picture, cached with the shared login. */
export async function loadUser() {
  const cached = shared.readUser();
  if (cached) return cached;
  const t = currentToken();
  if (!t) return null;
  const j = await lark("GET", `${LARK.api}/authen/v1/user_info`, { token: t.access_token, read: true });
  const u = j.data || {};
  const user = { name: u.name || u.en_name || "", avatar: u.avatar_thumb || u.avatar_url || "", email: u.email || "" };
  if ((currentToken() || {}).access_token === t.access_token) shared.writeUser(user);   // not if another tab logged in someone else meanwhile
  return user;
}

/* Is this page's address a registered redirect URL? Lark's authorize page
   answers an unregistered one with an error page carrying "code":20029.
   Resolves null when fine (or when it can't tell), else a sentence. */
export async function redirectProblem() {
  if (!/^https?:$/.test(location.protocol)) {
    return "This page is open as a file, so Lark can't send you back to it. Open it from its web address.";
  }
  const probe = `${LARK.api}/authen/v1/authorize?client_id=${encodeURIComponent(APP_ID)}` +
                `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}`;
  try {
    const html = await (await fetch(viaProxy(probe), { cache: "no-store" })).text();
    const code = (html.match(/"code":\s*(\d+)/) || [])[1];
    if (code === "20029") {
      return `This address (${REDIRECT_URI}) isn't registered on the Lark app, so login would stop on a Lark ` +
             "error page. Add it under Security Settings > Redirect URLs in the Lark developer console.";
    }
    if (code && /errorPage/.test(html)) return `Lark rejected a test login for this page (code ${code}).`;
  } catch (e) { /* can't tell (proxy asleep or blocked); the login button still works */ }
  return null;
}
