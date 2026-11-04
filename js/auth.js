/* Lark login: OAuth 2.0 + PKCE, the same flow as tech/lark-user-login.

   The browser gets a user_access_token through the proxy (which adds the app
   secret), keeps it in sessionStorage (this tab only), and every Lark call then
   runs as the signed-in person. Lark gives about 2 hours; there is no refresh
   token, so after that the user logs in again. */

import { lark, LarkError, viaProxy, wake, onDeadToken, unreachable } from "./net.js";
import { store, recall } from "./ui.js";
import { LARK } from "./config.js";

export const APP_ID = LARK.appId;
// Lark returns to this page's own address (minus query, hash and index.html),
// which must exactly match a redirect URL registered on the app.
export const REDIRECT_URI = location.origin + location.pathname.replace(/index\.html?$/i, "");
export const SCOPES = LARK.scopes;

const KEY = { token: "polaris.auth.token", pending: "polaris.auth.pending", user: "polaris.auth.user" };
const PENDING_MAX_MS = 10 * 60 * 1000;   // a login started longer ago than this is refused
const GRACE_MS = 30000;                  // a token with less than this left counts as ended

/* ---------- the session ---------- */
const raw = () => recall("session", KEY.token);
export function currentToken() {
  const t = raw();
  return t && t.access_token && t.expires_at > Date.now() + GRACE_MS ? t : null;
}
/* The token for work already running: Lark still accepts it during the last 30 s. */
export function workToken() {
  const t = raw();
  return t && t.access_token && t.expires_at > Date.now() ? t : null;
}
export const hadSession = () => !!raw();
export const msLeft = () => { const t = raw(); return t ? Math.max(0, t.expires_at - Date.now()) : 0; };
export const endsAt = () => { const t = raw(); return t ? t.expires_at : 0; };
/* Writing needs bitable:app (an empty scope string means Lark didn't say). */
export function canWrite() {
  const t = currentToken();
  return !!t && (!t.scope || t.scope.split(" ").includes("bitable:app"));
}
export function clearSession() {
  store("session", KEY.token, undefined);
  store("session", KEY.user, undefined);
}

/* The one way a session ends (the clock, a dead-token code, Log out). Whoever
   registered with onEnded() drops what's on screen. Calling it again for a session
   that's already over, with nothing new to say, does nothing. */
const enders = new Set();
export const onEnded = (fn) => { enders.add(fn); return () => enders.delete(fn); };
export function end(message) {
  const had = hadSession();
  clearSession();
  if (!had && !message) return;
  enders.forEach(fn => fn(message));
}
onDeadToken(() => end());

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
  if (!store("session", KEY.pending, { state, verifier, returnTo: returnTo || "", createdAt: Date.now() })) {
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
  const pending = recall("session", KEY.pending);
  store("session", KEY.pending, undefined);
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
    store("session", KEY.user, undefined);   // another account must not inherit the last name and picture
    store("session", KEY.token, {
      access_token: j.access_token,
      scope: j.scope || "",
      expires_at: Date.now() + (Number(j.expires_in) || 7200) * 1000,
    });
    return { ok: true, returnTo };
  } catch (err) {
    return { ok: false, returnTo, err };
  }
}

/* The signed-in person's name and picture, cached for this tab. */
export async function loadUser() {
  const cached = recall("session", KEY.user);
  if (cached) return cached;
  const t = currentToken();
  if (!t) return null;
  const j = await lark("GET", `${LARK.api}/authen/v1/user_info`, { token: t.access_token, read: true });
  const u = j.data || {};
  // open_id: the same id the tables' person fields carry, so Sanctum can tell who you are by it.
  const user = { id: u.open_id || "", name: u.name || u.en_name || "", avatar: u.avatar_thumb || u.avatar_url || "", email: u.email || "" };
  store("session", KEY.user, user);
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
    const res = await fetch(viaProxy(probe), { cache: "no-store" });
    const html = await res.text();
    // The connection service only serves the sites it lists: then nothing would work, login included.
    if (res.status === 403 && /origin not allowed/.test(html)) {
      return `The connection service doesn't accept this site (${location.origin}) yet, so logging in won't work here. ` +
             "Ask its admin to add this address to the service's allowed origins.";
    }
    const code = (html.match(/"code":\s*(\d+)/) || [])[1];
    if (code === "20029") {
      return `This address (${REDIRECT_URI}) isn't registered on the Lark app, so login would stop on a Lark ` +
             "error page. Add it under Security Settings > Redirect URLs in the Lark developer console.";
    }
    if (code && /errorPage/.test(html)) return `Lark rejected a test login for this page (code ${code}).`;
  } catch (e) { /* can't tell (proxy asleep or blocked); the login button still works */ }
  return null;
}
