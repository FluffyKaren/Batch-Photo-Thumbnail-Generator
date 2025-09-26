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

async function createZip(entries) {
  const { blob, writer } = makeBlobWriter();
  for (const e of entries) await writeZipEntry(writer, e.name, e.data);
  await finishZip(writer);
  return blob();
}

function makeBlobWriter() {
  const chunks = [];
  return {
    writer: { chunks, central: [] },
    blob: () => new Blob(chunks, { type: "application/zip" })
  };
}

async function writeZipEntry(w, name, data) {
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(name);
  const crc = crc32(data);
  const header = new DataView(new ArrayBuffer(30));
  header.setUint32(0, 0x04034b50, true);
  header.setUint16(4, 20, true);
  header.setUint16(6, 0, true);
  header.setUint16(8, 0, true);
  header.setUint16(10, 0, true);
  header.setUint16(12, 0, true);
  header.setUint32(14, crc, true);
  header.setUint32(18, data.byteLength, true);
  header.setUint32(22, data.byteLength, true);
  header.setUint16(26, nameBytes.byteLength, true);
  header.setUint16(28, 0, true);
  w.writer.chunks.push(header, nameBytes, data);

  w.writer.central.push({ nameBytes, crc, size: data.byteLength, offset: totalSize(w.writer.chunks) - (30 + nameBytes.byteLength + data.byteLength) });
}

async function finishZip(w) {
  const centralStart = totalSize(w.chunks);
  for (const f of w.central) {
    const hdr = new DataView(new ArrayBuffer(46));
    hdr.setUint32(0, 0x02014b50, true);
    hdr.setUint16(4, 20, true);
    hdr.setUint16(6, 20, true);
    hdr.setUint16(8, 0, true);
    hdr.setUint16(10, 0, true);
    hdr.setUint16(12, 0, true);
    hdr.setUint16(14, 0, true);
    hdr.setUint32(16, f.crc, true);
    hdr.setUint32(20, f.size, true);
    hdr.setUint32(24, f.size, true);
    hdr.setUint16(28, f.nameBytes.byteLength, true);
    hdr.setUint16(30, 0, true);
    hdr.setUint16(32, 0, true);
    hdr.setUint16(34, 0, true);
    hdr.setUint16(36, 0, true);
    hdr.setUint32(38, 0, true);
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
