# Polaris

<img src="img/polaris-icon.svg" alt="Polaris logo" width="96" align="right">

Polaris keeps the **🌌 Universe** and **💸 Collections** Lark tables in step with
what gets filed. Each change the trackers need shows up as a card;
**Push** makes it with one click, **Ignore** hides it for good (with Undo). It works on a
phone and on a PC, and every change is made as you, with your own Lark login.

| Source | Becomes |
| ------ | ------- |
| **Project Brief** (by Account Managers) | a new **Universe** row |
| **Project Approval (PAR)** | the request number in the project's Universe **PAR** column |
| **Won project** (in the Universe, with a PAR) | a **For Invoicing** row in **Collections** |
| **Invoice Request** (by Account Managers) | moves its Collections row along: **Pending Invoice Request Approval** when filed, **For Collection** when approved |
| **Project Brief** (any department) | a new **ANDON** row (Project Management's board) |
| **Project Approval (PAR)** | its Request No. in the **Approval** column of the project's ANDON row |
| **Project Brief** files (linked in Lark Approval) | uploaded by you into the project's Universe **Other Attachments** |

> **Connected to the live tables.** `APP.env` in `js/config.js` is `"live"`, so the
> header shows no *Test copy* badge and every push changes real data. See
> [Going live](#going-live) for switching between the test copies and production.

---

## Contents

- [Using Polaris](#using-polaris)
- [The push queue](#the-push-queue)
- [What shows up as a card](#what-shows-up-as-a-card)
- [What gets written](#what-gets-written)
- [The audit](#the-audit)
- [The Universe view](#the-universe-view)
- [The ANDON view](#the-andon-view)
- [The Tagging page](#the-tagging-page)
- [The row editor](#the-row-editor)
- [The Collections view](#the-collections-view)
- [Settings](#settings)
- [How it's built](#how-its-built)
- [Safety checks](#safety-checks)
- [Running it on your computer](#running-it-on-your-computer)
- [Hosting it for phones](#hosting-it-for-phones)
- [Going live](#going-live)
- [Tests and tools](#tests-and-tools)
- [Design decisions](#design-decisions)
- [Security and privacy](#security-and-privacy)
- [Known limits](#known-limits)
- [Troubleshooting](#troubleshooting)
- [Maintenance recipes](#maintenance-recipes)
- [Files](#files)

---

## Using Polaris

1. **Log in with Lark.** A login lasts about 2 hours and is shared with Fetch and Suppliers:
   log in to any of them and you're logged in to all three in this browser, in every tab,
   with one timer (closing the tab doesn't log you out). The clock in the header shows how
   long you have left (it turns amber in the last 10 minutes), a message stays on screen
   in the last 5, and Settings shows the exact time it ends. **Log in again** there to
   get a fresh 2 hours. A push that's already running isn't cut off by the clock.
2. The **Universe** tab lists the briefs and PARs that aren't in the Universe yet, in one
   list (a PAR card says *PAR …*; old `#/briefs` and `#/pars` links open it); **Invoices** lists
   every change Collections needs (see [Invoices](#invoices-the-collections-lifecycle)).
   Newest first; search narrows the list.

   **Filters** (the funnel beside the search) narrow every tab by the project's
   **Client**, **Status**, **BD**, **AM** and **Tribe**. Each card takes its project's
   values, found by its project code: Client, Status, BD and AM from the project's
   Universe row, and Tribe from the Universe (if it has a Tribe column) or else ANDON's
   TRIBE. A project that isn't in the Universe yet (a new brief) takes BD and AM from
   its brief, and has no client or status (*No status (not in the Universe)*). Each list
   offers the values the open tab's cards have, with how many (counted with the other
   filters on), plus "none". **Client** is a box to type in (there are too many clients
   for a list): it shows the closest matches as you type (part of a name, or its
   letters in order: *kstrl* finds Kestrel Motors), most cards first when it's empty;
   click one, or Enter for the best match. Clear it and leave to go back to any client.
   **Status** is the project's Universe Status (For Pitching,
   Signed CE, Lost…), not the request's approval status on the card. The filters apply
   to every tab, its count included, until the page reloads; what's on shows as chips
   under the search (**×** each, **Clear all**), and the list's footer says how many
   they hide. The audit's tag groups are filtered too.
3. **Push** opens the sheet. On the left, what needs a person; on the right, the
   Lark row the push changes, as it will be: the cells it changes are highlighted
   (the old value struck through), and it follows what you pick on the left. Lookups
   and formulas show what Lark has (a new row has none until Lark fills them). A new
   row says *New row*. Where there isn't room for both side by side, the row sits
   under the fields. Clicking outside the sheet is the same as **Cancel** (what you
   typed is kept for next time).
   - *Brief:* type the **Client**, pick the **BD** (blank unless you pick someone;
     frequent BDs are listed first), choose **VAT**, and optionally **Add other links**.
   - *PAR:* if several Universe rows share the code, you choose the row.
   - *Invoice:* pick another Collections row (or a new one) if Polaris guessed wrong;
     a new row's **AR Name** can be edited (for example add "Downpayment"). For an
     approved request (its row goes to *For Collection*) the **Collection Date** is needed:
     the push stays off until it's filled. You can also add the invoice details (number,
     SI, date, file).
   - *Audit (Fill):* each blank the brief can fill, ticked and pre-filled; edit or untick.
     A blank **Signed CE (PDF)** asks for the file(s), which upload when the push runs.
   The sheet's button (**Push to Universe**, **Fill 2 fields**, …) closes it at once:
   the card leaves the list, the next card's button has the keyboard, and the push
   goes to the **[queue](#the-push-queue)**.
4. **Ignore** hides a card by ticking the source row's IGNORE box. **Undo** in the
   message brings it back.
5. On a wide screen (1280 px and up) the **Universe** table sits beside the cards
   (**Collections** beside Invoices, **ANDON** beside ANDON). Narrower screens show
   the cards only. Click any row to open and change it ([the row editor](#the-row-editor)).
   To look at another table without leaving the tab, click the table's name
   (**Universe ▾**) and pick Universe, Collections or ANDON, or one of the tables Lark
   Approval fills: Project Brief, Project Approval or Invoice Request
   ([the source tables](#the-source-tables)). Each tab keeps its pick until the page is
   reloaded; picking the tab's own table goes back to it.
6. **Settings** (the gear next to **Queue** in the top bar): see [Settings](#settings).

---

## The push queue

Pushes wait in the **Queue** while Lark confirms them, so a long list (the audit can
have hundreds of cards) can be reviewed without stopping.

- **Queue** in the top bar shows how many are waiting, and a red number for any that
  failed. Hovering it shows the next five (the one being sent has a spinner and its
  upload progress; each ticks green and slides out when it lands). Click it for the
  queue page: **Failed**, **Waiting** and **Finished**, as cards like the inbox's.
- Pushes are sent **one at a time, in the order you pressed them**, each exactly as
  before: the destination is re-read first, the write is read back, and the result
  says what Lark confirmed. A PAR or invoice that waits for its brief unlocks once
  the brief's push lands.
- **A push Lark refused** stays under **Failed** with the reason (*Nothing was
  written. …*). **Retry** sends it again, **Edit** reopens its sheet with what you
  chose, **Remove** puts the card back in its list. One message on screen says how
  many need a look, with **Open queue**.
- **A push whose answer never came back** (a timeout or a dropped connection) may
  have landed, so the queue never sends it again on its own: it re-reads Lark, then
  marks it done (*It's in Lark.*) or failed (*It didn't reach Lark. It's safe to retry.*).
- **Waiting pushes are kept in this browser** (`polaris.queue`, up to 2 days), so
  **Log in again** (which reloads the page) or an accidental reload doesn't lose
  them: they carry on once the tables have loaded. A push that was being sent when
  the page closed is checked against Lark first. Files that hadn't uploaded can't be
  kept: that push fails with a note to add the file again (**Edit**).
- **When the login runs low** (under a minute), the queue stops and says so, with
  **Log in again**. **Pause** / **Resume** on the queue page stop and restart it by hand.
- Closing the tab while pushes are waiting asks first.
- Nothing reloads on its own: the lists and tables change only when a push lands
  (its card leaves, and the cards waiting on it move on) or when you press **Refresh**.

---

## What shows up as a card

All five tables are read **in full**, never through a view (the Universe view in
the link shows only part of the table; reading through it would make projects
look missing and get them added twice).

**Project Briefs:** `Initiator department` is *Account Managers* or *Sales* (its
name before Oct 2025; the same goes for invoice requests everywhere in Polaris),
`IGNORE` isn't ticked, the `Project Code` isn't in any Universe row, and the status
isn't Rejected, Recalled, Canceled, Deleted or Terminated. Codes are compared
in canonical form, so `"2025TEG-P0313 "` with a trailing space still counts.
A card says *Note: looks like "…" (code), already in the Universe* when a Universe
project has a very similar name: usually a re-filed brief to ignore.

**PARs:** the request number isn't anywhere in the Universe's PAR column, and the
project is in the Universe. A PAR whose brief is still waiting shows as *Push
this project's brief first.* with a link to that brief. The project is found
through the PAR's `Associated Project Brief` (more reliable than its hand-typed
code); any disagreement is shown as a note.

**Invoices:** see the next section.

Under each list: *Not shown: 233 already in the Universe · 24 ignored · …*

### Invoices: the Collections lifecycle

A Collections row moves through three stages, and the Invoices tab shows each
move that's due, as one card:

| Card | When | Push |
| ---- | ---- | ---- |
| **Won** | A Universe project is won (*Won - Awaiting CE Signature*, *Signed CE* or *For Collection*), has a PAR, and has no Collections row and no invoice request yet | adds a **For Invoicing** row |
| **Under Review** (request filed) | An invoice request is filed and isn't on any row | puts its number on the project's For Invoicing row and sets **Pending Invoice Request Approval** (or adds a new Pending row if there's none) |
| **Approved** | The request is approved and its row isn't For Collection yet | sets **For Collection**, updates the amount to the invoiced one if it changed, and takes the invoice details if you add them (a row can skip Pending when the approval is quick) |
| **Recalled / Rejected** (withdrawn) | A request on a Pending row was withdrawn | clears the number and puts the row back to **For Invoicing** |

So one invoice request comes up twice: when it's filed, and again when it's approved.

- **Which row.** A project can have several For Invoicing rows (tranches). Each
  request goes to the one in the same currency with the closest amount, one
  request per row. The card says which row (*"Tranche 2" · For Invoicing → Pending…*)
  and the sheet lets you pick another, or a new row.
- **Rows recorded by hand.** Many invoices were added to Collections without
  their request number. When an approved request has exactly the same amount as
  one of those rows (as filed, or VAT-ex), the card offers to **add the request
  number** to that row, and nothing else changes on it (*For Collection · adds
  the request number*). Ties go to the request approved closest to the row's
  Invoice Date. If a row is close but not equal, the card asks you to check it.
- **Requests filed again.** If a recalled request is replaced by a new one, the
  new request simply takes the row over; no *withdrawn* card is shown for it.
- **Which project.** The request's typed Project Code, or, when that code isn't in
  the Universe, the project its PAR (*Associated Project Approval*) is on. If the
  two disagree, the card says so.
- **Not shown:** other departments' requests (unless already on a Collections row:
  those are followed whoever filed them), ignored ones, rejected or recalled ones
  that aren't on a row, projects not in the Universe, and **closed or lost
  projects** (*For Closing*, *Fully Closed*, *Lost*, *Stalled*, *Archived*), unless
  a row of theirs is still waiting in For Invoicing.
- **Blocked:** a new row for a project with **no PAR** in the Universe (*Add this
  project's PAR to the Universe first*, with a link to the PAR card if there is
  one), and a won project with no amount yet.
- **Ignore** ticks the request's IGNORE box. For a *Won* card it ticks an
  **IGNORE** checkbox on the project's Universe row, which the Universe doesn't
  have yet: until someone adds that column, Ignore is greyed out on *Won* cards.
- **Mark invalid** (on *Won* cards) is the way to keep a won project out of the
  list without that column: it adds the project to Collections with Status
  **Invalid** (it works even when the project has no amount). Any Collections
  row for a project, Invalid included, means it's no longer offered as *Won*.
  To undo it, delete or change that row in Collections.

---

## What gets written

Empty values are never written, so nothing is blanked.

### Project Brief → new Universe row

| Universe column | Value |
| --------------- | ----- |
| Project Code | the brief's code, canonical |
| Project | Project Name |
| Client | what you type in the sheet (blank if you leave it) |
| BD | who you pick in the sheet (blank by default) |
| AM | the brief's AM (MKT is left blank: the Project Brief has no MKT column since Oct 2026; fill it in the [row editor](#the-row-editor)) |
| Amount (VAT-Ex.) (PHP) | Contract Value × **57** if USD, then **÷ 1.12** for 12% VAT, to the centavo |
| VAT% | chosen in the sheet: **12%** (default for PHP) or **0%** (default for USD). The sheet quotes any VAT sentence from the brief's remarks. |
| Project Description | Remarks |
| Project Start / End | Start date / End date |
| RFP Received Date | the day the brief was submitted (Manila time) |
| Year | from the code, e.g. `2026` |
| Status / Mancom Phase | `For CE/Pitch Creation` / `1. Client Brief Kickoff` |
| Other Links | what you add in the sheet (blank by default) |

Business Unit, Tribe and AM Lookup are lookups in the Universe and fill themselves in.

### Project Brief → new ANDON row

ANDON takes briefs from **every** department (the Universe only takes Account
Managers'). A brief shows on the **ANDON** tab while its code isn't in ANDON.

| ANDON column | Value |
| ------------ | ----- |
| Project, Project Code | the brief's Project Name and canonical code |
| AM | the brief's AM (ANDON holds one) |
| MKT (PITCH) | left blank (the Project Brief has no MKT column any more) |
| PM (LEAD) | who you pick in the sheet (blank by default; frequent ANDON PMs first) |
| TRIBE | picked in the sheet (blank by default; it can't be worked out from the brief) |
| Business Unit, Tools | the brief's, when ANDON has a matching option |
| Event Start / End | Start date / End date |

The live ANDON fills Brief, Brief Status, Brief Contract Value, Brief Currency,
Remarks, YEAR, MONTH, Contract Value (USD) and Budget Tier itself (lookups and
formulas from the Project Code and dates), so Polaris never writes those; it writes
only the columns a person would type. Budget Tier is left to ANDON. The Universe's
Business Unit and Tribe are lookups from ANDON, so they fill in once the ANDON row exists.

**Ignore** uses the brief's one IGNORE box, so an ignored brief disappears from both the
Universe and ANDON lists.

### PAR → Universe PAR

The request number goes into the project row's `PAR`, after any PAR already there
(`202607030034, 202610080029`), never replacing it.

### PAR → ANDON Approval

On the **ANDON** tab, beside the briefs: every ANDON row whose **Project Code** has a
Project Approval, and whose **Approval** is blank, gets a card (*PAR 202605120069 ·
into ANDON's Approval*). Push writes that PAR's **Request No.** into Approval as a link
to the approval in Lark, shown as its number. If a project has several PARs, it's the
newest one that wasn't rejected or withdrawn, an Approved one first. Whether the
project is won doesn't matter. Several ANDON rows with the same code each get the
link. Only a blank Approval is written: if someone filled it meanwhile, theirs stays
and the queue says so. The column is `andonApproval` in [`js/config.js`](js/config.js);
if ANDON has no column by that name, there are no cards.

### The brief's files → the Universe

The brief's files live in Lark Approval: its **Attachment (Project Brief, Pitch Deck)**
column is a link to them there (*1 attachment(s)*), and Polaris's login can't read Lark
Approval. So the files go across by hand. On the **Universe** tab, after the briefs and
PARs: every Universe row whose **Other Attachments** is blank and whose project's brief
has that link (the newest brief with its Project Code that wasn't recalled, rejected or
cancelled) gets a card, newest brief first, whatever the project's Status.

The card's link opens the files in Lark Approval: download them, then **Upload** and add
them (up to 20 MB each). The push uploads them to the Universe as you and puts them in
Other Attachments, only while it's still blank: if someone filled it meanwhile, theirs
stays and the queue says so. The columns (and any statuses to leave out) are `briefFiles` in
[`js/config.js`](js/config.js); if either table has no column by that name, there are
no cards.

### Collections changes

| Change | Collections columns written |
| ------ | --------------------------- |
| Won → new row | AR Name (the project, editable), Project Code, Invoice Amount = the Universe's **Amount (VAT-Inc.)** in PHP, Currency `PHP`, Status `For Invoicing`, Business Unit (the Universe's, matched to a Collections option) |
| Filed → its row | Invoice Request (the number), Status `Pending Invoice Request Approval`, and Invoice Amount and Currency when the request's differ (a For Invoicing row starts as the Universe's PHP amount; the card's note says what changes) |
| Filed → new row | AR Name, Project Code, Invoice Amount and Currency (as filed), Invoice Request, Status `Pending…`, Business Unit |
| Approved → its row | Status `For Collection`; Invoice Amount and Currency when the request's differ; the request number if the row didn't have it; any invoice details you add |
| Approved → a row recorded by hand | Invoice Request only (plus any invoice details you add) |
| Approved → new row | as *Filed → new row*, with Status `For Collection` |
| Withdrawn → its row | Invoice Request cleared, Status `For Invoicing` |

Only cells that change are written. PAR, Project Name, Client Name and AM are
lookups in Collections and fill themselves from the Universe through the Project
Code. Select values are only ever written with an option that already exists.

All rules are in [`js/config.js`](js/config.js) and [`js/sync.js`](js/sync.js).

---

## The audit

The **Audit** tab checks every Universe and ANDON row against its Project Brief
(matched by project code; the newest brief that wasn't rejected or withdrawn) and
lists each row that has **blank cells the brief can fill**: AM, the amount,
Project Description, start and end dates, RFP Received Date and Year for the
Universe; the typed ANDON columns (AM, Business Unit, Tools, Event
Start / End…) for ANDON. It also lists signed projects with no signed CE on file
(see below).

**Won projects must have a Sign Date and a Month.** A Universe project whose Status
is *Fully Closed*, *For Closing*, *For Collection*, *Signed CE* or *Won - Awaiting CE
Signature*, or whose Mancom Phase is *7. Won*, gets a card when either is blank,
even without a brief (no brief has them, so you type them in). They can't be
unticked, and the **Fill** button stays off while either is still blank (the sheet
doesn't spell the rule out). **Month** starts as the 1st of the Sign Date's month (the
Sign Date on the row, or the one you type; it follows the Sign Date until you change
Month yourself). The statuses, phases and columns are `auditRequired` in
[`js/config.js`](js/config.js); if the Universe has no column by that name, audit
pushes to the Universe stop and the column check says which one is missing.

**Lost projects must have a Loss Month and a Reason for Loss.** A Universe project
whose Status is *Stalled*, *Lost* or *Archived* gets a card when either is blank, even
without a brief. Like Sign Date and Month, they can't be unticked and **Fill** stays
off while either is blank; each has the editor its column needs (a select shows the
column's own options). The Status decides: a project in Mancom Phase *7. Won* whose
Status is *Lost* is asked for these, not Sign Date and Month. The statuses and columns
are `auditLost` in [`js/config.js`](js/config.js); a missing column stops audit pushes
to the Universe, as above. (In the Universe table these projects are in folded groups
at the bottom.)

People sometimes mark a project **Lost** when it's only stalled or archived, so these
cards' Fill sheet has a **Status** dropdown with just those three (only the ones the
Status column has), starting at the current one. Pick another and it's written with
the Fill (the row beside the sheet shows the change, and the queue says *Fill 2 blanks
and set Status to Stalled*). Status isn't a blank, so it's only changed if the row in
Lark still says what the card showed: if someone changed it meanwhile, theirs is kept
and the result says so.

**The PM must be the same in the Universe and ANDON.** A project in both whose
Universe **PM** and ANDON **PM (LEAD)** differ (in any of its ANDON rows), or where
either is blank, gets an Audit card showing both. **Fill** asks for one PM, filled in
with ANDON's (else the Universe's), and sets it in the Universe and in every ANDON row
of the project; it stays off while the PM is blank. Before writing, both tables are
re-read: if either PM was changed in Lark meanwhile, nothing is written anywhere and the
queue says which. The columns are `pmSync` in [`js/config.js`](js/config.js).

**The CE link must be the same in the Universe and ANDON.** The same check for the
Universe's **Internal CE (Sheet)** and ANDON's **Working CE** (both URL columns): a
project in both whose links differ (in any of its ANDON rows), or where either is
blank, gets an Audit card showing both links. **Fill** asks for one link, filled in
with ANDON's (else the Universe's; with two different links, a button picks either;
with both blank, you paste it). It must start with `https://`. It's written to the
Universe and every ANDON row of the project, after both are re-read, exactly like the
PM. The columns are `ceSync` in [`js/config.js`](js/config.js).

**Signed projects must have their signed CE on file.** A Universe project whose
Status is *Fully Closed*, *For Closing*, *For Collection* or *Signed CE* gets a card
when its **Signed CE (PDF)** attachment is blank, even without a brief (*Won - Awaiting
CE Signature* isn't asked: nothing is signed yet). In the Fill sheet, **Add the signed
CE** picks the file (PDF, up to 20 MB each; add several if the CE is in parts). The
files upload to Lark (as you, through the connection service, like invoice files)
when the push runs, before anything is written, so a failed upload writes nothing and
**Retry** in the queue doesn't upload a file twice. The Fill is refused while the row
is ticked with no file; untick it to fill the card's other blanks without it. Like
every Fill, the file only goes into a cell that's still blank: if someone attached
one meanwhile, theirs stays. The column and statuses are `auditFiles` in
[`js/config.js`](js/config.js); if the Universe has no such column, audit pushes to
the Universe stop and the column check says so (`npm run setup -- --apply --optional`
creates it).

- **Fill** shows each blank with an editor, pre-filled from the brief. Briefs go
  out of date, so change anything before pushing (text, amounts, dates, people,
  Business Unit, Tools); untick any you'd rather leave blank (except a won
  project's Sign Date and Month). If the amount is blank and the row has no VAT%,
  pick the VAT (it's written to VAT% too).
- Only blank cells are ever written. The row is re-read just before writing: a
  cell someone filled meanwhile is left alone, then everything written is read back.
- Never audited: what a person decides (Client, BD, Other Links, Status, Mancom
  Phase, VAT% on its own, PM (LEAD), TRIBE) and what Lark computes (lookups, formulas).
  (Status is only ever changed by hand, with the lost projects' dropdown above.)
- **Hide ▾** (on Universe cards) opens a menu:
  - **Mark as {tag}**, one per custom tag (*No Revenue*, *Hidden*…, see
    [Settings](#settings)). It writes the tag into the Universe row's **Tags** column
    (plain text, tags separated by commas), so it's shared: the
    card leaves **everyone's** Audit list and shows in that tag's group at the
    **bottom of the list** (folded; click to open). The tag is added to whatever the
    cell says in Lark at that moment, so other tags in it stay. It's instant, with
    **Undo**; if Lark refuses, the card moves back and the message says why.
  - **Mark as another tag…**: type any tag (the custom tags and the tags in use are
    suggested; a custom tag typed in any case is that tag). One that isn't a custom tag
    yet is added to Settings > Custom tags first (for everyone; it needs write access to
    the Variables table), then the card is marked with it like the others. A tag that
    looks like a misspelling of one in use (*Federal Lnad*) offers that one first;
    **Mark** again keeps the new spelling.
  - **Hide on this device**: as before, nothing is written to Lark, and the card
    comes back if another cell of that row goes blank.
- **PM** and **CE** cards have the same **Hide ▾**. They span the Universe and ANDON,
  but the tag is written to the project's **Universe** row only (ANDON has no Tags
  column); Unmark takes it off there. *Hide on this device* keeps the card away until
  either PM (or either CE link) changes.

  A card in a tag group has **Unmark** (takes that tag off; the card is back in the
  list) and **Fill**. Only tags in the custom tag list count: other words in the Tags
  column are left alone and don't hide anything. If the Universe has no **Tags**
  column, the menu says so (`npm run setup -- --apply --optional` adds it).

  **ANDON cards keep the plain Hide** (on this device only): ANDON belongs to Project
  Management and has no Tags column, so custom tags are off there and Polaris doesn't
  look for one. The column name and the tables that use tags are `tags.field` and
  `tags.tables` in [`js/config.js`](js/config.js); add `"andon"` there if ANDON ever
  gets a Tags column.

---

## The Universe view

Grouped by **Status** (in the column's own option order, each group with its count
and total), filtered to one **Year** (this year by default; pick another or *All
years*), sorted by **RFP Received Date** (newest first; click the column to flip it).
Columns: Client, Project, Amount (VAT-Ex.) (PHP), BD, AM, Project Code, RFP Received
Date. Groups can be folded.

**Stalled, Lost and Archived** are groups at the **bottom**, under a dashed line,
**folded until you open them** (each remembers being opened, on this device). They're
not pipeline, so they're left out of the count and total at the top; the footer says
how many there are. While searching they open like the others, and the count includes
them. (`foldedStatuses` in `UNIVERSE_VIEW`, [`js/config.js`](js/config.js).)

Shown beside the cards on wide screens only. Pushed rows appear as they land; the
table re-reads Lark (formulas, other people's edits) when you press **Refresh**.

**Search** looks through every column of every row (Project Description, PAR, MKT,
PM, Status… not only the ones the table shows), and includes the Lost, Stalled and
Archived projects the default view hides. Every word you type must appear somewhere
in the row (*lumen hybrid*). The **Year** still applies (pick *All years* to search
them all). Clear the box and the default view is back. The Collections and ANDON
searches work the same way.

---

## The ANDON view

On the **ANDON** tab, the right-hand pane shows **ANDON** (wide screens only): every
row, sorted by **Project Code, Z-A** (codes start with the year and count up, so the
newest projects are on top; numbers compare as numbers, so P1000 is above P0999;
click the column to flip it to A-Z).
Columns: Project, Project Code, AM, PM (LEAD), TRIBE, Event Start.

## The Tagging page

**Tagging**, in the top bar before *Data Audit*: every Universe project and its **Tags**
(plain text, tags separated by commas), newest Project Code first, to tag projects by hand without
misspelling a tag:

- **The tags in use**, above the table, each with how many projects have it, and
  *No tags*. A click shows only those projects (again: all of them). A tag that looks
  like a misspelling of another (the same letters, or a letter or two off:
  *Federal Lnad*, *federal-land*) is marked ⚠, and says which one on hover.
- **× on a tag** takes it off that project. **+** opens a box that suggests the tags in
  use; Enter adds it. A tag typed in another case takes the spelling in use
  (*booth* → *Booth*); a new tag that looks like one in use asks first (*Use "Event"* or
  *Add "Evnt" as a new tag*).
- Each change is written at once and read back, like *Mark as …*: the row is re-read
  and only that tag added or taken out, so tags someone else added meanwhile stay.
  **Undo** in the message puts it back. A click elsewhere on the row opens it in the
  row editor.
- The search looks through the code, project, status and tags.

## The Files page

**Files**, in the top bar after *Tagging*: the files kept in Lark, to download many at
once. Nothing is written to Lark. Three parts:

- **Universe**: every project with a file in **Signed CE (PDF)** or **Other
  Attachments**, newest Project Code first.
- **Collections**: every row with a file in **Invoice** (the project's name comes from
  the Universe; the row's AR Name if the code isn't there).
- **Approvals**: the **Project Brief**, **Project Approval** and **Invoice Request**
  rows whose attachments are in Lark Approval. Polaris can't download those, so each is a
  link that opens the approval; download them there. The columns are the URL columns
  with *attach* in their name (`RULES.filesPage.approvalColumns`).

Click a Universe or Collections row (or its box) to put it in the **Download** list on
the right; **Select all** takes every row the search shows. One file can also be
downloaded on its own from its name. The list says how many files and how big; with
both kinds of file in it, *Include* leaves a kind out. **Download zip** fetches each
file through the connection service (three at a time, as you, like a row's own download
button) and saves one zip, `polaris-files-YYYY-MM-DD.zip`, with the files renamed:

| Column | Name in the zip |
|---|---|
| Signed CE (PDF) | `signed_ce_{project code}_{project name}_{n}.pdf` |
| Other Attachments | `other_{project code}_{project name}_{n}.{its extension}` |
| Invoice (Collections) | `{project code}_{invoice number}_{n}.{its extension}` (`no-invoice-number` when the row has none) |

`n` counts from 1 for each name (two files on one invoice give `_1` and `_2`). Characters a file name can't have are taken out of the project name. A file keeps
its own extension (a signed CE without one gets `.pdf`). A file Lark won't hand over is
left out, and the message names it. The zip is built in the browser (`js/zip.js`,
stored, not compressed) and is capped at 2 GB: take rows out, or download in parts.

---

## The source tables

The table switcher (**▾** on any table's name) also shows the three tables Lark
Approval fills: **Project Brief**, **Project Approval** and **Invoice Request**, newest
submitted first (click *Submitted* to flip it). They're for looking things up, so
they can't be changed from Polaris: each row's **↗** opens the approval in Lark, and
the request number and project code copy when clicked. **Click a row** (or press Enter
on it) to see the whole record, every column, read fresh from Lark, read-only, with
**Open … in Lark** for its approval and **Close**.

| Table | Columns |
| ----- | ------- |
| Project Brief | Request No., Project, Project Code, AM, Contract Value, Status, Submitted |
| Project Approval | Request No., Project, Project Code, Status, Submitted |
| Invoice Request | Request No., Project, Project Code, Amount, Status, Submitted |

**Search** looks through every column Polaris reads from them (Remarks, Initiator
department, Business Unit…), the same way as the other tables. Each table remembers
its own search. Only the newest 300 rows are drawn at once (the footer says how many
more there are); a search finds any of them.

---

## The row editor

**Click any row** in the Universe, Collections or ANDON table (or press Enter on it)
to open the whole record. The row on the right is read fresh from Lark, with every
column (not only the ones the table shows), and every typed one can be changed:

| Column type | Editor |
| ----------- | ------ |
| Text | a box (a bigger one for descriptions and remarks) |
| Number | a box; *1,250,000* and *₱1,250,000* work, anything else is outlined in red and blocks the push |
| Single / multi select | the column's own options (no new options are made) |
| Date | the date field (see *Dates* below); it sets the day, at midnight Manila |
| Person | pick from everyone Polaris knows (the row's own people first) |
| Checkbox, URL | a tick box, an address |
| Attachment | the files it has (click one to download it; × takes it out) and **Add files** (up to 20 MB each) |

**Files download from any row Polaris shows** (beside a push sheet, in the row editor,
or a source table's record): click the file. It comes through the connection service,
as you, and saves under its own name; if Lark won't hand it over that way, a message
offers a temporary download link from Lark instead (valid about a day).

What Lark works out itself (**Formula**, **Lookup**, links, created/modified, auto
numbers) is shown with a tag and can't be changed. Clearing a cell empties it in Lark.

The sheet on the left lists **each change** (what it was, struck through, and what it
becomes). Click one to jump to its field; **×** puts it back as Lark has it. Changed
fields are outlined in the row, with *Was: …* under them. **Push N changes** sends
them to the [queue](#the-push-queue), like any push: new files upload first, then the
row is **re-read**. If someone changed one of the same cells in Lark since you opened
it, nothing is written and the queue says which (**Edit** opens the row again, fresh,
with your changes). If Lark already has every value, nothing is written either. Then
it writes only the changed cells and reads them back. Cancel keeps your changes for
next time (files aren't kept). Pushing needs edit access to that table.

---

## The Collections view

On the **Invoices** tab, the right-hand pane shows **Collections** instead of the
Universe (wide screens only). Columns: AR Name,
Project Code, Invoice Amount, Currency, Sales Remarks, Status, AM; grouped by
**Status** (in the column's own order) and sorted by **Invoice Number** (newest
first; click *Invoice No.* to flip). The invoice number, SI number, date and file
count show under each AR name. After you add an invoice, the new row glows.

**Invoice details.** Invoice Number, SI Number, Invoice Date and the Invoice file
are filled in by hand. If the invoice is already issued, add them when you **Push**
(*Add invoice details* in the sheet; files upload before the row is created, so a
failed upload writes nothing). Otherwise add them later with the **+** (or the
pencil, to edit) on the Collections row: the sheet saves only what you changed, uploads files
first (PDF or image, up to 20 MB each, the most Lark takes in one upload),
then reads the row back to confirm. Clearing a field empties it in Lark.

**Dates.** Every date field takes a typed date (*Oct 14, 2026*, *2026-10-14*,
*10/14/2026*, *14 Oct*…) or opens a calendar on a double-click (or the calendar
button: on a phone it opens the phone's own date picker). A date Polaris can't read is outlined in red and blocks
the push until it's fixed.

**Click to copy.** Request numbers, project codes, PAR numbers, invoice numbers and
SI numbers copy to the clipboard when clicked: on cards (including inside notes),
in the push sheets, and in the Universe and Collections tables.

---

## Settings

The gear in the top bar. It works logged out too.

| Section | What it does |
| ------- | ------------ |
| **Account** | Who you are, when your login ends, **Log in again** (a fresh 2 hours) and **Log out**. Log out logs you out of every Mineski tool in this browser (Polaris, Fetch and Suppliers share the login); you stay logged in to Lark itself. |
| **Appearance** | Light, Dark or System. |
| **Connections** | **Connection service**: Awake (with its version once it reports one), Waking up, Out of date or Unreachable, with **Wake up** / **Try again**. **Lark tables**: connected, with the row count, or the column problems found. One row per table, each with **Open in Lark**. |
| **Advanced** (only on a page opened from this computer) | Another connection service address, saved in this browser. Only an `https://` address, or an `http://` one on this computer. A `?lark=<address>` link does the same for one tab, and `?reset` clears it. While any override is active the top bar shows a red **Overridden** badge (hover it to see what). |
| **Custom tags** | The tags offered under **Hide ▾** on audit cards, with how many rows each marks. **Add tag** adds one; **×** removes one (after a confirmation): its rows come back into the Audit list, and their Tags cells aren't changed, so adding it again groups them again. A tag can't contain a comma or semicolon. The list lives in the **Variables** table in Lark (`TABLES.variables`): one row per tag, with `custom_tag` in the **Variable** column and the tag in **Value** (the names are `tags` in `js/config.js`; if the table names its columns differently, Polaris finds the one with `custom_tag` in it). If the table can't be read, only the custom tags are off. |
| **This browser** | **Clear local data** forgets the audit cards you hid, the tables' sort order and folded groups, and unsent drafts. Your login and theme stay. **Undo** in the message puts them back. |

What Polaris keeps in this browser (every key starts with `polaris.`, all values are JSON):

| Key | Where | Holds |
| --- | ----- | ----- |
| `theme`, `tab` | this browser | the theme choice, the open tab |
| `settings` | this browser | `{ "larkUrl": … }`, the saved connection service address (used on a local page only) |
| `draft` | this browser | what you typed in a push sheet you cancelled, with its retry token, for up to 7 days. Files aren't kept. |
| `queue` | this browser | pushes waiting in the queue (or that didn't go through): what each writes, with its retry token, for up to 2 days. Finished pushes and files that hadn't uploaded aren't kept. Not cleared by **Clear local data**: use **Remove** on the queue page. |
| `auditHidden`, `uniSort`, `uniCollapsed`, `uniOpened`, `colSort`, `colCollapsed`, `andonCodeSort`, `srcSort` | this browser | hidden audit cards, sort order, folded groups |
| `auth.pending` | this tab | a login in progress (it finishes in the tab that started it) |
| `override.lark` | this tab | the `?lark=` link override |

The login itself is **shared by the Mineski tools on this site** (Polaris, Fetch, Suppliers):
`mineski.auth.token` (your login) and `mineski.auth.user` (your name and picture) in this
browser, through `js/session.js` (copied unedited from `design-ref/mineski-systems-design/assets/`).
It lasts until it ends, about 2 hours after you logged in, or until you log out in any of them.
A login kept by an older Polaris in its tab (`polaris.auth.token`) moves over on the first load.

Polaris doesn't keep a copy of the tables: every load reads them fresh from Lark.

---

## How it's built

```
 Your browser: a static page (GitHub Pages, no build step, ES modules)
   │  every Lark call carries YOUR login (Authorization: Bearer), so Lark applies your own permissions
   ▼
 Connection service = the shared Lark proxy  ──▶  Lark Open API (open.larksuite.com)
   on Cloudflare (used first, never sleeps) and Render (the backup), same code and settings;
   adds the app secret ONLY to the login code exchange
 Lark Base is the database. There is no other server and no other database.
```

| Layer | Files |
| ----- | ----- |
| Page shell: state, routes, header, Settings | `index.html`, `js/app.js` |
| Cards, push sheet, Ignore / Undo | `js/inbox.js` |
| Universe, Collections and ANDON tables, and the source tables | `js/universe.js`, `js/collections.js`, `js/andon.js`, `js/sources.js` |
| Transfer rules (pure: no DOM, no network) | `js/sync.js` |
| Every Lark read and write (takes an injected `call`) | `js/ops.js` |
| Talking to the proxy: waking, retries, timeouts, uploads | `js/net.js` |
| Errors as facts and their sentences (pure) | `js/errors.js` |
| Which addresses and versions are acceptable (pure) | `js/service.js` |
| Login and the session clock | `js/auth.js` |
| Saved address and link overrides | `js/settings.js` |
| Everything a maintainer changes | `js/config.js` |

The same `ops.js` runs in the browser (with your login, through the proxy) and in the
Node tools (with the app's token, straight to Lark), because both hand it a `call`.

---

## Safety checks

- **Every column is checked on load** (name, type, and the select options Polaris
  writes). If anything doesn't match, pushing is switched off and the problem is listed.
- **The destination is re-read just before every push.** If it's already there
  (someone else pushed it), nothing is written and the push says so. A
  Collections change also checks its row still says what the card saw (same
  Status, same request number) and that no other row took the request meanwhile.
  Invoice details do the same for the cells you are changing, and the audit
  only fills cells that are still blank (a VAT% someone set meanwhile counts too).
- **Creates are idempotent** (`client_token`), and the token is kept with the draft,
  so a retry (even after a reload) can't make a second row.
- **Pushes are queued, not hurried.** The queue sends one at a time, in order, with the
  same checks as before, and never sends a push twice on its own (see [The push queue](#the-push-queue)).
- **Writes are never retried automatically.** A write that Lark answers with an error
  says *Nothing was written.* A write that timed out (after 2 minutes) or lost the
  connection after it was sent may have landed: Polaris says *couldn't confirm the
  save*, looks at Lark again, and only then lets you try again (or tells you it's already there).
- **Every write is read back** and compared field by field. The message says
  *All 15 fields checked in Lark*, or lists what didn't match.
- Ignore is instant and rolls back (with the reason) if Lark refuses it.
- **A login that Lark says is over** ends the session in one place, for every kind of
  call, and nothing is lost: drafts stay for the next login.

---

## Running it on your computer

```bash
npm run serve        # python tools/serve.py 9123
```

Open **http://127.0.0.1:9123/**. That address is registered as a redirect URL on
Lark app `cli_aab0716138b8ded3` (always `127.0.0.1`, never `localhost`: another
address needs registering too). `tools/serve.py` turns caching off and serves `.js`
as JavaScript (some Windows machines serve it as text, and module scripts then
refuse to run); plain `python -m http.server` does neither. The connection service
(the Lark proxy) runs on Cloudflare, which never sleeps, with a copy on Render as the
backup. If the Cloudflare one can't be reached Polaris moves to Render (reads at once;
pushes only before they're sent, never twice), and then the first load can take up to a
minute while Render wakes up; Polaris says so while it waits.

---

## Hosting it for phones

Any static host works (for example GitHub Pages); there's no build step.

1. Upload the folder (the `tests/` and `tools/` folders aren't needed, and must never include a preview snapshot or a `.env` file).
2. Register the page's exact address, e.g. `https://<user>.github.io/polaris/`,
   in the Lark developer console under *Security Settings > Redirect URLs*.
   Polaris checks this on the login screen and says if it's missing.
3. It must be served over `https://`. On a phone you can *Add to Home Screen*.
4. Everything under one `github.io` address can read what Polaris keeps in the browser
   (the keys above). A dedicated account or a custom domain avoids that.

---

## Going live

1. In [`js/config.js`](js/config.js) set `APP.env` to `"live"` (this is how it's set now).
   The tables come from `TABLES.live`. To go back to the test copies, for example to
   run the end-to-end check, paste their links into `TABLES.test` and set `APP.env`
   to `"test"`: the header then shows a *Test copy* badge. (An empty test link stops
   the page at start-up, so it can never fall back to production.)
2. Run `npm run check:live` (or just open Polaris). Any column that's named or typed
   differently in production is listed, and pushing stays off until it's fixed.
   `npm run setup` adds missing columns and options for you (it only adds).
3. Everyone who uses Polaris needs edit access to those Bases (it writes as them).
4. Older items that predate the Universe: ignore them once in Polaris.

---

## Tests and tools

```bash
npm test                 # offline: transfer rules, errors and codes, writes against a fake Lark, the tools
npm run check:shell      # offline: import map, shared files, watchdog, syntax, no secret in any file
npm run check:proxy      # asks the connection service for its name and version
npm run check:live       # read-only: column check, the card lists and every payload, against the live tables
npm run setup            # dry run: lists missing columns and select options (add -- --apply to create them)
```

**The admin scripts** (`check:live`, `setup`, `check:e2e`, `preview:fixture`) run as the
Lark app, straight to Lark, never through the connection service. They need the app's
secret: copy `.env.example` to `.env` (git-ignored) and fill in `LARK_APP_SECRET`
from the Lark developer console, or set it in the environment. `LARK_APP_ID` is
optional (the app's own id is in `js/config.js`). `setup` only ever **adds**: it never
deletes, renames or retypes a column, and only creates in the Universe and Collections
(the Brief, PAR and Invoice Request tables are filled by Lark Approval; it reports
those). Add `--optional` to also create optional columns (the Universe's IGNORE box).

**Preview mode (developers, no login).** `npm run preview:fixture` saves a read-only
snapshot of the tables to `tests/.preview-fixture.json`; then open
**http://127.0.0.1:9123/?preview** in its own tab. Polaris runs unchanged, but every
Lark call is answered from the snapshot and pushes and uploads are simulated in the
tab (a red badge says so); nothing is sent to Lark. It only works on localhost. The
snapshot holds real business data: never publish it (it's in `.gitignore`) and delete it when done.

**End-to-end (writes to the test copy).** The Lark app can read these Bases but
not edit them, so this runs as you, in the browser: log in to Polaris, then open
**http://127.0.0.1:9123/tests/e2e.html** in the same tab and click *Run the check*
twice. It snapshots every stored field of all five tables, pushes one brief, one
PAR, one Collections change that adds a row and one that moves a row along,
ignores and restores one brief, re-pushes each (expecting *already done*), and
requires the before/after difference to be exactly those writes. It refuses to
run unless `APP.env` is `"test"`, so it can't run while Polaris points at
the live tables.

---

## Design decisions

- **Lark is the database, and you are the user.** Every call carries your own login, so
  Lark's permissions apply and the audit trail shows you.
- **Tables are read in full, never through a view**, so a hidden row can't look like a
  missing project and get added twice.
- **Never write a blank or a guess.** Empty values are left out; a select value is only
  written with an option that exists.
- **Writes are never retried automatically, and "nothing was written" is only said when
  Lark answered with an error.** A lost answer is "couldn't confirm", and the destination is
  re-read before another try.
- **The destination is the judge.** Each push re-reads where it's going and refuses when
  someone got there first.
- **Pure rules, injected `call`.** `sync.js`, `errors.js` and `service.js` have no DOM and no
  network, and `ops.js` takes a `call`, so the offline tests and the Node tools run exactly the code the page runs.
- **A login ends in one place.** Net.js spots a dead-token code on any call and ends the
  session; callers still get the error, so they can roll back first.
- **Everything configurable is in `js/config.js`.** No address, app id, scope or table id is typed anywhere else.
- **JavaScript modules, not classic scripts**, so the tests run the page's own code. An import map
  gives every module a fresh URL on each visit, so nobody needs a hard refresh after a deploy.
- **No cached copy of the tables in the browser.** The first paint waits for Lark; the trade is that
  nothing business-related is left on a shared computer.

---

## Security and privacy

- **No secret is in the page or the repository.** The Lark app secret lives on the
  connection service (and in an admin's git-ignored `.env`). Only the app's public id is in `js/config.js`.
- **Known issue, outside Polaris: the shared Lark proxy can still hand out an app token.** As of
  Oct 2026 its `GET /token`, and its `/proxy` forwarding of `tenant_access_token`, add the app
  secret for anyone, and that token can read and write the Bases without any login. Polaris's own
  logins are safe (they're bound to your tab by PKCE), but until the proxy adds the secret only
  to the login code exchange (see `SYSTEMS-PARITY.md`, P0) the protection of the data is Lark's
  permissions on the app, not Polaris. The Node tools no longer need that route.
- **One login for every Mineski tool on this site** (`localStorage` `mineski.auth.token`): log in to
  Polaris, Fetch or Suppliers and every tab of all three is logged in, with one timer. Closing the
  tab doesn't log you out (the login lasts about 2 hours), so on a shared computer use **Log out**.
  Every page on `mineski-stephen.github.io` can read that storage, so only Mineski tools are
  published there. The token is sent only to the connection service, in an `Authorization` header,
  never in an address. **Log out is local**: it logs you out of every Mineski tool in this browser
  (other open tabs show the login screen at once, after any push already running); Lark has no
  way to revoke a login, so it still lasts up to 2 hours if someone copied it.
- **The page may only talk to itself and the connection service**: a `Content-Security-Policy` meta lists them
  (and local addresses for testing), and a `referrer` meta keeps addresses private.
- **Overrides work only on a local page**, accept only `https` (or local `http`) addresses, and always show a red badge.
- **What stays in this browser:** your theme and tab, hidden audit cards and view choices, the connection
  service address you saved for testing, unsent drafts (typed text and a retry token, for up to 7 days), and
  pushes waiting in the queue (what each will write, for up to 2 days, so a re-login doesn't lose them).
  Otherwise business data from Lark isn't kept: on a shared computer, empty the queue before you leave. **Clear local data** in Settings removes the drafts and view choices.
- The preview snapshot and `.env` are git-ignored. `npm run check:shell` fails if a key, an app secret or a token
  turns up in any file that would be published.

---

## Known limits

- **Attachments.** The brief's files live in Lark Approval, which this app has no
  permission to read, so they're downloaded and uploaded by hand (see *The brief's
  files → the Universe*). Lark takes files up to 20 MB through
  this app: upload bigger ones in Lark.
- **Client** isn't on the Project Brief, so it's typed in the sheet (or left for later).
- **Old PARs and invoices.** Nothing in those tables is marked IGNORE yet, so older
  ones for projects in the Universe show up once. Push or ignore them. Approved
  requests whose invoices were typed into Collections by hand with a slightly
  different amount can't be matched safely; their cards say so, so pick the row
  in the sheet or ignore the card.
- **Tranches.** A won project gets one For Invoicing row for its whole amount.
  Split it into tranche rows by hand if it's billed in parts; requests then find
  the right tranche by amount.
- **Lark API formats.** Read-backs use `records/batch_get` (the single-record GET
  returns numbers as text). Text columns only accept plain text; Lark still shows
  URLs in them as clickable links.
- **The row editor and times.** A date changed in the row editor is a day (midnight
  Manila); a date column that also holds a time loses it when changed. Phone,
  location and other uncommon column types are shown but can't be changed.
- **Narrow screens show the cards only.** Below 1280 px there's no Universe or
  Collections table, so a Collections row's invoice details (number, SI, date, file)
  can be added only from the push sheet of an approved request, or on a wider screen.
- **Files in a draft.** If you cancel (or reload) an invoice or audit sheet, the text you typed comes
  back, but the files you picked don't: add them again.
- **One login lasts about 2 hours.** Lark gives no refresh token, so after that you log in again.

---

## Troubleshooting

| You see | What to do |
| ------- | ---------- |
| *Port 9123 is already in use, so this server didn't start.* (`tools/serve.py`), or the browser says *127.0.0.1 didn't send any data* | Another server already has port 9123, often an old one left running in the background. Stop it (close its window, or end the `python` process in Task Manager), then run `python tools/serve.py` again. Lark login only works on port 9123. |
| *Polaris couldn't start.* | Reload. If it keeps happening, open Polaris from its web address (not a saved file). If you just deployed, a file is probably missing or not listed in the import map in `index.html`: run `npm run check:shell`. |
| People report an old version (the number beside "Polaris" in the top bar is lower than the newest entry in `CHANGELOG.md`) | The page and every script are fetched fresh on each visit, so this is almost always the host's own cache (GitHub Pages can take a few minutes after a push) or an old tab left open. Reload the tab; in the browser console, `APP_BUILD` changes on each load. Check the files on the host are the new ones. |
| *Waking up the connection… This can take up to a minute.* | Nothing; the free Render service is starting. It retries for up to 3 minutes. |
| *Polaris can't reach its connection service.* (red box, mentions an ad blocker) | Allow `lark-proxy.stephen-lin.workers.dev` (and `lark-proxy-dwiw.onrender.com`, the backup) in your ad blocker or privacy extension (or pause it on this page), then **Reload**. |
| Settings > Connections: "… (the backup: the usual one can't be reached)" | The connection service on Cloudflare didn't answer, so Polaris is using the copy on Render. Everything works; the first call after a while may wait for Render to wake up. If it lasts, check the Worker on Cloudflare (its Logs say why). |
| *Polaris can't reach its connection service (…). It may still be waking up* | Try again in a moment. If it stays, check `npm run check:proxy` or ask the admin. |
| *Out of date (…). Ask the admin to redeploy it.* (Settings > Connections) | The connection service is older than this page needs (`SERVICES.lark.min` in `js/config.js`). The admin redeploys it; see its README. |
| *This address (…) isn't registered on the Lark app* on the login screen | Add that exact address under *Security Settings > Redirect URLs* for the app. |
| *Your login ended after about 2 hours.* | Log in again. Watch the clock in the header; *Log in again* in Settings renews it early. |
| *Your login ended in another tab.* | You (or someone at this computer) logged out of Polaris, Fetch or Suppliers in another tab, or Lark ended the login there. They share one login, so log in again in any of them. |
| *Your login has ended. Log in again.* | Lark said the login is over (it expired, or was ended in Lark). Log in again; your drafts are still there. |
| *Your login ends at 4:30 PM.* (stays on screen) | Log in again to keep working without a break. |
| *Your login is about to end, so this wasn't sent.* | Log in again, then try it again. |
| *Polaris couldn't confirm the save. Refresh before trying again.* | The answer never came back, so the push may have gone through. Polaris looks at Lark again: if it's there you get *It's in Lark.*; if not, push again (the retry can't add a second row). |
| *Nothing was written. …* | Lark answered with an error, and the rest of the message says why. Fix that and push again (in the queue: **Retry**, or **Edit** to change it). |
| *N pushes didn't go through.* (stays on screen, **Open queue**) | Open the queue; each one says why. **Retry**, **Edit** or **Remove** it. |
| *Your login is about to end, so the queue stopped.* | **Log in again**. The waiting pushes are kept in this browser and carry on once the tables load. |
| *Its file was lost when the page reloaded.* (queue) | The page reloaded before that file uploaded. **Edit** the push, add the file again, and push. |
| *Not sent: it's no longer in its list.* (queue, *Check in Lark*) | The card left its list before its turn (someone did it in Lark, or it was ignored). Nothing was written. |
| *Polaris couldn't confirm it. Check it in Lark before retrying.* (queue) | The answer never came back and Lark couldn't be re-read. Look at the row in Lark; **Retry** only if it isn't there. |
| A card you pushed isn't in the list | It's in the queue (hover **Queue**). **Remove** there brings it back. |
| *These columns don't match what Polaris expects…* | A column was renamed or changed type (common when switching to production). Fix the table, or run `npm run setup` for a missing column or option. |
| A greyed-out **Fill** or **Push** on a card | Hover it: it says which column is missing or wrong (the tab's red box lists them too). Only the cards that need that column are off. |
| *Your login can only read the tables.* | Log in again so Lark grants editing. |
| *Lark says your account can't open or edit this Base.* | Ask the Base owner for edit access. |
| *Your account isn't allowed to change this table (its permissions are restricted).* | Ask the Base owner. |
| *… is already in the Universe. Someone else already did this.* | Nothing; it was pushed elsewhere. Press **Refresh** to see the list as Lark has it. |
| *Check these in Lark: …* after a push | A value didn't land as sent. Open the row in Lark and correct it. |
| *Note: looks like "…" already in the Universe* | Probably a re-filed brief. Ignore it if it's the same project. |
| *Push this project's brief first.* | Use **Go to the brief**, push it, then the PAR or invoice can go. |
| *Add this project's PAR to the Universe first.* | Use **Go to the PAR** (if it's listed), push it, then the invoice can go. |
| *"…" changed since the list was loaded.* | Someone updated that Collections row meanwhile. Nothing was written; the list refreshed, so check the card again. The same message appears for invoice details: the cells you changed were changed in Lark first. |
| **Fill** is greyed out on a won or lost project's sheet | A required field is still blank (Sign Date and Month; Loss Month and Reason for Loss). Fill them in. |
| *A won project needs Sign Date and Month.* (queue) | The push reached the queue without them (it can't from the sheet). **Edit** it and fill them in. |
| *Nothing was written. Status changed in Lark since the row was opened.* (queue, a row edit) | Someone changed the same cell meanwhile. **Edit** opens the row fresh from Lark with your changes; check it and push again (or **Remove**). |
| No *Mark as …* under Hide, only *Why no “Mark as …”?* | The Universe has no **Tags** column (or your login can only read). Click it to see which; add the column (a plain text column named `Tags`) and press **Refresh**. |
| An ANDON audit card has a plain **Hide**, no menu | That's on purpose: custom tags are Universe-only (`tags.tables` in `js/config.js`). |
| *Polaris couldn't find the custom tags in the Variables table.* (Settings) | The Variables table needs a column with `custom_tag` in it and a value column (ideally named **Variable** and **Value**). |
| *Add the file for Signed CE (PDF)…* (Fill) | Use **Add the signed CE** to pick the PDF, or untick **Signed CE (PDF)** to fill the card's other blanks without it. |
| *"…" is over 20 MB* (Fill) | Compress the PDF (or split it into parts and add each one), then add it again. |
| *Someone had already filled …, so those were left as they were.* (after Fill) | The audit only fills blank cells; those weren't blank any more. |
| Red **Overridden** badge in the top bar | This browser is using another connection service address (Settings > Advanced, or a `?lark=` link). Clear it there, or open the page with `?reset`. |
| Red *Preview mode* badge | `?preview` is on: the data is a snapshot and nothing is sent to Lark. Open Polaris without `?preview`. |
| **Ignore** is greyed out on a *Won* card | The Universe has no IGNORE checkbox column yet. Add one (named `IGNORE`, or `npm run setup -- --apply --optional`) to hide won projects that shouldn't go to Collections. |
| A card would add a new Collections row you think already exists | Pick that row in the sheet instead (rows recorded by hand show *add the number only*), or ignore the card. |

---

## Maintenance recipes

**Release a change.** Every change people will see gets a version. Bump `APP.version` in
`js/config.js` (patch for a fix, minor for something new, major when people must relearn something or old
links or data stop working), add an entry with the same number and the date at the top of `CHANGELOG.md`
saying what changed in the team's words, and run `npm run check:shell` (it fails if the two numbers
differ). The top bar shows the version beside the name, so people can check at a glance that they have the
latest one; if they don't, they reload the page.

**Add a column the page reads or writes.** Add it to `schemaSpec` in `js/ops.js` (its type, and `options` for
any select value Polaris writes), use it in `js/sync.js`, add a test, then run `npm run setup` to create it
in Lark (or add it by hand), and `npm run check:live`.

**A column was renamed in Lark.** Change the name in `schemaSpec` (`js/ops.js`) and wherever `js/sync.js` reads
it, run `npm test` and `npm run check:live`. Until then the page lists the column as missing and switches pushing off.

**Add a select option Polaris writes** (a new status, say): put it in `RULES` (`js/config.js`) and in the table's
`options` in `schemaSpec`; `npm run setup -- --apply` adds it to the column in Lark.

**Go live, or back to the test copies.** See [Going live](#going-live): `APP.env` and the links in `TABLES`.

**Point at another Base or table.** Paste the link, exactly as copied from the address bar, into `TABLES.live`
(or `.test`) in `js/config.js`. Links to a `/wiki/` page are refused: open the Base itself.

**Register a new address** (another port, the hosted page): add it under *Security Settings > Redirect URLs*
for the Lark app. Polaris says on the login screen if it's missing.

**Add a JavaScript file.** Add it to the `files` list in the loader script of `index.html` (the import map), or
the page won't start. `npm run check:shell` catches a missing entry.

**The connection service got a new version.** Run `npm run check:proxy`. Only raise `SERVICES.lark.min` in
`js/config.js` after the proxy itself is deployed.

**Rotate the app secret.** Change it in the Lark developer console and on the connection service's environment,
then in your `.env`. Nothing in the page changes.

**Refresh the shared files** (`js/ui.js`, `js/icons.js`, `css/mineski-base.css`, `css/theme.css`): change them in the
design language first, copy them over unedited, then `npm run check:shell` confirms they match.

---

## Files

| File | Purpose |
| ---- | ------- |
| `CHANGELOG.md` | Every change and version update, newest first. Its top entry matches `APP.version`, which the top bar shows beside the name. |
| `index.html` | The page: the one-time storage move, security metas, the loader and import map, every view, the boot watchdog. |
| `css/theme.css`, `css/mineski-base.css` | Polaris's colors (light and dark) and the shared Mineski stylesheet: unedited copies of `design-ref/mineski-design-language/assets/themes/polaris.css` and `assets/mineski-base.css`. |
| `css/app.css` | Only what is Polaris's own: the workspace, the tables' columns, the flow line, the audit, the push sheet and its row, the queue, and the date field. |
| `img/` | The Polaris icon (SVG, plus PNGs for the favicon, phones and the home screen). |
| `manifest.webmanifest` | Lets phones add Polaris to the home screen. |
| `js/config.js` | Everything a maintainer changes: `APP` (name, `version`, `env`), `SERVICES`, `LARK` (app id, scopes, API), `TABLES` (live and test links), business rules, the Universe view. |
| `js/sync.js` | The transfer rules as pure functions: cards, what gets written, the Universe view, read-back checks, fill-blanks and invoice re-check rules, drafts. |
| `js/ops.js` | Every Lark read and write: column check, full-table loads, pushes with re-check and read-back. |
| `js/net.js` | The connection service: waking it, retries, timeouts, uploads with progress, ad-blocker detection, dead-token detection. |
| `js/errors.js` | Errors as facts (`LarkError`), the dead-token codes, and one sentence for every code (`describeLark`). Pure. |
| `js/service.js` | Which addresses may override the connection service, and whether its `GET /` answer means awake and recent enough. Pure. |
| `js/settings.js` | The saved connection service address and `?lark=` / `?reset` link overrides (local pages only). |
| `js/auth.js` | Lark login (OAuth + PKCE), the session, work in flight (`track`), and how a session ends, here or in another tab. |
| `js/session.js` | The login shared by every Mineski tool on the site. Copied unedited from `design-ref/mineski-systems-design/assets/`. |
| `js/app.js` | Routes, header, loading, Settings, the session clock, and what happens after a push (quietly, for the queue). |
| `js/inbox.js` | The cards, the push sheet (with the BD picker), Ignore / Undo, and the push itself (`perform`) that the queue runs. |
| `js/queue.js` | The push queue: runs pushes one at a time, re-checks uncertain ones, keeps waiting ones in this browser; the Queue tab, its hover list and the queue page. |
| `js/rowdoc.js` | The row beside the push sheet: the Lark row as the push will leave it, changes highlighted. |
| `js/universe.js` | The Universe table. |
| `js/andon.js` | The ANDON table. |
| `js/tagging.js` | The Tagging page: every Universe project and its tags, added and taken off one at a time. |
| `js/files.js` | The Files page: the Universe's and Collections' files, picked into a list and saved as one zip; the approvals' links. |
| `js/zip.js` | Makes a zip in the browser (stored, UTF-8 names), for the Files page. |
| `js/sources.js` | The Project Brief, Project Approval and Invoice Request tables (read-only), shown with the table switcher; a row opens read-only (`inbox.js` `openView`). |
| `js/collections.js` | The Collections table and its invoice details sheet. |
| `js/icons.js`, `js/ui.js` | The shared Mineski icons and UI helpers: unedited copies of `design-ref/mineski-design-language/assets/`. Change them there, then copy them over. |
| `js/polaris-ui.js` | Polaris-only helpers on top of `ui.js`: Lark date-only days, the date field, copyable request numbers and project codes in a sentence. |
| `tools/serve.py` | The dev server: no caching, JavaScript served as JavaScript. |
| `tools/setup.mjs` | Setup and repair: creates missing columns and select options (dry run by default; only ever adds). |
| `tools/check-shell.mjs`, `tools/check-proxy.mjs` | `npm run check:shell` and `npm run check:proxy`. |
| `tests/` | Offline tests (`*.test.mjs`), the live read-only check, the end-to-end check, preview mode, and `lark-node.mjs` (the app's token and a direct `call` for the Node scripts). |
| `.env.example` | Template for the git-ignored `.env` the admin scripts read. |

Polaris follows the Mineski design language (`.claude/skills/mineski-design-language/`) and the systems design
(`.claude/skills/mineski-systems-design/`).
