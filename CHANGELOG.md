# Changelog

Every change and version update of Polaris, newest first. The version is
`APP.version` in `js/config.js`; the top bar shows it beside the name ("v1.0.0").

**Releasing a change:** bump `APP.version` (semver: patch for fixes, minor for
new features or behaviour, major when people must relearn something or old data
or links stop working), add an entry here with the same number and the date,
and say what changed in the team's words. `npm run check:shell` fails if the
two numbers differ.

## 1.10.4 · Nov 4, 2026

- **Changed:** switching the table beside the list (Universe, Collections, ANDON, the
  Lark Approval tables) keeps what's typed in its search.
- **Fixed:** picking someone in a people picker (PM, BD) closes its list, so it no
  longer covers the button below. Click the box to open it again.

## 1.10.3 · Nov 3, 2026

- **Changed:** when an invoice request is filed and its project's For Invoicing row
  becomes Pending, the row also takes the request's **amount and currency** (a For
  Invoicing row starts as the Universe's amount in PHP). The card's note says what
  changes, e.g. *"Tranche 1" is PHP 200,000; it becomes the request's USD 4,000.*
- **Changed:** links in the row beside the form (a request number, *1 attachment(s)*)
  open in Lark Approval.

## 1.10.2 · Oct 30, 2026

- **Fixed:** a long status badge on a card no longer pushes the date onto its own
  line. The badge ends in "…" instead.

## 1.10.1 · Oct 30, 2026

- **Changed:** files can be up to **20 MB** each (was 10 MB), the most Lark takes in
  one upload. Bigger ones still go in through Lark.

## 1.10.0 · Oct 30, 2026

- **New:** the Universe tab shows projects whose **Other Attachments** is blank and
  whose Project Brief has files. The card links to the files in Lark Approval: download
  them, then **Upload** them through Polaris (up to 10 MB each).

## 1.9.4 · Oct 29, 2026

- **Changed:** a people picker's list stays closed when the push form opens. It
  opens when you click the picker or start typing (or press the down arrow).

## 1.9.3 · Oct 29, 2026

- **Fixed:** the list of people under a picker (PM, BD, AM) was cut off inside
  the push form, so you couldn't see or click it. It now opens over the page,
  above the field when there's no room below.

## 1.9.2 · Oct 29, 2026

- **Changed:** the login page shows the version under the name instead of a
  line about what Polaris does, the same as Fetch.

## 1.9.1 · Oct 29, 2026

- **Fixed:** when a column the Audit needs is missing (for example the Universe's
  **Loss Month**), the Audit tab now says which, and hovering a greyed-out **Fill**
  shows why. Before, the buttons were just off. The same goes for the ANDON tab's
  approval cards.

## 1.9.0 · Oct 29, 2026

- **Briefs and PARs are one tab: Universe.** Everything waiting to go into the
  Universe is in one list, newest first; a PAR's card says *PAR …*. Each still pushes
  the way it did. Old links to the Briefs or PARs tab open the Universe tab, and
  **Go to the brief** / **Go to the PAR** highlight the card in the same list.
- **Collection Date for approved invoices.** On the **Invoices** tab, an approved
  request (its Collections row moves to *For Collection*) now asks for the
  **Collection Date**, and won't push until it's filled. It's written to the row's
  Collection Date column.
- **New audit: the PM must match.** A project whose **PM** in the Universe and **PM
  (LEAD)** in ANDON aren't the same, or is blank in either, gets an Audit card (it shows
  both). **Fill** picks one PM (ANDON's is filled in, else the Universe's) and sets it
  in both, every ANDON row of the project included. It won't push while the PM is
  blank. If someone changed either PM in Lark meanwhile, nothing is written anywhere.

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
