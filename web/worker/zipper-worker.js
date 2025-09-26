// Build manifest.csv and zip everything
export async function makeZip(results) {
  const ok = results.filter(r => r.ok);
  const manifestRows = ["original_name,thumb_name,width,height,mode"];
  for (const r of ok) {
    const mode = r.thumbName.includes("__crop.") ? "crop" : "fit";
    manifestRows.push(`${quote(r.name)},${quote(r.thumbName)},${r.width},${r.height},${mode}`);
  }
  const manifestCsv = manifestRows.join("\n");
  const files = [
    { name: "manifest.csv", data: new TextEncoder().encode(manifestCsv) },
    ...ok.map(r => ({ name: `thumbs/${r.thumbName}`, data: r.data }))
  ];
  const zipBlob = await createZip(files);
  return { zipBlob, manifestCsv };
}

function quote(s) {
  return `"${String(s).replace(/"/g, '""')}"`;
}

async function createZip(entries) {
  if ("CompressionStream" in self) {
    // Minimal ZIP writer using CompressionStream (store-only fallback if needed)
    // For portability, we implement a tiny ZIP with no extra fields.
    const { blob, writer } = makeBlobWriter();
    for (const e of entries) {
      await writeZipEntry(writer, e.name, e.data);
    }
    await finishZip(writer);
    return blob();
  } else {
    // Fallback: build via a lightweight JSZip-like approach (placeholder simple store)
    const { blob, writer } = makeBlobWriter();
    for (const e of entries) await writeZipEntry(writer, e.name, e.data);
    await finishZip(writer);
    return blob();
  }
}

// --- Very small ZIP (store method) ---
function makeBlobWriter() {
  const chunks = [];
  return {
    writer: {
      chunks,
      files: [],
      central: []
    },
    blob: () => new Blob(chunks, { type: "application/zip" })
  };
}

async function writeZipEntry(w, name, data) {
  // Store method only (no compression) for simplicity and speed
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(name);
  const crc = crc32(data);
  const header = new DataView(new ArrayBuffer(30));
  // Local file header signature
  header.setUint32(0, 0x04034b50, true);
  header.setUint16(4, 20, true); // version needed
  header.setUint16(6, 0, true); // flags
  header.setUint16(8, 0, true); // method 0 = store
  header.setUint16(10, 0, true); // time
  header.setUint16(12, 0, true); // date
  header.setUint32(14, crc, true);
  header.setUint32(18, data.byteLength, true);
  header.setUint32(22, data.byteLength, true);
  header.setUint16(26, nameBytes.byteLength, true);
  header.setUint16(28, 0, true); // extra length
  w.chunks.push(header, nameBytes, data);

  // Collect central directory info
  w.central.push({ nameBytes, crc, size: data.byteLength, offset: totalSize(w.chunks) - (30 + nameBytes.byteLength + data.byteLength) });
}

async function finishZip(w) {
  const centralStart = totalSize(w.chunks);
  for (const f of w.central) {
    const hdr = new DataView(new ArrayBuffer(46));
    hdr.setUint32(0, 0x02014b50, true);
    hdr.setUint16(4, 20, true); // version made by
    hdr.setUint16(6, 20, true); // version needed
    hdr.setUint16(8, 0, true);  // flags
    hdr.setUint16(10, 0, true); // method
    hdr.setUint16(12, 0, true); // time
    hdr.setUint16(14, 0, true); // date
    hdr.setUint32(16, f.crc, true);
    hdr.setUint32(20, f.size, true);
    hdr.setUint32(24, f.size, true);
    hdr.setUint16(28, f.nameBytes.byteLength, true);
    hdr.setUint16(30, 0, true); // extra len
    hdr.setUint16(32, 0, true); // comment len
    hdr.setUint16(34, 0, true); // disk #
    hdr.setUint16(36, 0, true); // int attrs
    hdr.setUint32(38, 0, true); // ext attrs
    hdr.setUint32(42, f.offset, true);
    w.chunks.push(hdr, f.nameBytes);
  }
  const centralEnd = totalSize(w.chunks);
  const record = new DataView(new ArrayBuffer(22));
  record.setUint32(0, 0x06054b50, true);
  record.setUint16(4, 0, true);
  record.setUint16(6, 0, true);
  record.setUint16(8, w.central.length, true);
  record.setUint16(10, w.central.length, true);
  record.setUint32(12, centralEnd - centralStart, true);
  record.setUint32(16, centralStart, true);
  record.setUint16(20, 0, true);
  w.chunks.push(record);
}

function totalSize(chunks) {
  let n = 0;
  for (const c of chunks) n += c.byteLength || c.length || 0;
  return n;
}

// CRC32 (tiny)
function crc32(buf) {
  let c = ~0 >>> 0;
  for (let i=0; i<buf.length; i++) {
    c = (c ^ buf[i]) >>> 0;
    for (let k=0; k<8; k++) {
      const m = -(c & 1);
      c = (c >>> 1) ^ (0xEDB88320 & m);
    }
  }
  return (~c) >>> 0;
}
