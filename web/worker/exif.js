// Minimal EXIF parser for Orientation from JPEG buffers.
// Returns 1..8 per EXIF, or 1 if not found/unsupported.
export function getExifOrientation(arrayBuf) {
  const view = new DataView(arrayBuf);
  // JPEG magic
  if (view.getUint16(0) !== 0xFFD8) return 1;
  let offset = 2;
  const length = view.byteLength;
  while (offset < length) {
    const marker = view.getUint16(offset);
    offset += 2;
    // APP1 (EXIF)
    if (marker === 0xFFE1) {
      const size = view.getUint16(offset); // includes size field
      offset += 2;
      // Check "Exif\0\0"
      if (
        view.getUint32(offset) === 0x45786966 && // "Exif"
        view.getUint16(offset + 4) === 0x0000
      ) {
        const tiff = offset + 6;
        const little = view.getUint16(tiff) === 0x4949; // 'II'
        const get16 = (pos) => view.getUint16(pos, little);
        const get32 = (pos) => view.getUint32(pos, little);
        const ifd0 = tiff + get32(tiff + 4);
        const entries = get16(ifd0);
        for (let i = 0; i < entries; i++) {
          const entry = ifd0 + 2 + i * 12;
          const tag = get16(entry);
          if (tag === 0x0112) { // Orientation
            const type = get16(entry + 2);
            const count = get32(entry + 4);
            if (type === 3 && count === 1) {
              const val = get16(entry + 8);
              return val >= 1 && val <= 8 ? val : 1;
            }
          }
        }
      }
      offset += size - 2;
    } else if (marker === 0xFFDA) {
      // Start of Scan: no more metadata
      break;
    } else {
      offset += view.getUint16(offset);
    }
  }
  return 1;
}
