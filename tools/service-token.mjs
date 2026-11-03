/* The digest's other way to a Lark token: the hosted connection service's GET /token,
   which mints a token for the Polaris Lark app from the credentials the service holds
   (its "Quick Start", documented in mineski-stephen/lark-api-test). No secret is
   needed on this side. Used by tools/notify.mjs only when LARK_APP_SECRET isn't set;
   the admin scripts (tests/lark-node.mjs) never go through the service.

   The service sleeps on Render's free tier and can take up to a minute to wake, so
   each try waits long enough for that. Throws a plain sentence if it fails. */

export async function serviceToken(base, { fetch: get = globalThis.fetch, timeoutMs = 90000, tries = 2 } = {}) {
  const url = `${String(base).replace(/\/+$/, "")}/token`;
  let last = "";
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await get(url, { signal: AbortSignal.timeout(timeoutMs) });
      const j = await res.json().catch(() => ({}));
      const token = j.tenant_access_token || j.app_access_token;
      if (Number(j.code) === 0 && token) return token;
      last = j.msg ? `Lark said ${j.msg} (code ${j.code})` : `HTTP ${res.status}`;
    } catch (e) {
      last = e && e.name === "TimeoutError" ? `no answer in ${Math.round(timeoutMs / 1000)} s` : (e && e.message) || "error";
    }
  }
  throw new Error(`Couldn't get a Lark token from the connection service (${url}): ${last}.`);
}
