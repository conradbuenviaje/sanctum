# Changelog

Every change and version update of Polaris, newest first. The version is
`APP.version` in `js/config.js`; the top bar shows it beside the name ("v1.0.0").

**Releasing a change:** bump `APP.version` (semver: patch for fixes, minor for
new features or behaviour, major when people must relearn something or old data
or links stop working), add an entry here with the same number and the date,
and say what changed in the team's words. `npm run check:shell` fails if the
two numbers differ.

## 2.2.1 · Nov 4, 2026

- **"NO TRIBE ASSIGNED" counts as no tribe.** A project whose ANDON TRIBE says NO TRIBE
  ASSIGNED is now asked for a real one, and every Tribe Lead is on it (as with a blank). It's
  no longer listed under Tribe leads on the Admin page. The values are `blankValues` in
  `js/config.js`.

## 2.2.0 · Nov 4, 2026

- **Who's on a missing AM, PM or tribe** now follows how the team works:
  - A blank **AM**: the **Account Director** is responsible and accountable for assigning one.
  - A blank **PM (LEAD)** or **TRIBE**: the project's **Tribe Lead** is responsible and the
    **Project Director** is accountable. While a project has no tribe yet, every Tribe Lead
    is listed, since they decide together at the Win meeting which tribe takes it.
- **Admin page:** new **Tribe leads** section, one per ANDON tribe (the Project Director can
  lead the Marketing tribe too), and the Account Director and Project Director roles.
- **Admin page:** saved rules that name different people than the starting rules (like the AM,
  PM and TRIBE rules saved before this version) are listed above the rules, with **Update**
  to bring just those up to date. Other rules are left as they are.

## 2.1.0 · Nov 3, 2026

- **Dismiss a blank, with a reason.** Each blank on the Accountability board has a **×**:
  say why it doesn't need filling (required), and it leaves the board and the daily digest.
  It's kept under **Dismissed with a reason** at the bottom, with who dismissed it and when,
  for everyone, and **Restore** puts it back. The digest says how many are dismissed.
- **Admin page:** add someone by email when they aren't a BD, AM or PM anywhere yet, and
  admins are recognised by their Lark name when Lark doesn't send the email.
- **Login page:** says so when the connection service doesn't accept the site it's on.

## 2.0.0 · Nov 3, 2026

**Polaris is now Sanctum**, the operations team's tool for making sure every project has
someone responsible and accountable for it. Everything Polaris did is still there under
**Data Audit**.

- **Accountability board** (the new home page): every project from Jan 2025 on is checked
  for the fields it must have at its stage: BD, AM and PM from the start, the amount and
  dates once it's pitching, PAR, Sign Date and the Collections row once it's won, the signed
  CE once it's signed, invoice details once it's for collection, and the reason once it's
  lost. Each blank shows who is **Responsible** for filling it and who is **Accountable**
  for it being filled, by person or by project. **Mine** shows only yours. Click a blank to
  open its row and fill it.
- **Admin page**: change the rules (which field, from which stage, who's responsible and
  accountable), who holds the Universe Keeper, Ops Lead and Finance roles, the Telegram
  handles, the start date, and who may change all this. It's saved in the Variables table
  in Lark, so everyone and the daily digest use the same rules.
- **Daily Telegram digest**: every weekday at 9:00, each person's blanks are posted to the
  team's Telegram group, new ones marked. Set up in `.github/workflows/digest.yml`.

## 1.8.0 · Oct 26, 2026

- **The ANDON approval moved to the ANDON tab, and follows the Project Approval.**
  Any ANDON row whose project code has a Project Approval, and whose **Approval** is
  blank, gets a card on the **ANDON** tab: **Push** adds that PAR's Request No. (its
  number, linking to the approval in Lark). It no longer depends on the project being
  won in the Universe, and it's no longer an Audit card.

## 1.7.0 · Oct 26, 2026

- **New audit: ANDON approval.** A project that's won in the Universe must have its
  approval in ANDON. If its ANDON row's **Approval** is blank it gets an Audit card,
  already filled in with the link to the project's Project Approval (the PAR's request
  number, an Approved one first). Change it if it's wrong; with no PAR to link to, paste
  the link yourself.
- **Download attached files.** A file in any row Polaris shows (beside a push sheet,
  in the row editor, or a brief, PAR or invoice request) is a button: click it to
  download it. If Lark won't hand the file over directly, a link to download it
  appears instead.
- **Open a brief, PAR or invoice request.** In the Project Brief, Project Approval and
  Invoice Request tables, click a row to see the whole record, every column, fresh from
  Lark, with its approval one click away. They stay read-only.

## 1.6.2 · Oct 20, 2026

- **Fixed:** on iPhone and iPad, tapping a date field's calendar button now opens the
  date picker.
- The Universe table now shows **Stalled**, **Lost** and **Archived** projects as
  groups at the bottom, folded until you open them. They stay out of the count and
  total at the top.

## 1.6.1 · Oct 20, 2026

- The **Client** filter is now a box you type in: it shows the closest matching
  clients (with how many cards each) as you type; click one or press Enter.

## 1.6.0 · Oct 20, 2026

