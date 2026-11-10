/* The Files page: which rows have files, how they're named in the zip, the approval
   links, and the zip itself (read back here). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RULES } from "../js/config.js";
import { fileRows, zipEntries, fileNamePart, extOf, approvalColumns, approvalFileRows, filesMatch } from "../js/sync.js";
import { columnsToRead } from "../js/ops.js";
import { createZip, crc32 } from "../js/zip.js";

const seg = (t) => [{ type: "text", text: t }];
const file = (name, size = 10, tok = name) => ({ file_token: `tok-${tok}`, name, size });

const universe = [
  { record_id: "u1", fields: { "Project Code": seg("2026TEG-P0001"), "Project": seg("Launch: Night/Day"), "Status": "Signed CE",
      "Signed CE (PDF)": [file("CE signed.PDF"), file("scan", 5, "s2")], "Other Attachments": [file("deck.pptx")] } },
  { record_id: "u2", fields: { "Project Code": seg("2026TEG-P0002"), "Project": seg("No files") } },
  { record_id: "u3", fields: { "Project Code": seg("2026TEG-P0010"), "Project": seg("Other only"), "Other Attachments": [file("a.jpg"), file("b.jpg")] } },
];
const collections = [
  { record_id: "c1", fields: { "Project Code": seg("2026TEG-P0001"), "AR Name": seg("Acme"), "Invoice Number": seg("INV-1"), "Invoice": [file("inv.pdf")] } },
  { record_id: "c2", fields: { "Project Code": seg("2026TEG-P0001"), "AR Name": seg("Acme"), "Invoice": [file("inv2.pdf")] } },
  { record_id: "c3", fields: { "Project Code": seg("2026TEG-P0099"), "AR Name": seg("Beta Corp"), "Invoice": [file("x.pdf")] } },
  { record_id: "c4", fields: { "Project Code": seg("2026TEG-P0003"), "AR Name": seg("No file") } },
];

test("fileRows: only rows with files, newest code first; Collections names come from the Universe", () => {
  const u = fileRows("universe", universe, RULES);
  assert.deepEqual(u.map(r => r.id), ["u3", "u1"]);
  assert.deepEqual(u[1].files.map(x => x.prefix), ["signed_ce", "signed_ce", "other"]);
  const c = fileRows("collections", collections, RULES, { universe });
  assert.deepEqual(c.map(r => r.id).sort(), ["c1", "c2", "c3"]);
  assert.equal(c.find(r => r.id === "c1").name, "Launch: Night/Day");
  assert.equal(c.find(r => r.id === "c3").name, "Beta Corp");   // not in the Universe: its AR Name
  assert.equal(c.find(r => r.id === "c1").sub, "Invoice INV-1 · Acme");
  assert.ok(filesMatch(c.find(r => r.id === "c1"), "inv-1 acme"));
  assert.ok(!filesMatch(c.find(r => r.id === "c1"), "beta"));
});

test("zipEntries: {prefix}_{code}_{name}_{n}.{ext}, n per project across rows, safe names", () => {
  const u = fileRows("universe", universe, RULES);
  const e = zipEntries([u.find(r => r.id === "u1")]);
  assert.deepEqual(e.map(x => x.name), [
    "signed_ce_2026TEG-P0001_Launch Night Day_1.pdf",
    "signed_ce_2026TEG-P0001_Launch Night Day_2.pdf",     // no extension: a signed CE is a PDF
    "other_2026TEG-P0001_Launch Night Day_1.pptx",
  ]);
  assert.deepEqual(zipEntries([u.find(r => r.id === "u1")], { prefixes: ["other"] }).map(x => x.name), ["other_2026TEG-P0001_Launch Night Day_1.pptx"]);
  const c = fileRows("collections", collections, RULES, { universe }).filter(r => r.code === "2026TEG-P0001");
  // Invoices: {project code}_{invoice number}_{n}; a row without one says so.
  assert.deepEqual(zipEntries(c).map(x => x.name).sort(), ["2026TEG-P0001_INV-1_1.pdf", "2026TEG-P0001_no-invoice-number_1.pdf"]);
  assert.equal(e[0].table, "universe");
  assert.equal(e[0].file.file_token, "tok-CE signed.PDF");
  assert.equal(fileNamePart('  a<b>:"c"|?*.  '), "a b c");
  assert.equal(extOf("x.tar.GZ"), "gz");
  assert.equal(extOf("noext", "pdf"), "pdf");
  assert.deepEqual(zipEntries([{ table: "universe", id: "x", code: "", name: "", files: [{ prefix: "other", file: file("q.txt") }] }]).map(x => x.name),
    ["other_no-code_no-name_1.txt"]);
});

test("approvals: the URL columns named like an attachment, and the rows with a link", () => {
  const fields = [{ field_name: "Request No.", type: 15 }, { field_name: "Attachment (Project Brief, Pitch Deck)", type: 15 },
    { field_name: "Attachments", type: 17 }, { field_name: "Other Links", type: 15 }, { field_name: "Project Code", type: 1 }];
  const cols = approvalColumns(fields, RULES);
  assert.deepEqual(cols, ["Attachment (Project Brief, Pitch Deck)"]);
  const A = "https://www.larksuite.com/approval/xyz";
  const recs = [
    { record_id: "b1", fields: { "Request No.": { link: "https://a/1", text: "202601010001" }, "Project Code": seg("2026TEG-P0001"),
        "Project Name": seg("Launch"), "Status": "Approved", "Submitted at": 2, [cols[0]]: { link: A, text: "2 attachment(s)" } } },
    { record_id: "b2", fields: { "Project Name": seg("No link"), "Submitted at": 3 } },
    { record_id: "b3", fields: { "Project Name": seg("Newer"), "Submitted at": 5, [cols[0]]: { link: A, text: "" } } },
  ];
  const rows = approvalFileRows(recs, cols);
  assert.deepEqual(rows.map(r => r.id), ["b3", "b1"]);
  assert.deepEqual(rows[1].links, [{ column: cols[0], link: A, text: "2 attachment(s)" }]);
  assert.equal(rows[1].requestNo, "202601010001");
  assert.equal(rows[1].request, "https://a/1");
  assert.equal(rows[0].links[0].text, cols[0]);   // no text: the column's name
  // The approval tables read those columns too.
  const briefFields = [{ field_name: "Project Code", type: 1 }, { field_name: "Request No.", type: 15 }, ...fields.slice(1)];
  const read = columnsToRead("brief", briefFields, RULES);
  assert.ok(read.includes("Attachment (Project Brief, Pitch Deck)"));
  assert.ok(!read.includes("Other Links"));
  const parRead = columnsToRead("par", [{ field_name: "Request No.", type: 15 }, { field_name: "Attachment", type: 15 }], RULES);
  assert.deepEqual(parRead, ["Request No.", "Attachment"]);
  // Lark refuses a name over 50 characters in the list: then every column is read.
  const long = "Attachment (Final Cost Estimate, Signed Quotation, Pitch Deck, Insurance, etc.)";
  assert.equal(columnsToRead("par", [{ field_name: "Request No.", type: 15 }, { field_name: long, type: 15 }], RULES), undefined);
});

/* Reads a stored zip back: [{ name, bytes, crc }] from the central directory. */
function unzip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const end = buf.length - 22;
  assert.equal(dv.getUint32(end, true), 0x06054b50);
  const n = dv.getUint16(end + 10, true);
  let p = dv.getUint32(end + 16, true);
  const out = [];
  for (let i = 0; i < n; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 20, true), nameLen = dv.getUint16(p + 28, true), at = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    assert.equal(dv.getUint32(at, true), 0x04034b50);
    const start = at + 30 + dv.getUint16(at + 26, true) + dv.getUint16(at + 28, true);
    out.push({ name, bytes: buf.subarray(start, start + size), crc });
    p += 46 + nameLen;
  }
  return out;
}

test("zip: stored files read back with their names and CRCs", async () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xCBF43926);
  const zip = createZip({ date: new Date(2026, 10, 10, 9, 30) });
  const a = new TextEncoder().encode("hello"), b = new Uint8Array([0, 1, 2, 255]);
  zip.add("signed_ce_2026TEG-P0001_Café_1.pdf", a);
  zip.add("other_x_y_1.bin", b);
  zip.add("empty.txt", new Uint8Array(0));
  const buf = new Uint8Array(await zip.blob().arrayBuffer());
  const files = unzip(buf);
  assert.deepEqual(files.map(f => f.name), ["signed_ce_2026TEG-P0001_Café_1.pdf", "other_x_y_1.bin", "empty.txt"]);
  assert.deepEqual([...files[0].bytes], [...a]);
  assert.deepEqual([...files[1].bytes], [...b]);
  assert.equal(files[1].crc, crc32(b));
  assert.equal(files[2].bytes.length, 0);
});
