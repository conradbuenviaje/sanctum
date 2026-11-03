/* The daily accountability digest: every blank the accountability rules ask for
   (js/accountability.js, with what the Admin page saved), by person, sent to a
   Telegram group. Read-only in Lark: it never writes there.

     npm run notify -- --dry-run     # print the digest, send nothing
     npm run notify                  # send it

   It reads Lark as a Lark app. Set, in the environment or in .env (git-ignored; see .env.example):
     LARK_APP_SECRET       optional: the Lark app's secret (and LARK_APP_ID if it isn't
                           Polaris's app). Without it, the token comes from the hosted
                           connection service's GET /token (Polaris's app; tools/service-token.mjs).
     TELEGRAM_BOT_TOKEN    from @BotFather (not needed with --dry-run)
     TELEGRAM_CHAT_ID      the group's chat id, e.g. -1001234567890 (not needed with --dry-run)
     SANCTUM_URL           optional: where Sanctum is hosted, for the link in the digest

   What was open last time is kept in a state file (--state=<path>, default
   .digest-state.json, git-ignored), so the digest can mark what's new and say how
   long the oldest blank has been open. GitHub Actions keeps it between runs in its
   cache (.github/workflows/digest.yml). */

import { readFileSync, writeFileSync } from "node:fs";
import { RULES, ACCOUNTABILITY, TABLE_LINKS, SERVICES, LARK } from "../js/config.js";
import { loadEverything, loadFields, loadRecords, parseBaseLink } from "../js/ops.js";
import { variableColumns } from "../js/sync.js";
import { configFrom, accountabilityItems, nextState, digestMessages } from "../js/accountability.js";
import { tenantToken, makeCall, tables as allTables, parseEnv } from "../tests/lark-node.mjs";
import { serviceToken } from "./service-token.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const statePath = (args.find(a => a.startsWith("--state=")) || "").slice(8) || new URL("../.digest-state.json", import.meta.url);

let saved = {};
try { saved = parseEnv(readFileSync(new URL("../.env", import.meta.url), "utf8")); } catch { /* the environment must have them */ }
const env = (k) => process.env[k] || saved[k] || "";
const bot = env("TELEGRAM_BOT_TOKEN"), chat = env("TELEGRAM_CHAT_ID");
if (!dryRun && (!bot || !chat)) {
  console.error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set to send the digest (or run with --dry-run).");
  process.exit(1);
}

/* Read only what the digest needs. ANDON may be closed to the Lark app (only users
   can open its Base today): then its rules are skipped and the digest says so. */
let token;
if (env("LARK_APP_SECRET")) {
  token = await tenantToken({ appId: env("LARK_APP_ID") || LARK.appId, appSecret: env("LARK_APP_SECRET") });
} else {
  const service = env("LARK_SERVICE_URL") || SERVICES.lark.url;
  console.log(`No LARK_APP_SECRET: getting the token from the connection service (${service}), which can take a minute to wake…`);
  token = await serviceToken(service);
}
const call = makeCall(token);
const T = allTables();
const want = Object.fromEntries(["universe", "collections", "variables"].filter(k => T[k]).map(k => [k, T[k]]));
const { data, fields, columns, problems } = await loadEverything(call, want, RULES);
try {
  const andon = parseBaseLink(TABLE_LINKS.andon);
  fields.andon = await loadFields(call, andon);
  data.andon = await loadRecords(call, andon);
} catch (e) {
  console.log(`ANDON couldn't be read as the Lark app (${e.message}); its rules are skipped.`);
}

const cols = data.variables ? variableColumns(fields.variables, data.variables, RULES.tags) : null;
const cfg = configFrom(ACCOUNTABILITY, data.variables, cols);
const res = accountabilityItems(data, cfg, {
  fields, read: columns, tagField: RULES.tags.field,
  forCollection: RULES.collectionStages.forCollection, invalid: RULES.invalidStatuses,
});

let previous = null;
try { previous = JSON.parse(readFileSync(statePath, "utf8")); } catch { /* first run: nothing is "new" */ }
const now = Date.now();
const state = nextState(res.items, previous, now);
const dateLabel = new Date(now).toLocaleDateString("en-PH", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Manila" });
const messages = digestMessages(res.items, cfg, {
  now, state, previous, dateLabel,
  perPerson: ACCOUNTABILITY.digest.perPerson,
  pageUrl: env("SANCTUM_URL") || ACCOUNTABILITY.digest.pageUrl,
  notes: [...cfg.problems, ...res.notes],   // (a column only a Polaris push needs is the log's business, not the team's)
});
for (const p of problems) console.log(`Column check: ${p}`);

console.log(`${res.items.length} blanks on ${res.projects.length} projects; skipped ${JSON.stringify(res.skipped)}; ${messages.length} message(s).`);
if (dryRun) {
  for (const m of messages) console.log(`\n----- message (${m.length} chars) -----\n${m}`);
  process.exit(0);
}

for (const [i, text] of messages.entries()) {
  const r = await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) {
    // The state isn't saved, so the next run still marks today's new items as new.
    console.error(`Telegram refused message ${i + 1} of ${messages.length}: ${j.description || `HTTP ${r.status}`}.`);
    process.exit(1);
  }
}
writeFileSync(statePath, JSON.stringify(state));
console.log(`Sent ${messages.length} message(s) to Telegram.`);
