/* Polaris: everything a maintainer may change. No secrets: the site is public.

   APP.env picks the tables. Production and the test copies differ only in the
   links under TABLES (and the "Test copy" badge that follows from APP.env). On
   every load the page re-checks each field it uses (name, type and the select
   options it writes) and refuses to push if anything is missing, so a renamed
   column fails loudly instead of writing bad data. Node scripts import this file
   too, so keep it free of browser APIs. */

/* version: bump it with every release and add an entry to CHANGELOG.md (newest first, same number).
   The top bar shows it beside the name, so people can see at a glance which version they're running. */
export const APP = { name: "Polaris", key: "polaris", version: "1.13.1", env: "live" };   // env: "live" | "test"
export const ENV_LABEL = APP.env === "test" ? "Test copy" : "";         // shown in the header, never a gate

/* The connection service: the shared Lark proxy (Render). `service` is the name its
   GET / answers with; `min` and `headers` are checked once it reports a version. */
export const SERVICES = {
  // The Lark proxy (tech/lark-proxy) runs in two places, tried in this order: Cloudflare Workers
  // (never sleeps), then Render (the backup). Both must be in index.html's connect-src.
  lark: { urls: ["https://lark-proxy.stephen-lin.workers.dev", "https://lark-proxy-dwiw.onrender.com"],
          service: "lark-cors-proxy", min: "2.0.0", headers: ["Authorization"] },
};

export const LARK = {
  appId: "cli_aab0716138b8ded3",
  scopes: "bitable:app",
  api: "https://open.larksuite.com/open-apis",
  authorize: "https://accounts.larksuite.com/open-apis/authen/v1/authorize",
  maxUploadMb: 20,       // Lark's upload_all takes up to 20 MiB; the proxy's MAX_BODY_BYTES must be above it
};

/* One Lark link per table, exactly as copied from the address bar. */
export const TABLES = {
  live: {
    universe:    "https://mineskiglobal.larksuite.com/base/NP7TbjwHNaTyLOsWafelN9wNgEd?table=tblEmWYOXoAF70uf&view=vewFlJYfpR",
    collections: "https://mineskiglobal.larksuite.com/base/NP7TbjwHNaTyLOsWafelN9wNgEd?table=tbln7I51ONseeG55&view=vewZ7gtj5w",
    brief:       "https://mineskiglobal.larksuite.com/base/NP7TbjwHNaTyLOsWafelN9wNgEd?table=tblu5GcPn9RoCcev&view=vewL6Eydfw",
    par:         "https://mineskiglobal.larksuite.com/base/NP7TbjwHNaTyLOsWafelN9wNgEd?table=tblFrfsaJZrLLpLQ&view=vewH1nekbn",
    invoice:     "https://mineskiglobal.larksuite.com/base/NP7TbjwHNaTyLOsWafelN9wNgEd?table=tblnZyLzHXfzrzQt&view=vewO7Hk4IE",
    // ANDON (Project Management), test copy. Only users can open this Base (the
    // Lark app itself can't), so the Node checks skip it. Don't use the "ANDON 2026"
    // table in the base above: it's a synced, read-only mirror.
    andon:       "https://mineskiglobal.larksuite.com/base/DOoobrd5IaEIwjshAnuuuDFasjg?table=tblS77AM8iHOWd0s&view=vewxixKUQf",
    // Variables: settings the team edits from Polaris (Settings > Custom tags), one
    // row per value (see RULES.tags).
    variables:   "https://mineskiglobal.sg.larksuite.com/base/NP7TbjwHNaTyLOsWafelN9wNgEd?table=tblKxdm95rmy8d9B&view=vewl27jzDV",
  },
  // The test copies. Paste their links here before setting APP.env to "test": an
  // empty link stops the page at start-up, so it can never fall back to production.
  test: {
    universe: "", collections: "", brief: "", par: "", invoice: "",
    andon:       "https://mineskiglobal.larksuite.com/base/DOoobrd5IaEIwjshAnuuuDFasjg?table=tblS77AM8iHOWd0s&view=vewxixKUQf",
    // (settings, not project data: the test setup shares the live list of custom tags)
    variables:   "https://mineskiglobal.sg.larksuite.com/base/NP7TbjwHNaTyLOsWafelN9wNgEd?table=tblKxdm95rmy8d9B&view=vewl27jzDV",
  },
};
export const TABLE_LINKS = TABLES[APP.env];

