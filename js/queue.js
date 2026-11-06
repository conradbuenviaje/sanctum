/* The push queue. Push closes the sheet at once and the write waits here, so the
   next card can be reviewed straight away. The queue runs each push exactly as the
   sheet used to (same re-checks, read-back and messages), ONE AT A TIME and in the
   order they were pushed, and never sends a push twice on its own:

   - a push Lark refused ("Nothing was written.") waits as Failed for Retry, Edit or Remove;
   - a push that may have landed (timeout, dropped connection) is re-checked
     against a fresh read of Lark, then marked done or "safe to try again";
   - when the login runs low it stops, and the waiting pushes are kept in this
     browser (polaris.queue), so they carry on after Log in again (which reloads).

   The top bar's Queue tab shows how many are waiting; hovering it shows the next
   five, which slide out as they land. #/queue lists everything (same cards as the inbox). */

import { $, h, ic, toast, store, recall, collapse, fmt, copyable, reduceMotion, sleep } from "./ui.js";
import { AlreadyDone } from "./ops.js";
import { describe, isDeadToken, isUncertain } from "./net.js";
import { queueToJSON, queueFromJSON } from "./sync.js";

const KEY = "polaris.queue";
const PEEK_MAX = 5;
const MIN_LOGIN_MS = 60000;           // the same minute every write needs (ensureTime)
const WHERE = { universe: "Universe", collections: "Collections", andon: "ANDON" };
const ROUTE = { brief: "#/universe", par: "#/universe", invoice: "#/invoices", andon: "#/andon", audit: "#/audit", approval: "#/andon", pm: "#/audit", ce: "#/audit", files: "#/universe" };
const EDIT_ROUTE = { universe: "#/universe", collections: "#/invoices", andon: "#/andon" };   // the tab its table sits beside
const LISTED = ["running", "checking", "waiting"];

