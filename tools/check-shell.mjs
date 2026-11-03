/* Checks the page's shell, offline: npm run check:shell
     1. index.html's import map lists every js/*.js (and nothing that isn't there),
        and every import inside js/ points at a listed module
     2. the shared files are byte-identical to the design language's assets
        (js/ui.js, js/icons.js, css/mineski-base.css, css/theme.css = themes/polaris.css)
     3. the boot watchdog is in place, and the page has main#main, a referrer meta and a CSP meta
     4. node --check passes on every module (and on these tools)
     5. no secret-shaped string (an API key, an app secret, a token) in any file that would be published
   Exits 1 if anything fails. */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, relative, sep, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* The module list in index.html's loader script: var files = ["js/a.js", …]. */
export function importMapFiles(html) {
  const m = html.match(/var files = \[([\s\S]*?)\]/);
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]) : [];
}

/* Secret-shaped strings: what an API key, an app secret or a Lark token looks like. */
const SECRETS = [
  [/AIza[0-9A-Za-z_\-]{35}/, "a Google API key (AIza…)"],
  [/\b(?:app_secret|client_secret|api[_-]?key|secret)["']?\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i, "a secret assigned to a name"],
  [/\bLARK_APP_SECRET[ \t]*=[ \t]*[^\s#"']{8,}/, "LARK_APP_SECRET with a value"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/\bsk-[A-Za-z0-9]{20,}/, "an API key (sk-…)"],
  [/\b[ut]-[A-Za-z0-9_\-]{36,}/, "a Lark access token (u-… or t-…)"],
  [/\b\d{8,10}:[A-Za-z0-9_\-]{35}\b/, "a Telegram bot token"],
  [/\bTELEGRAM_BOT_TOKEN[ \t]*=[ \t]*[^\s#"']{8,}/, "TELEGRAM_BOT_TOKEN with a value"],
];
export function findSecrets(text) {
  return SECRETS.filter(([re]) => re.test(text)).map(([, what]) => what);
}

const md5 = (file) => createHash("md5").update(readFileSync(file)).digest("hex");
const walk = (dir, skip) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  if (skip(p, name)) return [];
  return statSync(p).isDirectory() ? walk(p, skip) : [p];
});

/* Where the design language's assets are: next to the tool in the workspace, or the copy under .claude/skills. */
function assetsDir() {
  const candidates = [process.env.DESIGN_REF && join(process.env.DESIGN_REF, "assets"),
    join(ROOT, "..", "design-ref", "mineski-design-language", "assets"),
    join(ROOT, ".claude", "skills", "mineski-design-language", "assets")].filter(Boolean);
  return candidates.find(d => existsSync(join(d, "ui.js")));
}

function run() {
  let failures = 0;
  const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; return cond; };
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const mods = readdirSync(join(ROOT, "js")).filter(f => f.endsWith(".js")).map(f => `js/${f}`).sort();

  console.log("Import map");
  const listed = importMapFiles(html);
  const unlisted = mods.filter(f => !listed.includes(f)), ghosts = listed.filter(f => !mods.includes(f));
  ok(!unlisted.length, unlisted.length ? `not in the import map: ${unlisted.join(", ")}` : `all ${mods.length} modules are listed`);
  ok(!ghosts.length, ghosts.length ? `listed but missing: ${ghosts.join(", ")}` : "nothing listed that isn't there");
  const stray = [];
  for (const f of mods) {
    for (const m of readFileSync(join(ROOT, f), "utf8").matchAll(/(?:from|import)\s*["']\.\/([\w\-]+\.js)["']/g)) {
      if (!listed.includes(`js/${m[1]}`)) stray.push(`${f} → ${m[1]}`);
    }
  }
  ok(!stray.length, stray.length ? `imports of unlisted modules: ${stray.join(", ")}` : "every import points at a listed module");

  console.log("Shared files");
  const assets = assetsDir();
  if (!ok(!!assets, "design language assets found")) { /* nothing to compare with */ } else {
    for (const [mine, theirs] of [["js/ui.js", "ui.js"], ["js/icons.js", "icons.js"], ["css/mineski-base.css", "mineski-base.css"],
                                  ["css/theme.css", join("themes", "polaris.css")]]) {
      ok(md5(join(ROOT, mine)) === md5(join(assets, theirs)), `${mine} is identical to the design language's ${theirs.replace(sep, "/")}`);
    }
  }

  console.log("Page");
  ok(/setTimeout\(function \(\) \{\s*if \(document\.documentElement\.hasAttribute\("data-booted"\)\)/.test(html), "boot watchdog is in index.html");
  ok(/dataset\.booted\s*=/.test(readFileSync(join(ROOT, "js", "app.js"), "utf8")), "app.js tells the watchdog it started");
  ok(/<main[^>]*\bid="main"/.test(html), "main#main");
  ok(/<meta name="referrer"/.test(html), "referrer meta");
  ok(/<meta http-equiv="Content-Security-Policy"/.test(html), "CSP meta");

  console.log("Version");
  const version = (readFileSync(join(ROOT, "js", "config.js"), "utf8").match(/\bversion:\s*"(\d+\.\d+\.\d+)"/) || [])[1];
  const logged = existsSync(join(ROOT, "CHANGELOG.md")) &&
    (readFileSync(join(ROOT, "CHANGELOG.md"), "utf8").match(/^## (\d+\.\d+\.\d+)/m) || [])[1];
  if (ok(!!version, version ? `APP.version is ${version}` : "APP.version (x.y.z) is in js/config.js")) {
    ok(logged === version, logged ? (logged === version ? "CHANGELOG.md's newest entry matches it"
      : `CHANGELOG.md's newest entry is ${logged}, not ${version}`) : "CHANGELOG.md has a \"## x.y.z\" entry");
  }
  ok(/id="appVersion"/.test(html), "the top bar shows the version (#appVersion)");

  console.log("Syntax");
  const tools = readdirSync(join(ROOT, "tools")).filter(f => f.endsWith(".mjs")).map(f => `tools/${f}`);
  const tests = readdirSync(join(ROOT, "tests")).filter(f => /\.(m?js)$/.test(f)).map(f => `tests/${f}`);
  for (const f of [...mods, ...tools, ...tests]) {
    // stdio "inherit": a syntax error prints straight to the terminal (and works where piped child output doesn't)
    const r = spawnSync(process.execPath, ["--check", join(ROOT, f)], { stdio: "inherit" });
    if (r.status !== 0) ok(false, `${f} has a syntax error`);
  }
  console.log(`  ✓ checked ${mods.length + tools.length + tests.length} files`);

  console.log("Secrets");
  const skip = (p, name) => [".git", "node_modules", ".claude", "__pycache__"].includes(name)
    || /^\.env(\.|$)/.test(name) && name !== ".env.example" || name === ".preview-fixture.json";
  const files = walk(ROOT, skip).filter(p => /\.(js|mjs|css|html|md|json|py|webmanifest|svg|yml|yaml|txt|example)$/.test(p) || p.endsWith(".env.example"));
  let found = 0;
  for (const p of files) {
    const hits = findSecrets(readFileSync(p, "utf8"));
    if (hits.length) { found++; ok(false, `${relative(ROOT, p)} looks like it holds ${hits.join(", ")}`); }
  }
  if (!found) ok(true, `none in ${files.length} files`);

  console.log(failures ? `\n${failures} problem(s) found.` : "\nThe shell checks out ✓");
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = run() ? 1 : 0;
