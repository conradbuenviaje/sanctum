/* The Tagging page (topbar, before Data Audit): every Universe project and its tags (the Tags column, plain text,
   tags separated by commas), to tag them by hand without misspelling a tag.

   - Above the table, every tag in use with how many projects have it. A click shows
     only those projects. A tag that looks like a misspelling of another
     ("Federal Lnad", "federal land") says so.
   - Each project's tags: × takes one off; + adds one, suggesting the tags in use.
     A new tag that looks like one in use asks first ("Did you mean …?").
   - Each change is written at once (js/ops.js setTag: the row is re-read and only
     that tag is added or taken out, so tags someone added meanwhile stay), then read
     back. A click on the row opens it in the row editor, like the Universe table. */

import { RULES } from "./config.js";
import { taggingView, lookalikeTags, tagsWith, tagsWithout, UNTAGGED } from "./sync.js";
import { setTag } from "./ops.js";
import { $, h, ic, toast, openMenu } from "./ui.js";
import { copyableText } from "./polaris-ui.js";
import { describe, isDeadToken, isUncertain } from "./net.js";

export function createTagging(ctx) {
  const { S } = ctx;
  const G = { query: "", tag: "", adding: null };   // adding: the row id whose + is open
  const field = RULES.tags.field;
  $("#tagSearch").addEventListener("input", (e) => { G.query = e.target.value; render(); });

  const canWrite = () => ctx.canWriteFor("tag:universe");
  const busy = new Set();   // row ids with a write in flight

  function render() {
    const table = $("#tagTable"), summary = $("#tagSummary"), empty = $("#tagEmpty"), loader = $("#tagLoader");
    loader.hidden = !(!S.data && S.loading);
    if (!loader.hidden) loader.replaceChildren(h("div", { class: "loader-title" }, h("span", { class: "spinner" }), "Loading the Universe…"));
    if (!S.data || !S.data.universe) {
      table.replaceChildren(); summary.replaceChildren(); $("#tagSub").textContent = "";
      empty.hidden = !(S.loadError && !S.loading);
      if (S.loadError) {
        empty.className = "callout callout-err";
        empty.replaceChildren(ic("alert"), h("div", null, describe(S.loadError)),
          h("button", { type: "button", class: "btn btn-sm", onclick: () => ctx.loadData() }, "Try again"));
      }
      return;
    }
    if (!ctx.hasField("universe", field)) {
      table.replaceChildren(); summary.replaceChildren();
      empty.hidden = false;
      empty.className = "callout callout-warn";
      empty.replaceChildren(ic("alert"), h("div", null, `The Universe has no “${field}” column, so there's nothing to tag.`));
      return;
    }
    const v = taggingView(S.data.universe, field, { query: G.query, tag: G.tag });
    const known = v.tags.map(t => t.tag);
    if (G.tag && G.tag !== UNTAGGED && !known.some(t => t.toLowerCase() === G.tag.toLowerCase())) G.tag = "";
    $("#tagSub").textContent = `${v.total.toLocaleString()} projects · ${v.tags.length} tag${v.tags.length === 1 ? "" : "s"} in use · ${v.untagged.toLocaleString()} untagged`;

    // The tags in use: a click filters (again: all of them).
    const pick = (t) => { G.tag = G.tag.toLowerCase() === t.toLowerCase() ? "" : t; render(); };
    summary.replaceChildren(
      ...v.tags.map(t => h("button", { type: "button", class: "chip-opt tag-count" + (t.like.length ? " is-lookalike" : ""),
        "aria-pressed": String(G.tag.toLowerCase() === t.tag.toLowerCase()),
        title: t.like.length ? `Looks like ${t.like.map(x => `“${x}”`).join(", ")}: a misspelling?` : `Show only the projects tagged “${t.tag}”`,
        onclick: () => pick(t.tag) }, t.like.length ? ic("alert") : null, t.tag, h("span", { class: "n" }, String(t.count)))),
      h("button", { type: "button", class: "chip-opt tag-count", "aria-pressed": String(G.tag === UNTAGGED),
        title: "Show only the projects with no tags", onclick: () => pick(UNTAGGED) }, "No tags", h("span", { class: "n" }, String(v.untagged))));

    const head = h("thead", null, h("tr", null, ["Project Code", "Project", "Status", "Tags"].map(l => h("th", { scope: "col" }, l))));
    table.replaceChildren(head, h("tbody", null, v.rows.map(r => rowEl(r, known))));
    empty.hidden = v.rows.length > 0;
    empty.className = "empty small";
    empty.replaceChildren(h("p", null, G.query.trim() || G.tag ? "No projects match." : "The Universe is empty."));
    const input = G.adding && table.querySelector(".tag-add input");
    if (input) input.focus();
  }

  function rowEl(r, known) {
    const writable = canWrite() && !busy.has(r.id);
    const chips = r.tags.map(t => h("span", { class: "chip" }, t,
      h("button", { type: "button", "aria-label": `Take “${t}” off ${r.code || r.name}`, title: "Take this tag off", disabled: !writable,
        onclick: () => change(r, t, false) }, ic("x"))));
    const add = G.adding === r.id ? adder(r, known)
      : h("button", { type: "button", class: "icon-btn icon-sm tag-plus", disabled: !writable,
          title: writable ? "Add a tag" : canWrite() ? "Saving…" : `Tagging is off: ${ctx.problemsFor("tag:universe")[0] || "your login can only read the tables."}`,
          "aria-label": `Add a tag to ${r.code || r.name}`, onclick: () => { G.adding = r.id; render(); } }, ic("plus"));
    return ctx.openable(h("tr", { class: "urow" + (busy.has(r.id) ? " is-working" : ""), "data-id": r.id },
      h("td", { class: "c-code" }, r.code ? copyableText(r.code) : ""),
      h("td", { class: "c-project" }, r.name || h("span", { class: "none" }, "(no name)")),
      h("td", { class: "c-status" }, r.status),
      h("td", { class: "c-tags" }, h("div", { class: "tag-cell" }, chips, add))), "universe", r.id, r.name || r.code);
  }

  /* The + box: type a tag; the tags in use are suggested (a datalist). Enter adds it,
     Escape (or leaving it empty) closes it. */
  function adder(r, known) {
    const listId = `tagList-${r.id}`;
    const input = h("input", { type: "text", list: listId, autocomplete: "off", placeholder: "Tag", "aria-label": `New tag for ${r.code || r.name}` });
    const close = () => { G.adding = null; render(); };
    const commit = () => {
      const typed = input.value.trim().replace(/\s*,\s*/g, " ");
      if (!typed) return close();
      // The tag's spelling in use, whatever the case typed ("booth" → "Booth").
      const same = known.find(t => t.toLowerCase() === typed.toLowerCase());
      if (same) { G.adding = null; return change(r, same, true); }
      const like = lookalikeTags(typed, known);
      if (!like.length) { G.adding = null; return change(r, typed, true); }
      openMenu([...like.map(t => ({ label: `Use “${t}”`, icon: "check", onSelect: () => { G.adding = null; change(r, t, true); } })),
        "-", { label: `Add “${typed}” as a new tag`, icon: "plus", onSelect: () => { G.adding = null; change(r, typed, true); } }],
        { anchor: input });
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    });
    return h("span", { class: "tag-add" }, input,
      h("datalist", { id: listId }, known.filter(t => !r.tags.some(x => x.toLowerCase() === t.toLowerCase())).map(t => h("option", { value: t }))),
      h("button", { type: "button", class: "btn btn-sm", onclick: commit }, "Add"),
      h("button", { type: "button", class: "icon-btn icon-sm", "aria-label": "Cancel", onclick: close }, ic("x")));
  }

  /* Add or take off one tag, at once. Shown straight away; what Lark holds after the
     write (other people's tags too) replaces it. */
  async function change(r, tag, add) {
    if (busy.has(r.id) || !ctx.ensureTime()) return;
    const rec = (S.data.universe || []).find(x => x.record_id === r.id);
    if (!rec) return;
    const before = rec.fields[field];
    const apply = (val) => { rec.fields[field] = val; ctx.recompute(); ctx.render(); };
    const label = r.code || r.name || "the project";
    busy.add(r.id);
    apply(add ? tagsWith(before, tag) : tagsWithout(before, tag));
    try {
      const res = await ctx.track(() => setTag(ctx.call, ctx.tables.universe, r.id, field, tag, add));
      busy.delete(r.id);
      apply(res.written[field]);
      if (res.readBackError || (res.mismatches && res.mismatches.length)) {
        toast(`Lark didn't confirm the tag on ${label}.`, { type: "warn", timeout: 0,
          detail: `Check its ${field} cell in Lark.`, link: { href: ctx.tables.universe.url, text: "Open in Lark" } });
      } else {
        toast(add ? `Tagged ${label} “${tag}”.` : `Took “${tag}” off ${label}.`, { action: "Undo", onAction: () => change(r, tag, !add) });
      }
    } catch (err) {
      busy.delete(r.id);
      if (isDeadToken(err)) { apply(before); return; }
      if (isUncertain(err)) {
        toast(`Polaris couldn't confirm the tag on ${label}.`, { type: "warn", timeout: 0,
          detail: "The list refreshed to show what Lark has. Check it before trying again.",
          link: { href: ctx.tables.universe.url, text: "Open in Lark" } });
        ctx.loadData({ quiet: true });
        return;
      }
      apply(before);
      toast(add ? `Couldn't tag ${label} “${tag}”.` : `Couldn't take “${tag}” off ${label}.`, {
        type: "error", detail: describe(err), action: "Try again", onAction: () => change(r, tag, add) });
    }
  }

  return { render };
}
