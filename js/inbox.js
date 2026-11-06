/* The Inbox: cards for Project Briefs, PARs and Invoice Requests, the push
   sheet (with the BD picker), and Ignore with Undo. */

import { RULES, LARK } from "./config.js";
import { TABLE_TITLES, pushBrief, pushPar, pushCollections, pushAndon, setIgnore, newClientToken, writableOnly, fillGaps,
         saveEdit, findRecord, setTag, syncPm } from "./ops.js";
import {
  universeFromBrief, collectionsChange, stepStatus, parAfterAdding, defaultVat, vatMentions,
  people, plain, pmWrites, ceWrites, validLink, andonFromBrief, auditPatch, auditMissing, auditFilesMissing, monthOf, clean, editChanges, editWrite,
  tagsWith, tagsWithout, requiredMessage, FILTER_KEYS, NONE, passesFilters, filterChoices, closestMatches,
} from "./sync.js";
import { uploadSizeProblem } from "./errors.js";
import { $, h, ic, toast, fmt, flash, copyable, store, collapse, busy, radioKeys, openMenu } from "./ui.js";
import { copyableText, dateField } from "./polaris-ui.js";
import { createRowDoc } from "./rowdoc.js";
import { describe, isDeadToken, isUncertain, uploadToBase } from "./net.js";

const NOUN = { universe: "briefs or PARs", brief: "briefs", par: "PARs", invoice: "invoices", andon: "briefs for ANDON", audit: "projects with blanks" };
// The search box says what it looks through on each tab.
const SEARCHES = { universe: "Search code, project, AM, request no.…", brief: "Search code, project, AM…", par: "Search request no., code, project…",
                   invoice: "Search request no., code, project…", andon: "Search code, project, AM…",
                   audit: "Search project, code, blank columns…" };
const STAGE_ORDER = ["universe", "brief", "par", "invoice", "collections", "andon"];
// The table each card comes from (ANDON cards are Project Briefs too; invoice
// cards say which table they come from themselves: a won project is a Universe row).
const SOURCE = { brief: "brief", par: "par", invoice: "invoice", andon: "brief" };
const sourceOf = (c) => c.source || SOURCE[c.kind];
// One IGNORE box on the brief hides it from both the Universe and ANDON lists.
const ignoreFieldOf = (c) => c.ignoreField || "IGNORE";
const BADGE = { "Approved": "badge-ok", "Under Review": "badge-warn", "Processing": "badge-info", "Won": "badge-ok" };
const VOID_BADGE = "badge-err";
// A sheet that's cancelled keeps what was typed, per card and step (a request
// comes back as a new card when it's approved).
const draftKey = (c) => `${c.kind}:${c.step || ""}:${c.id}`;

