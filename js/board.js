/* The Accountability board (#/accountability): every blank the accountability rules
   ask for (js/accountability.js), by person (what each is Responsible for filling and
   Accountable for) or by project. A field opens its row in the row editor
   (js/inbox.js), so it can be filled right there; the edit goes through the queue. */

import { byPerson, byProject, fieldCounts, itemMatches, UNASSIGNED } from "./accountability.js";
import { $, h, ic, store, recall } from "./ui.js";
import { describe } from "./net.js";

const KEY = { group: "polaris.boardGroup", mine: "polaris.boardMine" };

export function createBoard(ctx) {
  const { S } = ctx;
  const B = { query: "", field: null, group: recall("local", KEY.group) === "project" ? "project" : "person",
              mine: recall("local", KEY.mine) === true, open: new Set() };
  $("#boardSearch").addEventListener("input", (e) => { B.query = e.target.value; render(); });
  $("#boardRefresh").addEventListener("click", () => ctx.loadData({ quiet: true }));

  /* Is this person the one signed in? (Lark's user info has a name and an email, not the open_id.) */
  const isMe = (p) => {
    const u = S.user || {};
    return (u.email && p.email && p.email.toLowerCase() === u.email.toLowerCase()) || (!!u.name && p.name === u.name);
  };
  const mineOnly = (it) => [...it.responsible.people, ...it.accountable.people].some(isMe);

  function render() {
    const list = $("#boardList"), sub = $("#boardSub"), notes = $("#boardNotes");
    if (!S.data || !S.acc) {
      sub.textContent = "";
      notes.replaceChildren();
      $("#boardFields").replaceChildren();
      list.replaceChildren(S.loadError
        ? h("div", { class: "callout callout-err" }, ic("alert"), h("div", null, describe(S.loadError)),
            h("button", { type: "button", class: "btn btn-sm", onclick: () => ctx.loadData() }, "Try again"))
        : h("div", { class: "loader" }, h("div", { class: "loader-title" }, h("span", { class: "spinner" }), "Checking every project…")));
      return;
    }
    const A = S.acc;
    const shown = A.items.filter(it => itemMatches(it, B.query) && (!B.mine || mineOnly(it)));
    const items = B.field ? shown.filter(it => it.label === B.field) : shown;
    const projects = new Set(A.items.map(it => it.projectId)).size;
    sub.textContent = A.items.length
      ? `${A.items.length.toLocaleString()} blank${A.items.length === 1 ? "" : "s"} on ${projects.toLocaleString()} project${projects === 1 ? "" : "s"}, from ${fmtDay(A.cfg.since)} on`
      : `Every project from ${fmtDay(A.cfg.since)} on has its owners and fields filled.`;

    notes.replaceChildren(...[...A.cfg.problems, ...A.notes].map(n =>
      h("div", { class: "callout callout-warn" }, ic("alert"), h("div", null, n))),
      ...(A.cfg.saved.rule ? [] : [h("div", { class: "callout callout-info" }, ic("info"),
        h("div", null, "These are Sanctum's starting rules. An admin can change them, and who holds each role, on the ",
          h("a", { href: "#/admin" }, "Admin page"), "."))]));

    // Field chips: how many of each, click to show only that field.
    const counts = fieldCounts(shown);
    $("#boardFields").replaceChildren(...counts.map(c => h("button", {
      type: "button", class: "chip-opt", "aria-pressed": String(B.field === c.field),
      onclick: () => { B.field = B.field === c.field ? null : c.field; render(); },
    }, c.field, h("span", { class: "count" }, String(c.n)))));

    for (const btn of $("#boardGroup").querySelectorAll("button")) btn.setAttribute("aria-checked", String(btn.dataset.group === B.group));
    $("#boardMine").setAttribute("aria-pressed", String(B.mine));

    if (!items.length) {
      list.replaceChildren(h("p", { class: "empty small" }, A.items.length ? "Nothing matches." : "Nothing is missing. 🎉"));
      return;
    }
    list.replaceChildren(...(B.group === "person" ? personCards(items, A.cfg) : projectCards(items)));
  }

  /* ---- by person ---- */
  function personCards(items, cfg) {
    return byPerson(items, cfg).filter(p => !B.mine || (p.id !== UNASSIGNED && isMe(p)))
      .map(p => {
        const unassigned = p.id === UNASSIGNED;
        const groups = byProject(p.responsible);
        const onlyA = p.accountable.filter(it => !p.responsible.includes(it));
        const openKey = `p:${p.id}`;
        return h("article", { class: `card acc-card${unassigned ? " is-unassigned" : ""}` },
          h("header", { class: "acc-head" },
            h("div", null,
              h("h3", null, unassigned ? "Nobody (unassigned)" : p.name),
              h("p", { class: "acc-meta" }, unassigned
                ? "No one holds the role, or any role it falls back to. Set them on the Admin page."
                : p.telegram ? `@${p.telegram}` : h("span", { class: "muted" }, "No Telegram handle yet"))),
            h("div", { class: "acc-counts" },
              h("span", { class: "badge badge-warn", title: "Blanks this person fills" }, `Responsible · ${p.responsible.length}`),
              h("span", { class: "badge badge-info", title: "Blanks this person makes sure get filled" }, `Accountable · ${p.accountable.length}`))),
          groups.length ? h("ul", { class: "acc-list" }, groups.map(g => projectLine(g, "responsible"))) : null,
          onlyA.length ? h("details", { class: "acc-more", open: B.open.has(openKey) || null,
            ontoggle: (e) => { if (e.target.open) B.open.add(openKey); else B.open.delete(openKey); } },
            h("summary", null, `Accountable for ${onlyA.length} more on others' lists`),
            h("ul", { class: "acc-list" }, byProject(onlyA).map(g => projectLine(g, "accountable")))) : null);
      });
  }

  /* ---- by project ---- */
  function projectCards(items) {
    return byProject(items).map(g => h("article", { class: "card acc-card" },
      h("header", { class: "acc-head" },
        h("div", null, h("h3", null, g.project || "(no name)"),
          h("p", { class: "acc-meta" }, h("span", { class: "mono" }, g.code || "(no code)"), " · ", g.status || "no status")),
        h("span", { class: "badge badge-warn" }, `${g.items.length} blank${g.items.length === 1 ? "" : "s"}`)),
      h("ul", { class: "acc-fields" }, g.items.map(it => h("li", null,
        fieldBtn(it),
        h("span", { class: "acc-who" }, h("b", null, "R "), who(it.responsible)),
        h("span", { class: "acc-who" }, h("b", null, "A "), who(it.accountable)))))));
  }

  /* One project's blanks on a person's list: the code, name and stage, then each field. */
  function projectLine(g, side) {
    return h("li", { class: "acc-proj" },
      h("div", { class: "acc-proj-head" },
        h("span", { class: "mono" }, g.code || "(no code)"), h("span", { class: "acc-name" }, g.project || "(no name)"),
        h("span", { class: "badge badge-muted" }, g.status || "no status")),
      h("div", { class: "acc-proj-fields" }, g.items.map(it => fieldBtn(it, side === "accountable" ? it.responsible : it.accountable,
        side === "accountable" ? "Responsible" : "Accountable"))));
  }

  /* A blank field: click to open its row and fill it. The title says who else is on it. */
  function fieldBtn(it, other, otherSide) {
    const title = [`${it.label} is blank`, it.rowTable === "universe" && it.table !== "universe" ? `(opens the Universe row: there's no ${it.label.replace(/ row$/, "")} row yet)` : "",
                   other ? `${otherSide}: ${whoText(other)}` : ""].filter(Boolean).join(" · ");
    return h("button", { type: "button", class: "acc-field", title, onclick: () => ctx.openRow(it.rowTable, it.rowId) },
      it.label, ic("pencil"));
  }
  const whoText = (r) => (r.unassigned ? "nobody" : `${r.people.map(p => p.name).join(", ")}${r.via ? ` (no ${r.role}, so the ${r.via})` : ` (${r.role})`}`);
  const who = (r) => h("span", { class: r.unassigned ? "muted" : null, title: whoText(r) },
    r.unassigned ? "nobody" : r.people.map(p => p.short || p.name).join(", "), r.via ? h("em", null, ` via ${r.via}`) : null);

  for (const btn of $("#boardGroup").querySelectorAll("button")) {
    btn.addEventListener("click", () => { B.group = btn.dataset.group; store("local", KEY.group, B.group); render(); });
  }
  $("#boardMine").addEventListener("click", () => { B.mine = !B.mine; store("local", KEY.mine, B.mine); render(); });

  return { render };
}

const fmtDay = (iso) => new Date(`${iso}T00:00:00+08:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Manila" });
