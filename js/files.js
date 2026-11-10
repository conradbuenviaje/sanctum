/* The Files page (topbar, after Tagging): the files kept in Lark, to download many at once.

   - Universe: every project with a Signed CE (PDF) or Other Attachments file.
   - Collections: every row with an Invoice file.
   - Approvals: the briefs, PARs and invoice requests whose attachments are in Lark
     Approval. Those open there (Polaris can't download them), so they're links.

   Clicking a Universe or Collections row (or its box) puts it in the download list on
   the right; "Select all" takes every row the search shows. Download zip fetches each
   file through the connection service, as the person (like a row's own download
   button), and saves one zip, the files renamed
   {prefix}_{project code}_{project name}_{n}.{ext} (sync.js zipEntries). Nothing is
   written to Lark. */

import { RULES, LARK } from "./config.js";
import { fileRows, zipEntries, approvalColumns, approvalFileRows, filesMatch, attachmentRequest } from "./sync.js";
import { createZip, ZIP_MAX_FILES } from "./zip.js";
import { $, h, ic, toast, fmt, busy } from "./ui.js";
import { copyableText } from "./polaris-ui.js";
import { describe, isDeadToken, downloadFromBase } from "./net.js";

const SECTIONS = [
  { key: "universe", label: "Universe" },
  { key: "collections", label: "Collections" },
  { key: "approvals", label: "Approvals" },
];
const APPROVALS = [
  { key: "brief", label: "Project Brief" },
  { key: "par", label: "Project Approval" },
  { key: "invoice", label: "Invoice Request" },
];
const MAX_ZIP_BYTES = 2 * 1024 ** 3;   // well under zip's 4 GB, and what a browser tab can hold
const PARALLEL = 3;                     // files fetched at once

const kb = (n) => (n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : n ? `${Math.max(1, Math.round(n / 1024))} KB` : "");

