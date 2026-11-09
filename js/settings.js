/* Settings kept in this browser, layered over config.js:

     config.js default  ←  saved address (Settings > Advanced)  ←  ?lark=<url> (this tab)

   The connection service receives people's login tokens, so its address can only
   be overridden on a local page: a hosted page always uses the real one. Link
   overrides last for the tab; ?reset clears them. Only https addresses, or http on
   this computer, are accepted. The theme has its own key (polaris.theme, ui.js). */

import { SERVICES } from "./config.js";
import { store, recall } from "./ui.js";
import { isLocalHostname, isServiceUrl } from "./service.js";

const KEY = "polaris.settings";             // { larkUrl }
const LINK_KEY = "polaris.override.lark";   // session: the ?lark= link
export { isServiceUrl };

export const isLocalPage = () => isLocalHostname(location.hostname);

const read = () => recall("local", KEY) || {};
const listeners = new Set();
export const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/* Link overrides, read once as the page loads. */
if (isLocalPage()) {
  const q = new URLSearchParams(location.search);
  if (q.has("reset")) store("session", LINK_KEY, undefined);
  if (q.get("lark") && isServiceUrl(q.get("lark"))) store("session", LINK_KEY, q.get("lark").trim());
}

/* The saved address, or "" (only on a local page). */
export const savedLarkUrl = () => (isLocalPage() && isServiceUrl(read().larkUrl || "") ? read().larkUrl : "");
export const linkLarkUrl = () => (isLocalPage() && isServiceUrl(recall("session", LINK_KEY) || "") ? recall("session", LINK_KEY) : "");

/* The connection service addresses in force, tried in order: SERVICES.lark.urls (Cloudflare,
   then Render), or an override, which replaces the whole list with one address (no backup). */
export const larkUrls = () => {
  const o = linkLarkUrl() || savedLarkUrl();
  return (o ? [o] : SERVICES.lark.urls).map(u => String(u).replace(/\/+$/, ""));
};

/* Every active override, for the red badge in the top bar. */
export function overrides() {
  const out = [];
  const url = linkLarkUrl() || savedLarkUrl();
  if (url) out.push(`Connection service: ${url}`);
  return out;
}

/* Save (or, with "", remove) the saved address. */
export function setLarkUrl(url) {
  const next = { ...read() };
  if (url) next.larkUrl = url; else delete next.larkUrl;
  const ok = store("local", KEY, Object.keys(next).length ? next : undefined);
  listeners.forEach(fn => fn());
  return ok;
}