- **Filter the lists** by **Client**, **Status**, **BD**, **AM** and **Tribe**: the
  funnel beside the search. The filters are the project's (from the Universe, Tribe
  from ANDON if the Universe has none), apply to every tab and its count, and show as
  chips you can clear. A new brief that isn't in the Universe yet uses its own BD and
  AM, and counts as *No status*.

## 1.5.0 · Oct 20, 2026

- **Put a lost project's status right.** The Fill sheet for a *Stalled*, *Lost* or
  *Archived* project now has a **Status** dropdown with those three, for projects
  marked Lost by mistake. The change goes to Lark with the Fill, but only if the
  row's Status hasn't been changed by someone else meanwhile.

## 1.4.2 · Oct 20, 2026

- The Fill sheet no longer spells out the rule ("A lost, stalled or archived project
  needs …", "A won project needs …") while a required field is blank. **Fill** just
  stays off until it's filled.

## 1.4.1 · Oct 20, 2026

- The Universe row beside a push sheet now shows **Quick Remarks** (it wasn't read
  before, so it never appeared). It's also found by the Universe search.

## 1.4.0 · Oct 20, 2026

- **Look up briefs, PARs and invoice requests beside any list.** The table switcher
  (▾ on the table's name) now also offers **Project Brief**, **Project Approval** and
  **Invoice Request**: newest submitted first, searchable across every column, with
  a link to each approval in Lark. They're read-only.
- **New audit: lost projects.** A Universe project that's *Stalled*, *Lost* or
  *Archived* must have a **Loss Month** and a **Reason for Loss**. If either is
  blank it gets an Audit card (even without a brief), and the Fill needs both.

## 1.3.3 · Oct 19, 2026

- The Project Brief no longer has an **MKT** column, so Polaris stopped asking for
  it (pushing was switched off with *Project Brief: column “MKT” is missing.*). A
  pushed brief now leaves the Universe's **MKT** and ANDON's **MKT (PITCH)** blank,
  and the audit no longer offers them as blanks the brief can fill. Set MKT by
  clicking the project's row in the Universe table.

## 1.3.2 · Oct 19, 2026

- Settings > Custom tags no longer shows a stray "null" under the Add tag box.

## 1.3.1 · Oct 19, 2026

- Custom tags are for **Universe** audit cards only. ANDON belongs to Project
  Management and has no Tags column, so its audit cards keep the plain **Hide**
  (on this device), and Polaris no longer looks for a Tags column there.

## 1.3.0 · Oct 19, 2026

- **Custom tags on audit cards.** **Hide ▾** now offers *Mark as No Revenue*,
  *Mark as Hidden* and any other custom tag, plus *Hide on this device* as before.
  Marking writes the tag into the row's **Tags** column (Universe or ANDON), so the
  card leaves the Audit list for everyone and shows in that tag's group at the
  bottom of the list. **Unmark** puts it back; **Undo** works too.
- **Settings > Custom tags** lists the tags (from the Variables table in Lark),
  with how many rows each marks. Add one, or remove one (its rows come back into
  the list; their Tags cells aren't changed).
- Searching the Audit list also finds cards by their tag.

## 1.2.1 · Oct 19, 2026

- **ANDON is sorted by Project Code, Z-A**, so the newest projects are on top
  (click *Project Code* to flip it to A-Z).
- **Switch the table beside the list.** Click the table's name (*Universe ▾*) to show
  Collections, ANDON or the Universe instead, whichever tab you're on. Each tab keeps
  its pick until you reload; pick the tab's own table to go back.

## 1.2.0 · Oct 19, 2026

- **Search finds everything.** The Universe and Collections searches look through
  every column of every row (description, PAR, MKT, remarks…), and in the Universe
  they include Lost, Stalled and Archived projects too. The year you picked still
  applies. With the search box empty, the tables look just as before.
- **ANDON has its own table.** On the ANDON tab, ANDON sits beside the cards
  (newest event first, searchable) instead of the Universe.
- **Click a row to open it.** Any row in the Universe, Collections or ANDON opens
  the whole record, every column, ready to change: text, amounts, dates, people,
  selects, checkboxes, links and files (add or remove). Formulas and lookups are
  shown but locked. The sheet lists each change you've made (with × to undo it);
  **Push** sends them to the queue. Before writing, Polaris re-reads the row; if
  someone changed one of the same cells meanwhile, nothing is written and the
  queue says which.

## 1.1.0 · Oct 19, 2026

- The **Audit** tab now checks that every *Fully Closed*, *For Closing*, *For
  Collection* and *Signed CE* project has its signed CE on file. A project whose
  **Signed CE (PDF)** is blank gets a card (even without a brief). **Fill** lets you
  add the PDF (one file or several); they're uploaded to Lark as you when the push
  runs, then put on the project's Universe row and read back to check.
- A card's other blanks can still be filled without the file: untick
  **Signed CE (PDF)**.

## 1.0.1 · Oct 16, 2026

- The lists no longer refresh on their own. Coming back to the tab after a while,
  or the queue finishing, doesn't reload them any more, so cards don't move while
  you're working; press **Refresh** to see what changed in Lark. A pushed card still
  leaves its list as soon as you push it.
- A card sliding out of the list no longer flashes a sideways scrollbar.

## 1.0.0 · Oct 16, 2026

- Initial release.
