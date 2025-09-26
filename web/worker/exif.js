// Minimal EXIF parser for JPEG buffers.
// Exposes: orientation (1..8), make (camera brand), model (camera model),
// and dateTimeOriginal (YYYY:MM:DD HH:MM:SS) when present.
// Safe defaults if fields are missing/unknown.

export function parseExifMeta(arrayBuf) {
  const view = new DataView(arrayBuf);
  if (view.getUint16(0) !== 0xFFD8) return { orientation: 1 };
  let offset = 2;
  const length = view.byteLength;
  while (offset < length) {
    const marker = view.getUint16(offset);
    offset += 2;
    if (marker === 0xFFE1) {
      const size = view.getUint16(offset);
      offset += 2;
      if (view.getUint32(offset) === 0x45786966 && view.getUint16(offset + 4) === 0x0000) {
        const tiff = offset + 6;
        const little = view.getUint16(tiff) === 0x4949; // 'II'
        const get16 = (pos) => view.getUint16(pos, little);
        const get32 = (pos) => view.getUint32(pos, little);
        const getStr = (pos, len) => {
          const bytes = new Uint8Array(view.buffer, pos, len);
          let s = "";
          for (let i = 0; i < bytes.length && bytes[i] !== 0; i++) s += String.fromCharCode(bytes[i]);
          return s;
        };

        const result = { orientation: 1 };

        function readIFD(ifdOffset) {
          const count = get16(ifdOffset);
          for (let i = 0; i < count; i++) {
            const entry = ifdOffset + 2 + i * 12;
            const tag = get16(entry);
            const type = get16(entry + 2);
            const count = get32(entry + 4);
            const valueOff = entry + 8;
            const valPtr = count * (type === 2 ? 1 : type === 3 ? 2 : type === 4 ? 4 : 0) > 4 ? tiff + get32(valueOff) : valueOff;

            // Orientation (IFD0)
            if (tag === 0x0112 && type === 3 && count === 1) {
              const v = get16(valPtr);
              if (v >= 1 && v <= 8) result.orientation = v;
            }
            // Make (brand)
            if (tag === 0x010F && type === 2) {
              result.make = getStr(valPtr, count);
            }
            // Model
            if (tag === 0x0110 && type === 2) {
              result.model = getStr(valPtr, count);
            }
          }
          return get32(ifdOffset + 2 + count * 12); // next IFD offset
        }

        const ifd0 = tiff + get32(tiff + 4);
        const nextIfd = readIFD(ifd0);

        // EXIF subIFD pointer tag
        const entries0 = get16(ifd0);
        for (let i = 0; i < entries0; i++) {
          const entry = ifd0 + 2 + i * 12;
          const tag = get16(entry);
          if (tag === 0x8769) {
            const exifIFD = tiff + get32(entry + 8);
            const count = get16(exifIFD);
            for (let j = 0; j < count; j++) {
              const e = exifIFD + 2 + j * 12;
              const t = get16(e);
              const type = get16(e + 2);
              const c = get32(e + 4);
              const vOff = e + 8;
              const ptr = c * (type === 2 ? 1 : type === 3 ? 2 : type === 4 ? 4 : 0) > 4 ? tiff + get32(vOff) : vOff;
              // DateTimeOriginal
              if (t === 0x9003 && type === 2) {
                result.dateTimeOriginal = getStr(ptr, c);
              }
            }
          }
        }
        return result;
      }
      offset += size - 2;
    } else if (marker === 0xFFDA) {
      break;
    } else {
      const size = view.getUint16(offset);
      offset += size;
    }
  }
  return { orientation: 1 };
}

export function getExifOrientation(arrayBuf) {
  return parseExifMeta(arrayBuf).orientation || 1;
}