export function createFiles(ctx) {
  const { S } = ctx;
  const G = {
    section: "universe", approval: "brief", query: "",
    cart: new Map(),                    // "table:rowId" → row (as fileRows gives it)
    off: new Set(),                     // file kinds (prefixes) left out of the zip
    run: null,                          // { done, total, failed: [], cancel } while downloading
  };
  $("#filesSearch").addEventListener("input", (e) => { G.query = e.target.value; render(); });

  const keyOf = (r) => `${r.table}:${r.id}`;

  function rowsOf(section) {
    if (!S.data) return [];
    if (section === "universe") return fileRows("universe", S.data.universe, RULES);
    if (section === "collections") return fileRows("collections", S.data.collections, RULES, { universe: S.data.universe });
    return [];
  }

  function render() {
    const view = $("#filesView"), sub = $("#filesSub"), loader = $("#filesLoader");
    loader.hidden = !(!S.data && S.loading);
    if (!loader.hidden) loader.replaceChildren(h("div", { class: "loader-title" }, h("span", { class: "spinner" }), "Loading the tables…"));
    if (!S.data || !S.data.universe) {
      view.replaceChildren(S.loadError && !S.loading ? h("div", { class: "callout callout-err" }, ic("alert"), h("div", null, describe(S.loadError)),
        h("button", { type: "button", class: "btn btn-sm", onclick: () => ctx.loadData() }, "Try again")) : "");
      sub.textContent = "";
      return;
    }
    // Rows that left Lark (or lost their files) leave the list too.
    const live = new Map([...rowsOf("universe"), ...rowsOf("collections")].map(r => [keyOf(r), r]));
    for (const k of [...G.cart.keys()]) { if (live.has(k)) G.cart.set(k, live.get(k)); else if (!G.run) G.cart.delete(k); }

    const uni = rowsOf("universe"), col = rowsOf("collections");
    const count = (rows) => rows.reduce((n, r) => n + r.files.length, 0);
    sub.textContent = `${uni.length.toLocaleString()} projects with ${count(uni).toLocaleString()} files · ` +
      `${col.length.toLocaleString()} Collections rows with ${count(col).toLocaleString()} invoices`;

    const seg = h("div", { class: "seg files-seg", role: "radiogroup", "aria-label": "Which files" },
      SECTIONS.map(s => h("button", { type: "button", role: "radio", "aria-checked": String(G.section === s.key),
        onclick: () => { G.section = s.key; render(); } }, s.label)));

    if (G.section === "approvals") {
      view.replaceChildren(seg, approvalsEl());
      return;
    }
    const rows = (G.section === "universe" ? uni : col).filter(r => filesMatch(r, G.query));
    view.replaceChildren(seg, h("div", { class: "files-grid" }, tableEl(rows), cartEl()));
  }

  /* ---- Universe / Collections: the rows with files ---- */
  function tableEl(rows) {
    const picked = rows.filter(r => G.cart.has(keyOf(r))).length;
    const all = h("input", { type: "checkbox", id: "filesAll", disabled: !rows.length || !!G.run });
    all.checked = rows.length > 0 && picked === rows.length;
    all.indeterminate = picked > 0 && picked < rows.length;
    all.addEventListener("change", () => {
      for (const r of rows) { if (all.checked) G.cart.set(keyOf(r), r); else G.cart.delete(keyOf(r)); }
      render();
    });
    const what = G.section === "universe" ? "project" : "row";
    const bar = h("div", { class: "files-bar" },
      h("label", { class: "check", for: "filesAll" }, all,
        h("span", null, G.query.trim() ? `Select all ${rows.length.toLocaleString()} found` : `Select all ${rows.length.toLocaleString()} ${what}${rows.length === 1 ? "" : "s"}`)),
      picked ? h("span", { class: "muted small" }, `${picked.toLocaleString()} selected here`) : null);

    const cols = G.section === "universe"
      ? ["", "Project Code", "Project", "Status", "Signed CE", "Other attachments"]
      : ["", "Project Code", "Project", "Status", "Invoices"];
    const fileList = (r, prefix) => {
      const list = r.files.filter(x => x.prefix === prefix);
      if (!list.length) return h("span", { class: "none" }, "—");
      return h("ul", { class: "files-names" }, list.map(x => h("li", null,
        h("button", { type: "button", class: "file-link", title: `Download “${x.file.name}” on its own`,
          onclick: (e) => { e.stopPropagation(); ctx.downloadFile(r.table, x.file, e.currentTarget); } },
          ic("download"), h("span", { class: "file-name" }, x.file.name || "file"), h("span", { class: "muted" }, kb(Number(x.file.size) || 0))))));
    };
    const body = rows.map(r => {
      const on = G.cart.has(keyOf(r));
      const box = h("input", { type: "checkbox", "aria-label": `Add ${r.code || r.name} to the download`, disabled: !!G.run });
      box.checked = on;
      const toggle = () => { if (G.run) return; if (G.cart.has(keyOf(r))) G.cart.delete(keyOf(r)); else G.cart.set(keyOf(r), r); render(); };
      box.addEventListener("change", toggle);
      const tr = h("tr", { class: "files-row" + (on ? " is-picked" : ""), tabIndex: 0, "aria-selected": String(on) },
        h("td", { class: "c-pick" }, box),
        h("td", { class: "c-code" }, r.code ? copyableText(r.code) : h("span", { class: "none" }, "No code")),
        h("td", { class: "c-project" }, h("div", null, r.name || h("span", { class: "none" }, "(no name)")),
          r.sub ? h("div", { class: "muted small" }, r.sub) : null),
        h("td", { class: "c-status" }, r.status),
        ...(G.section === "universe" ? [h("td", null, fileList(r, "signed_ce")), h("td", null, fileList(r, "other"))]
          : [h("td", null, fileList(r, "invoice"))]));
      tr.addEventListener("click", (e) => {
        if (e.target.closest("button, a, input, label") || String(getSelection() || "").trim()) return;
        toggle();
      });
      tr.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === tr) { e.preventDefault(); toggle(); } });
      return tr;
    });
    return h("div", { class: "files-main" }, bar,
      h("div", { class: "tbl-wrap" },
        h("table", { class: "tbl uni files-tbl" }, h("thead", null, h("tr", null, cols.map(c => h("th", { scope: "col" }, c)))), h("tbody", null, body)),
        rows.length ? null : h("div", { class: "empty small" }, h("p", null, G.query.trim() ? "No rows match." : "No files here yet."))));
  }

  /* ---- the download list ---- */
  function cartEl() {
    const rows = [...G.cart.values()];
    const kinds = [...RULES.filesPage.universe, ...RULES.filesPage.collections]
      .filter(c => rows.some(r => r.files.some(x => x.prefix === c.prefix)));
    const entries = zipEntries(rows, { prefixes: kinds.map(k => k.prefix).filter(p => !G.off.has(p)) });
    const bytes = entries.reduce((n, e) => n + e.size, 0);
    const tooBig = bytes > MAX_ZIP_BYTES || entries.length > ZIP_MAX_FILES;
    const run = G.run;

    const head = h("div", { class: "cart-head" }, h("h2", null, ic("download"), "Download"),
      rows.length && !run ? h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => { G.cart.clear(); render(); } }, "Clear") : null);
    if (!rows.length) {
      return h("aside", { class: "card files-cart", "aria-label": "Download list" }, head,
        h("p", { class: "muted small" }, "Click a row to add its files. They download together as one zip, renamed like ",
          h("code", null, "signed_ce_2026TEG-P0001_Project_1.pdf"), "."));
    }
    const list = h("ul", { class: "cart-list" }, rows.map(r => {
      const n = r.files.filter(x => !G.off.has(x.prefix)).length;
      return h("li", null,
        h("div", { class: "cart-what" }, h("b", { class: "cart-code" }, r.code || "No code"), h("span", null, r.name || "(no name)")),
        h("span", { class: "muted small" }, `${n} file${n === 1 ? "" : "s"}`),
        run ? null : h("button", { type: "button", class: "icon-btn icon-sm", "aria-label": `Take ${r.code || r.name} out`, title: "Take it out",
          onclick: () => { G.cart.delete(keyOf(r)); render(); } }, ic("x")));
    }));
    const kindBoxes = kinds.length > 1 ? h("fieldset", { class: "cart-kinds" }, h("legend", { class: "small muted" }, "Include"),
      kinds.map(k => {
        const box = h("input", { type: "checkbox", disabled: !!run });
        box.checked = !G.off.has(k.prefix);
        box.addEventListener("change", () => { if (box.checked) G.off.delete(k.prefix); else G.off.add(k.prefix); render(); });
        return h("label", { class: "check" }, box, h("span", null, k.label));
      })) : null;
    const total = h("p", { class: "cart-total" }, h("b", null, `${entries.length.toLocaleString()} file${entries.length === 1 ? "" : "s"}`),
      ` from ${rows.length.toLocaleString()} row${rows.length === 1 ? "" : "s"}`, bytes ? ` · ${kb(bytes)}` : "");
    const progress = run ? h("div", { class: "cart-progress" },
      h("div", { class: "bar" }, h("span", { style: `width:${Math.round((run.done / Math.max(1, run.total)) * 100)}%` })),
      h("p", { class: "small" }, run.zipping ? "Making the zip…" : `Downloading ${Math.min(run.done + 1, run.total)} of ${run.total}…`,
        run.failed.length ? h("span", { class: "muted" }, ` · ${run.failed.length} couldn't be downloaded`) : null)) : null;
    const go = h("button", { type: "button", class: "btn btn-primary", disabled: !entries.length || tooBig || !!run, onclick: () => download(entries) },
      h("span", { class: "label" }, "Download zip"));
    return h("aside", { class: "card files-cart", "aria-label": "Download list" }, head, list, kindBoxes, total,
      tooBig ? h("p", { class: "form-error" }, "That's too much for one zip (over 2 GB). Take some rows out, or download in parts.") : null,
      progress,
      h("div", { class: "cart-actions" },
        run ? h("button", { type: "button", class: "btn btn-ghost", onclick: () => { run.cancel = true; } }, "Cancel") : null, go));
  }

  async function download(entries) {
    if (G.run || !entries.length) return;
    if (!ctx.ensureTime(Math.min(30 * 60000, 60000 + entries.length * 5000))) return;
    const token = ctx.token();
    if (!token) return;
    const run = G.run = { done: 0, total: entries.length, failed: [], cancel: false, zipping: false };
    const got = new Array(entries.length);
    render();
    let next = 0, dead = false;
    const worker = async () => {
      while (!run.cancel && !dead && next < entries.length) {
        const i = next++;
        const e = entries[i];
        try {
          const t = ctx.tables[e.table];
          const blob = await downloadFromBase(attachmentRequest(e.file, t.table, LARK.api), token);
          got[i] = new Uint8Array(await blob.arrayBuffer());
        } catch (err) {
          if (isDeadToken(err)) { dead = true; break; }
          run.failed.push({ name: e.file.name || e.name, why: describe(err) });
        }
        run.done++;
        render();
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(PARALLEL, entries.length) }, worker));
      if (dead) return;   // the login ended: net.js says so
      if (run.cancel) { toast("Download cancelled. Nothing was saved."); return; }
      run.zipping = true;
      render();
      const zip = createZip();
      entries.forEach((e, i) => { if (got[i]) zip.add(e.name, got[i]); });
      if (!zip.count) {
        toast("None of the files could be downloaded.", { type: "error", timeout: 0, detail: run.failed[0] ? run.failed[0].why : "" });
        return;
      }
      const name = `polaris-files-${new Date().toISOString().slice(0, 10)}.zip`;
      const url = URL.createObjectURL(zip.blob());
      h("a", { href: url, download: name }).click();
      setTimeout(() => URL.revokeObjectURL(url), 120000);
      if (run.failed.length) {
        toast(`Saved ${name} with ${zip.count} of ${entries.length} files.`, { type: "warn", timeout: 0,
          detail: `Not in it: ${run.failed.map(f => `“${f.name}”`).join(", ")}. ${run.failed[0].why}` });
      } else {
        toast(`Saved ${name} (${zip.count} file${zip.count === 1 ? "" : "s"}).`, { type: "success",
          action: "Clear the list", onAction: () => { G.cart.clear(); render(); } });
      }
    } catch (err) {
      toast("Couldn't make the zip.", { type: "error", timeout: 0, detail: describe(err) });
    } finally {
      G.run = null;
      render();
    }
  }

  /* ---- Approvals: links into Lark Approval ---- */
  function approvalsEl() {
    const pick = h("div", { class: "chip-row", role: "radiogroup", "aria-label": "Which approvals" }, APPROVALS.map(a => {
      const cols = approvalColumns(ctx.fieldsOf(a.key), RULES);
      const n = approvalFileRows(S.data[a.key], cols).length;
      return h("button", { type: "button", class: "chip-opt", role: "radio", "aria-checked": String(G.approval === a.key), "aria-pressed": String(G.approval === a.key),
        onclick: () => { G.approval = a.key; render(); } }, a.label, h("span", { class: "n" }, String(n)));
    }));
    const a = APPROVALS.find(x => x.key === G.approval);
    const cols = approvalColumns(ctx.fieldsOf(a.key), RULES);
    const note = h("p", { class: "muted small files-note" }, ic("info"),
      "These files are kept in Lark Approval, so they can't go in a zip. Each link opens the approval, to download them there.");
    if (!cols.length) {
      return h("div", null, pick, note, h("div", { class: "callout callout-warn" }, ic("alert"),
        h("div", null, `The ${a.label} table has no attachment link column (a URL column with “attach” in its name).`)));
    }
    const rows = approvalFileRows(S.data[a.key], cols).filter(r => filesMatch(r, G.query));
    const many = cols.length > 1;
    const table = h("table", { class: "tbl uni files-tbl" },
      h("thead", null, h("tr", null, ["Submitted", "Request No.", "Project Code", "Project", "Status", "Attachments"].map(c => h("th", { scope: "col" }, c)))),
      h("tbody", null, rows.map(r => h("tr", null,
        h("td", { class: "c-date" }, r.submittedAt ? fmt.day(r.submittedAt) : ""),
        h("td", { class: "c-req" }, r.request ? h("a", { href: r.request, target: "_blank", rel: "noopener" }, r.requestNo || "Open") : r.requestNo),
        h("td", { class: "c-code" }, r.code ? copyableText(r.code) : h("span", { class: "none" }, "No code")),
        h("td", { class: "c-project" }, r.name || h("span", { class: "none" }, "(no name)")),
        h("td", { class: "c-status" }, r.status),
        h("td", null, h("ul", { class: "files-names" }, r.links.map(l => h("li", null,
          h("a", { href: l.link, target: "_blank", rel: "noopener", class: "file-link", title: l.link },
            ic("link"), h("span", { class: "file-name" }, many ? `${l.column}: ${l.text}` : l.text))))))))));
    return h("div", null, pick, note, h("div", { class: "tbl-wrap" }, table,
      rows.length ? null : h("div", { class: "empty small" }, h("p", null, G.query.trim() ? "No approvals match." : "No attachments here."))));
  }

  return { render };
}