export const RULES = {
  // Only briefs and invoice requests filed by these departments become cards
  // ("Sales" is what Account Managers was called before Oct 2025).
  // ANDON takes briefs from every department.
  departments: ["Account Managers", "Sales"],

  // Amount (VAT-Ex.) (PHP) = filed value × (usdRate if USD) ÷ (vatDivisor if 12% VAT).
  usdRate: 57,          // internal rate, not the BSP rate
  vatDivisor: 1.12,

  // A pushed brief starts the Universe pipeline here.
  newProjectStatus: "For CE/Pitch Creation",
  newProjectMancomPhase: "1. Client Brief Kickoff",

  // Approval outcomes that mean the request is dead. These never become cards.
  voidStatuses: ["Rejected", "Recalled", "Canceled", "Deleted", "Terminated"],
  // The invoice request status that means it was approved (and the invoice issued).
  approvedStatus: "Approved",

  // Collections.Status, in the order a row moves through it:
  //   won project (has a PAR) → For Invoicing → request filed → Pending… → approved → For Collection.
  collectionStages: {
    forInvoicing: "For Invoicing",
    pending: "Pending Invoice Request Approval",
    forCollection: "For Collection",
  },
  // Collections rows marked as void: Polaris never puts a request on them. The
  // first is what "Mark invalid" writes, to keep a won project out of the list.
  invalidStatuses: ["Invalid"],
  // Universe statuses of a won project that's still being billed. These get a
  // For Invoicing row once they have a PAR and an amount.
  wonStatuses: ["Won - Awaiting CE Signature", "Signed CE", "For Collection"],
  // Universe statuses of finished or dead projects: Polaris adds no new
  // Collections rows for them (it still moves along rows that are already there).
  closedStatuses: ["For Closing", "Fully Closed", "Lost", "Stalled", "Archived"],
  // Optional checkbox column on the Universe that hides a won project from the
  // Invoices list. Ignore stays off for those cards until the column exists.
  universeIgnoreField: "IGNORE",

  // The audit: Universe projects that are won (by Status, or by Mancom Phase) must
  // have these columns filled. The brief doesn't have them, so the Audit tab asks
  // for them, and a Fill on such a project is refused while either is blank.
  auditRequired: {
    statuses: ["Fully Closed", "For Closing", "For Collection", "Signed CE", "Won - Awaiting CE Signature"],
    mancomPhases: ["7. Won"],
    fields: ["Sign Date", "Month"],
    // Month defaults to the 1st of the Sign Date's month (until it's changed by hand).
    month: { field: "Month", from: "Sign Date" },
    who: "A won project",   // in "A won project needs Sign Date and Month."
  },
  // The audit: Universe projects that were lost (or stalled, or archived) must say
  // when and why. Same as auditRequired: a person fills them, even without a brief,
  // and the Fill is refused while either is blank. The status wins over the Mancom
  // Phase: a "7. Won" project whose Status is Lost is asked for these, not Sign Date.
  auditLost: {
    statuses: ["Stalled", "Lost", "Archived"],
    fields: ["Loss Month", "Reason for Loss"],
    who: "A lost, stalled or archived project",
  },
  // The audit: Universe projects with these statuses must have the signed CE on
  // file. A blank one gets a card, and the Fill uploads the file(s) to it.
  auditFiles: {
    field: "Signed CE (PDF)",
    statuses: ["Fully Closed", "For Closing", "For Collection", "Signed CE"],
  },
  // ANDON tab: an ANDON row whose Project Code has a Project Approval gets that
  // PAR's Request No. (its number, linking to the approval) in `field`, a link
  // column, while it's blank: one card per row, pushed like a PAR to the Universe.
  andonApproval: { field: "Approval" },
  // Universe tab: a Universe row whose `to` (an attachment column) is blank, and whose
  // Project Brief links to its files in Lark Approval (`link`, a URL column; Polaris
  // can't read Lark Approval itself), gets a card: the person opens the link,
  // downloads the files, and uploads them through Polaris. Every status counts; to
  // leave some out, list them in `skipStatuses` (e.g. ["Stalled", "Lost", "Archived"]).
  briefFiles: { link: "Attachment (Project Brief, Pitch Deck)", to: "Other Attachments", skipStatuses: [] },
  // The audit: a project's PM must be the same in the Universe (`universe`) and in
  // its ANDON row(s) (`andon`). If they differ or either is blank, it gets an Audit
  // card whose Fill sets one PM in both; the Fill is refused while it's blank.
  pmSync: { universe: "PM", andon: "PM (LEAD)" },
  // The same for the CE: one link (both URL columns) in the Universe (`universe`) and in
  // its ANDON row(s) (`andon`). Different or blank: an Audit card whose Fill puts one
  // link in both (the link must start with https://).
  ceSync: { universe: "Internal CE (Sheet)", andon: "Working CE" },
  // Custom tags: "Mark as No Revenue", "Mark as Hidden"… under an audit card's Hide.
  // The tags are the rows of the Variables table whose `nameColumn` is `variable`
  // (one row per tag, the tag in `valueColumn`); Settings adds and removes them.
  // Marking writes the tag into `field` (plain text, tags separated by commas) on
  // the card's row, in the tables listed in `tables`. A row with a custom tag leaves
  // the audit list and shows in that tag's group at the bottom. If the Variables table
  // names its columns differently, Polaris finds them itself (the one holding `variable`).
  tags: {
    variable: "custom_tag",
    field: "Tags",
    // Only the Universe: ANDON belongs to Project Management and has no Tags column.
    // Its audit cards keep "Hide on this device". Add "andon" here once it has one.
    tables: ["universe"],
    nameColumn: "Variable",
    valueColumn: "Value",
  },

  // Date-only fields (RFP Received Date) are stored as midnight in this offset.
  utcOffsetHours: 8,    // Asia/Manila

  // Show "looks similar to…" on a brief card at or above this name similarity (0 to 1).
  similarityHint: 0.5,
};

/* The Universe view: grouped by Status (in the column's own option order),
   filtered to one Year (this year by default), sorted by RFP Received Date.
   `foldedStatuses` come last as groups folded until opened, and stay out of the
   totals at the top (they're not pipeline). */
export const UNIVERSE_VIEW = {
  foldedStatuses: ["Stalled", "Lost", "Archived"],
  defaultSort: "desc",          // newest RFP first, so a just-pushed brief is at the top of its group
};
