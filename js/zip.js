/* A zip file, made in the browser (no library: the page loads nothing from outside).
   Files are stored as they are, not compressed: PDFs and images barely shrink, and it
   keeps this small and quick. Names are UTF-8. Up to 65,535 files and 4 GB in all
   (classic zip, no zip64); the Files page stops well before that.

     const zip = createZip();
     zip.add("signed_ce_2026TEG-P0001_Launch_1.pdf", bytes);   // bytes: Uint8Array
     const blob = zip.blob();

   Works in Node too (tests/zip.test.mjs reads what it makes back). */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* The date and time as zip stores them (MS-DOS format, local time, 2-second steps). */
function dosTime(d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export const ZIP_MAX_BYTES = 0xFFFFFFFF;
export const ZIP_MAX_FILES = 0xFFFF;

export function createZip({ date = new Date() } = {}) {
  const enc = new TextEncoder();
  const { time, date: day } = dosTime(date);
  const parts = [];      // local headers and file bytes, in order
  const central = [];    // one central directory record per file
  let offset = 0;
  let count = 0;

  function add(name, bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    if (count >= ZIP_MAX_FILES) throw new Error("A zip can hold at most 65,535 files.");
    const nameBytes = enc.encode(name);
    const crc = crc32(bytes);
    const size = bytes.length;
    if (offset + 30 + nameBytes.length + size > ZIP_MAX_BYTES) throw new Error("The zip would be over 4 GB.");

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);    // local file header
    local.setUint16(4, 20, true);            // version needed (2.0)
    local.setUint16(6, 0x0800, true);        // flags: the name is UTF-8
    local.setUint16(8, 0, true);             // method: stored
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);         // compressed size
    local.setUint32(22, size, true);         // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);            // extra field length
    parts.push(new Uint8Array(local.buffer), nameBytes, bytes);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);       // central directory header
    cd.setUint16(4, 20, true);               // made by
    cd.setUint16(6, 20, true);               // version needed
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, day, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint16(30, 0, true);               // extra
    cd.setUint16(32, 0, true);               // comment
    cd.setUint16(34, 0, true);               // disk number
    cd.setUint16(36, 0, true);               // internal attributes
    cd.setUint32(38, 0, true);               // external attributes
    cd.setUint32(42, offset, true);          // where the local header is
    central.push(new Uint8Array(cd.buffer), nameBytes);

    offset += 30 + nameBytes.length + size;
    count++;
  }

  function blob(type = "application/zip") {
    const cdSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);      // end of central directory
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, count, true);
    end.setUint16(10, count, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    end.setUint16(20, 0, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type });
  }

  return { add, blob, get count() { return count; }, get size() { return offset; } };
}
