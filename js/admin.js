/* The Admin page (#/admin): the accountability rules, who holds each named role, the
   Telegram handles the digest mentions, the scope, and who may change them. A draft
   is edited here and nothing reaches Lark until Save: then the Variables table is made
   to match it (one row per rule, role, person or setting; js/accountability.js), and
   the board and the next digest use it. Each section folds (remembered in this browser). */

import { ACCOUNTABILITY } from "./config.js";
import {
  configValues, configWrites, isAdmin, telegramHandle, rulesBehindDefaults, rulesMissingFromDefaults, filterValues, renameRole, ROW, TABLE_NAMES,
} from "./accountability.js";
import { addVariable, updateVariable, deleteVariable } from "./ops.js";
import { nickKey } from "./mancom.js";
import { $, h, ic, toast, busy, confirmSheet, store, recall } from "./ui.js";
import { describe, isDeadToken } from "./net.js";

const KEY = { closed: "polaris.adminClosed" };
const clone = (x) => JSON.parse(JSON.stringify(x));
// "stephen.lin@mineskiglobal.com" → "Stephen Lin": a name for someone added by email who isn't in the tables.
const nameFromEmail = (email) => email.split("@")[0].split(/[._-]+/).filter(Boolean)
  .map(w => w[0].toUpperCase() + w.slice(1)).join(" ") || email;
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const sig = (cfg) => JSON.stringify(configValues(cfg).map(v => [v.key, v.value]));
const PROJECT_ROLES = [...Object.keys(ACCOUNTABILITY.projectRoles), ACCOUNTABILITY.tribeRole.role];