export function createQueue(ctx, inbox) {
  const { S } = ctx;
  const Q = S.queue = { items: queueFromJSON(recall("local", KEY)), paused: "", running: null };
  let seq = Q.items.reduce((n, it) => Math.max(n, Number(String(it.id).replace(/\D/g, "")) || 0), 0);
  let closeAttention = null;            // the one toast that points at failures and warnings
  let warnedLogin = false;

  const save = () => store("local", KEY, queueToJSON(Q.items));
  const active = () => Q.items.filter(it => it.state !== "done");
  const waiting = () => Q.items.filter(it => LISTED.includes(it.state));
  const failed = () => Q.items.filter(it => it.state === "failed");
  // A row edit isn't in a list: its "card" is the row, as long as the table still has it.
  // An audit card marked with a custom tag is in its tag's group, not the list.
  const findCard = (it) => {
    if (it.kind === "edit") return inbox.editCard(it.cardId);
    // (approval cards sit in the ANDON tab's list, file cards in the Universe tab's)
    const list = (S.lists && S.lists[{ approval: "andon", pm: "audit", ce: "audit", files: "universe" }[it.kind] || it.kind]) || { cards: [] };
    return [...list.cards, ...(list.tagged || []).flatMap(g => g.cards)]
      .find(c => c.id === it.cardId && (c.step || "") === (it.step || ""));
  };

  /* ---------------------------------------------------------------- adding */
  function add(c, job, entry) {
    const it = {
      id: `q${++seq}`, key: inbox.keyOf(c), kind: c.kind, cardId: c.id, step: c.step || "",
      ...entry, job, state: "waiting", error: "", at: Date.now(), card: c,
    };
    Q.items.push(it);
    save();
    paint();
    pump();
    return it;
  }

  /* Is this card waiting in the queue (so it's left the list)? */
  const hides = (c) => Q.items.some(it => (it.state !== "done" || it.alreadyDone) && it.cardId === c.id
                                          && (it.step || "") === (c.step || "") && it.kind === c.kind);

  /* ---------------------------------------------------------------- running */
  async function pump() {
    if (Q.running || Q.paused || !S.data || !S.lists) return;
    // A push that was running when the page closed: look before anything else.
    const unsure = Q.items.find(it => it.state === "checking");
    if (unsure) return settleUnsure(unsure);
    const it = Q.items.find(x => x.state === "waiting");
    if (!it) return drained();
    const card = findCard(it);
    if (!card) {
      finish(it, "done", { title: "Not sent: it's no longer in its list.", detail: "", warn: true });
      return next();
    }
    if (it.lostFiles) {
      fail(it, "Its file was lost when the page reloaded. Edit it and add the file again.");
      return next();
    }
    if (ctx.msLeft() < MIN_LOGIN_MS) return pause("login");
    Q.running = it;
    it.state = "running";
    it.status = "";
    paint();
    let unsureErr = null;
    try {
      const out = await ctx.track(() => inbox.perform(card, it.job, { onStatus: (t) => { it.status = t; paintRow(it); } }));
      it.recordId = out.res.recordId;
      finish(it, "done", await ctx.afterPush(card, out.res, out.payload, out.extra));
    } catch (err) {
      if (err instanceof AlreadyDone) {
        // Already in Lark. The list isn't reloaded (nothing refreshes on its own), so
        // its card stays out of the list until the next Refresh.
        it.alreadyDone = true;
        finish(it, "done", { title: err.message, detail: "", warn: false });
      } else if (isDeadToken(err)) {
        it.state = "waiting";           // Lark refused the login, so nothing was written: it runs after Log in again
        pause("login");
      } else if (isUncertain(err)) {
        unsureErr = err;
      } else {
        fail(it, `Nothing was written. ${describe(err)}`);
      }
    } finally {
      if (Q.running === it) Q.running = null;
    }
    if (unsureErr) return settleUnsure(it, unsureErr);
    next();
  }
  const next = () => { save(); paint(); setTimeout(pump, 0); };

  /* It may have landed: look at Lark (a quiet reload) before anyone can send it again. */
  async function settleUnsure(it, err) {
    Q.running = it;
    it.state = "checking";
    paint();
    while (S.loading) await sleep(300);   // a load already running isn't a fresh look
    const was = S.loadedAt;
    await ctx.loadData({ quiet: true });
    Q.running = null;
    if (S.loadedAt === was) {
      fail(it, "Polaris couldn't confirm it. Check it in Lark before retrying.");
    } else if (it.kind === "edit") {
      // An edited row stays in its table either way, so the list can't tell. A retry
      // is safe: it re-reads the row first and writes nothing if the changes are there.
      fail(it, "Polaris couldn't confirm it. Retry checks the row first, and won't write if it's already changed.");
    } else if (findCard(it)) {
      fail(it, "It didn't reach Lark. It's safe to retry.");
    } else {
      finish(it, "done", { title: "It's in Lark.", detail: "", warn: false });
    }
    next();
  }

  function finish(it, state, report) {
    it.state = state;
    it.doneAt = Date.now();
    Object.assign(it, { title: report.title, detail: report.detail, warn: !!report.warn, error: "" });
    it.card = null;
    if (it.warn) attention();
    slideOut(it);
  }
  function fail(it, message) {
    it.state = "failed";
    it.error = message;
    it.card = null;
    attention();
  }

  // Nothing is reloaded when the queue empties: the lists only change when a push
  // lands (its card leaves) or when the person presses Refresh.
  const drained = () => paint();

  function pause(reason) {
    Q.paused = reason;
    save();
    paint();
    if (reason === "login" && !warnedLogin) {
      warnedLogin = true;
      const n = active().length;
      toast("Your login is about to end, so the queue stopped.", {
        type: "warn", timeout: 0, detail: `${fmt.plural(n, "push", "pushes")} carry on after you log in again.`,
        action: "Log in again", onAction: () => ctx.login(location.hash),
      });
    }
  }
  function resume() {
    Q.paused = "";
    paint();
    pump();
  }

  /* One sticky toast for everything that needs a look, replaced as it changes. */
  function attention() {
    const f = failed().length, w = Q.items.filter(it => it.state === "done" && it.warn && !it.seen).length;
    if (closeAttention) closeAttention();
    if (!f && !w) { closeAttention = null; return; }
    const parts = [f ? `${fmt.plural(f, "push", "pushes")} didn't go through` : "", w ? `${fmt.plural(w, "push", "pushes")} need${w === 1 ? "s" : ""} a check in Lark` : ""].filter(Boolean);
    closeAttention = toast(`${parts.join(", and ")}.`.replace(/^./, (x) => x.toUpperCase()), {
      type: f ? "error" : "warn", timeout: 0, action: "Open queue",
      onAction: () => { location.hash = "#/queue"; },
    });
  }

  /* ---------------------------------------------------------------- actions */
  function remove(it) {
    if (it.state === "running" || it.state === "checking") return;
    Q.items = Q.items.filter(x => x !== it);
    const c = findCard(it);
    if (c) { S.entering.add(c.id); S.flashCard = c.id; }
    // What was chosen stays as the card's draft, so its sheet opens the same way again.
    if (c) S.drafts.set(inbox.keyOf(c) + (it.job.invalid ? ":invalid" : ""),
                        { choices: it.job.choices, clientToken: it.job.clientToken, targetId: it.job.targetId });
    save();
    attention();
    ctx.render();
    toast(`Took ${it.code || it.name || "it"} out of the queue.`, { detail: it.kind === "edit"
      ? "Nothing was written. Open the row again to see your changes." : c ? "It's back in its list. Nothing was written." : "Nothing was written." });
  }
  function retry(it) {
    if (it.state !== "failed") return;
    it.state = "waiting";
    it.error = "";
    save();
    attention();
    paint();
    pump();
  }
  function edit(it) {
    const c = findCard(it);
    if (!c) { toast(`${it.code || "That item"} isn't in its list any more.`, { detail: "Refresh to see what Lark has now." }); return; }
    Q.items = Q.items.filter(x => x !== it);
    save();
    attention();
    location.hash = (it.kind === "edit" ? EDIT_ROUTE[it.table] : ROUTE[it.kind]) || "#/universe";
    setTimeout(() => inbox.reopen(c, it.job), 0);
  }
  function clearDone() {
    Q.items = Q.items.filter(it => it.state !== "done");
    attention();
    paint();
  }

  /* ---------------------------------------------------------------- the top bar */
  const link = $("#queueLink"), count = $("#queueCount"), bad = $("#queueBad"), peek = $("#queuePeek");
  const peekRows = new Map();           // item id → its row in the peek, so rows can slide out

  function paint() {
    const n = waiting().length, f = failed().length;
    link.hidden = !ctx.signedIn();
    count.textContent = n ? String(n) : "";
    bad.textContent = f ? String(f) : "";
    bad.hidden = !f;
    link.setAttribute("aria-label", `Queue: ${n} waiting${f ? `, ${f} failed` : ""}`);
    renderPeek();
    if (S.view === "queue") renderPage();
  }
  function paintRow(it) {
    const row = peekRows.get(it.id);
    if (row) row.replaceWith(peekRow(it));
    if (S.view === "queue") renderPage();
  }

  function stateIcon(it) {
    if (it.state === "running" || it.state === "checking") return h("span", { class: "spinner", "aria-hidden": "true" });
    if (it.state === "done") return ic(it.warn ? "alert" : "check");
    if (it.state === "failed") return ic("alert");
    return h("span", { class: "q-slot", "aria-hidden": "true" });
  }
  // Said only where the icon isn't enough: what's running, and what needs a look.
  const stateText = (it) => ({ running: it.status || "Pushing…", checking: "Checking…", failed: "Failed",
                               done: it.warn ? "Check" : "" }[it.state] || "");

  function peekRow(it) {
    const row = h("li", { class: `q-row is-${it.state}${it.warn ? " is-warn" : ""}`, "data-id": it.id },
      stateIcon(it),
      h("span", { class: "q-text" }, h("b", null, it.code || "(no code)"), h("span", null, it.verb)),
      h("span", { class: "q-state" }, stateText(it)));
    peekRows.set(it.id, row);
    return row;
  }

  function renderPeek() {
    const list = waiting().slice(0, PEEK_MAX);
    const n = waiting().length, f = failed().length;
    const head = peek.querySelector(".q-head") || peek.appendChild(h("p", { class: "q-head" }));
    const box = peek.querySelector(".q-list") || peek.appendChild(h("ul", { class: "q-list" }));
    const foot = peek.querySelector(".q-foot") || peek.appendChild(h("p", { class: "q-foot" }));
    const want = new Set(list.map(it => it.id));
    for (const [id, row] of peekRows) {
      if (!want.has(id) && !row.classList.contains("is-leaving")) { row.remove(); peekRows.delete(id); }
    }
    for (const it of list) {
      const old = peekRows.get(it.id);
      const fresh = peekRow(it);
      if (old) old.replaceWith(fresh); else box.append(fresh);
    }
    for (const it of list) box.append(peekRows.get(it.id));    // running first, then the next in line
    head.replaceChildren(...[h("b", null, `${n.toLocaleString()} waiting`),
      Q.paused ? h("span", { class: "badge badge-warn" }, "Paused") : null,
      f ? h("span", { class: "badge badge-err" }, `${f} failed`) : null].filter(Boolean));
    foot.hidden = n <= PEEK_MAX;
    foot.textContent = `+${(n - PEEK_MAX).toLocaleString()} more`;
    peek.classList.toggle("is-empty", !n && !f && !box.querySelector(".is-leaving"));
  }

  /* A push that landed: tick it in the peek, then slide it out. */
  async function slideOut(it) {
    const row = peekRows.get(it.id);
    if (!row || !row.isConnected) return;
    const done = peekRow(it);
    row.replaceWith(done);
    done.classList.add("is-leaving");
    if (!reduceMotion()) await new Promise(r => setTimeout(r, 450));
    await collapse(done, 0);
    done.remove();
    peekRows.delete(it.id);
    renderPeek();
  }

  /* ---------------------------------------------------------------- the page (#/queue) */
  const BADGE = { running: "badge-info", checking: "badge-info", failed: "badge-err" };
  const badgeText = (it) => ({ running: it.status || "Pushing…", checking: "Checking…", waiting: "Waiting",
                               failed: "Failed", done: it.warn ? "Check in Lark" : "Done" }[it.state]);

  function renderPage() {
    const n = waiting().length, f = failed(), done = Q.items.filter(it => it.state === "done").slice().reverse();
    $("#queueTools").replaceChildren(...[
      n ? h("button", { type: "button", class: "btn btn-sm", onclick: () => (Q.paused ? resume() : pause("user")) },
        Q.paused ? "Resume" : "Pause") : null,
      f.length > 1 ? h("button", { type: "button", class: "btn btn-sm", onclick: () => f.forEach(retry) }, `Retry all ${f.length}`) : null,
      done.length ? h("button", { type: "button", class: "btn btn-sm btn-ghost", onclick: clearDone }, "Clear finished") : null].filter(Boolean));
    const login = Q.paused === "login";
    $("#queuePaused").hidden = !login;
    if (login) {
      $("#queuePaused").replaceChildren(ic("alert"), h("div", null, "Your login is about to end."),
        h("button", { type: "button", class: "btn btn-sm", onclick: () => ctx.login("#/queue") }, "Log in again"));
    }
    section("#queueFailed", "Failed", f, (it) => [
      h("button", { type: "button", class: "btn btn-ghost", onclick: () => remove(it) }, "Remove"),
      h("button", { type: "button", class: "btn btn-ghost", onclick: () => edit(it) }, "Edit"),
      h("button", { type: "button", class: "btn btn-tonal", onclick: () => retry(it) }, "Retry")]);
    section("#queueWaiting", "Waiting", waiting(), (it) => (it.state === "waiting"
      ? [h("button", { type: "button", class: "btn btn-ghost", onclick: () => remove(it) }, "Remove")] : []));
    section("#queueDone", "Finished", done.slice(0, 200), (it) => [
      h("a", { class: "btn btn-ghost", href: ctx.tables[it.table].url, target: "_blank", rel: "noopener" }, "Open in Lark", ic("external"))]);
    done.forEach(it => { it.seen = true; });
    $("#queueEmpty").hidden = Q.items.length > 0;
  }

  /* One card per push, built like the inbox's cards. */
  function section(sel, title, items, actions) {
    const el = $(sel);
    el.hidden = !items.length;
    if (!items.length) { el.replaceChildren(); return; }
    el.replaceChildren(h("h2", { class: "subhead" }, `${title} · ${items.length.toLocaleString()}`),
      h("div", { class: "cards" }, items.map((it) => {
        const msg = it.error || (it.state === "done" ? [it.title, it.detail].filter(Boolean).join(" ") : "");
        const acts = actions(it).filter(Boolean);
        return h("article", { class: `card item q-item is-${it.state}${it.warn ? " is-warn" : ""}` },
          h("div", { class: "item-head" },
            copyable(it.code, { label: "project code", cls: "code", empty: h("span", { class: "code" }, "No code") }),
            h("span", { class: `badge ${BADGE[it.state] || (it.state === "done" ? (it.warn ? "badge-warn" : "badge-ok") : "")}` },
              it.state === "running" || it.state === "checking" ? h("span", { class: "spinner", "aria-hidden": "true" }) : null, badgeText(it)),
            h("span", { class: "item-date" }, fmt.time(it.doneAt || it.at))),
          h("h3", null, it.name || "(no name)"),
          h("p", { class: "item-meta" }, it.verb),
          msg ? h("p", { class: `q-msg${it.error ? " is-err" : it.warn ? " is-warn" : ""}` }, msg) : null,
          acts.length ? h("div", { class: "item-actions" }, acts) : null);
      })));
  }

  // Leaving with pushes still waiting would drop the ones that hadn't started:
  // they're kept in this browser, but say so.
  window.addEventListener("beforeunload", (e) => { if (waiting().length && !Q.paused) { e.preventDefault(); e.returnValue = ""; } });

  return { add, hides, pump, paint, renderPage, item: (id) => Q.items.find(it => it.id === id), findCard,
           count: () => waiting().length };
}
