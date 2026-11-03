/* The row beside the push sheet: the Lark row the push changes (or creates),
   laid out as a filled-in document, so what's there can be compared with what
   the sheet will write. It re-renders as the sheet changes. Cells the push
   changes are highlighted, with the old value struck through; blank cells stay
   empty. Lookups and formulas show what Lark has (a new row has none yet). A new
   row has nothing to compare, so nothing is highlighted. */

import { h, ic } from "./ui.js";
import { plain, cellText, canEditField, writeValueOf, people } from "./sync.js";
import { computedTypes, TABLE_TITLES, selectOptions } from "./ops.js";
import { RULES, LARK } from "./config.js";
import { dateField } from "./polaris-ui.js";

const TITLE_FIELD = { universe: "Project", andon: "Project", collections: "AR Name",
                      brief: "Project Name", par: "Project Name", invoice: "Project Name" };
const LONG = /description|remarks|links|notes/i;

export function createRowDoc(ctx) {
  const { S } = ctx;
  const kb = (n) => (n ? h("span", { class: "file-size" }, ` (${Math.max(1, Math.round(n / 1024)).toLocaleString()} KB)`) : null);

  /* A file already in Lark, as a button that downloads it (ctx.downloadFile). */
  function fileButton(table, f) {
    return h("button", { type: "button", class: "file-dl", title: `Download ${f.name || "this file"}`,
                         onclick: (e) => ctx.downloadFile(table, f, e.currentTarget) },
      ic("download"), h("span", { class: "file-name" }, f.name || "file", kb(f.size)));
  }
  const fileList = (table, files) => h("ul", { class: "files" }, files.map(f => h("li", null, fileButton(table, f))));
  const inLark = (v) => Array.isArray(v) && v.length > 0 && v.every(f => f && f.file_token);
  const linkOf = (d, v) => (d && d.type === 15 && v && typeof v.link === "string" && /^https:\/\//.test(v.link) ? v.link : "");

  /* p: { table, rowId, fields (what the push writes), names, code, name }, or for a
     row read fresh from Lark, shown as it is (a source table's record): { table,
     loaded (its fields), kicker }. Every column then, since all of them were read. */
  function render(box, p) {
    const rec = p.loaded ? { fields: p.loaded } : p.rowId ? (S.data[p.table] || []).find(r => r.record_id === p.rowId) : null;
    const now = rec ? rec.fields : {};
    const writes = p.fields || {};
    const names = p.names || {};
    const nameOf = (id) => names[id] || ((S.pool || []).find(u => u.id === id) || {}).name
      || ((S.pmPool || []).find(u => u.id === id) || {}).name || "";
    const show = (def, v) => cellText(def, v, { nameOf, offsetHours: RULES.utcOffsetHours });
    // Only columns Polaris read (null: all), so nothing looks blank just because it wasn't loaded.
    const read = p.loaded ? null : (S.columns || {})[p.table];
    const known = Array.isArray(read) ? new Set(read) : null;
    const defs = ctx.fieldsOf(p.table).filter(d => {
      const k = d.field_name;
      if (d.type === 7 && /^ignore$/i.test(k)) return false;          // Polaris's own flag, not row data
      if (!rec && computedTypes.has(d.type)) return false;            // Lark fills these once the row exists
      return k in writes || !known || known.has(k);
    });
    const value = (k) => show(defs.find(d => d.field_name === k), k in writes ? writes[k] : now[k]);

    const fields = defs.map((d) => {
      const k = d.field_name;
      const before = show(d, now[k]);
      const after = k in writes ? show(d, writes[k]) : before;
      const changed = !!rec && after !== before;
      const wide = d.type === 17 || LONG.test(k) || after.length > 48 || after.includes("\n");
      // Files already in Lark download from here; ones a push is adding show by name.
      const files = d.type === 17 && !changed && inLark(now[k]);
      // A link (a request number, "1 attachment(s)") opens where it points, in Lark Approval.
      const href = linkOf(d, k in writes ? writes[k] : now[k]);
      return h("div", { class: `doc-field${wide ? " is-wide" : ""}${changed ? " is-change" : ""}${files ? " is-files" : ""}` },
        h("dt", null, k),
        h("dd", null, files ? fileList(p.table, now[k]) : [changed && before ? h("del", null, before) : null,
          href && after ? h("a", { href, target: "_blank", rel: "noopener" }, after) : after]));
    });

    const title = value(TITLE_FIELD[p.table]) || p.name || "";
    const meta = [p.code || value("Project Code"), value("Status")].filter(Boolean).join(" · ");
    box.replaceChildren(
      h("header", { class: "doc-head" },
        h("p", { class: "doc-kicker" }, p.kicker || (rec ? TABLE_TITLES[p.table] : `${TABLE_TITLES[p.table]} · New row`)),
        h("h3", null, plain(title) || "(no name)"),
        meta ? h("p", { class: "doc-meta" }, meta) : null),
      h("div", { class: "doc-body" }, h("dl", { class: "doc-fields" }, fields)));
  }

  /* ======================= the row, editable (the row editor) =======================
     Every column of the row, each with an editor that fits its type. What Lark works
     out itself (formulas, lookups, links, auto fields) and types Polaris can't write
     are shown locked. Built once; editors report through onChange and the sheet's
     list of changes repaints, so typing never loses focus.
     p: { table, loaded (the row's fields, read format), choices ({edits, files, bad}),
          names (Map id → name), name, peoplePicker, onChange() }
     Returns { mark(changes), revert(field), focus(field), show(def, value) }. */
  function renderEdit(box, p) {
    const { table, loaded, choices } = p;
    const defs = ctx.fieldsOf(table);
    const nameOf = (id) => p.names.get(id) || ((S.pool || []).find(u => u.id === id) || {}).name
      || ((S.pmPool || []).find(u => u.id === id) || {}).name || "";
    const show = (def, v) => cellText(def, v, { nameOf, offsetHours: RULES.utcOffsetHours });
    const current = (def) => (def.field_name in choices.edits ? choices.edits[def.field_name] : writeValueOf(def, loaded[def.field_name]));
    // Everyone the people pickers can offer: the row's own people, then the usual pools.
    const pool = (() => {
      const m = new Map();
      for (const d of defs) if (d.type === 11) people(loaded[d.field_name]).forEach(u => m.set(u.id, { ...u, bdCount: 0 }));
      for (const u of [...(S.pool || []), ...(S.pmPool || [])]) if (!m.has(u.id) || u.bdCount) m.set(u.id, u);
      m.forEach(u => p.names.set(u.id, u.name));
      return [...m.values()];
    })();

    const set = (k, v, ok = true) => {
      choices.edits[k] = v;
      choices.bad = ok ? (choices.bad || []).filter(x => x !== k) : [...new Set([...(choices.bad || []), k])];
      p.onChange();
    };
    const fieldEls = new Map();

    function editor(def) {
      const k = def.field_name, id = `edit-${def.field_id || k.replace(/\W+/g, "-")}`, v = current(def);
      const type = def.type;
      if (type === 5) return dateField({ id, value: v, onChange: (ms, ok) => set(k, ms, ok) });
      if (type === 7) {
        const box = h("input", { type: "checkbox", id });
        box.checked = v === true;
        box.addEventListener("change", () => set(k, box.checked));
        return h("label", { class: "edit-check", for: id }, box, "Ticked");
      }
      if (type === 3) {
        const opts = selectOptions(def);
        const sel = h("select", { id }, h("option", { value: "" }, "Not set"),
          [...opts, ...(v && !opts.includes(v) ? [v] : [])].map(o => h("option", { value: o }, o)));
        sel.value = v || "";
        sel.addEventListener("change", () => set(k, sel.value || null));
        return h("label", { class: "select" }, sel);
      }
      if (type === 4) {
        const now = new Set(Array.isArray(v) ? v : []);
        const opts = [...new Set([...selectOptions(def), ...now])];
        return h("div", { class: "chips", role: "group", "aria-label": k }, opts.map(o =>
          h("button", { type: "button", class: "chip-opt", "aria-pressed": String(now.has(o)), onclick: (e) => {
            if (now.has(o)) now.delete(o); else now.add(o);
            e.currentTarget.setAttribute("aria-pressed", String(now.has(o)));
            set(k, now.size ? opts.filter(x => now.has(x)) : null);
          } }, o)));
      }
      if (type === 11) {
        const chosen = (Array.isArray(v) ? v : []).map(u => ({ id: u.id, name: nameOf(u.id) || u.id, email: "" }));
        return p.peoplePicker({ id, selected: chosen, pool, placeholder: "Add someone", head: "Frequent people",
          single: !!(def.property && def.property.multiple === false),
          onChange: (list) => { list.forEach(u => p.names.set(u.id, u.name)); set(k, list.length ? list.map(u => ({ id: u.id })) : null); } });
      }
      if (type === 2) {
        const el = h("input", { type: "text", id, inputmode: "decimal", autocomplete: "off" });
        el.value = v ?? "";
        el.addEventListener("input", () => {
          const t = el.value.replace(/[₱$,\s]/g, "");
          const n = t === "" ? null : Number(t);
          el.setAttribute("aria-invalid", String(Number.isNaN(n)));
          set(k, Number.isNaN(n) ? current(def) : n, !Number.isNaN(n));
        });
        return el;
      }
      if (type === 15) {
        const el = h("input", { type: "url", id, autocomplete: "off", placeholder: "https://…" });
        el.value = (v && v.link) || "";
        el.addEventListener("input", () => { const link = el.value.trim(); set(k, link ? { link, text: link } : null); });
        return el;
      }
      if (type === 17) return filesEditor(def, id);
      const long = LONG.test(k) || String(v || "").length > 60 || String(v || "").includes("\n");
      const el = h(long ? "textarea" : "input", long ? { id, rows: "3" } : { type: "text", id, autocomplete: "off" });
      el.value = v ?? "";
      el.addEventListener("input", () => set(k, el.value));
      return el;
    }

    // An attachment: the files it keeps (× takes one out) and new ones, uploaded when the push runs.
    function filesEditor(def, id) {
      const k = def.field_name;
      const list = h("ul", { class: "files" });
      const paint = () => {
        const kept = current(def) || [];
        const fresh = choices.files.filter(f => f.field === k);
        list.replaceChildren(
          ...kept.map((f, i) => h("li", null, f.file_token ? fileButton(table, f) : [ic("link"), h("span", { class: "file-name" }, f.name, kb(f.size))],
            h("button", { type: "button", "aria-label": `Remove ${f.name}`, title: "Remove", onclick: () => {
              const next = kept.filter((_, j) => j !== i);
              set(k, next.length ? next : null);
              paint();
            } }, ic("x")))),
          ...fresh.map((f) => h("li", null, ic("link"), h("span", { class: "file-name" }, f.name, kb(f.size)),
            h("span", { class: "is-new-file" }, "new"),
            h("button", { type: "button", "aria-label": `Remove ${f.name}`, title: "Remove", onclick: () => {
              choices.files.splice(choices.files.indexOf(f), 1);
              p.onChange();
              paint();
            } }, ic("x")))));
        list.hidden = !list.children.length;
      };
      const input = h("input", { type: "file", id, multiple: true, hidden: true });
      input.addEventListener("change", () => {
        for (const file of input.files) choices.files.push({ field: k, name: file.name, size: file.size, file });
        input.value = "";
        p.onChange();
        paint();
      });
      paint();
      return h("div", { class: "edit-files" }, list,
        h("label", { class: "btn btn-sm file-btn" }, ic("plus"), "Add files", input),
        h("p", { class: "set-sub" }, `Up to ${LARK.maxUploadMb} MB each. Uploaded to Lark when the push runs.`));
    }

    const LOCKED = { 18: "Link", 19: "Lookup", 20: "Formula", 21: "Link", 24: "Stage", 1001: "Created", 1002: "Modified",
                     1003: "Created by", 1004: "Modified by", 1005: "Auto number" };
    function fieldEl(def) {
      const k = def.field_name;
      const was = h("p", { class: "doc-was", hidden: true });
      const editable = canEditField(def);
      const what = LOCKED[def.type] || def.ui_type || "Read-only";
      const dd = editable ? h("dd", { class: "is-edit" }, editor(def))
        : h("dd", { class: "is-locked", title: computedTypes.has(def.type)
            ? `Lark works this out (${what}), so it can't be changed here.` : `${what} columns can't be changed from Polaris.` },
            def.type === 17 && inLark(loaded[k]) ? fileList(table, loaded[k]) : show(def, loaded[k]));
      const wide = def.type === 17 || def.type === 4 || LONG.test(k) || String(plain(loaded[k])).length > 48;
      const el = h("div", { class: `doc-field${wide ? " is-wide" : ""}${editable ? "" : " is-locked"}`, "data-field": k },
        h("dt", null, k, editable ? null : h("span", { class: "doc-tag" }, what)),
        dd, was);
      fieldEls.set(k, { el, def, was });
      return el;
    }

    box.replaceChildren(
      h("header", { class: "doc-head" },
        h("p", { class: "doc-kicker" }, `${TABLE_TITLES[table]} · Editing`),
        h("h3", null, plain(loaded[TITLE_FIELD[table]]) || p.name || "(no name)"),
        h("p", { class: "doc-meta" }, [plain(loaded["Project Code"]), plain(loaded["Status"])].filter(Boolean).join(" · "))),
      h("div", { class: "doc-body" }, h("dl", { class: "doc-fields" }, defs.map(fieldEl))));

    return {
      // Highlight what changes, with what Lark has now under it.
      mark(changes) {
        for (const [k, { el, def, was }] of fieldEls) {
          const on = k in changes;
          el.classList.toggle("is-change", on);
          was.hidden = !on;
          if (on) was.textContent = `Was: ${show(def, loaded[k]) || "(empty)"}`;
        }
      },
      // Put a field back as Lark has it.
      revert(k) {
        const f = fieldEls.get(k);
        delete choices.edits[k];
        choices.files = choices.files.filter(x => x.field !== k);
        choices.bad = (choices.bad || []).filter(x => x !== k);
        if (f) f.el.querySelector("dd").replaceChildren(editor(f.def));
      },
      focus(k) {
        const f = fieldEls.get(k);
        if (!f) return;
        f.el.scrollIntoView({ block: "center", behavior: "smooth" });
        const input = f.el.querySelector("dd input:not([type=file]):not(.date-pick), dd select, dd textarea, dd button");
        if (input) input.focus({ preventScroll: true });
      },
      show,
    };
  }

  return { render, renderEdit };
}