export function createAdmin(ctx) {
  const { S } = ctx;
  const D = { draft: null, base: "", saving: false, peopleQuery: "", refocus: "",
              closed: new Set(recall("local", KEY.closed) || ["people"]), openFilters: new Set() };

  /* The draft follows what's saved until someone changes something. */
  function sync() {
    if (!S.acc) { D.draft = null; return; }
    const saved = sig(S.acc.cfg);
    if (!D.draft || (D.base !== saved && sig(D.draft) === D.base)) { D.draft = clone(S.acc.cfg); D.base = saved; }
  }
  const dirty = () => !!D.draft && sig(D.draft) !== D.base;

  /* Everyone the pickers offer: BDs, AMs and PMs seen in the tables, and whoever is already in a role. */
  function pool() {
    const m = new Map();
    const add = (p) => { const id = p.id || p.email || p.name; if (id && !m.has(id)) m.set(id, { id: p.id || id, name: p.name || id, email: p.email || "" }); };
    [...(S.pool || []), ...(S.pmPool || [])].forEach(add);
    if (D.draft) { [...Object.values(D.draft.roles), ...Object.values(D.draft.tribeLeads || {})].flat().forEach(add); D.draft.admins.forEach(add); }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function render() {
    const box = $("#adminBox"), bar = $("#adminBar");
    sync();
    if (!S.data || !S.acc) {
      bar.hidden = true;
      box.replaceChildren(S.loadError
        ? h("div", { class: "callout callout-err" }, ic("alert"), h("div", null, describe(S.loadError)))
        : h("div", { class: "loader" }, h("div", { class: "loader-title" }, h("span", { class: "spinner" }), "Loading…")));
      return;
    }
    const why = blockedReason();
    const can = !why;
    const d = D.draft;
    const allOpen = !D.closed.size;
    box.replaceChildren(...[
      why ? h("div", { class: "callout callout-warn" }, ic("alert"), h("div", null, why)) : null,
      ...S.acc.cfg.problems.map(p => h("div", { class: "callout callout-warn" }, ic("alert"), h("div", null, p))),
      h("div", { class: "adm-tools" }, h("button", { type: "button", class: "btn btn-sm btn-ghost", onclick: () => {
        if (allOpen) SECTIONS.forEach(k => D.closed.add(k)); else D.closed.clear();
        store("local", KEY.closed, [...D.closed]); render();
      } }, ic(allOpen ? "sortUp" : "sortDown"), allOpen ? "Fold all" : "Unfold all")),
      scopeCard(d, can), rolesCard(d, can), tribesCard(d, can), rulesCard(d, can), nicknamesCard(d, can), peopleCard(d, can), adminsCard(d, can),
    ].filter(Boolean));
    bar.hidden = !dirty();
    $("#adminSave").disabled = !can || D.saving;
    // A picker that just added someone keeps the keyboard.
    if (D.refocus) {
      const el = box.querySelector(`input[data-picker="${CSS.escape(D.refocus)}"]`);
      D.refocus = "";
      if (el) el.focus();
    }
  }

  function blockedReason() {
    if (!ctx.tables.variables || !S.data.variables) return "The Variables table couldn't be read, so these can't be saved. Check your access to it in Lark, then Refresh.";
    if (!S.tagCols) return "Sanctum couldn't find the Variable and Value columns in the Variables table, so these can't be saved.";
    const valueCol = ctx.fieldsOf("variables").find(f => f.field_name === S.tagCols.value);
    if (valueCol && valueCol.type !== 1) return `The Variables table's “${S.tagCols.value}” column must be Text to hold these settings.`;
    if (!isAdmin(S.acc.cfg, S.user)) return `Only the admins (${S.acc.cfg.admins.map(a => a.name).join(", ")}) can change these.`;
    if (!ctx.canWriteFor("variables")) return ctx.problemsFor("variables")[0] || "Your login can only read the tables. Log in again to change these.";
    return "";
  }
  const changed = () => { render(); };

  /* A section that folds: its title is a button; `meta` sits beside it (a count). */
  const SECTIONS = ["scope", "roles", "tribes", "rules", "nicknames", "people", "admins"];
  function section(key, title, meta, ...body) {
    const open = !D.closed.has(key);
    return h("section", { class: `card set-card adm-sec${open ? "" : " is-closed"}` },
      h("button", { type: "button", class: "adm-sec-head", "aria-expanded": String(open), onclick: () => {
        if (open) D.closed.add(key); else D.closed.delete(key);
        store("local", KEY.closed, [...D.closed]); render();
      } }, h("h2", null, title), meta ? h("span", { class: "badge badge-muted" }, meta) : null, ic("caret", "i adm-caret")),
      open ? body : null);
  }

  /* ---- scope ---- */
  function scopeCard(d, can) {
    const since = h("input", { type: "date", value: d.since, disabled: !can, onchange: (e) => { if (e.target.value) { d.since = e.target.value; changed(); } } });
    const tags = h("input", { type: "text", value: d.skipTags.join(", "), disabled: !can, placeholder: "e.g. Hidden",
      onchange: (e) => { d.skipTags = e.target.value.split(",").map(s => s.trim()).filter(Boolean); changed(); } });
    const roles = roleNames(d);
    const fb = h("input", { type: "text", value: d.fallback.join(", "), disabled: !can, list: "adminRoleList",
      onchange: (e) => { d.fallback = e.target.value.split(",").map(s => s.trim()).filter(s => roles.includes(s)); changed(); } });
    d.exclude = d.exclude || {};
    const nOut = Object.values(d.exclude).reduce((n, l) => n + l.length, 0);
    return section("scope", "Scope", nOut ? `${nOut} left out` : "",
      h("label", { class: "field" }, h("span", null, "Check projects from"), since,
        h("span", { class: "set-help" }, "By RFP Received Date, else Year, else the year in the project code.")),
      h("div", { class: "field" }, h("span", null, "Leave out projects by"),
        h("div", { class: "adm-filters" }, (d.scopeFilters || ACCOUNTABILITY.scopeFilters).map(flt => filterBox(d, flt, can))),
        h("span", { class: "set-help" }, "Tap a value to leave out every project that has it (for example Status: Archived). Tap again to bring them back.")),
      h("label", { class: "field" }, h("span", null, "Skip projects tagged"), tags,
        h("span", { class: "set-help" }, "Custom tags (Settings), separated by commas.")),
      h("label", { class: "field" }, h("span", null, "When a role has nobody, send to"), fb,
        h("span", { class: "set-help" }, `The first of these that has someone, in order. Roles: ${roles.join(", ")}.`)),
      h("datalist", { id: "adminRoleList" }, roles.map(r => h("option", { value: r }))));
  }

  /* One scope filter: its values as chips (pressed = left out), with a search when there are many. */
  function filterBox(d, flt, can) {
    const values = filterValues(flt, S.data, d);
    const out = d.exclude[flt.key] || [];
    const isOut = (v) => out.some(x => x.toLowerCase() === v.toLowerCase());
    const toggle = (v) => {
      const next = isOut(v) ? out.filter(x => x.toLowerCase() !== v.toLowerCase()) : [...out, v];
      if (next.length) d.exclude[flt.key] = next; else delete d.exclude[flt.key];
      D.openFilters.add(flt.key);
      changed();
    };
    const chips = values.map(({ value, n }) => h("button", {
      type: "button", class: "chip-opt", "aria-pressed": String(isOut(value)), disabled: !can || null, "data-v": value.toLowerCase(),
      title: isOut(value) ? "Left out: tap to check these projects again" : "Tap to leave these projects out", onclick: () => toggle(value),
    }, value, h("span", { class: "count" }, String(n))));
    const search = values.length > 12 ? h("label", { class: "search search-sm" }, ic("search"), h("span", { class: "sr-only" }, `Find a ${flt.label}`),
      h("input", { type: "search", placeholder: `Find a ${flt.label.toLowerCase()}…`, oninput: (e) => {
        const q = e.target.value.trim().toLowerCase();
        for (const c of chips) c.hidden = !!q && !c.dataset.v.includes(q);
      } })) : null;
    return h("details", { class: "adm-filter", open: D.openFilters.has(flt.key) || null,
      ontoggle: (e) => { if (e.target.open) D.openFilters.add(flt.key); else D.openFilters.delete(flt.key); } },
      h("summary", null, h("b", null, flt.label), out.length ? h("span", { class: "badge badge-warn" }, `leaving out ${out.join(", ")}`) : h("span", { class: "muted" }, "nothing left out")),
      values.length ? [search, h("div", { class: "chips adm-chips" }, chips)]
        : h("p", { class: "set-help" }, `No values found in ${TABLE_NAMES[flt.table]}'s ${flt.field}.`));
  }

  /* ---- named roles ---- */
  function rolesCard(d, can) {
    const input = h("input", { type: "text", placeholder: "New role, e.g. Sales Head", maxlength: "40", disabled: !can });
    const add = () => {
      const name = input.value.replace(/\s+/g, " ").trim();
      if (!name || roleNames(d).some(r => r.toLowerCase() === name.toLowerCase())) return;
      d.namedRoles.push(name); d.roles[name] = []; changed();
    };
    const tagged = d.namedRoles.filter(n => (d.roles[n] || []).length).length;
    return section("roles", "Roles", `${tagged} of ${d.namedRoles.length} tagged`,
      h("p", { class: "set-sub" }, "BD, AM and PM come from each project's own rows (Universe BD and AM, ANDON PM (LEAD)), and the Tribe Lead from its tribe (below). These roles are held by the same people for every project."),
      h("ul", { class: "adm-roles" }, d.namedRoles.map(name => h("li", null,
        h("div", { class: "adm-role-head" }, h("b", null, name),
          h("span", { class: "row" },
            can ? h("button", { type: "button", class: "icon-btn icon-sm", title: `Rename ${name}`, "aria-label": `Rename ${name}`, onclick: () => rename(name) }, ic("pencil")) : null,
            can && !ruleUses(d, name) ? h("button", { type: "button", class: "icon-btn icon-sm", title: `Remove the ${name} role`, "aria-label": `Remove ${name}`,
              onclick: () => { d.namedRoles = d.namedRoles.filter(r => r !== name); delete d.roles[name]; d.fallback = d.fallback.filter(r => r !== name); changed(); } }, ic("x")) : null)),
        peoplePicker(d.roles[name], can, `Who is the ${name}?`, `role:${name}`)))),
      h("form", { class: "tag-add", onsubmit: (e) => { e.preventDefault(); add(); } }, input,
        h("button", { type: "submit", class: "btn btn-sm", disabled: !can }, "Add role")));
  }
  const ruleUses = (d, role) => d.rules.some(r => r.responsible === role || r.accountable === role) || d.fallback.includes(role);
  const roleNames = (d) => [...PROJECT_ROLES, ...d.namedRoles];

  /* Rename a role everywhere it's used in the draft: its people, the rules, the fallback order. */
  async function rename(from) {
    const field = h("input", { type: "text", id: "roleRename", value: from, maxlength: "40" });
    const ok = await confirmSheet({
      title: `Rename ${from}`, icon: "pencil", confirm: "Rename", busyText: "Renaming…",
      sub: "Its people, the rules naming it and the fallback order follow. Save changes afterwards.",
      body: h("div", { class: "field" }, h("label", { class: "field-label", for: "roleRename" }, "New name"), field),
      run: async () => { D.draft = renameRole(D.draft, from, field.value, PROJECT_ROLES); },
    });
    if (ok) changed();
  }

  /* ---- tribe leads ---- */
  function tribesCard(d, can) {
    d.tribeLeads = d.tribeLeads || {};
    // Every tribe ANDON offers (in the browser ANDON reads as you), and any saved before.
    const andonTribes = (ctx.optionsOf("andon") || {})[ACCOUNTABILITY.tribeRole.field] || [];
    const notATribe = (t) => (ACCOUNTABILITY.blankValues[ACCOUNTABILITY.tribeRole.field] || []).some(p => p.toLowerCase() === t.toLowerCase());
    const tribes = [...new Set([...andonTribes, ...Object.keys(d.tribeLeads)])].filter(t => !notATribe(t));
    for (const t of tribes) if (!d.tribeLeads[t]) d.tribeLeads[t] = [];
    const tagged = tribes.filter(t => d.tribeLeads[t].length).length;
    return section("tribes", "Tribe leads", tribes.length ? `${tagged} of ${tribes.length} tagged` : "",
      h("p", { class: "set-sub" }, "A project's Tribe Lead is the lead of its ANDON TRIBE. While a project has no tribe yet, it's every Tribe Lead: they decide at the Win meeting which tribe takes it and who its PM is."),
      tribes.length
        ? h("ul", { class: "adm-roles" }, tribes.map(t => h("li", null,
            h("div", { class: "adm-role-head" }, h("b", null, t)),
            peoplePicker(d.tribeLeads[t], can, `Who leads ${t}?`, `tribe:${t}`))))
        : h("p", { class: "set-help" }, "ANDON couldn't be read, so its tribes aren't known here. Check your access to ANDON, then Refresh."));
  }

  /* People chips with a box that searches everyone in the tables by name or email, and
     adds anyone else by their full email. Enter (or a click) adds the highlighted one. */
  function peoplePicker(list, can, placeholder, key) {
    const all = pool();
    const sug = h("ul", { class: "suggest", role: "listbox", hidden: true });
    let matches = [], active = 0;
    const same = (p) => (x) => (p.id && x.id === p.id) || (p.email && x.email && x.email.toLowerCase() === p.email.toLowerCase());
    const add = (p) => {
      if (!p || list.some(same(p))) return;
      list.push({ id: p.id, name: p.name, email: p.email });
      D.refocus = key;
      changed();
    };
    const paint = () => {
      sug.replaceChildren(...matches.map((p, i) => h("li", {
        role: "option", "aria-selected": String(i === active),
        onmousedown: (e) => { e.preventDefault(); add(p); },
      }, h("span", null, p.isNew ? `Add ${p.email}` : p.name), h("small", null, p.isNew ? "Not in the tables yet: added by email" : p.email || "no email in Lark"))));
      sug.hidden = !matches.length;
    };
    const input = h("input", {
      type: "text", placeholder: `${placeholder} Type a name or email`, disabled: !can, autocomplete: "off", "data-picker": key,
      role: "combobox", "aria-autocomplete": "list", "aria-expanded": "false",
      oninput: (e) => {
        const q = e.target.value.trim().toLowerCase();
        active = 0;
        matches = !q ? [] : all.filter(p => !list.some(same(p)) && (p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))).slice(0, 8);
        if (isEmail(q) && !all.some(p => p.email.toLowerCase() === q)) matches.push({ id: "", name: nameFromEmail(q), email: q, isNew: true });
        e.target.setAttribute("aria-expanded", String(!!matches.length));
        paint();
      },
      onkeydown: (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          if (!matches.length) return;
          e.preventDefault();
          active = (active + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length;
          paint();
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (matches.length) add(matches[active]);
        } else if (e.key === "Escape") { matches = []; paint(); }
      },
      onblur: () => setTimeout(() => { matches = []; paint(); }, 120),
    });
    return h("div", { class: "picker" }, h("div", { class: "picker-box" },
      list.map(p => h("span", { class: `chip${p.id ? "" : " is-email"}`, title: p.id ? p.email || null : `${p.email}: added by email. Sanctum knows them by this name until they show up in the tables, so it should match their Lark name.` },
        p.name,
        // Added by email (no Lark id): the name is how Sanctum recognises them when they log in.
        can && !p.id ? h("button", { type: "button", "aria-label": `Set ${p.email}'s name as in Lark`, title: "Set their name as it is in Lark",
          onclick: () => renamePerson(p) }, ic("pencil")) : null,
        can ? h("button", { type: "button", "aria-label": `Remove ${p.name}`, onclick: () => { list.splice(list.indexOf(p), 1); changed(); } }, ic("x")) : null)),
      input), sug);
  }

  /* Someone added by email: set their name as Lark spells it (it's what their login is matched by). */
  async function renamePerson(p) {
    const field = h("input", { type: "text", id: "personName", value: p.name, maxlength: "80" });
    const ok = await confirmSheet({
      title: "Their name in Lark", icon: "pencil", confirm: "Set name", busyText: "Setting…",
      sub: p.email,
      body: h("div", { class: "field" }, h("label", { class: "field-label", for: "personName" }, "Name, as it shows in Lark"), field,
        h("p", { class: "set-help" }, "Lark doesn't tell Sanctum a person's email when they log in, only their name, so this is how Sanctum knows it's them. Save changes afterwards.")),
      run: async () => {
        const name = field.value.replace(/\s+/g, " ").trim();
        if (name.split(" ").length < 2) throw new Error("Type their full name (at least a first and last name).");
        // The same person may be in several roles: rename them everywhere in the draft.
        for (const list of [...Object.values(D.draft.roles), ...Object.values(D.draft.tribeLeads || {}), D.draft.admins]) {
          for (const x of list) if (!x.id && x.email && x.email.toLowerCase() === p.email.toLowerCase()) x.name = name;
        }
      },
    });
    if (ok) changed();
  }

  /* ---- rules ---- */
  function rulesCard(d, can) {
    const roles = roleNames(d);
    const stageOpts = ["", ...ACCOUNTABILITY.pipeline];
    const rows = d.rules.map((r, i) => {
      const cols = ctx.fieldsOf(r.table).map(f => f.field_name);
      const fieldOpts = [ROW, ...new Set([...cols, r.field].filter(Boolean))];
      const sel = (value, options, label, on, fmt = (x) => x) => h("label", { class: "select" }, h("span", { class: "sr-only" }, label),
        h("select", { disabled: !can, onchange: (e) => { on(e.target.value); changed(); } },
          options.map(o => h("option", { value: o, selected: o === value || null }, fmt(o)))));
      return h("tr", { class: r.on ? null : "is-off" },
        h("td", null, h("input", { type: "checkbox", checked: r.on || null, disabled: !can, "aria-label": "On", onchange: (e) => { r.on = e.target.checked; changed(); } })),
        h("td", null, sel(r.table, Object.keys(TABLE_NAMES), "Table", (v) => { r.table = v; r.field = ROW; }, (t) => TABLE_NAMES[t])),
        h("td", null, cols.length
          ? sel(r.field, fieldOpts, "Field", (v) => { r.field = v; }, (f) => (f === ROW ? `(has a ${TABLE_NAMES[r.table]} row)` : f))
          : h("input", { type: "text", value: r.field, disabled: !can, "aria-label": "Field", onchange: (e) => { r.field = e.target.value.trim() || ROW; changed(); } })),
        h("td", null, sel(r.from, stageOpts, "Required from", (v) => { r.from = v; }, (s) => s || "(not while active)")),
        h("td", null, h("input", { type: "checkbox", checked: r.lost || null, disabled: !can, "aria-label": "Also when lost", onchange: (e) => { r.lost = e.target.checked; changed(); } })),
        h("td", null, sel(r.responsible, roles, "Responsible", (v) => { r.responsible = v; })),
        h("td", null, sel(r.accountable, roles, "Accountable", (v) => { r.accountable = v; })),
        h("td", null, can ? h("button", { type: "button", class: "icon-btn icon-sm", title: "Remove this rule", "aria-label": "Remove this rule",
          onclick: () => { d.rules.splice(i, 1); changed(); } }, ic("trash")) : null));
    });
    const on = d.rules.filter(r => r.on).length;
    return section("rules", "Rules", `${on} of ${d.rules.length} on`,
      h("p", { class: "set-sub" }, "Each field must be filled from the stage it's required at, and at every later one. ",
        h("b", null, "Responsible"), " fills it; ", h("b", null, "Accountable"), " makes sure it gets filled. ",
        "“Lost” also asks it of Lost, Stalled and Archived projects."),
      h("div", { class: "row" },
        h("button", { type: "button", class: "btn btn-sm", disabled: !can, onclick: () => {
          d.rules.push({ id: `r${Date.now().toString(36)}`, table: "universe", field: ROW, from: ACCOUNTABILITY.pipeline[0], lost: false,
                         responsible: "AM", accountable: "BD", on: true });
          changed();
        } }, ic("plus"), "Add rule"),
        h("button", { type: "button", class: "btn btn-sm btn-ghost", disabled: !can, onclick: () => { d.rules = clone(ACCOUNTABILITY.rules); changed(); } }, "Use the starting rules")),
      missingNote(d, can),
      behindNote(d, can),
      h("div", { class: "tbl-wrap" }, h("table", { class: "tbl adm-rules" },
        h("thead", null, h("tr", null, ["On", "Table", "Field", "Required from", "Lost", "Responsible", "Accountable", ""].map(t => h("th", { scope: "col" }, t)))),
        h("tbody", null, rows))));
  }

  /* Starting rules added after the rules were saved (the saved rules replace the starting
     ones, so a new one stays off until an admin adds it here). */
  function missingNote(d, can) {
    const missing = rulesMissingFromDefaults(d.rules, ACCOUNTABILITY.rules);
    if (!missing.length) return null;
    const n = missing.length, one = n === 1;
    return h("div", { class: "callout callout-info" }, ic("info"),
      h("div", null,
        h("p", null, `Sanctum has ${n} starting rule${one ? "" : "s"} the saved rules don't have. Add ${one ? "it" : "them"} unless an admin removed ${one ? "it" : "them"} on purpose:`),
        h("ul", null, missing.map(m => h("li", null, h("b", null, m.rule.field), ` (${TABLE_NAMES[m.rule.table] || m.rule.table}): R ${m.rule.responsible} · A ${m.rule.accountable}`))),
        h("button", { type: "button", class: "btn btn-sm", disabled: !can, onclick: () => {
          for (const m of missing) {
            const at = m.after ? d.rules.findIndex(r => r.id === m.after) + 1 : 0;
            d.rules.splice(at, 0, { ...m.rule, on: true });
          }
          changed();
        } }, `Add ${one ? "this rule" : `these ${n}`}`),
        " ", h("span", { class: "set-help" }, "Then Save changes.")));
  }

  /* Rules saved before the starting rules changed who's on them (AM, PM, TRIBE in 2.2.0):
     offer to bring just those up to date, leaving every other rule as it is. */
  function behindNote(d, can) {
    const behind = rulesBehindDefaults(d.rules, ACCOUNTABILITY.rules);
    if (!behind.length) return null;
    const who = (x) => `R ${x.responsible} · A ${x.accountable}`;
    return h("div", { class: "callout callout-info" }, ic("info"),
      h("div", null,
        h("p", null, `${behind.length} saved rule${behind.length === 1 ? "" : "s"} name${behind.length === 1 ? "s" : ""} different people than Sanctum's starting rules. Update ${behind.length === 1 ? "it" : "them"} unless an admin changed ${behind.length === 1 ? "it" : "them"} on purpose:`),
        h("ul", null, behind.map(b => h("li", null, h("b", null, b.field), `: ${who(b.from)} → ${who(b.to)}`))),
        h("button", { type: "button", class: "btn btn-sm", disabled: !can, onclick: () => {
          for (const b of behind) Object.assign(d.rules.find(r => r.id === b.id), b.to);
          changed();
        } }, `Update ${behind.length === 1 ? "this rule" : `these ${behind.length}`}`),
        " ", h("span", { class: "set-help" }, "Then Save changes.")));
  }

  /* ---- nicknames (the Mancom sheet's "@Shanna", "Bopeep") ---- */
  function nicknamesCard(d, can) {
    d.aliases = d.aliases || {};
    const people = pool().filter(p => /^ou_/.test(p.id || ""));
    const nick = h("input", { type: "text", placeholder: "Nickname, e.g. Bopeep", maxlength: "40", disabled: !can });
    const who = h("select", { disabled: !can, "aria-label": "Who it is" }, h("option", { value: "" }, "Who is it?"),
      people.map(p => h("option", { value: p.id }, `${p.name}${p.email ? ` · ${p.email}` : ""}`)));
    const add = () => {
      const k = nickKey(nick.value);
      const p = people.find(x => x.id === who.value);
      if (!k || !p) return;
      d.aliases[k] = { id: p.id, name: p.name, email: p.email || "" };
      changed();
    };
    const list = Object.entries(d.aliases).sort((a, b) => a[0].localeCompare(b[0]));
    return section("nicknames", "Nicknames", `${list.length}`,
      h("p", { class: "set-sub" }, "The weekly Mancom sheet names people by nickname (@Shanna, Bopeep…). Say who each is, once; the Mancom page uses these every week, and asks about any it doesn't know."),
      list.length ? h("ul", { class: "adm-nicks" }, list.map(([k, p]) => h("li", null, h("b", null, k), h("span", null, p.name),
        can ? h("button", { type: "button", class: "icon-btn icon-sm", "aria-label": `Remove the nickname ${k}`, onclick: () => { delete d.aliases[k]; changed(); } }, ic("x")) : null)))
        : h("p", { class: "set-help" }, "None yet."),
      h("form", { class: "tag-add adm-nick-add", onsubmit: (e) => { e.preventDefault(); add(); } }, nick, h("label", { class: "select" }, who),
        h("button", { type: "submit", class: "btn btn-sm", disabled: !can }, "Add")));
  }

  /* ---- Telegram handles ---- */
  function peopleCard(d, can) {
    const q = D.peopleQuery.trim().toLowerCase();
    const everyone = pool().filter(p => p.id && p.id.startsWith("ou_"));
    const list = everyone.filter(p => !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)
      || (d.people[p.id] && d.people[p.id].telegram.toLowerCase().includes(q)));
    const set = (p, v) => {
      const t = telegramHandle(v);
      if (t) d.people[p.id] = { id: p.id, name: p.name, telegram: t }; else delete d.people[p.id];
      changed();
    };
    const n = Object.values(d.people).filter(p => p.telegram).length;
    return section("people", "Telegram handles", `${n} of ${everyone.length} set`,
      h("p", { class: "set-sub" }, "The digest @mentions these people."),
      h("label", { class: "search search-sm" }, ic("search"), h("span", { class: "sr-only" }, "Find a person"),
        h("input", { type: "search", value: D.peopleQuery, placeholder: "Find a person by name or email…", "data-picker": "people-search", oninput: (e) => {
          D.peopleQuery = e.target.value; D.refocus = "people-search"; render();
          const el = $("#adminBox input[data-picker=people-search]"); if (el) el.setSelectionRange(el.value.length, el.value.length);
        } })),
      h("ul", { class: "adm-people" }, list.slice(0, 60).map(p => h("li", null,
        h("span", { title: p.email || null }, p.name),
        h("input", { type: "text", value: d.people[p.id] ? `@${d.people[p.id].telegram}` : "", placeholder: "@handle", disabled: !can, "aria-label": `${p.name}'s Telegram`,
          onchange: (e) => set(p, e.target.value) })))),
      list.length > 60 ? h("p", { class: "set-help" }, `${list.length - 60} more: search to find them.`) : null);
  }

  /* ---- admins ---- */
  function adminsCard(d, can) {
    return section("admins", "Admins", `${d.admins.length}`,
      h("p", { class: "set-sub" }, d.admins.length
        ? "Only these people can change this page. Anyone with edit access to the Variables table in Lark can still change the rows there."
        : "No admins yet, so anyone who can edit the Variables table can change this page. Add yourself first."),
      peoplePicker(d.admins, can, "Add an admin.", "admins"));
  }

  /* ---- saving ---- */
  async function save() {
    if (!dirty() || D.saving || blockedReason()) return;
    if (!isAdmin(D.draft, S.user)) {
      const ok = await confirmSheet({ title: "Lock yourself out?", icon: "alert", danger: true, confirm: "Save anyway",
        sub: "You're not on the admin list you're saving.", body: h("p", null, "After this, only the admins listed can change this page."), run: async () => {} });
      if (!ok) return;
    }
    if (!ctx.ensureTime()) return;
    const cols = S.tagCols, t = ctx.tables.variables;
    const w = configWrites(S.acc.cfg.rows, configValues(D.draft));
    const total = w.create.length + w.update.length + w.remove.length;
    D.saving = true;
    busy($("#adminSave"), true, "Saving…");
    let done = 0;
    try {
      await ctx.track(async () => {
        for (const c of w.create) {
          const rec = await addVariable(ctx.call, t, cols, ACCOUNTABILITY.variables[c.kind], c.value);
          S.data.variables.push({ record_id: rec.record_id, fields: { ...rec.fields, [cols.name]: ACCOUNTABILITY.variables[c.kind], [cols.value]: c.value } });
          done++;
        }
        for (const u of w.update) {
          await updateVariable(ctx.call, t, cols, u.id, u.value);
          const rec = S.data.variables.find(r => r.record_id === u.id);
          if (rec) rec.fields[cols.value] = u.value;
          done++;
        }
        for (const id of w.remove) {
          await deleteVariable(ctx.call, t, id);
          S.data.variables = S.data.variables.filter(r => r.record_id !== id);
          done++;
        }
      });
      D.draft = null;
      ctx.recompute();
      toast("Saved.", { type: "success", detail: `${total} change${total === 1 ? "" : "s"} written to the Variables table. The board uses them now; the next digest will too.` });
    } catch (e) {
      ctx.recompute();
      if (!isDeadToken(e)) toast("Not everything was saved.", { type: "error", timeout: 0,
        detail: `${done} of ${total} changes reached Lark before this: ${describe(e)} Your other edits are still here; Save again to send the rest.` });
    } finally {
      D.saving = false;
      busy($("#adminSave"), false);
      ctx.render();
    }
  }
  $("#adminSave").addEventListener("click", save);
  $("#adminDiscard").addEventListener("click", () => { D.draft = null; render(); });

  return { render, dirty };
}
