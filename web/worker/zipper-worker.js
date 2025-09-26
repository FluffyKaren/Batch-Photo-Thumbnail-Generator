// Build manifest.csv and zip everything
export async function makeZip(results) {
  const ok = results.filter(r => r.ok);
  const manifestRows = ["original_name,thumb_name,width,height,mode,filesize_bytes,exif_camera,exif_datetime"];
  for (const r of ok) {
    const mode = r.thumbName.includes("__crop.") ? "crop" : "fit";
    manifestRows.push([
      quote(r.name),
      quote(r.thumbName),
      r.width,
      r.height,
      mode,
      r.sizeBytes ?? "",
      quoteOrEmpty(r.exif_camera),
      quoteOrEmpty(r.exif_datetime)
    ].join(","));
  }
  const manifestCsv = manifestRows.join("\n");
  const files = [
    { name: "manifest.csv", data: new TextEncoder().encode(manifestCsv) },
    ...ok.map(r => ({ name: `thumbs/${r.thumbName}`, data: r.data }))
  ];
  const zipBlob = await createZip(files);
  return { zipBlob, manifestCsv };
}

// Provide a list of files for folder save UX
export async function buildFileList(results, manifestCsv) {
  const ok = results.filter(r => r.ok);
  const list = [{ name: "manifest.csv", data: new TextEncoder().encode(manifestCsv) }];
  for (const r of ok) list.push({ name: `thumbs/${r.thumbName}`, data: r.data });
  return list;
}

function quote(s) { return `"${String(s).replace(/"/g, '""')}"`; }
function quoteOrEmpty(s) { return s ? quote(s) : ""; }

// ---- ZIP (store method) ----
// NOTE: Simplified shape: writer is {chunks:[], central:[]}
async function createZip(entries) {
  const writer = makeWriter();
  for (const e of entries) await writeZipEntry(writer, e.name, e.data);
  await finishZip(writer);
  return new Blob(writer.chunks, { type: "application/zip" });
}

function makeWriter() {
  return { chunks: [], central: [] };
}

async function writeZipEntry(w, name, data) {
  if (!data || !("byteLength" in data)) data = new Uint8Array(0);
  const enc = new TextEncoder();
  const nameBytes = enc.encode(name);
  const crc = crc32(data);

  const header = new DataView(new ArrayBuffer(30));
  header.setUint32(0, 0x04034b50, true);
  header.setUint16(4, 20, true); // version needed
  header.setUint16(6, 0, true);  // flags
  header.setUint16(8, 0, true);  // method: store
  header.setUint16(10, 0, true); // time
  header.setUint16(12, 0, true); // date
  header.setUint32(14, crc, true);
  header.setUint32(18, data.byteLength, true);
  header.setUint32(22, data.byteLength, true);
  header.setUint16(26, nameBytes.byteLength, true);
  header.setUint16(28, 0, true); // extra len

  w.chunks.push(header, nameBytes, data);

  const offset = totalSize(w.chunks) - (30 + nameBytes.byteLength + data.byteLength);
  w.central.push({ nameBytes, crc, size: data.byteLength, offset });
}

async function finishZip(w) {
  const start = totalSize(w.chunks);
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
    hdr.setUint16(30, 0, true); // extra
    hdr.setUint16(32, 0, true); // comment
    hdr.setUint16(34, 0, true); // disk#
    hdr.setUint16(36, 0, true); // int attrs
    hdr.setUint32(38, 0, true); // ext attrs
    hdr.setUint32(42, f.offset, true);
    w.chunks.push(hdr, f.nameBytes);
  }
  const end = totalSize(w.chunks);
  const rec = new DataView(new ArrayBuffer(22));
  rec.setUint32(0, 0x06054b50, true);
  rec.setUint16(4, 0, true);
  rec.setUint16(6, 0, true);
  rec.setUint16(8, w.central.length, true);
  rec.setUint16(10, w.central.length, true);
  rec.setUint32(12, end - start, true);
  rec.setUint32(16, start, true);
  rec.setUint16(20, 0, true);
  w.chunks.push(rec);
}

function totalSize(chunks) {
  let n = 0;
  for (const c of chunks) n += (c.byteLength ?? c.length ?? 0);
  return n;
}

function crc32(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let c = ~0 >>> 0;
  for (let i=0; i<b.length; i++) {
    c ^= b[i];
    for (let k=0; k<8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
