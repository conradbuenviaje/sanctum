/* The Admin page (#/admin): the accountability rules, who holds each named role, the
   Telegram handles the digest mentions, the scope, and who may change them. A draft
   is edited here and nothing reaches Lark until Save: then the Variables table is made
   to match it (one row per rule, role, person or setting; js/accountability.js), and
   the board and the next digest use it. */

import { ACCOUNTABILITY } from "./config.js";
import { configValues, configWrites, isAdmin, telegramHandle, ROW, TABLE_NAMES } from "./accountability.js";
import { addVariable, updateVariable, deleteVariable } from "./ops.js";
import { $, h, ic, toast, busy, confirmSheet } from "./ui.js";
import { describe, isDeadToken } from "./net.js";

const clone = (x) => JSON.parse(JSON.stringify(x));
// "stephen.lin@mineskiglobal.com" → "Stephen Lin": a name for someone added by email who isn't in the tables.
const nameFromEmail = (email) => email.split("@")[0].split(/[._-]+/).filter(Boolean)
  .map(w => w[0].toUpperCase() + w.slice(1)).join(" ") || email;
const sig = (cfg) => JSON.stringify(configValues(cfg).map(v => [v.key, v.value]));

export function createAdmin(ctx) {
  const { S } = ctx;
  const D = { draft: null, base: "", saving: false, peopleQuery: "" };

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
    box.replaceChildren(...[
      why ? h("div", { class: "callout callout-warn" }, ic("alert"), h("div", null, why)) : null,
      ...S.acc.cfg.problems.map(p => h("div", { class: "callout callout-warn" }, ic("alert"), h("div", null, p))),
      scopeCard(d, can), rolesCard(d, can), tribesCard(d, can), rulesCard(d, can), peopleCard(d, can), adminsCard(d, can),
    ].filter(Boolean));
    bar.hidden = !dirty();
    $("#adminSave").disabled = !can || D.saving;
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

  /* ---- scope ---- */
  function scopeCard(d, can) {
    const since = h("input", { type: "date", value: d.since, disabled: !can, onchange: (e) => { if (e.target.value) { d.since = e.target.value; changed(); } } });
    const tags = h("input", { type: "text", value: d.skipTags.join(", "), disabled: !can, placeholder: "e.g. Hidden",
      onchange: (e) => { d.skipTags = e.target.value.split(",").map(s => s.trim()).filter(Boolean); changed(); } });
    const roles = roleNames(d);
    const fb = h("input", { type: "text", value: d.fallback.join(", "), disabled: !can, list: "adminRoleList",
      onchange: (e) => { d.fallback = e.target.value.split(",").map(s => s.trim()).filter(s => roles.includes(s)); changed(); } });
    return h("section", { class: "card set-card" },
      h("h2", null, "Scope"),
      h("label", { class: "field" }, h("span", null, "Check projects from"), since,
        h("span", { class: "set-help" }, "By RFP Received Date, else Year, else the year in the project code.")),
      h("label", { class: "field" }, h("span", null, "Skip projects tagged"), tags,
        h("span", { class: "set-help" }, "Custom tags (Settings), separated by commas.")),
      h("label", { class: "field" }, h("span", null, "When a role has nobody, send to"), fb,
        h("span", { class: "set-help" }, `The first of these that has someone, in order. Roles: ${roles.join(", ")}.`)),
      h("datalist", { id: "adminRoleList" }, roles.map(r => h("option", { value: r }))));
  }

  /* ---- named roles ---- */
  function rolesCard(d, can) {
    const input = h("input", { type: "text", placeholder: "New role, e.g. Sales Head", maxlength: "40", disabled: !can });
    const add = () => {
      const name = input.value.replace(/\s+/g, " ").trim();
      if (!name || roleNames(d).some(r => r.toLowerCase() === name.toLowerCase())) return;
      d.namedRoles.push(name); d.roles[name] = []; changed();
    };
    return h("section", { class: "card set-card" },
      h("h2", null, "Roles"),
      h("p", { class: "set-sub" }, "BD, AM and PM come from each project's own rows (Universe BD and AM, ANDON PM (LEAD)), and the Tribe Lead from its tribe (below). These roles are held by the same people for every project."),
      h("ul", { class: "adm-roles" }, d.namedRoles.map(name => h("li", null,
        h("div", { class: "adm-role-head" }, h("b", null, name),
          can && !ruleUses(d, name) ? h("button", { type: "button", class: "icon-btn icon-sm", title: `Remove the ${name} role`, "aria-label": `Remove ${name}`,
            onclick: () => { d.namedRoles = d.namedRoles.filter(r => r !== name); delete d.roles[name]; d.fallback = d.fallback.filter(r => r !== name); changed(); } }, ic("x")) : null),
        peoplePicker(d.roles[name], can, `Who is the ${name}?`)))),
      h("form", { class: "tag-add", onsubmit: (e) => { e.preventDefault(); add(); } }, input,
        h("button", { type: "submit", class: "btn btn-sm", disabled: !can }, "Add role")));
  }
  const ruleUses = (d, role) => d.rules.some(r => r.responsible === role || r.accountable === role) || d.fallback.includes(role);
  const roleNames = (d) => [...Object.keys(ACCOUNTABILITY.projectRoles), ACCOUNTABILITY.tribeRole.role, ...d.namedRoles];

  /* ---- tribe leads ---- */
  function tribesCard(d, can) {
    d.tribeLeads = d.tribeLeads || {};
    // Every tribe ANDON offers (in the browser ANDON reads as you), and any saved before.
    const andonTribes = (ctx.optionsOf("andon") || {})[ACCOUNTABILITY.tribeRole.field] || [];
    const tribes = [...new Set([...andonTribes, ...Object.keys(d.tribeLeads)])];
    for (const t of tribes) if (!d.tribeLeads[t]) d.tribeLeads[t] = [];
    return h("section", { class: "card set-card" },
      h("h2", null, "Tribe leads"),
      h("p", { class: "set-sub" }, "A project's Tribe Lead is the lead of its ANDON TRIBE. While a project has no tribe yet, it's every Tribe Lead: they decide at the Win meeting which tribe takes it and who its PM is."),
      tribes.length
        ? h("ul", { class: "adm-roles" }, tribes.map(t => h("li", null,
            h("div", { class: "adm-role-head" }, h("b", null, t)),
            peoplePicker(d.tribeLeads[t], can, `Who leads ${t}?`))))
        : h("p", { class: "set-help" }, "ANDON couldn't be read, so its tribes aren't known here. Check your access to ANDON, then Refresh."));
  }

  /* People chips with a box to add one (any name the tables have). */
  function peoplePicker(list, can, placeholder) {
    const all = pool();
    const id = `pk${Math.random().toString(36).slice(2, 8)}`;
    const input = h("input", { type: "text", list: id, placeholder: `${placeholder} (name or email)`, disabled: !can, autocomplete: "off",
      onchange: (e) => {
        const name = e.target.value.trim().toLowerCase();
        // Someone in the tables (a BD, AM or PM), or anyone else by their email.
        const p = all.find(x => x.name.toLowerCase() === name || (x.email && x.email.toLowerCase() === name))
          || (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name) ? { id: "", name: nameFromEmail(name), email: name } : null);
        const same = (x) => (p.id && x.id === p.id) || (p.email && x.email && x.email.toLowerCase() === p.email.toLowerCase());
        if (p && !list.some(same)) { list.push({ id: p.id, name: p.name, email: p.email }); changed(); }
        else e.target.value = "";
      } });
    return h("div", { class: "picker" }, h("div", { class: "picker-box" },
      list.map(p => h("span", { class: "chip" }, p.name,
        can ? h("button", { type: "button", "aria-label": `Remove ${p.name}`, onclick: () => { list.splice(list.indexOf(p), 1); changed(); } }, ic("x")) : null)),
      input), h("datalist", { id }, all.map(p => h("option", { value: p.name }, p.email || ""))));
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
    return h("section", { class: "card set-card adm-wide" },
      h("div", { class: "set-head" },
        h("div", null, h("h2", null, "Rules"),
          h("p", { class: "set-sub" }, "Each field must be filled from the stage it's required at, and at every later one. ",
            h("b", null, "Responsible"), " fills it; ", h("b", null, "Accountable"), " makes sure it gets filled. ",
            "“Lost” also asks it of Lost, Stalled and Archived projects.")),
        h("div", { class: "row" },
          h("button", { type: "button", class: "btn btn-sm", disabled: !can, onclick: () => {
            d.rules.push({ id: `r${Date.now().toString(36)}`, table: "universe", field: ROW, from: ACCOUNTABILITY.pipeline[0], lost: false,
                           responsible: "AM", accountable: "BD", on: true });
            changed();
          } }, ic("plus"), "Add rule"),
          h("button", { type: "button", class: "btn btn-sm btn-ghost", disabled: !can, onclick: () => { d.rules = clone(ACCOUNTABILITY.rules); changed(); } }, "Use the starting rules"))),
      h("div", { class: "tbl-wrap" }, h("table", { class: "tbl adm-rules" },
        h("thead", null, h("tr", null, ["On", "Table", "Field", "Required from", "Lost", "Responsible", "Accountable", ""].map(t => h("th", { scope: "col" }, t)))),
        h("tbody", null, rows))));
  }

  /* ---- Telegram handles ---- */
  function peopleCard(d, can) {
    const q = D.peopleQuery.trim().toLowerCase();
    const everyone = pool().filter(p => p.id && p.id.startsWith("ou_"));
    const list = everyone.filter(p => !q || p.name.toLowerCase().includes(q) || (d.people[p.id] && d.people[p.id].telegram.toLowerCase().includes(q)));
    const set = (p, v) => {
      const t = telegramHandle(v);
      if (t) d.people[p.id] = { id: p.id, name: p.name, telegram: t }; else delete d.people[p.id];
      changed();
    };
    const n = Object.values(d.people).filter(p => p.telegram).length;
    return h("section", { class: "card set-card" },
      h("h2", null, "Telegram handles"),
      h("p", { class: "set-sub" }, `The digest @mentions these people. ${n} of ${everyone.length} set.`),
      h("label", { class: "search search-sm" }, ic("search"), h("span", { class: "sr-only" }, "Find a person"),
        h("input", { type: "search", value: D.peopleQuery, placeholder: "Find a person…", oninput: (e) => { D.peopleQuery = e.target.value; render(); const el = $("#adminBox input[type=search]"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } } })),
      h("ul", { class: "adm-people" }, list.slice(0, 60).map(p => h("li", null,
        h("span", null, p.name),
        h("input", { type: "text", value: d.people[p.id] ? `@${d.people[p.id].telegram}` : "", placeholder: "@handle", disabled: !can, "aria-label": `${p.name}'s Telegram`,
          onchange: (e) => set(p, e.target.value) })))),
      list.length > 60 ? h("p", { class: "set-help" }, `${list.length - 60} more: search to find them.`) : null);
  }

  /* ---- admins ---- */
  function adminsCard(d, can) {
    return h("section", { class: "card set-card" },
      h("h2", null, "Admins"),
      h("p", { class: "set-sub" }, d.admins.length
        ? "Only these people can change this page. Anyone with edit access to the Variables table in Lark can still change the rows there."
        : "No admins yet, so anyone who can edit the Variables table can change this page. Add yourself first."),
      peoplePicker(d.admins, can, "Add an admin"));
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
