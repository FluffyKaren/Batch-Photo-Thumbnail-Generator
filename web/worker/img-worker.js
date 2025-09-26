import { getExifOrientation } from "./exif.js";

self.onmessage = async (e) => {
  const { arrayBuf, name, opts } = e.data;
  try {
    const blob = new Blob([arrayBuf]);
    const bitmap = await createImageBitmap(blob);
    // Apply EXIF orientation from original ArrayBuffer before any drawing
    const orient = getExifOrientation(arrayBuf);
    const oriented = await orientBitmap(bitmap, orient);

    const { canvas, w, h } = await resizeBitmap(oriented, opts);

    const outType = opts.format === "png" ? "image/png" : "image/jpeg";
    const quality = opts.format === "png" ? undefined : Math.max(0.1, Math.min(1, (opts.quality || 85) / 100));

    // Optional tiny sharpen to avoid mushy downsamples
    try { tinySharpen(canvas, 0.15); } catch {}

    const outBlob = await (canvas.convertToBlob
      ? canvas.convertToBlob({ type: outType, quality })
      : new Promise(r => canvas.toBlob(r, outType, quality)));

    const thumbName = makeName(name, w, h, opts.square ? "crop" : "fit", outType);
    const buf = await outBlob.arrayBuffer();
    self.postMessage({ ok:true, name, thumbName, width:w, height:h, data:new Uint8Array(buf) }, [buf]);
  } catch (err) {
    self.postMessage({ ok:false, name, error:String(err) });
  }
};

function makeName(original, w, h, mode, mime) {
  const base = original.replace(/\.[^.]+$/, "");
  const ext = mime === "image/png" ? "png" : "jpg";
  return `${base}__w${w}_h${h}__${mode}.${ext}`;
}

async function orientBitmap(bitmap, orientation) {
  if (orientation === 1) return bitmap;
  let w = bitmap.width, h = bitmap.height;
  const swap = [5,6,7,8].includes(orientation);
  const cw = swap ? h : w;
  const ch = swap ? w : h;

  const off = new OffscreenCanvas(cw, ch);
  const ctx = off.getContext("2d");
  ctx.save();
  switch (orientation) {
    case 2: ctx.translate(cw, 0); ctx.scale(-1, 1); break;              // mirror horizontal
    case 3: ctx.translate(cw, ch); ctx.rotate(Math.PI); break;          // rotate 180
    case 4: ctx.translate(0, ch); ctx.scale(1, -1); break;              // mirror vertical
    case 5: ctx.rotate(0.5*Math.PI); ctx.scale(1, -1); ctx.translate(0, -h); break; // mirror horizontal & rotate 90 CW
    case 6: ctx.rotate(0.5*Math.PI); ctx.translate(0, -h); break;       // rotate 90 CW
    case 7: ctx.rotate(0.5*Math.PI); ctx.translate(w, -h); ctx.scale(-1,1); break; // mirror horizontal & rotate 90 CCW
    case 8: ctx.rotate(-0.5*Math.PI); ctx.translate(-w, 0); break;      // rotate 90 CCW
  }
  ctx.drawImage(bitmap, 0, 0);
  ctx.restore();
  return off;
}

async function resizeBitmap(bitmap, opts) {
  const long = opts.size || 512;
  if (opts.square) {
    const s = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - s)/2;
    const sy = (bitmap.height - s)/2;
    const off = new OffscreenCanvas(long, long);
    const ctx = off.getContext("2d");
    ctx.drawImage(bitmap, sx, sy, s, s, 0, 0, long, long);
    if (opts.watermark) placeWatermark(ctx, long, long, opts.watermark);
    return { canvas: off, w: long, h: long };
  } else {
    const scale = bitmap.width >= bitmap.height ? long / bitmap.width : long / bitmap.height;
    const targetW = Math.max(1, Math.round(bitmap.width * scale));
    const targetH = Math.max(1, Math.round(bitmap.height * scale));
    const off = new OffscreenCanvas(targetW, targetH);
    const ctx = off.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    if (opts.watermark) placeWatermark(ctx, targetW, targetH, opts.watermark);
    return { canvas: off, w: targetW, h: targetH };
  }
}

function placeWatermark(ctx, w, h, text) {
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.font = `${Math.max(12, Math.round(w*0.05))}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.textBaseline = "bottom";
  const pad = Math.max(8, Math.round(w*0.02));
  ctx.textAlign = "right";
  ctx.fillText(text, w - pad, h - pad);
  ctx.restore();
}

// Tiny sharpen: unsharp-like pass using a 3x3 kernel, scaled by amount (0..1)
function tinySharpen(canvas, amount = 0.15) {
  const ctx = canvas.getContext("2d");
  const { width:w, height:h } = canvas;
  const img = ctx.getImageData(0,0,w,h);
  const src = img.data;
  const out = new Uint8ClampedArray(src.length);

  const k = [
    0,      -1*amount, 0,
    -1*amount, 1+4*amount, -1*amount,
    0,      -1*amount, 0
  ];

  const idx = (x,y) => ((y*w)+x)*4;
  for (let y=1; y<h-1; y++) {
    for (let x=1; x<w-1; x++) {
      for (let c=0; c<3; c++) {
        let v=0, i=0;
        for (let ky=-1; ky<=1; ky++) {
          for (let kx=-1; kx<=1; kx++, i++) {
            v += src[idx(x+kx,y+ky)+c] * k[i];
          }
        }
        out[idx(x,y)+c] = Math.max(0, Math.min(255, v));
      }
      out[idx(x,y)+3] = src[idx(x,y)+3];
    }
  }
  // Copy borders without filtering
  // Top/bottom
  out.set(src.slice(0, w*4));
  out.set(src.slice((h-1)*w*4), (h-1)*w*4);
  // Left/right columns
  for (let y=1; y<h-1; y++) {
    out.set(src.slice(idx(0,y), idx(0,y)+4), idx(0,y));
    out.set(src.slice(idx(w-1,y), idx(w-1,y)+4), idx(w-1,y));
  }

  img.data.set(out);
  ctx.putImageData(img,0,0);
}
