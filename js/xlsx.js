/* Reading an .xlsx file (a zip of XML) without a library: the zip's central directory
   gives each part's place and size, `DecompressionStream("deflate-raw")` (browsers and
   Node 18+) unpacks it, and a few regular expressions read the cells. Enough for the
   weekly Mancom sheet: tabs in order, each a grid of cell text. Formulas are read as
   their cached values; styles, merges and dates as numbers are left as they are.

   readWorkbook(bytes) → [{ name, rows: [[text, …], …] }] (rows and columns from 0). */

const td = new TextDecoder();

/* The zip's files: Map name → { method, size, offset } (from the central directory). */
function zipEntries(b) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("This isn't an .xlsx file (it isn't a zip).");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("The .xlsx file is damaged (its zip directory doesn't read).");
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = td.decode(b.subarray(p + 46, p + 46 + nameLen));
    out.set(name, { method, size, local });
    p += 46 + nameLen + extra + comment;
  }
  return { out, v };
}

async function unzip(b, entry, v) {
  const nameLen = v.getUint16(entry.local + 26, true), extra = v.getUint16(entry.local + 28, true);
  const start = entry.local + 30 + nameLen + extra;
  const raw = b.subarray(start, start + entry.size);
  if (entry.method === 0) return td.decode(raw);
  if (entry.method !== 8) throw new Error(`The .xlsx file uses a compression this page can't read (${entry.method}).`);
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return td.decode(await new Response(stream).arrayBuffer());
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const xmlText = (s) => String(s || "").replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] ?? m));
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`)); return m ? xmlText(m[1]) : ""; };
// All the <t> text in a piece of XML (rich text has several runs), joined.
const allT = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => xmlText(m[1])).join("");

/* "AB12" → { col: 27, row: 11 } (from 0). */
export function cellRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref || "");
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) - 1 };
}

/* One sheet's XML → rows of cell text. */
export function sheetRows(xml, shared) {
  const rows = [];
  for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const at = cellRef(attr(c[1], "r"));
    if (!at) continue;
    const type = attr(c[1], "t"), body = c[2] || "";
    const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
    let text = "";
    if (type === "s") text = shared[Number(v)] ?? "";
    else if (type === "inlineStr") text = allT(body);
    else if (type === "b") text = v === "1" ? "TRUE" : v === "0" ? "FALSE" : "";
    else text = v !== undefined ? xmlText(v) : "";
    if (text === "") continue;
    (rows[at.row] || (rows[at.row] = []))[at.col] = text;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

export async function readWorkbook(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const { out, v } = zipEntries(b);
  const read = async (name) => { const e = out.get(name); return e ? unzip(b, e, v) : ""; };
  const book = await read("xl/workbook.xml");
  if (!book) throw new Error("This doesn't look like an Excel workbook (.xlsx).");
  const rels = await read("xl/_rels/workbook.xml.rels");
  const target = new Map([...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map(m => [attr(m[1], "Id"), attr(m[1], "Target")]));
  const sharedXml = await read("xl/sharedStrings.xml");
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => allT(m[1]));
  const sheets = [];
  for (const m of book.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = attr(m[1], "name"), rid = attr(m[1], "r:id");
    let path = target.get(rid) || "";
    path = path.startsWith("/") ? path.slice(1) : `xl/${path.replace(/^\.\//, "")}`;
    sheets.push({ name, state: attr(m[1], "state") || "visible", rows: sheetRows(await read(path), shared) });
  }
  return sheets;
}