export function createInbox(ctx) {
  const { S } = ctx;
  const search = $("#inboxSearch");

  search.addEventListener("input", () => { S.query[S.tab] = search.value; renderCards(); });
  $("#refreshBtn").addEventListener("click", () => ctx.loadData({ quiet: true }));
  $("#filterBtn").addEventListener("click", () => { S.filtersOpen = !S.filtersOpen; renderFilters(); });

  /* ======================= list ======================= */
  function render() {
    search.placeholder = SEARCHES[S.tab];
    if (search.value !== S.query[S.tab]) search.value = S.query[S.tab];
    $("#refreshBtn").classList.toggle("is-busy", S.loading);
    $("#refreshBtn").disabled = S.loading;
    $("#updated").replaceChildren(...(S.loading && S.quiet ? [h("span", { class: "spinner", "aria-hidden": "true" }), "Refreshing…"]
      : S.loadedAt ? [`Updated ${fmt.time(S.loadedAt)}`] : []));
    renderMessage();
    renderLoader();
    renderFilters();
    renderCards();
  }

  /* ======================= filters: Client, Status, BD, AM, Tribe =======================
     The same filters apply on every tab (and to the tab counts) until the page
     reloads. Each list offers the values the open tab's cards have, with how many
     (as the other filters leave them), plus "none". Picked ones show as chips under
     the search, with × each and Clear. */
  const FILTER_LABEL = { client: "Client", status: "Status", bd: "BD", am: "AM", tribe: "Tribe" };
  const FILTER_NONE = { client: "No client", status: "No status (not in the Universe)", bd: "No BD", am: "No AM", tribe: "No tribe" };
  const NONE_OPT = "\u0000none";   // the select's value for "has none"
  const filterSelects = {};
  const activeFilters = () => FILTER_KEYS.filter(k => S.filters[k] !== null && S.filters[k] !== undefined);
  function setFilter(k, v) {
    S.filters[k] = v;
    ctx.render();   // the cards, the chips and every tab's count
  }
  function renderFilters() {
    const panel = $("#inboxFilters"), chips = $("#filterChips"), btn = $("#filterBtn");
    const on = activeFilters();
    $("#filterCount").textContent = on.length ? String(on.length) : "";
    btn.classList.toggle("is-on", on.length > 0);
    btn.setAttribute("aria-expanded", String(S.filtersOpen));
    btn.setAttribute("aria-label", `Filters${on.length ? ` (${on.length} on)` : ""}`);
    panel.hidden = !S.filtersOpen || !S.lists;
    if (!panel.hidden) {
      if (!panel.children.length) {   // built once, so an open list isn't swept away by a re-render
        panel.append(...FILTER_KEYS.map(k => {
          if (k === "client") return clientFilter();   // too many clients for a list: type and pick
          const sel = h("select", { id: `filter-${k}` });
          sel.addEventListener("change", () => setFilter(k, sel.value === "" ? null : sel.value === NONE_OPT ? NONE : sel.value));
          filterSelects[k] = sel;
          return h("div", { class: "filter" }, h("label", { class: "field-label", for: sel.id }, FILTER_LABEL[k]), h("label", { class: "select" }, sel));
        }));
      }
      const cards = (S.lists[S.tab].cards || []).concat((S.lists[S.tab].tagged || []).flatMap(g => g.cards)).filter(c => !ctx.queue.hides(c));
      for (const k of FILTER_KEYS) {
        const sel = filterSelects[k], want = S.filters[k];
        const { values, none } = filterChoices(cards, k, S.filters, k === "status" ? S.statusOrder || [] : []);
        if (k === "client") { client.choices = { values, none }; client.sync(); continue; }
        // the picked value stays listed even if this tab has none of it
        if (want && want !== NONE && !values.some(v => v.value.toLowerCase() === want.toLowerCase())) values.unshift({ value: want, n: 0 });
        const opts = [["", "Any"], ...values.map(v => [v.value, `${v.value} (${v.n})`]), ...(none || want === NONE ? [[NONE_OPT, `${FILTER_NONE[k]} (${none})`]] : [])];
        const sig = JSON.stringify(opts);
        if (sel.dataset.sig !== sig) {
          sel.replaceChildren(...opts.map(([v, text]) => h("option", { value: v }, text)));
          sel.dataset.sig = sig;
        }
        sel.value = want === null || want === undefined ? "" : want === NONE ? NONE_OPT : (values.find(v => v.value.toLowerCase() === want.toLowerCase()) || { value: want }).value;
      }
    }
    chips.hidden = !on.length;
    chips.replaceChildren(...on.map(k => h("span", { class: "chip" }, `${FILTER_LABEL[k]}: ${S.filters[k] === NONE ? FILTER_NONE[k] : S.filters[k]}`,
      h("button", { type: "button", "aria-label": `Clear the ${FILTER_LABEL[k]} filter`, onclick: () => setFilter(k, null) }, ic("x")))),
      ...(on.length > 1 ? [h("button", { type: "button", class: "linkish", onclick: () => { FILTER_KEYS.forEach(k => { S.filters[k] = null; }); ctx.render(); } }, "Clear all")] : []));
  }

  /* The Client filter: type part of a name (or its letters in order) and the closest
     matches show, each with its card count; click one, or arrow to it and Enter.
     Enter with nothing highlighted takes the best match. Clearing the box and
     leaving it is "Any"; leaving it half-typed puts back what was picked. */
  const client = { choices: { values: [], none: 0 }, sync: () => {} };
  function clientFilter() {
    const input = h("input", { type: "text", id: "filter-client", autocomplete: "off", spellcheck: "false", placeholder: "Any: type a client",
                               role: "combobox", "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": "filter-client-list" });
    const list = h("ul", { class: "suggest", id: "filter-client-list", role: "listbox", hidden: true });
    let items = [], active = -1;
    const shown = () => { const w = S.filters.client; return w === null || w === undefined ? "" : w === NONE ? FILTER_NONE.client : w; };
    const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
    const pick = (v) => { close(); input.value = v === NONE ? FILTER_NONE.client : v; setFilter("client", v); };
    const show = () => {
      const q = input.value === shown() ? "" : input.value;   // focused on the picked one: show everything
      const { values, none } = client.choices;
      items = closestMatches(values, q).map(v => [v.value, v.n]);
      // "No client" when it's what's being typed (or nothing is), and some cards have none
      if (none && (!q.trim() || FILTER_NONE.client.toLowerCase().startsWith(q.trim().toLowerCase()))) items.push([NONE, none]);
      active = -1;
      list.replaceChildren(...items.map(([v, n]) => h("li", { role: "option", "aria-selected": "false",
        onmousedown: (e) => { e.preventDefault(); pick(v); } }, v === NONE ? h("em", null, FILTER_NONE.client) : v, h("small", null, String(n)))),
        ...(!items.length ? [h("li", { class: "suggest-head", role: "presentation" }, q.trim() ? "No client by that name in this tab" : "No clients in this tab")] : []));
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
    };
    input.addEventListener("focus", () => { input.select(); show(); });
    input.addEventListener("input", show);
    input.addEventListener("blur", () => {
      close();
      if (!input.value.trim() && S.filters.client !== null) setFilter("client", null);   // cleared: any client
      else input.value = shown();                                                        // half-typed: back to what's picked
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && active < 0) {   // nothing highlighted: the best match (or "Any" if the box is empty)
        e.preventDefault();
        if (!input.value.trim()) { close(); setFilter("client", null); return; }
        if (items.length) pick(items[0][0]);
        return;
      }
      keyNav(e, list, () => items.length, (i) => { active = i; return active; }, () => active,
        () => { if (active >= 0) pick(items[active][0]); }, close);
    });
    // After a re-render: the box shows what's picked (unless someone's typing in it).
    client.sync = () => { if (document.activeElement !== input) input.value = shown(); else if (!list.hidden) show(); };
    return h("div", { class: "filter filter-client" }, h("label", { class: "field-label", for: input.id }, FILTER_LABEL.client),
      h("div", { class: "picker" }, input, list));
  }

  function renderMessage() {
    const box = $("#loadMsg");
    let content = null;
    if (S.loadError && !S.loading && !S.quiet) {
      content = ["callout callout-err", [ic("alert"), h("div", null, describe(S.loadError)),
        h("button", { type: "button", class: "btn btn-sm", onclick: () => ctx.loadData() }, "Try again")]];
    } else if (tabProblems().length) {
      // Every kind of card on this tab counts (the Audit tab's Universe, ANDON and PM
      // cards each need their own columns), so a switched-off button always has its reason here.
      content = ["callout callout-err", [ic("alert"), h("div", null,
        "These columns don't match what Polaris expects, so the cards that need them can't be pushed until they're fixed:",
        h("ul", null, tabProblems().map(p => h("li", null, p))))]];
    } else if (S.data && !ctx.canWriteFor(S.tab)) {
      content = ["callout callout-warn", [ic("alert"),
        h("div", null, "Your login can only read the tables. Log in again to allow pushing."),
        h("a", { class: "btn btn-sm", href: "#/settings" }, "Open Settings")]];
    }
    box.hidden = !content;
    if (content) { box.className = content[0]; box.replaceChildren(...content[1]); }
  }

  // The kinds of push each tab's cards make (TABLES_FOR / neededBy in app.js and ops.js).
  const TAB_KINDS = { universe: ["brief", "par", "files"], invoice: ["invoice"], andon: ["andon", "approval"],
                      audit: ["audit:universe", "audit:andon", "pm", "ce"] };
  const tabProblems = () => [...new Set([S.tab, ...(TAB_KINDS[S.tab] || [])].flatMap(k => ctx.problemsFor(k)))];

  /* Why a kind of push is off, in one sentence ("" when it's on). */
  function offReason(kind) {
    const p = ctx.problemsFor(kind);
    if (p.length) return `Off until ${p.length === 1 ? "this is" : "these are"} fixed: ${p.join(" ")}`;
    if (S.data && !ctx.canWriteFor(kind)) return "Your login can only read the tables. Log in again to allow pushing.";
    return "";
  }
  /* A card's main button. When it's off, the wrapper says why on hover (a disabled
     button shows no tooltip of its own), like Ignore's. */
  function mainButton(label, kind, onclick) {
    const why = offReason(kind);
    const btn = h("button", { type: "button", class: "btn btn-tonal", disabled: !!why, onclick }, label);
    return why ? h("span", { class: "btn-wrap", title: why }, btn) : btn;
  }

  /* Honest, staged progress: the real tables, ticked off as they arrive. */
  function renderLoader() {
    const el = $("#loader");
    const show = S.loading && !S.quiet;
    el.hidden = !show;
    if (!show) return;
    const head = S.waking
      ? [h("div", { class: "loader-title" }, h("span", { class: "spinner" }), "Waking up the connection…"),
         h("p", { class: "loader-sub" }, "It sleeps when nobody's using it. This can take up to a minute.")]
      : [h("div", { class: "loader-title" }, h("span", { class: "spinner" }), "Reading the tables…")];
    const stages = h("ul", { class: "stages" }, STAGE_ORDER.filter(k => ctx.tables[k]).map((k) => {
      const st = S.stages[k];
      const done = st && st.total !== null && st.n >= st.total;
      return h("li", { class: done ? "done" : "" },
        done ? ic("check") : st ? h("span", { class: "spinner" }) : h("span", { class: "slot" }),
        TABLE_TITLES[k], h("span", { class: "n" }, st ? `${st.n.toLocaleString()}${st.total ? ` of ${st.total.toLocaleString()}` : ""}` : ""));
    }));
    el.replaceChildren(...head, ...(S.waking ? [] : [stages]));
  }

  function matches(c, q) {
    if (!q) return true;
    const am = c.am ? c.am.map(u => u.name).join(" ") : "";
    const extra = c.kind === "audit" ? `${c.target} ${c.gaps.join(" ")} ${c.tag || ""}`
      : c.kind === "files" ? `${c.field} ${c.label}`
      : c.kind === "ce" ? `CE ${c.universeLink} ${c.andonLinks.join(" ")}` : "";
    return `${c.code} ${c.name} ${c.requestNo} ${c.status} ${am} ${extra}`.toLowerCase().includes(q.toLowerCase().trim());
  }

  function renderCards() {
    const box = $("#cards");
    const empty = $("#emptyNote");
    const hiddenNote = $("#hiddenNote");
    if (!S.lists) { box.replaceChildren(); empty.hidden = true; hiddenNote.textContent = ""; return; }
    const list = S.lists[S.tab];
    const q = S.query[S.tab] || "";
    const found = list.cards.filter(c => !ctx.queue.hides(c) && matches(c, q));   // queued ones have left
    const cards = found.filter(c => passesFilters(c.facets, S.filters));
    // Re-rendering mustn't lose the keyboard's place (the queue re-renders as pushes land).
    const had = document.activeElement && document.activeElement.closest && document.activeElement.closest("#cards .item");
    const hadBtn = had ? [...had.querySelectorAll("button")].indexOf(document.activeElement) : -1;
    box.replaceChildren(...cards.map(cardEl));
    if (had && hadBtn >= 0) {
      const again = box.querySelector(`[data-id="${CSS.escape(had.dataset.id)}"]`);
      const btn = again && again.querySelectorAll("button")[hadBtn];
      if (btn) btn.focus({ preventScroll: true });
    }
    empty.hidden = cards.length > 0;
    empty.textContent = found.length && !cards.length ? `No ${NOUN[S.tab]} match the filters.`
      : q ? `No ${NOUN[S.tab]} match "${q.trim()}".`
      : { universe: "Every brief and PAR is in the Universe. Nice work!",
          brief: "Every brief is in the Universe. Nice work!",
          par: "Every PAR is in the Universe. Nice work!",
          invoice: "Collections is up to date. Nice work!",
          andon: "Every brief is in ANDON. Nice work!",
          audit: "Nothing in the Universe or ANDON has blanks to fill. Nice work!" }[S.tab];
    hiddenNote.textContent = hiddenSummary({ ...list.hidden, filtered: found.length - cards.length });
    renderTagGroups(list, q);
    S.entering.clear();
    if (S.flashCard) {
      const el = box.querySelector(`[data-id="${S.flashCard}"]`);
      S.flashCard = null;
      if (el) flash(el);   // scrolls it into view too
    }
  }

  function hiddenSummary(hd) {
    const label = {
      done: { invoice: "already up to date in Collections", andon: "already in ANDON" }[S.tab] || "already in the Universe",
      ignored: "ignored", void: "rejected, recalled or cancelled",
      otherDept: "from other departments", noProject: "for projects not in the Universe",
      closed: "for closed or lost projects", hiddenHere: "hidden on this device",
      filtered: "filtered out",
    };
    const parts = Object.keys(label).filter(k => hd[k] > 0).map(k => `${hd[k].toLocaleString()} ${label[k]}`);
    return parts.length ? `Not shown: ${parts.join(" · ")}.` : "";
  }

  function cardEl(c) {
    if (c.kind === "audit") return auditCardEl(c);
    if (c.kind === "approval") return approvalCardEl(c);
    if (c.kind === "pm") return pmCardEl(c);
    if (c.kind === "ce") return ceCardEl(c);
    if (c.kind === "files") return filesCardEl(c);
    const writable = ctx.canWriteFor(c.kind);
    const notes = [];
    let meta;
    if (c.kind === "brief" || c.kind === "andon") {
      meta = [c.value !== null ? h("b", null, fmt.money(c.value, c.currency)) : "No contract value",
              c.am.length ? h("span", { title: c.am.map(u => u.name).join(", ") }, ` · AM ${c.am.map(u => u.short).join(", ")}`) : "",
              c.kind === "andon" && c.department ? ` · ${c.department}` : ""];
      c.problems.forEach(p => notes.push(h("li", { class: "is-plain" }, p)));
      if (c.similar) {
        notes.push(h("li", null, copyableText(`Note: looks like "${c.similar.project}"${c.similar.code ? ` (${c.similar.code})` : ""}, ` +
          `already in ${c.kind === "andon" ? "ANDON" : "the Universe"}. If it's the same project, ignore this one.`)));
      }
    } else if (c.kind === "par") {
      const t = c.target;
      meta = ["PAR ", copyable(c.requestNo, { label: "request number" }),
              t ? ` · goes to "${t.project || t.codeText}"` : "",
              t && t.par ? [" (already has ", copyableText(t.par), ")"] : ""];
      c.notes.forEach(n => notes.push(h("li", null, copyableText(`Note: ${n}`))));
    } else {
      const t = c.targets.find(x => x.id === c.target);
      meta = [c.amount !== null ? h("b", null, fmt.money(c.amount, c.currency)) : "No amount",
              c.step === "won" ? ` · Amount (VAT-Inc.) · Universe: ${c.status}` : [" · request ", copyable(c.requestNo, { label: "request number" })],
              !t && c.existing ? ` · ${c.existing} already in Collections for this project` : ""];
      notes.unshift(h("li", { class: "flow" }, flowEl(c, c.target)));
      c.notes.forEach(n => notes.push(h("li", null, copyableText(`Note: ${n}`))));
    }
    if (c.blocked) notes.push(h("li", { class: "is-plain" }, c.blocked, fixLink(c.blocked, c.code)));
    const pushable = writable && !c.blocked && !(c.problems && c.problems.length);
    // A won project is hidden with an IGNORE box on its Universe row, if the Universe has one.
    const ignorable = c.source !== "universe" || ctx.hasField("universe", ignoreFieldOf(c));
    const canIgnore = writable && ignorable;
    const ignoreTitle = c.kind === "brief" || c.kind === "andon" ? "Hides this brief from both the Universe and ANDON lists"
      : !ignorable ? `To hide won projects here, add a checkbox column named “${ignoreFieldOf(c)}” to the Universe.`
      : c.source === "universe" ? `Ticks ${ignoreFieldOf(c)} on the project's Universe row` : null;
    const badge = c.step === "won" ? "Won" : c.status;
    return h("article", { class: "card item" + (S.working.has(c.id) ? " is-working" : "") + (S.entering.has(c.id) ? " is-entering" : ""),
                          "data-id": c.id },
      h("div", { class: "item-head" },
        copyable(c.code, { label: "project code", cls: "code", empty: h("span", { class: "code" }, "No code") }),
        badge ? h("span", { class: `badge ${BADGE[badge] || (RULES.voidStatuses.includes(badge) ? VOID_BADGE : "")}` }, badge) : null,
        h("span", { class: "item-date" }, fmt.day(c.submittedAt))),
      h("h3", null, c.name || "(no name)"),
      h("p", { class: "item-meta" }, meta),
      notes.length ? h("ul", { class: "notes" }, notes) : null,
      h("div", { class: "item-actions" },
        h("span", { class: "btn-wrap", title: ignoreTitle },
          h("button", { type: "button", class: "btn btn-ghost", disabled: !canIgnore,
            onclick: (e) => ignore(c, true, e.currentTarget) }, "Ignore")),
        // A won project that shouldn't be billed: a Collections row marked Invalid keeps it off the list.
        c.step === "won" ? h("button", { type: "button", class: "btn btn-ghost", disabled: !writable,
          title: "Adds this project to Collections with Status Invalid, so it stops showing here",
          onclick: () => openSheet(c, { invalid: true }) }, "Mark invalid") : null,
        h("button", { type: "button", class: "btn btn-tonal", disabled: !pushable, onclick: () => openSheet(c) }, "Push")));
  }

  /* A project whose PM isn't the same in the Universe and ANDON (or is blank in one). */
  function pmCardEl(c) {
    const who = (list) => (list.length ? list.map(u => u.name || u.id).join(", ") : "blank");
    const andon = [...new Set(c.andonPm.map(who))].join(" / ");
    return h("article", { class: "card item" + (S.working.has(c.id) ? " is-working" : "") + (S.entering.has(c.id) ? " is-entering" : ""),
                          "data-id": c.id },
      h("div", { class: "item-head" },
        copyable(c.code, { label: "project code", cls: "code" }),
        h("span", { class: "badge badge-info" }, "PM"),
        c.status ? h("span", { class: "item-date" }, c.status) : null),
      h("h3", null, c.name || "(no name)"),
      h("ul", { class: "notes" }, h("li", { class: "flow" },
        h("span", { class: "flow-step" }, h("b", null, "Universe"), ` ${who(c.universePm)}`),
        h("span", { class: "flow-step" }, h("b", null, "ANDON"), ` ${andon}`))),
      h("div", { class: "item-actions" }, mainButton("Fill", "pm", () => openSheet(c))));
  }

  /* A project whose CE link isn't the same in the Universe and ANDON (or is blank in one). */
  function ceCardEl(c) {
    const link = (url) => (url ? h("a", { href: url, target: "_blank", rel: "noopener", class: "ce-link", title: url }, url) : "blank");
    const andon = [...new Set(c.andonLinks)];
    return h("article", { class: "card item" + (S.working.has(c.id) ? " is-working" : "") + (S.entering.has(c.id) ? " is-entering" : ""),
                          "data-id": c.id },
      h("div", { class: "item-head" },
        copyable(c.code, { label: "project code", cls: "code" }),
        h("span", { class: "badge badge-info" }, "CE"),
        c.status ? h("span", { class: "item-date" }, c.status) : null),
      h("h3", null, c.name || "(no name)"),
      h("ul", { class: "notes" }, h("li", { class: "flow" },
        h("span", { class: "flow-step" }, h("b", null, RULES.ceSync.universe), " ", link(c.universeLink)),
        h("span", { class: "flow-step" }, h("b", null, `ANDON ${RULES.ceSync.andon}`), " ", ...andon.flatMap((u, i) => [i ? " / " : null, link(u)])))),
      h("div", { class: "item-actions" }, mainButton("Fill", "ce", () => openSheet(c))));
  }

  /* An ANDON row whose project has a Project Approval: its Request No. goes into
     ANDON's Approval (a link to the approval, shown as the number). */
  function approvalCardEl(c) {
    return h("article", { class: "card item" + (S.working.has(c.id) ? " is-working" : "") + (S.entering.has(c.id) ? " is-entering" : ""),
                          "data-id": c.id },
      h("div", { class: "item-head" },
        copyable(c.code, { label: "project code", cls: "code" }),
        c.status ? h("span", { class: `badge ${BADGE[c.status] || ""}` }, c.status) : null,
        h("span", { class: "item-date" }, c.submittedAt ? `PAR ${fmt.day(c.submittedAt)}` : "")),
      h("h3", null, c.name || "(no name)"),
      h("p", { class: "item-meta" }, "PAR ", copyable(c.requestNo, { label: "request number" }), ` · into ANDON's ${c.field}`),
      h("div", { class: "item-actions" }, mainButton("Push", "approval", () => openSheet(c))));
  }

  /* A Universe row with a blank Other Attachments whose brief has files in Lark
     Approval: the link opens them there (to download), and Upload sends them here. */
  function filesCardEl(c) {
    return h("article", { class: "card item" + (S.working.has(c.id) ? " is-working" : "") + (S.entering.has(c.id) ? " is-entering" : ""),
                          "data-id": c.id },
      h("div", { class: "item-head" },
        copyable(c.code, { label: "project code", cls: "code" }),
        c.status ? h("span", { class: `badge ${BADGE[c.status] || ""}` }, c.status) : null,
        h("span", { class: "item-date" }, c.submittedAt ? `Brief ${fmt.day(c.submittedAt)}` : "")),
      h("h3", null, c.name || "(no name)"),
      h("p", { class: "item-meta" }, h("a", { href: c.link, target: "_blank", rel: "noopener" }, `Brief: ${c.label || "attachments"}`),
        ` · ${c.field} is blank`),
      h("div", { class: "item-actions" }, mainButton("Upload", "files", () => openSheet(c))));
  }

  /* Where a Collections card lands: the row (“AR name”), then From → To. */
  function flowEl(c, targetId, invalid = false) {
    const t = invalid ? null : c.targets.find(x => x.id === targetId);
    const to = invalid ? RULES.invalidStatuses[0] : stepStatus(c.step, RULES);
    const arrow = h("span", { class: "flow-arrow", "aria-label": "becomes" }, "→");
    if (!t) return [h("span", { class: "flow-step" }, "New Collections row", arrow, h("b", null, to))];
    const name = h("span", { class: "flow-row" }, `“${t.row.arName || "(no AR name)"}”`);
    if (t.action === "link") return [name, h("span", { class: "flow-step" }, `${t.row.status} · adds the request number`)];
    return [name, h("span", { class: "flow-step" }, t.row.status || "No status", arrow, h("b", null, to))];
  }

  /* Show a card in the Universe tab and let it glow. Briefs and PARs share that tab,
     so the link is often to the tab already open: then draw it here (no hash change). */
  function goTo(e, id) {
    S.flashCard = id;
    S.query.universe = "";
    if (location.hash === "#/universe") { e.preventDefault(); ctx.render(); }
  }

  /* A link to the card that clears a blocker, if it's in the lists. */
  function fixLink(reason, code) {
    if (reason.startsWith("Push this project's brief")) {
      const brief = S.lists.brief.cards.find(b => b.code === code);
      return brief ? h("a", { href: "#/universe", onclick: (e) => goTo(e, brief.id) }, "Go to the brief") : null;
    }
    if (reason.startsWith("Add this project's PAR")) {
      const par = S.lists.par.cards.find(p => p.code === code);
      return par ? h("a", { href: "#/universe", onclick: (e) => goTo(e, par.id) }, "Go to the PAR") : null;
    }
    return null;
  }

  /* ======================= ignore / undo (optimistic) ======================= */
  async function ignore(c, value, button) {
    if (S.working.has(c.id)) return;
    const src = sourceOf(c), box = ignoreFieldOf(c);
    const rec = (S.data[src] || []).find(r => r.record_id === c.id);
    if (!rec) return;
    if (!ctx.ensureTime()) return;     // Ignore and Undo are writes too
    const before = rec.fields[box];
    const what = c.requestNo && c.kind !== "brief" && c.kind !== "andon" ? `${c.code} · ${c.requestNo}` : c.code;
    const apply = (v) => { rec.fields[box] = v; ctx.recompute(); ctx.render(); };

    if (value && button) {   // let the card slide out, then drop it
      const el = button.closest(".item");
      await collapse(el);
    }
    if (!value) { S.entering.add(c.id); S.flashCard = c.id; }
    apply(value);
    const closeToast = value
      ? toast(`Ignored ${what}.`, { action: "Undo", onAction: () => ignore(c, false),
          detail: c.kind === "brief" || c.kind === "andon" ? "It's hidden from both the Universe and ANDON lists." : undefined })
      : toast(`${what} is back in the list.`, { type: "success" });
    S.working.add(c.id);
    try {
      const res = await ctx.track(() => setIgnore(ctx.call, ctx.tables[src], c.id, value, box));
      if (res.readBackError || (res.mismatches && res.mismatches.length)) {
        toast(`Lark didn't confirm the change to ${what}.`, { type: "warn", timeout: 0,
          detail: `Check its ${box} box in Lark.`, link: { href: ctx.tables[src].url, text: "Open in Lark" } });
      }
    } catch (err) {
      closeToast();
      if (isDeadToken(err)) { rec.fields[box] = before; return; }   // the session already ended (net.js); data is gone
      if (isUncertain(err)) {              // it may have landed: don't roll back, show what Lark really has
        toast(`Polaris couldn't confirm the change to ${what}.`, { type: "warn", timeout: 0,
          detail: "The list refreshed to show what Lark has. Check it before trying again.",
          link: { href: ctx.tables[src].url, text: "Open in Lark" } });
        ctx.loadData({ quiet: true });
        return;
      }
      apply(before);                       // roll back, and say why
      toast(`Couldn't ${value ? "ignore" : "restore"} ${what}.`, {
        type: "error", detail: describe(err), action: "Try again", onAction: () => ignore(c, value),
      });
    } finally {
      S.working.delete(c.id);
    }
  }

  /* ======================= push sheet ======================= */
  const dialog = $("#sheet");
  const go = $("#sheetGo");
  const cancel = $("#sheetCancel");
  let sheet = null;   // { card, choices, clientToken, targetId, busy, refresh }

  cancel.addEventListener("click", () => { if (!sheet || !sheet.busy) dialog.close(); });
  dialog.addEventListener("cancel", (e) => { if (sheet && sheet.busy) e.preventDefault(); });
  // A click on the backdrop (or the gap between the two cards) is Cancel. Only one that
  // starts there too, so a text selection dragged out of a field doesn't close it.
  let downOnBackdrop = false;
  dialog.addEventListener("pointerdown", (e) => { downOnBackdrop = e.target === dialog; });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog && downOnBackdrop && !(sheet && sheet.busy)) dialog.close();
    downOnBackdrop = false;
  });
  dialog.addEventListener("close", () => {
    // (a row opened and closed without a change leaves no draft)
    const untouched = sheet && sheet.card.kind === "edit" && !Object.keys(sheet.choices.edits || {}).length && !(sheet.choices.files || []).length;
    if (sheet && !sheet.done && !untouched) S.drafts.set(draftKey(sheet.card) + (sheet.invalid ? ":invalid" : ""), { choices: sheet.choices, clientToken: sheet.clientToken, targetId: sheet.targetId });
    sheet = null;
  });
  $("#sheetForm").addEventListener("submit", (e) => e.preventDefault());   // Enter in a field mustn't send
  go.addEventListener("click", runPush);

  // Beside the form: the Lark row as it will be after this push (js/rowdoc.js).
  // Where there's no room for two side by side, it sits under the form's fields.
  const rowDoc = createRowDoc(ctx);
  const docBox = $("#sheetDoc");
  const narrow = matchMedia("(max-width: 960px)");
  function placeDoc() {
    if (narrow.matches) $("#sheetBody").append(docBox); else dialog.append(docBox);
    docBox.classList.toggle("is-inline", narrow.matches);
  }
  narrow.addEventListener("change", placeDoc);
  function paintDoc() {
    if (!sheet || sheet.card.kind === "edit" || sheet.card.kind === "view") return;   // those paint their own row
    rowDoc.render(docBox, preview(sheet.card, { choices: sheet.choices, targetId: sheet.targetId, invalid: sheet.invalid }));
  }

  /* ======================= the audit: blanks the brief can fill ======================= */
  const AUDIT_WHERE = { universe: "Universe", andon: "ANDON" };
  const auditRow = (c) => (S.data[c.target] || []).find(r => r.record_id === c.rowId) || { fields: {} };
  // The table's options and columns (ANDON's select spellings; the type of a column like Month).
  const auditOpts = (c) => ({ options: ctx.optionsOf(c.target), fields: ctx.fieldsOf(c.target) });
  const AUDIT_DATES = new Set(["Project Start", "Project End", "RFP Received Date", "Event Start", "Event End"]);

  function auditCardEl(c) {
    return h("article", { class: "card item" + (S.working.has(c.id) ? " is-working" : "") + (S.entering.has(c.id) ? " is-entering" : ""),
                          "data-id": c.id },
      h("div", { class: "item-head" },
        copyable(c.code, { label: "project code", cls: "code" }),
        h("span", { class: "badge badge-info" }, AUDIT_WHERE[c.target]),
        c.tag ? h("span", { class: "badge badge-tag" }, ic("pin"), c.tag) : null,
        h("span", { class: "item-date" }, c.submittedAt ? `Brief ${fmt.day(c.submittedAt)}` : "")),
      h("h3", null, c.name || "(no name)"),
      // "…that the brief can fill" only when it can fill all of them (Sign Date, Month and the signed CE it never has).
      h("p", { class: "item-meta" }, h("b", null, `${c.gaps.length} blank`), ` in ${AUDIT_WHERE[c.target]}`,
        c.requestNo ? ((c.required || []).length || (c.files || []).length ? [" · brief ", copyable(c.requestNo, { label: "request number" })]
          : [" that the brief ", copyable(c.requestNo, { label: "request number" }), " can fill"]) : "",
        c.status ? ` · ${c.status}` : ""),
      h("ul", { class: "notes" }, h("li", { class: "flow" }, h("span", { class: "flow-row" }, "Missing"),
        h("span", { class: "flow-step" }, c.gaps.join(" · ")))),
      h("div", { class: "item-actions" },
        c.tag
          ? h("button", { type: "button", class: "btn btn-ghost", disabled: !ctx.canWriteFor(`tag:${c.target}`),
              title: `Takes “${c.tag}” off this row, so it's back in the list (for everyone)`,
              onclick: (e) => markTag(c, c.tag, false, e.currentTarget) }, "Unmark")
          : !RULES.tags.tables.includes(c.target)
          // A table without custom tags (ANDON): Hide is just "on this device", as it always was.
          ? h("button", { type: "button", class: "btn btn-ghost", title: "Hides this card on this device until another cell goes blank",
              onclick: (e) => hideAudit(c, true, e.currentTarget) }, "Hide")
          : h("button", { type: "button", class: "btn btn-ghost hide-btn", "aria-haspopup": "menu", "aria-expanded": "false",
              title: "Mark it with a tag (for everyone), or hide it on this device",
              onclick: (e) => hideMenu(c, e.currentTarget) }, "Hide", ic("caret")),
        mainButton("Fill", `audit:${c.target}`, () => openSheet(c))));
  }

  /* Under Hide: "Mark as …" for each custom tag (Settings > Custom tags), written to
     the row's Tags cell so the card leaves everyone's list, and "Hide on this device". */
  function hideMenu(c, btn) {
    const canTag = ctx.canWriteFor(`tag:${c.target}`);
    const items = canTag ? S.customTags.map(t => ({ label: `Mark as ${t.tag}`, icon: "pin",
      onSelect: () => markTag(c, t.tag, true, btn) })) : [];
    if (!canTag && S.customTags.length) {
      items.push({ label: "Why no “Mark as …”?", icon: "info", onSelect: () => toast(`Marking needs a “${RULES.tags.field}” column in ${AUDIT_WHERE[c.target]}.`,
        { detail: ctx.problemsFor(`tag:${c.target}`)[0] || "Your login can only read the tables. Log in again to allow it.", timeout: 0 }) });
    }
    if (!S.customTags.length) {
      items.push({ label: "Add custom tags in Settings", icon: "gear", onSelect: () => { location.hash = "#/settings"; } });
    }
    items.push("-", { label: "Hide on this device", icon: "eye", onSelect: () => hideAudit(c, true, btn) });
    openMenu(items, { anchor: btn });
  }

  /* The tag groups at the bottom of the audit list: one per custom tag, folded until
     opened (each remembers, until the page reloads). Search narrows them too. */
  const tagOpen = new Set();
  function renderTagGroups(list, q) {
    const box = $("#tagGroups");
    const groups = S.tab === "audit" && list.tagged ? list.tagged.map(g => ({ ...g, cards: g.cards.filter(c => !ctx.queue.hides(c) && matches(c, q) && passesFilters(c.facets, S.filters)) }))
      .filter(g => g.cards.length) : [];
    box.hidden = !groups.length;
    box.replaceChildren(...groups.map(g => {
      const d = h("details", { class: "tag-group", "data-tag": g.tag, open: tagOpen.has(g.tag) || null },
        h("summary", null, ic("caret"), ic("pin"), h("b", null, g.tag), h("span", { class: "group-n" }, String(g.cards.length)),
          h("span", { class: "tag-hint" }, "marked, so not in the list above")),
        h("div", { class: "cards" }, g.cards.map(cardEl)));
      d.addEventListener("toggle", () => { if (d.open) tagOpen.add(g.tag); else tagOpen.delete(g.tag); });
      return d;
    }));
  }

  /* Mark a card's row with a custom tag, or take it off (Unmark, Undo). Instant, like
     Ignore: the card moves at once, the write follows, and a refusal moves it back
     with the reason. The tag is merged into what the Tags cell says in Lark then. */
  async function markTag(c, tag, add, button) {
    const key = `tag:${c.target}:${c.rowId}`;
    if (S.working.has(key)) return;
    const table = c.target, field = RULES.tags.field;
    const rec = (S.data[table] || []).find(r => r.record_id === c.rowId);
    if (!rec || !ctx.ensureTime()) return;
    const before = rec.fields[field];
    const apply = (v) => { rec.fields[field] = v; ctx.recompute(); ctx.render(); };
    if (button && button.closest) { const el = button.closest(".item"); if (el) await collapse(el); }
    if (add) tagOpen.delete(tag); else { S.entering.add(c.id); S.flashCard = c.id; }
    apply(add ? tagsWith(before, tag) : tagsWithout(before, tag));
    const closeToast = toast(add ? `Marked ${c.code} as ${tag}.` : `Took “${tag}” off ${c.code}.`, {
      action: "Undo", onAction: () => markTag(c, tag, !add),
      detail: add ? `It's in the “${tag}” group at the bottom of the list, for everyone.` : "It's back in the list.",
    });
    S.working.add(key);
    try {
      const res = await ctx.track(() => setTag(ctx.call, ctx.tables[table], c.rowId, field, tag, add));
      apply(res.written[field]);           // what Lark holds now (other people's tags included)
      if (res.readBackError || (res.mismatches && res.mismatches.length)) {
        toast(`Lark didn't confirm the tag on ${c.code}.`, { type: "warn", timeout: 0,
          detail: `Check its ${field} cell in Lark.`, link: { href: ctx.tables[table].url, text: "Open in Lark" } });
      }
    } catch (err) {
      closeToast();
      if (isDeadToken(err)) { rec.fields[field] = before; return; }
      if (isUncertain(err)) {
        toast(`Polaris couldn't confirm the tag on ${c.code}.`, { type: "warn", timeout: 0,
          detail: "The list refreshed to show what Lark has. Check it before trying again.",
          link: { href: ctx.tables[table].url, text: "Open in Lark" } });
        ctx.loadData({ quiet: true });
        return;
      }
      apply(before);
      toast(`Couldn't ${add ? `mark ${c.code} as ${tag}` : `take “${tag}” off ${c.code}`}.`, {
        type: "error", detail: describe(err), action: "Try again", onAction: () => markTag(c, tag, add),
      });
    } finally {
      S.working.delete(key);
    }
  }

  /* Hide (or bring back) an audit card on this device: nothing is written to Lark. */
  async function hideAudit(c, value, button) {
    if (value && button) {
      const el = button.closest(".item");
      await collapse(el);
    }
    if (value) S.auditHide.add(c.hideKey); else { S.auditHide.delete(c.hideKey); S.entering.add(c.id); S.flashCard = c.id; }
    store("local", "polaris.auditHidden", [...S.auditHide]);
    ctx.recompute();
    ctx.render();
    if (value) toast(`Hid ${c.code} (${AUDIT_WHERE[c.target]}).`, { action: "Undo", onAction: () => hideAudit(c, false),
      detail: "Only on this device. It comes back if another cell goes blank." });
  }

  /* The fill sheet: every blank with an editor, pre-filled from the brief (which
     may be out of date). Ticked ones are written; editing one ticks it. */
  function buildAudit(body, c) {
    const ch = sheet.choices;
    const row = auditRow(c);
    const opts = auditOpts(c);
    const types = new Map(ctx.fieldsOf(c.target).map(f => [f.field_name, f.type]));
    const selects = ctx.optionsOf(c.target);
    const AMOUNT = "Amount (VAT-Ex.) (PHP)";
    // Names for the people in the row beside the sheet (the brief's, plus anyone picked here).
    ch.names = ch.names || new Map();
    if (c.brief) for (const f of ["AM", "BD"]) people(c.brief.record.fields[f]).forEach(u => ch.names.set(u.id, u.name));
    const fromBrief = () => auditPatch(c, row, { fields: c.gaps, vat: ch.vat }, RULES, opts);
    if (!ch.values) ch.values = { ...fromBrief() };
    ch.edited = ch.edited || [];
    ch.bad = ch.bad || [];
    ch.files = ch.files || [];   // the signed CE (a draft never keeps files)

    const vatBox = h("div", { class: "field" });
    const refresh = () => {
      const patch = auditPatch(c, row, ch, RULES, opts);
      const n = Object.keys(patch).length;
      const bad = ch.bad.filter(k => ch.fields.includes(k));
      const missing = auditMissing(c, patch);
      const noFile = auditFilesMissing(c, ch);
      const uploading = (c.files || []).some(k => k in patch);
      const tooBig = uploading ? ch.files.map(f => uploadSizeProblem(f, LARK.maxUploadMb)).filter(Boolean) : [];
      sheet.blocked = bad.length ? `Check ${bad.join(", ")}: ${bad.length === 1 ? "it isn't" : "they aren't"} valid yet.`
        : tooBig.length ? tooBig[0]
        : missing.length ? requiredMessage(c, missing)
        : noFile.length ? `Add the file for ${noFile.join(", ")}${c.gaps.length > 1 ? ", or untick it to fill the rest" : ""}.`
        : n ? "" : "Tick at least one field to fill.";
      go.disabled = sheet.busy || !!sheet.blocked;
      const files = ch.files.length;
      if (!sheet.busy) {
        go.querySelector(".label").textContent = !n ? "Fill"
          : uploading && n === 1 ? `Upload ${files} file${files === 1 ? "" : "s"}`
          : "Status" in patch && n === 1 ? "Change Status"
          : `Fill ${n} field${n === 1 ? "" : "s"}`;
      }
      // A required field still blank (Sign Date and Month, Loss Month and Reason for
      // Loss) just keeps Fill off: they're always ticked, so nobody needs the rule spelled out.
      const onlyRequired = !bad.length && !tooBig.length && missing.length > 0;
      blockNote.hidden = !sheet.blocked || onlyRequired || (!n && !noFile.length);
      blockNote.textContent = sheet.blocked;
      vatBox.hidden = !(c.needsVat && ch.fields.includes(AMOUNT));
      paintDoc();
    };
    sheet.refresh = refresh;
    const blockNote = h("p", { class: "note", role: "status", hidden: true });

    // One row per blank: tick box, name, and an editor that fits the column.
    const tick = {};
    const editors = {};
    const mo = RULES.auditRequired.month;
    const changed = (k, v, ok = true) => {
      ch.values[k] = v;
      if (!ch.edited.includes(k)) ch.edited.push(k);
      ch.bad = ok ? ch.bad.filter(x => x !== k) : [...new Set([...ch.bad, k])];
      if (!ch.fields.includes(k)) { ch.fields.push(k); tick[k].checked = true; }
      // A new Sign Date moves Month to its month, unless Month was changed by hand.
      if (mo && k === mo.from && ok && v !== null && editors[mo.field] && !ch.edited.includes(mo.field)) {
        const month = monthOf(v, ctx.fieldsOf(c.target).find(f => f.field_name === mo.field), RULES);
        if (month !== null && month !== undefined) {
          ch.values[mo.field] = month;
          const fresh = editor(mo.field);
          editors[mo.field].replaceWith(fresh);
          editors[mo.field] = fresh;
        }
      }
      refresh();
    };
    let amountInput = null;
    // The signed CE: files picked here are uploaded to Lark when the push runs, then
    // put in the attachment cell. Adding a file ticks the row.
    const filesEditor = (k) => {
      const list = h("ul", { class: "files" });
      const btnText = h("span");
      const paint = (again = true) => {
        list.replaceChildren(...ch.files.map((f, i) => h("li", null, ic("link"),
          h("span", { class: "file-name" }, f.name, " ", h("span", { class: "file-size" }, `(${Math.max(1, Math.round(f.size / 1024)).toLocaleString()} KB)`)),
          h("button", { type: "button", "aria-label": `Remove ${f.name}`, onclick: () => { ch.files.splice(i, 1); paint(); } }, ic("x")))));
        list.hidden = !ch.files.length;
        btnText.textContent = ch.files.length ? "Add another file" : "Add the signed CE";
        if (again) refresh();
      };
      const input = h("input", { type: "file", multiple: true, hidden: true, accept: ".pdf,application/pdf" });
      input.addEventListener("change", () => {
        for (const file of input.files) ch.files.push({ name: file.name, size: file.size, file });
        input.value = "";
        if (ch.files.length && !ch.fields.includes(k)) { ch.fields.push(k); tick[k].checked = true; }
        paint();
      });
      paint(false);
      return h("div", { class: "field" }, list,
        h("label", { class: "btn btn-sm file-btn" }, ic("plus"), btnText, input),
        h("p", { class: "set-sub" }, `PDF, up to ${LARK.maxUploadMb} MB each. Uploaded to Lark when the push runs.`));
    };
    const editor = (k) => {
      if ((c.files || []).includes(k)) return filesEditor(k);
      const id = `gap-v-${k.replace(/\W+/g, "-")}`;
      const v = ch.values[k];
      const type = types.get(k) || (AUDIT_DATES.has(k) ? 5 : 1);
      if (type === 5) return dateField({ id, value: v ?? null, onChange: (ms, ok) => changed(k, ms, ok) });
      if (type === 11) {
        const chosen = (Array.isArray(v) ? v : []).map(u => ({ id: u.id, name: ch.names.get(u.id) || u.id, email: "" }));
        const pool = c.target === "andon" ? [...(S.pmPool || []), ...S.pool] : S.pool;
        return peoplePicker({ id, selected: chosen, pool: [...new Map(pool.map(p => [p.id, p])).values()],
          placeholder: "Add someone", single: c.target === "andon" && k === "AM", head: "Frequent people",
          onChange: (list) => { list.forEach(u => ch.names.set(u.id, u.name)); changed(k, list.map(u => ({ id: u.id }))); } });
      }
      if (type === 3) {
        const sel = h("select", { id }, h("option", { value: "" }, "Not set"), (selects[k] || []).map(o => h("option", { value: o }, o)));
        sel.value = v || "";
        sel.addEventListener("change", () => changed(k, sel.value || null));
        return h("label", { class: "select" }, sel);
      }
      if (type === 4) {
        const now = new Set(Array.isArray(v) ? v : []);
        return h("div", { class: "chips", role: "group", "aria-label": k }, (selects[k] || []).map(o =>
          h("button", { type: "button", class: "chip-opt", "aria-pressed": String(now.has(o)), onclick: (e) => {
            if (now.has(o)) now.delete(o); else now.add(o);
            e.currentTarget.setAttribute("aria-pressed", String(now.has(o)));
            changed(k, [...now]);
          } }, o)));
      }
      if (type === 2) {
        const el = h("input", { type: "text", id, inputmode: "decimal", autocomplete: "off" });
        el.value = v ?? "";
        el.addEventListener("input", () => {
          const t = el.value.replace(/[₱,\s]/g, "");
          const n = t === "" ? null : Number(t);
          el.setAttribute("aria-invalid", String(Number.isNaN(n)));
          changed(k, Number.isNaN(n) ? null : n, !Number.isNaN(n));
        });
        if (k === AMOUNT) amountInput = el;
        return el;
      }
      if (type === 15) {   // a link (ANDON's Approval): Lark takes {link, text}, never plain text
        const el = h("input", { type: "url", id, autocomplete: "off", placeholder: "https://…" });
        el.value = (v && v.link) || "";
        el.addEventListener("input", () => {
          const link = el.value.trim(), ok = !link || /^https?:\/\/\S+$/.test(link);
          el.setAttribute("aria-invalid", String(!ok));
          changed(k, link && ok ? { link, text: link } : null, ok);
        });
        return el;
      }
      const long = /description|remarks/i.test(k) || String(v || "").length > 60;
      const el = h(long ? "textarea" : "input", long ? { id, rows: "3" } : { type: "text", id, autocomplete: "off" });
      el.value = v ?? "";
      el.addEventListener("input", () => changed(k, el.value));
      return el;
    };
    const rows = c.gaps.map((k) => {
      const box = h("input", { type: "checkbox", id: `gap-${k.replace(/\W+/g, "-")}`, "aria-label": `Fill ${k}` });
      // A required column can't be left out: always ticked.
      if ((c.required || []).includes(k)) { box.disabled = true; if (!ch.fields.includes(k)) ch.fields.push(k); }
      box.checked = ch.fields.includes(k);
      tick[k] = box;
      box.addEventListener("change", () => {
        ch.fields = box.checked ? [...ch.fields, k] : ch.fields.filter(x => x !== k);
        refresh();
      });
      editors[k] = editor(k);
      return h("div", { class: "gap" },
        h("label", { class: "gap-head", for: box.id }, box, h("b", null, k)),
        editors[k]);
    });
    if (c.needsVat) {
      const seg = h("div", { class: "chips", role: "radiogroup", "aria-label": "VAT" },
        ["12%", "0%"].map(v => h("button", { type: "button", class: "chip-opt", role: "radio", "aria-checked": String(ch.vat === v), onclick: (e) => {
          ch.vat = v;
          for (const b of e.currentTarget.parentElement.children) b.setAttribute("aria-checked", String(b.textContent === v));
          // An amount still as the brief has it follows the VAT; one typed in stays.
          if (!ch.edited.includes(AMOUNT) && amountInput) {
            ch.values[AMOUNT] = fromBrief()[AMOUNT];
            amountInput.value = ch.values[AMOUNT] ?? "";
          }
          refresh();
        } }, v)));
      radioKeys(seg);
      vatBox.replaceChildren(h("span", { class: "field-label" }, "VAT"), seg);
    }
    // A lost, stalled or archived project: its Status can be put right here, among those
    // three (people sometimes pick Lost for one that's only stalled or archived).
    let statusBox = null;
    if (c.lost) {
      const have = selects.Status || [];
      const choices = RULES.auditLost.statuses.filter(s => s === c.status || !have.length || have.includes(s));
      const sel = h("select", { id: "auditStatus" }, choices.map(s => h("option", { value: s }, s)));
      sel.value = ch.status || c.status;
      sel.addEventListener("change", () => { ch.status = sel.value; refresh(); });
      statusBox = h("div", { class: "field" },
        h("label", { class: "field-label", for: "auditStatus" }, "Status"),
        h("label", { class: "select" }, sel),
        h("p", { class: "set-sub" }, `Change it if it was marked ${c.status} by mistake.`));
    }
    put(body, statusBox, h("div", { class: "gaps" }, rows), vatBox, blockNote);
    refresh();
  }

  /* ======================= the row editor =======================
     A row clicked in the Universe, Collections or ANDON table opens here. The row
     beside the sheet (#sheetDoc) becomes editable, every typed column of it; the
     sheet itself lists what's been changed, each with a way back. Push sends the
     changes to the queue like any other push: files upload first, then the row is
     re-read (a cell someone changed meanwhile stops it), written and read back. */
  const EDIT_WHERE = { universe: "Universe", collections: "Collections", andon: "ANDON" };
  const EDIT_TITLE = { universe: "Project", collections: "AR Name", andon: "Project" };

  /* The card a row edit travels as (in the queue too), from the row as listed. */
  function editCard(id) {
    const [table, rowId] = String(id).split(":");
    const rec = S.data && (S.data[table] || []).find(r => r.record_id === rowId);
    if (!rec || !EDIT_WHERE[table]) return null;
    const f = rec.fields || {};
    return { kind: "edit", id: `${table}:${rowId}`, table, rowId, code: clean(f["Project Code"]),
             name: clean(f[EDIT_TITLE[table]]) || clean(f["Project"]) || "", notes: [] };
  }
  function openRecord(table, rowId) {
    if (VIEW_ONLY.has(table)) return openView(table, rowId);
    const c = editCard(`${table}:${rowId}`);
    if (c) openSheet(c);
  }

  /* ======================= a source table's row, read-only =======================
     Project Brief, Project Approval and Invoice Request are filled by Lark Approval,
     so a row opened from them is only shown: the whole record, fresh from Lark, as
     a document (its files download), with its approval one click away. */
  const VIEW_ONLY = new Set(["brief", "par", "invoice"]);
  function openView(table, rowId) {
    const rec = S.data && (S.data[table] || []).find(r => r.record_id === rowId);
    if (!rec) return;
    const f = rec.fields || {};
    const req = f["Request No."];
    openSheet({ kind: "view", id: `${table}:${rowId}`, table, rowId, code: clean(f["Project Code"]),
                name: clean(f["Project Name"]), requestNo: plain(req), link: (req && req.link) || "", notes: [] });
  }
  function buildView(body, c) {
    const s = sheet;
    s.done = true;                 // nothing to keep as a draft
    s.blocked = "read-only";
    put(body, c.link ? h("a", { class: "btn btn-sm view-open", href: c.link, target: "_blank", rel: "noopener" },
      `Open ${c.requestNo || "the approval"} in Lark`, ic("external")) : null);
    const load = async () => {
      docBox.replaceChildren(h("div", { class: "loader" }, h("div", { class: "loader-title" }, h("span", { class: "spinner" }), "Reading the row from Lark…")));
      try {
        const rec = await findRecord(ctx.call, ctx.tables[c.table], c.rowId);
        if (sheet !== s) return;
        if (!rec) throw Object.assign(new Error("gone"), { userMessage: "That row isn't in Lark any more. Refresh to see what Lark has now." });
        rowDoc.render(docBox, { table: c.table, loaded: rec.fields || {}, name: c.name, code: c.code });
      } catch (err) {
        if (sheet !== s || isDeadToken(err)) return;
        docBox.replaceChildren(h("div", { class: "callout callout-err" }, ic("alert"), h("div", null, describe(err)),
          h("button", { type: "button", class: "btn btn-sm", onclick: load }, "Try again")));
      }
    };
    load();
  }
  const editCount = (n) => `${n} change${n === 1 ? "" : "s"}`;

  function buildEdit(body, c) {
    const ch = sheet.choices;
    ch.edits = ch.edits || {};
    ch.files = ch.files || [];   // (a draft never keeps files)
    ch.bad = ch.bad || [];
    ch.names = ch.names instanceof Map ? ch.names : new Map();
    const defs = ctx.fieldsOf(c.table);
    const s = sheet;
    let doc = null;
    const list = h("ul", { class: "changes", "aria-label": "Changes to push" });
    const blockNote = h("p", { class: "note", role: "status", hidden: true });
    put(body, h("p", { class: "set-sub" }, "Change any field in the row. Each change is listed here, and nothing goes to Lark until you push."),
      list, blockNote);

    const refresh = () => {
      if (!ch.loaded || !doc) return;
      const changes = editChanges(defs, ch.loaded, ch);
      const n = Object.keys(changes).length;
      const bad = ch.bad.filter(k => k in ch.edits);
      const tooBig = ch.files.map(f => uploadSizeProblem(f, LARK.maxUploadMb)).filter(Boolean);
      s.blocked = !ctx.canWriteFor(`edit:${c.table}`) ? `Pushing to ${EDIT_WHERE[c.table]} is off: ${ctx.problemsFor(`edit:${c.table}`)[0] || "your login can only read the tables."}`
        : s.checking ? "Checking the row against Lark…"
        : bad.length ? `Check ${bad.join(", ")}: ${bad.length === 1 ? "it isn't" : "they aren't"} valid yet.`
        : tooBig.length ? tooBig[0]
        : n ? "" : "Nothing changed yet.";
      go.disabled = s.busy || !!s.blocked;
      if (!s.busy) go.querySelector(".label").textContent = n ? `Push ${editCount(n)}` : "Push changes";
      blockNote.hidden = !s.blocked || !n && !bad.length;
      blockNote.textContent = s.blocked;
      doc.mark(changes);
      // The list: what each field becomes, what it was, and × to put it back.
      const byName = new Map(defs.map(d => [d.field_name, d]));
      list.replaceChildren(...(n ? Object.entries(changes).map(([k, v]) => {
        const def = byName.get(k);
        const before = doc.show(def, ch.loaded[k]), after = doc.show(def, v);
        return h("li", { class: "change" },
          h("button", { type: "button", class: "change-main", title: `Go to ${k}`, onclick: () => doc.focus(k) },
            h("b", null, k),
            h("span", { class: "change-vals" }, before ? h("del", null, before) : null,
              h("span", { class: "change-new" }, after || "(empty)"))),
          h("button", { type: "button", class: "change-undo", "aria-label": `Undo the change to ${k}`, title: "Put it back as it is in Lark",
            onclick: () => { doc.revert(k); refresh(); } }, ic("x")));
      }) : [h("li", { class: "change is-empty" }, "Nothing changed yet. Click a field in the row to change it.")]));
    };
    s.refresh = refresh;

    const draw = () => {
      // A redraw keeps the edits (they're in ch), and the field being typed in.
      const focused = docBox.contains(document.activeElement) ? document.activeElement.id : "";
      const top = docBox.scrollTop;
      doc = rowDoc.renderEdit(docBox, { table: c.table, loaded: ch.loaded, choices: ch, names: ch.names, name: c.name,
                                         peoplePicker, onChange: refresh });
      docBox.scrollTop = top;
      if (focused && document.getElementById(focused)) document.getElementById(focused).focus();
      refresh();
    };

    // The whole row, fresh from Lark (every column, not only the ones the table shows). A table
    // read with every column (ANDON) already has it as listed: that shows at once, and the fresh
    // read only redraws it if Lark has something newer. Push waits for the fresh read either way.
    const load = async () => {
      s.blocked = "Reading the row…";
      s.checking = true;
      go.disabled = true;
      $("#sheetError").hidden = true;
      const listed = Array.isArray((S.columns || {})[c.table]) ? null
        : (S.data && (S.data[c.table] || []).find(r => r.record_id === c.rowId)) || null;
      if (listed) { ch.loaded = listed.fields || {}; draw(); }
      else docBox.replaceChildren(h("div", { class: "loader" }, h("div", { class: "loader-title" }, h("span", { class: "spinner" }), "Reading the row from Lark…")));
      try {
        const rec = await findRecord(ctx.call, ctx.tables[c.table], c.rowId);
        if (sheet !== s) return;   // closed meanwhile
        if (!rec) throw Object.assign(new Error("gone"), { userMessage: "That row isn't in Lark any more. Refresh to see what Lark has now." });
        s.checking = false;
        const fresh = rec.fields || {};
        const same = listed && JSON.stringify(fresh) === JSON.stringify(ch.loaded);
        ch.loaded = fresh;
        if (same) refresh(); else draw();
      } catch (err) {
        s.checking = false;
        if (sheet !== s || isDeadToken(err)) return;
        docBox.replaceChildren(h("div", { class: "callout callout-err" }, ic("alert"), h("div", null, describe(err)),
          h("button", { type: "button", class: "btn btn-sm", onclick: load }, "Try again")));
      }
    };
    load();
  }

  function defaults(c) {
    if (c.kind === "brief") return { vat: defaultVat(c.currency), client: "", bd: [], otherLinks: "", showLinks: false };
    if (c.kind === "invoice") {
      return { targetId: c.target, arName: c.name, invoiceNo: "", siNo: "", invoiceDate: null, invoiceDateOk: true,
               collectionDate: null, collectionDateOk: true, files: [], showDetails: false };
    }
    if (c.kind === "andon") return { pm: [], tribe: "" };
    if (c.kind === "pm") return { pm: c.suggestion.map(u => ({ id: u.id, name: u.name || u.id, email: "" })) };
    if (c.kind === "ce") return { link: c.suggestion || "" };
    if (c.kind === "edit") return { edits: {}, files: [], bad: [], loaded: null };
    if (c.kind === "files") return { files: [] };
    if (c.kind === "audit") return { fields: [...c.gaps], vat: defaultVat(c.brief ? c.brief.currency : "PHP"), values: null, edited: [], bad: [], files: [] };
    return {};
  }

  function openSheet(c, { invalid = false } = {}) {
    const draft = S.drafts.get(draftKey(c) + (invalid ? ":invalid" : ""));
    sheet = {
      card: c,
      choices: draft ? { ...draft.choices } : defaults(c),
      clientToken: draft ? draft.clientToken : newClientToken(),
      targetId: (draft && draft.targetId) || (c.target && c.target.id) || null,
      busy: false, done: false, blocked: "", invalid,
    };
    sheet.choices.invalid = invalid;
    // A draft's row may have gone (the list was refreshed): fall back to the card's default.
    if (c.kind === "invoice" && sheet.choices.targetId !== "new" && !c.targets.some(t => t.id === sheet.choices.targetId)) {
      sheet.choices.targetId = c.target;
    }
    $("#sheetTitle").textContent = { brief: "Push to Universe", par: "Add PAR to Universe", invoice: "Add to Collections", andon: "Add to ANDON",
                                     audit: `Fill blanks in ${c.target === "andon" ? "ANDON" : "the Universe"}`,
                                     edit: `Changes to this ${EDIT_WHERE[c.table]} row`, view: TABLE_TITLES[c.table],
                                     approval: "Add approval to ANDON", pm: "Set the PM in the Universe and ANDON",
                                     ce: "Set the CE link in the Universe and ANDON",
                                     files: `Upload the brief's files to ${c.field}` }[c.kind];
    $("#sheetSub").replaceChildren(copyable(c.code, { label: "project code", empty: "No code" }),
      ...((c.kind === "par" || c.kind === "invoice" || c.kind === "view" || c.kind === "approval") && c.requestNo ? [" · request ", copyable(c.requestNo, { label: "request number" })] : []), ` · ${c.name}`);
    go.querySelector(".label").textContent = { brief: "Push to Universe", par: "Add PAR", invoice: "Add to Collections", andon: "Add to ANDON", audit: "Fill",
                                               edit: "Push changes", approval: "Add approval", pm: "Set PM", ce: "Set CE link",
                                               files: "Upload" }[c.kind];
    $("#sheetError").hidden = true;
    const body = $("#sheetBody");
    body.replaceChildren();
    // A read-only row has nothing to push: just Close.
    go.hidden = c.kind === "view";
    cancel.textContent = c.kind === "view" ? "Close" : "Cancel";
    if (c.kind === "view") buildView(body, c);
    else if (c.kind === "edit") buildEdit(body, c);
    else if (c.kind === "brief") buildBrief(body, c);
    else if (c.kind === "par") buildPar(body, c);
    else if (c.kind === "andon") buildAndon(body, c);
    else if (c.kind === "audit") buildAudit(body, c);
    else if (c.kind === "approval") buildApproval(body, c);
    else if (c.kind === "pm") buildPm(body, c);
    else if (c.kind === "ce") buildCe(body, c);
    else if (c.kind === "files") buildFiles(body, c);
    else buildInvoice(body, c);
    placeDoc();
    if (c.kind !== "view") paintDoc();
    setBusy(false);
    dialog.showModal();
    const first = body.querySelector("input, select, textarea");
    (first || cancel).focus();
  }

  // Busy: a spinner on the button and "Pushing…" (uploads write their progress into the label).
  function setBusy(on) {
    if (sheet) sheet.busy = on;
    busy(go, on, "Pushing…");
    go.disabled = on || !!(sheet && sheet.blocked);
    cancel.disabled = on;
  }

  const put = (parent, ...kids) => parent.append(...kids.filter(Boolean));
  const fieldEl = (labelText, optional, control, id) =>
    h("div", { class: "field" }, h("label", { class: "field-label", for: id }, labelText, optional ? h("em", null, " (optional)") : null), control);

  /* --- brief --- */
  function buildBrief(body, c) {
    const ch = sheet.choices;
    const refresh = paintDoc;
    sheet.refresh = refresh;

    const client = suggestInput({
      id: "sheetClient", value: ch.client, placeholder: "Type or pick a client",
      options: S.clients, onChange: (v) => { ch.client = v; refresh(); },
    });
    const bd = peoplePicker({
      id: "sheetBd", selected: ch.bd, pool: S.pool, placeholder: "Add a BD",
      onChange: (list) => { ch.bd = list; refresh(); },
    });
    const vatSeg = h("div", { class: "chips", role: "radiogroup", "aria-label": "VAT" },
      ["12%", "0%"].map(v => h("button", { type: "button", class: "chip-opt", role: "radio", "aria-checked": String(ch.vat === v),
        onclick: (e) => {
          ch.vat = v;
          for (const b of e.currentTarget.parentElement.children) b.setAttribute("aria-checked", String(b.textContent === v));
          refresh();
        } }, v)));
    radioKeys(vatSeg);
    const said = vatMentions(c.record.fields["Remarks"]);
    const linksBox = h("div", { class: "field" });
    const showLinks = () => {
      const ta = h("textarea", { id: "sheetLinks", rows: "2", placeholder: "Paste links, one per line" });
      ta.value = ch.otherLinks;
      ta.addEventListener("input", () => { ch.otherLinks = ta.value; refresh(); });
      linksBox.replaceChildren(h("label", { class: "field-label", for: "sheetLinks" }, "Other Links", h("em", null, " (optional)")), ta);
      return ta;
    };
    if (ch.showLinks || ch.otherLinks) showLinks();
    else linksBox.replaceChildren(h("button", { type: "button", class: "linkish", onclick: () => { ch.showLinks = true; showLinks().focus(); } },
      ic("plus"), "Add other links"));

    put(body,
      fieldEl("Client", true, client, "sheetClient"),
      fieldEl("BD", true, bd, "sheetBd"),
      h("div", { class: "field" }, h("span", { class: "field-label" }, "VAT"), vatSeg),
      said.length ? h("p", { class: "note" }, `Note: the brief says "${said.join(" ")}"`) : null,
      linksBox);
    refresh();
  }

  /* --- ANDON --- */
  function andonPayload(c, ch) {
    return writableOnly(andonFromBrief(c, ch, RULES, ctx.optionsOf("andon")), ctx.fieldsOf("andon"));
  }
  function buildAndon(body, c) {
    const ch = sheet.choices;
    const refresh = paintDoc;
    sheet.refresh = refresh;
    const pm = peoplePicker({
      id: "sheetPm", selected: ch.pm, pool: S.pmPool, placeholder: "Pick the lead PM", single: true,
      head: "Frequent PMs", onChange: (list) => { ch.pm = list; refresh(); },
    });
    const tribes = ctx.optionsOf("andon").TRIBE || [];
    const tribe = h("select", { id: "sheetTribe" }, h("option", { value: "" }, "Not set"), tribes.map(t => h("option", { value: t }, t)));
    tribe.value = ch.tribe;
    tribe.addEventListener("change", () => { ch.tribe = tribe.value; refresh(); });
    put(body,
      fieldEl("PM (LEAD)", true, pm, "sheetPm"),
      fieldEl("TRIBE", true, h("label", { class: "select" }, tribe), "sheetTribe"));
    refresh();
  }

  /* --- PAR --- */
  /* --- PM: one person for the Universe's PM and ANDON's PM (LEAD). Fill stays off while it's blank. --- */
  function buildPm(body, c) {
    const ch = sheet.choices;
    const refresh = () => {
      sheet.blocked = (ch.pm || []).length ? "" : "PM";
      go.disabled = sheet.busy || !!sheet.blocked;
      paintDoc();
    };
    sheet.refresh = refresh;
    const pool = [...new Map([...(S.pmPool || []), ...S.pool, ...c.universePm, ...c.andonPm.flat()].map(p => [p.id, p])).values()];
    put(body, fieldEl("PM", false, peoplePicker({ id: "sheetPmSync", selected: ch.pm || [], pool, placeholder: "Pick the PM",
      single: true, head: "Frequent PMs", onChange: (list) => { ch.pm = list; refresh(); } }), "sheetPmSync"));
    refresh();
  }

  /* --- CE: one link for the Universe's Internal CE (Sheet) and ANDON's Working CE. Off while it isn't a link. --- */
  function buildCe(body, c) {
    const ch = sheet.choices;
    const input = h("input", { type: "url", id: "sheetCe", autocomplete: "off", placeholder: "https://docs.google.com/spreadsheets/…" });
    input.value = ch.link || "";
    const note = h("p", { class: "note", role: "status", hidden: true });
    const refresh = () => {
      const ok = validLink(ch.link);
      sheet.blocked = ok ? "" : "CE link";
      note.hidden = ok || !String(ch.link || "").trim();
      note.textContent = "Paste the whole link, starting with https://.";
      go.disabled = sheet.busy || !!sheet.blocked;
      paintDoc();
    };
    sheet.refresh = refresh;
    input.addEventListener("input", () => { ch.link = input.value.trim(); refresh(); });
    // Two different links: one click picks either.
    const choices = [...new Set([...c.andonLinks, c.universeLink].filter(Boolean))];
    const pick = choices.length > 1 ? h("div", { class: "ce-picks" }, choices.map(u => h("button", { type: "button", class: "btn btn-sm",
      title: u, onclick: () => { ch.link = u; input.value = u; refresh(); } },
      c.andonLinks.includes(u) ? (u === c.universeLink ? "Use this one" : "Use ANDON's") : "Use the Universe's"))) : null;
    put(body,
      h("p", { class: "set-sub" }, c.universeLink || c.andonLinks.some(Boolean)
        ? "The link goes into both tables. Check it's the right sheet." : "Neither table has the CE yet. Paste the link to its sheet."),
      fieldEl("CE link", false, input, "sheetCe"), pick, note);
    refresh();
  }

  /* --- PAR → ANDON Approval: nothing to choose; the row beside it shows the change. --- */
  function buildApproval(body, c) {
    sheet.refresh = paintDoc;
    put(body, c.link && c.link.link ? h("a", { class: "btn btn-sm view-open", href: c.link.link, target: "_blank", rel: "noopener" },
      `Open ${c.requestNo || "the approval"} in Lark`, ic("external")) : null);
  }

  /* --- the brief's files → the Universe: open them in Lark Approval, download, add here. --- */
  function buildFiles(body, c) {
    const ch = sheet.choices;
    const list = h("ul", { class: "files" });
    const btnText = h("span");
    const blockNote = h("p", { class: "note", role: "status", hidden: true });
    const refresh = () => {
      list.replaceChildren(...ch.files.map((f, i) => h("li", null, ic("link"),
        h("span", { class: "file-name" }, f.name, " ", h("span", { class: "file-size" }, `(${Math.max(1, Math.round(f.size / 1024)).toLocaleString()} KB)`)),
        h("button", { type: "button", "aria-label": `Remove ${f.name}`, onclick: () => { ch.files.splice(i, 1); refresh(); } }, ic("x")))));
      list.hidden = !ch.files.length;
      btnText.textContent = ch.files.length ? "Add another file" : "Add the files";
      const tooBig = ch.files.map(f => uploadSizeProblem(f, LARK.maxUploadMb)).filter(Boolean);
      sheet.blocked = tooBig.join(" ") || (ch.files.length ? "" : "files");
      blockNote.hidden = !tooBig.length;
      blockNote.textContent = tooBig.join(" ");
      go.disabled = sheet.busy || !!sheet.blocked;
      paintDoc();
    };
    sheet.refresh = refresh;
    const input = h("input", { type: "file", multiple: true, hidden: true });
    input.addEventListener("change", () => {
      for (const file of input.files) ch.files.push({ name: file.name, size: file.size, file });
      input.value = "";
      refresh();
    });
    put(body,
      h("a", { class: "btn btn-sm view-open", href: c.link, target: "_blank", rel: "noopener" },
        `Open the brief's ${c.label || "attachments"} in Lark`, ic("external")),
      h("div", { class: "field" }, h("span", { class: "field-label" }, c.field), list,
        h("label", { class: "btn btn-sm file-btn" }, ic("plus"), btnText, input),
        h("p", { class: "set-sub" }, `Up to ${LARK.maxUploadMb} MB each. Uploaded to Lark when the push runs.`)),
      blockNote);
    refresh();
  }

  function buildPar(body, c) {
    const refresh = paintDoc;
    sheet.refresh = refresh;
    if (c.targets.length > 1) {
      const sel = h("select", { id: "sheetTarget" },
        c.targets.map(t => h("option", { value: t.id }, `${t.project || "(no name)"}${t.par ? ` · PAR ${t.par}` : ""}`)));
      sel.value = sheet.targetId;
      sel.addEventListener("change", () => { sheet.targetId = sel.value; refresh(); });
      body.append(fieldEl(`Universe row (${c.targets.length} rows share ${c.code})`, false, h("label", { class: "select" }, sel), "sheetTarget"));
    }
    put(body, c.notes.length ? h("p", { class: "note" }, copyableText(`Note: ${c.notes.join(" ")}`)) : null);
    refresh();
  }

  /* --- invoice (a Collections change) --- */
  // The sheet's title and button, for what the chosen row goes through.
  function verbs(c, action, invalid) {
    if (invalid) return ["Mark as Invalid in Collections", "Mark invalid"];
    if (action === "create") return ["Add to Collections", "Add to Collections"];
    if (action === "link") return ["Add the request number", "Add the number"];
    if (action === "reset") return ["Move back to For Invoicing", "Move back"];
    return c.step === "filed" ? ["Mark as pending approval", "Mark pending"] : ["Move to For Collection", "Move to For Collection"];
  }
  const rowMoney = (row) => (row.amount === null ? "no amount" : fmt.money(row.amount, row.currency));

  function buildInvoice(body, c) {
    const ch = sheet.choices;
    const opts = ctx.collectionOptions();
    const arField = h("div", { class: "field" });
    const blockNote = h("p", { class: "note", role: "status" });
    const details = h("div", { class: "field" });
    // An approved request (its row goes to For Collection) needs the Collection Date.
    const needsDate = () => c.step === "approved" && !ch.invalid;
    const collField = h("div", { class: "field" });
    collField.append(h("label", { class: "field-label", for: "sheetCollDate" }, "Collection Date"),
      dateField({ id: "sheetCollDate", value: ch.collectionDate || null,
                  onChange: (ms, ok) => { ch.collectionDate = ms; ch.collectionDateOk = ok; refresh(); } }));
    const refresh = () => {
      const change = collectionsChange(c, ch, opts, RULES);
      const [title, label] = verbs(c, change.action, ch.invalid);
      $("#sheetTitle").textContent = title;
      if (!sheet.busy) go.querySelector(".label").textContent = label;
      arField.hidden = change.mode !== "create";
      details.hidden = c.step !== "approved";
      collField.hidden = !needsDate();
      const said = (change.mode === "create" && !ch.invalid ? c.noNew : "")
        || (ch.invoiceDateOk === false ? "Invoice Date isn't a date Polaris can read. Try Oct 14, 2026, or double-click it to pick one." : "")
        || (needsDate() && ch.collectionDateOk === false ? "Collection Date isn't a date Polaris can read. Try Oct 14, 2026, or double-click it to pick one." : "");
      // A blank Collection Date just keeps the button off (the empty field says what's missing).
      sheet.blocked = said || (needsDate() && !ch.collectionDate ? "Collection Date" : "");
      blockNote.hidden = !said;
      blockNote.textContent = said;
      go.disabled = sheet.busy || !!sheet.blocked;
      paintDoc();
    };
    sheet.refresh = refresh;

    // Which row, when there's a choice: rows waiting for a request, older rows
    // without a request number, or a new row.
    const rows = [...c.targets.map(t => [t.id, `${t.row.arName || "(no AR name)"} · ${rowMoney(t.row)} · ` +
                    `${t.row.status || "no status"}${t.row.ir ? ` · request ${t.row.ir}` : ""}` +
                    `${t.action === "link" ? " · add the number only" : ""}`]),
                  ...(c.canCreate ? [["new", "New row"]] : [])];
    let picker = null;
    if (rows.length > 1) {
      const sel = h("select", { id: "sheetRow" }, rows.map(([v, text]) => h("option", { value: v }, text)));
      sel.value = ch.targetId;
      sel.addEventListener("change", () => { ch.targetId = sel.value; refresh(); });
      picker = fieldEl("Collections row", false, h("label", { class: "select" }, sel), "sheetRow");
    }
    const ar = h("input", { type: "text", id: "sheetAr", autocomplete: "off" });
    ar.value = ch.arName;
    ar.addEventListener("input", () => { ch.arName = ar.value; refresh(); });
    arField.replaceChildren(h("label", { class: "field-label", for: "sheetAr" }, "AR Name"), ar);

    // Invoice details, once the request is approved and the invoice issued (optional;
    // they can also be added later from the Collections pane).
    const showDetails = () => {
      const text = (id, key, label, placeholder, onInput) => {
        const el = h("input", { type: "text", id, autocomplete: "off", placeholder });
        el.value = ch[key];
        el.addEventListener("input", () => { ch[key] = el.value; onInput(); });
        return fieldEl(label, true, el, id);
      };
      const date = dateField({ id: "sheetInvDate", value: ch.invoiceDate,
        onChange: (ms, ok) => { ch.invoiceDate = ms; ch.invoiceDateOk = ok; refresh(); } });
      const list = h("ul", { class: "files" });
      const paint = () => {
        list.replaceChildren(...ch.files.map((f, i) => h("li", null, ic("link"),
          h("span", { class: "file-name" }, f.name, " ", h("span", { class: "file-size" }, `(${Math.max(1, Math.round(f.size / 1024)).toLocaleString()} KB)`)),
          h("button", { type: "button", "aria-label": `Remove ${f.name}`, onclick: () => { ch.files.splice(i, 1); paint(); } }, ic("x")))));
        refresh();
      };
      const input = h("input", { type: "file", multiple: true, hidden: true });
      input.addEventListener("change", () => { for (const file of input.files) ch.files.push({ name: file.name, size: file.size, file }); input.value = ""; paint(); });
      paint();
      details.replaceChildren(
        h("p", { class: "subhead" }, "Invoice details"),
        text("sheetInvNo", "invoiceNo", "Invoice Number", "e.g. INV-1680", refresh),
        text("sheetSiNo", "siNo", "SI Number", "e.g. 610", refresh),
        fieldEl("Invoice Date", true, date, "sheetInvDate"),
        h("div", { class: "field" }, h("span", { class: "field-label" }, "Invoice", h("em", null, " (optional)")), list,
          h("label", { class: "btn btn-sm file-btn" }, ic("plus"), "Add a file", input),
          h("p", { class: "set-sub" }, `PDF or image, up to ${LARK.maxUploadMb} MB.`)));
      details.style.gap = "12px";
    };
    if (ch.showDetails || ch.invoiceNo || ch.files.length) showDetails();
    else details.replaceChildren(h("button", { type: "button", class: "linkish", onclick: () => {
      ch.showDetails = true; showDetails(); $("#sheetInvNo").focus(); } }, ic("plus"), "Add invoice details"));

    put(body, picker, arField, blockNote,
                c.notes.length ? h("p", { class: "note" }, copyableText(`Note: ${c.notes.join(" ")}`)) : null,
                collField, details);
    refresh();
  }

  /* Invoice details from the sheet, in Lark's write format (files uploaded first,
     their progress reported through onStatus; tokens are kept on the job so a
     retry doesn't upload them twice). */
  async function invoiceDetails(ch, onStatus) {
    const out = {};
    if (ch.invoiceNo.trim()) out["Invoice Number"] = ch.invoiceNo.trim();
    if (ch.siNo.trim()) out["SI Number"] = ch.siNo.trim();
    if (ch.invoiceDate) out["Invoice Date"] = ch.invoiceDate;   // already midnight Manila
    if (ch.collectionDate) out["Collection Date"] = ch.collectionDate;
    await uploadFiles(ch.files, ctx.tables.collections, onStatus);
    if (ch.files.length) out["Invoice"] = ch.files.map(f => ({ file_token: f.file_token }));
    onStatus("Pushing…");
    return out;
  }

  /* Upload the files that don't have a file_token yet to the table's Base (Lark's
     drive upload_all, as you), one at a time, with progress through onStatus. The
     token is kept on each file, so a retry from the queue doesn't upload it twice. */
  async function uploadFiles(files, table, onStatus) {
    const todo = files.filter(f => !f.file_token);
    for (let i = 0; i < todo.length; i++) {
      if (!todo[i].file) {   // a file object only lives in memory: a reload loses it
        throw Object.assign(new Error("lost file"), { userMessage: `“${todo[i].name}” was lost when the page reloaded. Edit the push and add it again.` });
      }
      const what = todo.length > 1 ? `Uploading ${i + 1} of ${todo.length}` : "Uploading";
      onStatus(`${what}…`);
      todo[i].file_token = await uploadToBase(todo[i].file, table, ctx.token(),
        { onProgress: (p) => onStatus(`${what} ${Math.round(p * 100)}%`) });
    }
  }

  /* Push: the sheet closes at once and the write goes to the queue (js/queue.js),
     which runs it exactly as the sheet used to, one at a time. The card leaves the
     list and the next one is ready to review. */
  async function runPush() {
    if (!sheet || sheet.busy || sheet.blocked) return;
    const s = sheet, c = s.card;
    const job = { choices: s.choices, clientToken: s.clientToken, targetId: s.targetId, invalid: !!s.invalid };
    const entry = preview(c, job);
    s.done = true;
    S.drafts.delete(draftKey(c) + (s.invalid ? ":invalid" : ""));
    const el = $(`#cards [data-id="${CSS.escape(c.id)}"]`);
    const nextId = el && el.nextElementSibling && el.nextElementSibling.dataset.id;
    dialog.close();
    ctx.queue.add(c, job, entry);
    if (el) await collapse(el);
    ctx.render();
    // Keyboard and mouse both land on the next card's main button.
    const next = nextId && $(`#cards [data-id="${CSS.escape(nextId)}"]`);
    const nextBtn = next && next.querySelector(".item-actions .btn-tonal:not(:disabled)");
    if (nextBtn) nextBtn.focus({ preventScroll: true });
  }

  /* What a push writes, for the entry card and the queue list: the table, the row
     (null for a new one), the cells, and names for the people in them. Computed
     when Push is pressed; the queue computes the payload again when it runs, from
     what Lark has then. */
  function preview(c, job) {
    const ch = job.choices, names = {};
    const addPeople = (v) => people(v).forEach(u => { names[u.id] = u.name; });
    const record = c.record || (c.brief && c.brief.record);
    if (record) for (const f of ["AM", "MKT", "BD"]) addPeople(record.fields[f]);
    for (const list of [ch.bd, ch.pm]) (list || []).forEach(u => { names[u.id] = u.name; });
    if (ch.names instanceof Map) ch.names.forEach((n, id) => { names[id] = n; });
    const base = { code: c.code || "", name: c.name || "", names };
    if (c.kind === "approval") {
      return { ...base, verb: `Add PAR ${c.requestNo} to ANDON`, table: "andon", rowId: c.rowId, fields: { [c.field]: c.link } };
    }
    if (c.kind === "files") {   // the files picked, by name (the write itself uses the uploaded tokens)
      const n = (ch.files || []).length;
      return { ...base, verb: `Upload ${n} file${n === 1 ? "" : "s"} to ${c.field}`, table: "universe", rowId: c.rowId,
               fields: { [c.field]: (ch.files || []).map(f => ({ name: f.name })) } };
    }
    if (c.kind === "ce") {   // the Universe row beside the sheet (ANDON gets the same)
      const link = validLink(ch.link);
      return { ...base, verb: "Set the CE link in the Universe and ANDON", table: "universe", rowId: c.rowId,
               fields: link ? ceWrites(link, RULES).universe : {} };
    }
    if (c.kind === "pm") {   // the Universe row beside the sheet (ANDON gets the same)
      const p = (ch.pm || [])[0];
      if (p) names[p.id] = p.name;
      return { ...base, verb: "Set the PM in the Universe and ANDON", table: "universe", rowId: c.rowId,
               fields: p ? pmWrites(p, RULES).universe : {} };
    }
    if (c.kind === "edit") {
      const fields = editChanges(ctx.fieldsOf(c.table), ch.loaded || {}, ch);
      const n = Object.keys(fields).length;
      return { ...base, verb: `Change ${n} field${n === 1 ? "" : "s"} in ${EDIT_WHERE[c.table]}`, table: c.table, rowId: c.rowId, fields };
    }
    if (c.kind === "brief") return { ...base, verb: "Push to Universe", table: "universe", rowId: null, fields: universeFromBrief(c, ch, RULES) };
    if (c.kind === "andon") return { ...base, verb: "Add to ANDON", table: "andon", rowId: null, fields: andonPayload(c, ch) };
    if (c.kind === "par") {
      const row = c.targets.find(t => t.id === job.targetId) || c.target;
      return { ...base, verb: `Add PAR ${c.requestNo}`, table: "universe", rowId: row.id,
               fields: { PAR: parAfterAdding(row.par, c.requestNo) || row.par } };
    }
    if (c.kind === "audit") {
      const fields = auditPatch(c, auditRow(c), ch, RULES, auditOpts(c));
      // The signed CE shows by file name (the write itself uses the uploaded tokens).
      for (const k of c.files || []) if (k in fields) fields[k] = (ch.files || []).map(f => ({ name: f.name }));
      // (a lost project's Status change is said apart from the blanks)
      const n = Object.keys(fields).length - ("Status" in fields ? 1 : 0);
      const verb = [n ? `Fill ${n} blank${n === 1 ? "" : "s"}` : "", "Status" in fields ? `${n ? "set" : "Set"} Status to ${fields["Status"]}` : ""]
        .filter(Boolean).join(" and ");
      return { ...base, verb: `${verb} in ${AUDIT_WHERE[c.target]}`, table: c.target, rowId: c.rowId, fields };
    }
    const change = collectionsChange(c, ch, ctx.collectionOptions(), RULES);
    const fields = { ...change.fields };
    if (c.step === "approved") {
      if (ch.invoiceNo && ch.invoiceNo.trim()) fields["Invoice Number"] = ch.invoiceNo.trim();
      if (ch.siNo && ch.siNo.trim()) fields["SI Number"] = ch.siNo.trim();
      if (ch.invoiceDate) fields["Invoice Date"] = ch.invoiceDate;
      if (ch.collectionDate) fields["Collection Date"] = ch.collectionDate;
      if (ch.files && ch.files.length) fields["Invoice"] = ch.files.map(f => ({ name: f.name }));
    }
    return { ...base, verb: verbs(c, change.action, job.invalid)[0], table: "collections",
             rowId: change.mode === "update" ? change.rowId : null, fields };
  }

  /* The write itself, for the queue. Resolves { res, payload, extra }; throws
     the same errors the sheet used to show (AlreadyDone, uncertain, dead token…). */
  async function perform(c, job, { onStatus = () => {} } = {}) {
    let res, payload, extra = {};
    const ch = job.choices;
    if (c.kind === "pm") {
      // Refused here too: one PM, never blank. Both tables are re-read before either is written.
      const p = (ch.pm || [])[0];
      if (!p) throw Object.assign(new Error("required"), { userMessage: "Pick the PM first." });
      const writes = pmWrites(p, RULES);
      const rows = [{ table: "universe", rowId: c.rowId, loaded: c.loaded.universe },
                    ...c.andonRows.map(id => ({ table: "andon", rowId: id, loaded: c.loaded.andon[id] }))];
      payload = writes.universe;
      res = await syncPm(ctx.call, ctx.tables, rows, writes, (t) => ctx.fieldsOf(t));
      return { res, payload, extra: { pmName: p.name } };
    }
    if (c.kind === "ce") {
      // Refused here too: an https link. Both tables are re-read before either is written.
      const link = validLink(ch.link);
      if (!link) throw Object.assign(new Error("required"), { userMessage: "Paste the CE link first (starting with https://)." });
      const writes = ceWrites(link, RULES);
      const rows = [{ table: "universe", rowId: c.rowId, loaded: c.loaded.universe },
                    ...c.andonRows.map(id => ({ table: "andon", rowId: id, loaded: c.loaded.andon[id] }))];
      payload = writes.universe;
      res = await syncPm(ctx.call, ctx.tables, rows, writes, (t) => ctx.fieldsOf(t), "Both already have that CE link.");
      return { res, payload, extra };
    }
    if (c.kind === "files") {
      // Refused here too: at least one file, none too big. They upload first (a failed
      // upload writes nothing; a retry reuses the tokens), then go into the cell only
      // while it's still blank (someone who filled it meanwhile: AlreadyDone).
      const files = ch.files || [];
      if (!files.length) throw Object.assign(new Error("no file"), { userMessage: "Add the files first." });
      const tooBig = files.map(f => uploadSizeProblem(f, LARK.maxUploadMb)).filter(Boolean);
      if (tooBig.length) throw Object.assign(new Error("too big"), { userMessage: tooBig.join(" ") });
      await uploadFiles(files, ctx.tables.universe, onStatus);
      onStatus("Pushing…");
      payload = { [c.field]: files.map(f => ({ file_token: f.file_token })) };
      res = await fillGaps(ctx.call, ctx.tables.universe, c.rowId, payload);
      return { res, payload, extra: { cell: files.map(f => ({ file_token: f.file_token, name: f.name, size: f.size })) } };
    }
    if (c.kind === "approval") {
      // Only into a blank Approval: one someone filled meanwhile is left alone (AlreadyDone).
      payload = { [c.field]: c.link };
      res = await fillGaps(ctx.call, ctx.tables.andon, c.rowId, payload);
      return { res, payload, extra };
    }
    if (c.kind === "edit") {
      // New files upload first (a failed upload writes nothing; a retry reuses the tokens).
      const defs = ctx.fieldsOf(c.table), t = ctx.tables[c.table];
      if ((ch.files || []).length) {
        await uploadFiles(ch.files, t, onStatus);
        onStatus("Pushing…");
      }
      const changes = editChanges(defs, ch.loaded || {}, ch);
      if (!Object.keys(changes).length) throw Object.assign(new Error("nothing"), { userMessage: "There's nothing to change." });
      payload = editWrite(changes, defs);
      res = await saveEdit(ctx.call, t, c.rowId, payload, ch.loaded || {}, defs);
      extra = { changes };
    } else if (c.kind === "brief") {
      payload = universeFromBrief(c, ch, RULES);
      extra = { bd: (ch.bd || []).map(u => ({ id: u.id, name: u.name })) };
      res = await pushBrief(ctx.call, ctx.tables, RULES, c, payload, job.clientToken);
    } else if (c.kind === "andon") {
      payload = andonPayload(c, ch);
      res = await pushAndon(ctx.call, ctx.tables, RULES, c, payload, job.clientToken);
    } else if (c.kind === "par") {
      res = await pushPar(ctx.call, ctx.tables, RULES, c, job.targetId);
    } else if (c.kind === "audit") {
      payload = auditPatch(c, auditRow(c), ch, RULES, auditOpts(c));
      const missing = auditMissing(c, payload);
      if (missing.length) {   // refused here too, not only in the sheet
        throw Object.assign(new Error("required"), { userMessage: requiredMessage(c, missing) });
      }
      const noFile = auditFilesMissing(c, ch);
      if (noFile.length) throw Object.assign(new Error("no file"), { userMessage: `Add the file for ${noFile.join(", ")}.` });
      // The signed CE: upload its files first (a failed upload writes nothing), then
      // the cell gets their tokens, with the rest of the Fill.
      if ((c.files || []).some(k => k in payload)) {
        await uploadFiles(ch.files, ctx.tables[c.target], onStatus);
        payload = auditPatch(c, auditRow(c), ch, RULES, auditOpts(c));
        onStatus("Pushing…");
      }
      if (Object.values(payload).some(v => Array.isArray(v) && v.some(x => x && x.name && !x.file_token))) {
        throw Object.assign(new Error("not uploaded"), { userMessage: "A file didn't upload. Try again." });
      }
      // A changed Status isn't a blank: it's written only if the row still says what the card showed.
      res = await fillGaps(ctx.call, ctx.tables[c.target], c.rowId, payload, "Status" in payload ? { Status: c.status } : {});
    } else {
      const change = collectionsChange(c, { ...ch, invalid: job.invalid }, ctx.collectionOptions(), RULES);
      // Refused here too, not only in the sheet: an approved request needs its Collection Date.
      if (c.step === "approved" && !job.invalid && !ch.collectionDate) {
        throw Object.assign(new Error("required"), { userMessage: "An approved invoice needs its Collection Date." });
      }
      if (c.step === "approved") Object.assign(change.fields, await invoiceDetails(ch, onStatus));
      payload = change.fields;
      const t = c.targets.find(x => x.id === change.rowId);
      extra = { action: change.action, rowName: t ? t.row.arName : payload["AR Name"] };
      res = await pushCollections(ctx.call, ctx.tables, RULES, c, change, job.clientToken);
    }
    return { res, payload, extra };
  }

  /* Open the sheet again for a queued push (Edit in the queue), with what was chosen. */
  function reopen(c, job) {
    S.drafts.set(draftKey(c) + (job.invalid ? ":invalid" : ""),
                 { choices: job.choices, clientToken: job.clientToken, targetId: job.targetId });
    openSheet(c, { invalid: job.invalid });
  }

  /* ======================= small inputs ======================= */

  /* A suggestion list floats over the page under its field (above it when there's
     no room below), so the form's scrolling body and rounded card don't clip it.
     It follows the field while anything scrolls or the window resizes. */
  function floatList(list, anchor) {
    let on = false;
    const place = () => {
      if (list.hidden) return;
      const r = anchor.getBoundingClientRect();
      const below = innerHeight - r.bottom - 12, above = r.top - 12;
      const up = below < 200 && above > below;
      Object.assign(list.style, { position: "fixed", right: "auto", left: `${r.left}px`, width: `${r.width}px`,
        maxHeight: `${Math.max(120, Math.min(248, (up ? above : below) - 6))}px`,
        top: up ? "auto" : `${r.bottom + 6}px`, bottom: up ? `${innerHeight - r.top + 6}px` : "auto" });
      // Inside a transformed parent (the dialog while it animates in) "fixed" is
      // measured from that parent: move it by however far off it landed.
      const got = list.getBoundingClientRect();
      const dx = got.left - r.left, dy = up ? got.bottom - (r.top - 6) : got.top - (r.bottom + 6);
      if (dx || dy) {
        list.style.left = `${r.left - dx}px`;
        if (up) list.style.bottom = `${innerHeight - r.top + 6 + dy}px`; else list.style.top = `${r.bottom + 6 - dy}px`;
      }
    };
    return {
      open() { place(); if (!on) { on = true; addEventListener("scroll", place, true); addEventListener("resize", place); } },
      close() { if (on) { on = false; removeEventListener("scroll", place, true); removeEventListener("resize", place); } },
    };
  }

  /* A text input with suggestions (free text allowed). */
  function suggestInput({ id, value, placeholder, options, onChange }) {
    const input = h("input", { type: "text", id, autocomplete: "off", placeholder, role: "combobox",
                               "aria-autocomplete": "list", "aria-expanded": "false" });
    input.value = value || "";
    const list = h("ul", { class: "suggest", role: "listbox", hidden: true });
    const wrap = h("div", { class: "picker" }, input, list);
    const float = floatList(list, input);
    let items = [], active = -1;
    const close = () => { list.hidden = true; float.close(); input.setAttribute("aria-expanded", "false"); active = -1; };
    const pick = (v) => { input.value = v; onChange(v); close(); };
    const show = () => {
      const q = input.value.trim().toLowerCase();
      items = q ? options.filter(o => o.toLowerCase().includes(q) && o.toLowerCase() !== q).slice(0, 8) : [];
      active = -1;
      list.replaceChildren(...items.map((o, i) => h("li", { role: "option", "aria-selected": "false",
        onmousedown: (e) => { e.preventDefault(); pick(o); } }, o)));
      list.hidden = !items.length;
      if (items.length) float.open(); else float.close();
      input.setAttribute("aria-expanded", String(!!items.length));
    };
    input.addEventListener("input", () => { onChange(input.value); show(); });
    input.addEventListener("blur", close);
    input.addEventListener("keydown", (e) => keyNav(e, list, () => items.length, (i) => { active = i; return active; },
      () => active, () => { if (active >= 0) pick(items[active]); }, close));
    return wrap;
  }

  /* People as chips, picked from everyone seen in the Universe and on briefs. */
  function peoplePicker({ id, selected, pool, placeholder, onChange, single = false, head = "Frequent BDs" }) {
    const chosen = [...selected];
    const input = h("input", { type: "text", id, autocomplete: "off", placeholder, role: "combobox",
                               "aria-autocomplete": "list", "aria-expanded": "false" });
    const chips = h("span", { class: "picker-chips" });
    // The list opens on a click or typing, not on focus: the sheet focuses its first field as it opens.
    const box = h("div", { class: "picker-box", onclick: () => { input.focus(); show(); } }, chips, input);
    const list = h("ul", { class: "suggest", role: "listbox", hidden: true });
    const wrap = h("div", { class: "picker" }, box, list);
    const float = floatList(list, box);
    let items = [], active = -1;

    const paintChips = () => chips.replaceChildren(...chosen.map((p, i) => h("span", { class: "chip" }, p.name,
      h("button", { type: "button", "aria-label": `Remove ${p.name}`, onclick: (e) => {
        e.stopPropagation(); chosen.splice(i, 1); paintChips(); onChange([...chosen]); input.focus();
      } }, ic("x")))));
    const close = () => { list.hidden = true; float.close(); input.setAttribute("aria-expanded", "false"); active = -1; };
    const add = (p) => {
      if (single) chosen.length = 0;
      if (!chosen.some(x => x.id === p.id)) chosen.push({ id: p.id, name: p.name, email: p.email });
      // Picked: the list closes (it would cover the button below) until the box is clicked again.
      input.value = ""; paintChips(); onChange([...chosen]); close();
    };
    const show = () => {
      const q = input.value.trim().toLowerCase();
      const free = pool.filter(p => !chosen.some(x => x.id === p.id));
      items = q ? free.filter(p => `${p.name} ${p.email}`.toLowerCase().includes(q)).slice(0, 8)
                : free.filter(p => p.bdCount > 0).slice(0, 6);
      active = -1;
      list.replaceChildren(...[
        !q && items.length ? h("li", { class: "suggest-head", role: "presentation" }, head) : null,
        ...items.map((p) => h("li", { role: "option", "aria-selected": "false",
          onmousedown: (e) => { e.preventDefault(); add(p); } }, p.name, p.email ? h("small", null, p.email) : null)),
        q && !items.length ? h("li", { class: "suggest-head", role: "presentation" }, "No one by that name") : null,
      ].filter(Boolean));
      list.hidden = !list.children.length;
      if (list.hidden) float.close(); else float.open();
      input.setAttribute("aria-expanded", String(!list.hidden));
    };
    input.addEventListener("input", show);
    input.addEventListener("blur", close);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !input.value && chosen.length) { chosen.pop(); paintChips(); onChange([...chosen]); return; }
      if (e.key === "ArrowDown" && list.hidden) { e.preventDefault(); show(); return; }
      keyNav(e, list, () => items.length, (i) => { active = i; return active; }, () => active,
        () => { if (active >= 0) add(items[active]); else if (items.length === 1) add(items[0]); }, close);
    });
    paintChips();
    return wrap;
  }

  /* Arrow keys move through suggestions, Enter picks, Escape closes the list
     (and only the list: the sheet stays open). */
  function keyNav(e, list, count, setActive, getActive, choose, close) {
    const opts = [...list.querySelectorAll('[role="option"]')];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!count()) return;
      e.preventDefault();
      const next = e.key === "ArrowDown" ? Math.min(getActive() + 1, count() - 1) : Math.max(getActive() - 1, 0);
      setActive(next);
      opts.forEach((o, i) => o.setAttribute("aria-selected", String(i === next)));
      opts[next] && opts[next].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose();
    } else if (e.key === "Escape" && !list.hidden) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  return { render, renderLoader, perform, preview, reopen, keyOf: draftKey, openRecord, editCard };
}
