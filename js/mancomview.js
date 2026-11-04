/* The Mancom page (#/mancom): upload the week's Mancom sheet (.xlsx), review what it would
   change in the Universe and ANDON (js/mancom.js), and apply the ones you tick. The file is
   read in this browser; only the changes you apply go to Lark. Each applied change is logged
   in the Variables table (who, when, which week, tab and row, before and after), and every
   match you confirm is remembered for next week. Admins and editors only. */

import { ACCOUNTABILITY } from "./config.js";
import { readWorkbook } from "./xlsx.js";
import { sheetEntries, mancomChanges, memoryFrom, changeLogValue, weekOf, nickKey } from "./mancom.js";
import { clean, plain, normCode } from "./sync.js";
import { addVariable, saveEdit } from "./ops.js";
import { $, h, ic, toast, busy } from "./ui.js";
import { describe, isDeadToken } from "./net.js";

const CFG = ACCOUNTABILITY.mancom;
const SHOW = 40;   // rows a long list shows before "Show all"

export function createMancom(ctx) {
  const { S } = ctx;
  const M = { file: "", week: "", sheets: null, entries: [], picks: {}, off: new Set(), on: new Set(), busy: false, results: null,
              all: new Set(), query: "" };

  $("#mancomFile").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      M.sheets = await readWorkbook(await file.arrayBuffer());
      M.file = file.name; M.week = weekOf(file.name); M.picks = {}; M.off.clear(); M.on.clear(); M.results = null;
      M.entries = sheetEntries(M.sheets, CFG);
      if (!M.entries.length) toast("No project rows found in that file.", { type: "error", detail: "Is it the Mancom scoreboard (Revenue, Pitch Pipeline and BD Pipeline tabs)?" });
    } catch (err) {
      toast("Couldn't read that file.", { type: "error", detail: err.message });
    }
    render();
  });

  const vars = () => S.data && S.data.variables;
  /* Everything the page shows, worked out from the file and what Lark has now. */
  function compute() {
    const d = S.data;
    const memory = memoryFrom(vars(), S.tagCols, CFG.matchVariable);
    const pool = [...(S.pool || []), ...(S.pmPool || [])];
    return mancomChanges(M.entries.map(e => ({ ...e })), {
      universe: d.universe, andon: d.andon, fields: { universe: ctx.fieldsOf("universe"), andon: ctx.fieldsOf("andon") },
      aliases: (S.acc && S.acc.cfg.aliases) || {}, pool, memory, picks: M.picks, cfgAcc: S.acc && S.acc.cfg,
    }, CFG);
  }
  // A change is ticked unless it's a disagreement in the sheet or someone unticked it.
  const ticked = (c) => (c.conflict ? M.on.has(c.id) : !M.off.has(c.id));

  function render() {
    const box = $("#mancomBox");
    if (!S.data) { box.replaceChildren(h("div", { class: "loader" }, h("div", { class: "loader-title" }, h("span", { class: "spinner" }), "Loading the tables…"))); return; }
    const canWrite = !!S.tagCols && ctx.canWriteFor("edit:universe");
    $("#mancomPick").classList.toggle("is-disabled", M.busy);
    if (!M.sheets) {
      box.replaceChildren(h("div", { class: "card set-card" },
        h("h2", null, "Start with this week's sheet"),
        h("p", { class: "set-sub" }, "In Google Sheets: File → Download → Microsoft Excel (.xlsx), then choose it above. It's read here in your browser; only the changes you apply go to Lark."),
        h("ul", { class: "set-sub" },
          h("li", null, h("b", null, "Revenue - <tribe>"), ": the tribe of each project (ANDON TRIBE)."),
          h("li", null, h("b", null, "RFP-RFQ - Pitch Pipeline"), ": the Mancom Phase, and the Owner as AM."),
          h("li", null, h("b", null, "Leads - BD Pipeline"), ": the BD and the AM."),
          h("li", null, "Any of them: the Client, when the Universe has none."))));
      return;
    }
    const res = compute();
    const unmatched = groupUnmatched(res.entries);
    const chosen = res.changes.filter(ticked);
    box.replaceChildren(...[
      h("div", { class: "mc-summary" },
        h("span", { class: "badge badge-brand" }, M.week || "This week"),
        h("span", null, `${M.file} · ${res.entries.length} project rows`),
        h("span", { class: "badge badge-warn" }, `${res.changes.length} change${res.changes.length === 1 ? "" : "s"}`),
        unmatched.length ? h("span", { class: "badge badge-muted" }, `${unmatched.length} project${unmatched.length === 1 ? "" : "s"} to match`) : null,
        res.unknown.length ? h("span", { class: "badge badge-muted" }, `${res.unknown.length} nickname${res.unknown.length === 1 ? "" : "s"} to set`) : null),
      M.results ? resultsCard(M.results) : null,
      res.unknown.length ? nicknamesCard(res.unknown, canWrite) : null,
      changesCard(res.changes, canWrite, chosen),
      unmatched.length ? unmatchedCard(unmatched) : null,
      res.notes.length ? h("details", { class: "card set-card mc-notes" }, h("summary", null, `Notes · ${res.notes.length}`),
        h("ul", null, res.notes.map(n => h("li", null, n)))) : null,
    ].filter(Boolean));
  }

  /* ---- nicknames the sheet uses that Sanctum doesn't know ---- */
  function nicknamesCard(unknown, canWrite) {
    const pool = [...new Map([...(S.pool || []), ...(S.pmPool || [])].filter(p => /^ou_/.test(p.id || "")).map(p => [p.id, p])).values()]
      .sort((a, b) => a.name.localeCompare(b.name));
    return h("section", { class: "card set-card" },
      h("h2", null, "Who are they?"),
      h("p", { class: "set-sub" }, "The sheet names these people by nickname. Pick who each one is: it's saved (Admin page → Nicknames) and used every week."),
      h("ul", { class: "mc-nicks" }, unknown.map(nick => {
        const sel = h("select", { disabled: !canWrite || M.busy || null, "aria-label": `Who is ${nick}?` },
          h("option", { value: "" }, "Choose a person…"), pool.map(p => h("option", { value: p.id }, `${p.name}${p.email ? ` · ${p.email}` : ""}`)));
        sel.addEventListener("change", () => { if (sel.value) saveNick(nick, pool.find(p => p.id === sel.value), sel); });
        return h("li", null, h("b", null, nick), h("label", { class: "select" }, sel));
      })));
  }
  async function saveNick(nick, person, sel) {
    if (!person || !ctx.ensureTime()) return;
    sel.disabled = true;
    const value = JSON.stringify({ nick: nickKey(nick), person: { id: person.id, name: person.name, email: person.email || "" } });
    try {
      const rec = await ctx.track(() => addVariable(ctx.call, ctx.tables.variables, S.tagCols, ACCOUNTABILITY.variables.alias, value));
      S.data.variables.push({ record_id: rec.record_id, fields: { [S.tagCols.name]: ACCOUNTABILITY.variables.alias, [S.tagCols.value]: value } });
      ctx.recompute();
      toast(`“${nick}” is ${person.name}.`, { type: "success" });
    } catch (e) {
      if (!isDeadToken(e)) toast(`Couldn't save “${nick}”.`, { type: "error", detail: describe(e) });
    }
    render();
  }

  /* ---- the changes, by project ---- */
  function changesCard(changes, canWrite, chosen) {
    const byProject = new Map();
    for (const c of changes) (byProject.get(c.projectId) || byProject.set(c.projectId, []).get(c.projectId)).push(c);
    const q = M.query.trim().toLowerCase();
    const groups = [...byProject.values()].filter(list => !q || [list[0].project, list[0].code, ...list.map(c => c.field)].some(s => String(s).toLowerCase().includes(q)));
    const all = M.all.has("changes");
    const shown = all ? groups : groups.slice(0, SHOW);
    const go = h("button", { type: "button", class: "btn btn-primary", disabled: !chosen.length || !canWrite || M.busy || null, onclick: () => apply(chosen, go) },
      h("span", { class: "label" }, `Apply ${chosen.length} change${chosen.length === 1 ? "" : "s"}`));
    return h("section", { class: "card set-card" },
      h("div", { class: "set-head" },
        h("div", null, h("h2", null, "Changes"),
          h("p", { class: "set-sub" }, "Ticked ones are applied. A change replaces what Lark has; a fill only sets a blank. Untick anything that's wrong, or fix the project it's matched to.")),
        go),
      !canWrite ? h("p", { class: "set-help" }, ctx.problemsFor("edit:universe")[0] || "Your login can only read the tables.") : null,
      groups.length > 8 ? h("label", { class: "search search-sm" }, ic("search"), h("span", { class: "sr-only" }, "Find a project"),
        h("input", { type: "search", value: M.query, placeholder: "Find a project or field…", oninput: (e) => { M.query = e.target.value; render(); $("#mancomBox input[type=search]")?.focus(); } })) : null,
      groups.length ? h("ul", { class: "mc-groups" }, shown.map(list => projectChanges(list))) : h("p", { class: "empty small" }, "Nothing to change: Lark already says what the sheet says (for the projects it could match)."),
      groups.length > SHOW ? h("button", { type: "button", class: "linkish", onclick: () => { if (all) M.all.delete("changes"); else M.all.add("changes"); render(); } },
        all ? "Show fewer" : `Show all ${groups.length} projects`) : null);
  }
  function projectChanges(list) {
    const first = list[0];
    const via = [...new Set(list.flatMap(c => c.sources.map(s => s.tab)))].join(", ");
    return h("li", { class: "mc-group" },
      h("div", { class: "acc-proj-head" },
        h("span", { class: "mono" }, first.code || "(no code)"), h("span", { class: "acc-name" }, first.project || "(no name)"),
        h("span", { class: "muted mc-via" }, `from ${via}`)),
      h("ul", { class: "mc-changes" }, list.map(c => {
        const box = h("input", { type: "checkbox", checked: ticked(c) || null, disabled: M.busy || null, "aria-label": `Apply ${c.field} on ${c.project}` });
        box.addEventListener("change", () => {
          if (c.conflict) { if (box.checked) M.on.add(c.id); else M.on.delete(c.id); }
          else if (box.checked) M.off.delete(c.id); else M.off.add(c.id);
          render();
        });
        const values = [...new Set(c.sources.map(s => s.value))];
        return h("li", { class: c.conflict ? "is-conflict" : null },
          h("label", { class: "mc-change" }, box,
            h("b", null, c.field),
            h("span", { class: "mc-from" }, c.from || "blank"), ic("arrowRight"), h("span", { class: "mc-to" }, c.to),
            h("span", { class: `badge ${c.kind === "fill" ? "badge-ok" : "badge-warn"}` }, c.kind === "fill" ? "fills a blank" : "changes it"),
            c.guessed ? h("span", { class: "badge badge-muted", title: "Recognised from the name in the tables, not a saved nickname" }, "guessed who") : null),
          h("p", { class: "mc-src" }, c.conflict
            ? `The sheet disagrees: ${c.sources.map(s => `${s.value} (${s.tab} row ${s.row})`).join(" · ")}. Unticked: tick only if “${c.to}” is right.`
            : `${values.length === 1 ? `“${values[0]}”` : values.map(v => `“${v}”`).join(", ")} · ${c.sources.map(s => `${s.tab} row ${s.row}`).join(", ")}`));
      })));
  }

  /* ---- sheet projects that aren't matched to a Universe project ---- */
  function groupUnmatched(entries) {
    const m = new Map();
    for (const e of entries) {
      if (e.match.rowId || e.match.how === "skipped") continue;
      if (!m.has(e.key)) m.set(e.key, { key: e.key, project: e.project, rows: [], candidates: e.match.candidates });
      m.get(e.key).rows.push(e);
    }
    return [...m.values()];
  }
  function unmatchedCard(groups) {
    const all = M.all.has("unmatched");
    const shown = all ? groups : groups.slice(0, SHOW);
    return h("details", { class: "card set-card", open: M.all.has("unmatchedOpen") || null,
      ontoggle: (e) => { if (e.target.open) M.all.add("unmatchedOpen"); else M.all.delete("unmatchedOpen"); } },
      h("summary", null, h("b", null, `Projects to match · ${groups.length}`),
        h("span", { class: "set-help" }, " No clear match in the Universe. Pick one (remembered for next week when you apply) or skip.")),
      h("ul", { class: "mc-unmatched" }, shown.map(g => {
        const sel = h("select", { disabled: M.busy || null, "aria-label": `Universe project for ${g.project}` },
          h("option", { value: "" }, "Choose the Universe project…"),
          g.candidates.map(c => h("option", { value: c.rowId }, `${c.project}${c.code ? ` · ${c.code}` : ""}${c.client ? ` · ${c.client}` : ""}`)),
          h("option", { value: "__skip" }, "Not in the Universe: skip it"));
        sel.addEventListener("change", () => { if (sel.value) { M.picks[g.key] = sel.value === "__skip" ? "" : sel.value; render(); } });
        return h("li", null,
          h("div", null, h("b", null, g.project), h("span", { class: "muted" }, ` · ${[...new Set(g.rows.map(r => r.tab))].join(", ")}`)),
          h("label", { class: "select" }, sel));
      })),
      groups.length > SHOW ? h("button", { type: "button", class: "linkish", onclick: () => { if (all) M.all.delete("unmatched"); else M.all.add("unmatched"); render(); } },
        all ? "Show fewer" : `Show all ${groups.length}`) : null);
  }

  /* ---- applying ---- */
  async function apply(chosen, btn) {
    if (M.busy || !chosen.length || !ctx.ensureTime(chosen.length * 4000)) return;
    M.busy = true;
    busy(btn, true, "Applying…");
    const byRecord = new Map();
    for (const c of chosen) {
      const k = `${c.table}:${c.recordId}`;
      (byRecord.get(k) || byRecord.set(k, []).get(k)).push(c);
    }
    const done = [], failed = [], by = (S.user && S.user.name) || "";
    try {
      await ctx.track(async () => {
        for (const list of byRecord.values()) {
          const { table, recordId } = list[0];
          const rec = (S.data[table] || []).find(r => r.record_id === recordId);
          const write = Object.fromEntries(list.map(c => [c.field, c.write]));
          try {
            const res = await saveEdit(ctx.call, ctx.tables[table], recordId, write, rec ? rec.fields : {}, ctx.fieldsOf(table));
            if (rec && res.record) rec.fields = { ...rec.fields, ...res.record.fields };
            for (const c of list) {
              done.push(c);
              await log(changeLogValue(c, { by, week: M.week, file: M.file }));
            }
          } catch (e) {
            if (isDeadToken(e)) throw e;
            for (const c of list) failed.push({ change: c, why: e.userMessage || describe(e) });
          }
        }
        await rememberMatches(done);
      });
    } catch (e) {
      if (!isDeadToken(e)) toast("Stopped.", { type: "error", detail: describe(e) });
    } finally {
      M.busy = false;
      M.results = { done, failed, at: Date.now() };
      ctx.recompute();
      busy(btn, false);
      ctx.render();
      toast(`Applied ${done.length} change${done.length === 1 ? "" : "s"}${failed.length ? `; ${failed.length} didn't go through` : ""}.`,
        { type: failed.length ? "warn" : "success", detail: "Each is in the change log (Variables table), with this week's sheet and row." });
    }
  }
  async function log(value) {
    const rec = await addVariable(ctx.call, ctx.tables.variables, S.tagCols, CFG.logVariable, value);
    S.data.variables.push({ record_id: rec.record_id, fields: { [S.tagCols.name]: CFG.logVariable, [S.tagCols.value]: value } });
  }
  /* Matches that weren't remembered yet (picked, or suggested and now applied) are kept for next week. */
  async function rememberMatches(done) {
    const memory = memoryFrom(vars(), S.tagCols, CFG.matchVariable);
    const keys = new Map();
    for (const e of compute().entries) {
      if (!e.match.rowId || memory.has(e.key)) continue;
      const used = e.match.how === "picked" || done.some(c => c.projectId === e.match.rowId && c.sources.some(s => s.tab === e.tab && s.row === e.row));
      if (used) keys.set(e.key, e.match.rowId);
    }
    for (const [key, rowId] of keys) {
      const u = S.data.universe.find(r => r.record_id === rowId);
      const value = JSON.stringify({ key, rowId, code: u ? normCode(plain((u.fields || {})["Project Code"])) : "", project: u ? clean((u.fields || {})["Project"]) : "" });
      const rec = await addVariable(ctx.call, ctx.tables.variables, S.tagCols, CFG.matchVariable, value);
      S.data.variables.push({ record_id: rec.record_id, fields: { [S.tagCols.name]: CFG.matchVariable, [S.tagCols.value]: value } });
    }
  }
  function resultsCard(r) {
    return h("section", { class: `callout ${r.failed.length ? "callout-warn" : "callout-ok"}` }, ic(r.failed.length ? "alert" : "check"),
      h("div", null,
        h("p", null, `Applied ${r.done.length} change${r.done.length === 1 ? "" : "s"}.`),
        r.failed.length ? h("ul", null, r.failed.map(f => h("li", null, `${f.change.code || f.change.project} · ${f.change.field}: ${f.why}`))) : null));
  }

  return { render };
}
