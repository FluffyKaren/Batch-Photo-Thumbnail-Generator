import { parseExifMeta } from "./exif.js";

// Worker entry
self.onmessage = async (e) => {
  const { arrayBuf, name, opts, sizeBytes } = e.data;
  const out = await processOne(arrayBuf, name, opts, sizeBytes).catch(err => ({ ok:false, name, error:String(err) }));
  // If ok, transfer the typed array buffer to avoid copies
  if (out && out.ok && out.data && out.data.buffer) {
    self.postMessage(out, [out.data.buffer]);
  } else {
    self.postMessage(out);
  }
};

// Exported for main-thread fallback
export async function processOne(arrayBuf, name, opts, sizeBytes) {
  const meta = parseExifMeta(arrayBuf);
  const blob = new Blob([arrayBuf]);
  const bitmap = await createImageBitmap(blob);

  const oriented = await orientBitmap(bitmap, meta.orientation || 1);
  const { canvas, w, h } = await resizeBitmap(oriented, opts);

  const detectedAlpha = opts.square ? false : await hasAlphaSampled(canvas);
  const outMime =
    opts.format === "png" ? "image/png" :
    opts.format === "jpg" ? "image/jpeg" :
    detectedAlpha ? "image/png" : "image/jpeg";

  const quality = outMime === "image/jpeg" ? Math.max(0.1, Math.min(1, (opts.quality || 85) / 100)) : undefined;

  try { tinySharpen(canvas, 0.15); } catch {}

  const outBlob = await (canvas.convertToBlob
    ? canvas.convertToBlob({ type: outMime, quality })
    : new Promise(r => canvas.toBlob(r, outMime, quality)));

  const thumbName = makeName(name, w, h, opts.square ? "crop" : "fit", outMime);
  const buf = await outBlob.arrayBuffer();

  return {
    ok: true,
    name,
    thumbName,
    width: w,
    height: h,
    sizeBytes,
    exif_camera: compactCamera(meta.make, meta.model),
    exif_datetime: meta.dateTimeOriginal || null,
    data: new Uint8Array(buf)
  };
}

function compactCamera(make, model) {
  if (!make && !model) return null;
  if (make && model) {
    return model.toLowerCase().startsWith((make||"").toLowerCase()) ? model : `${make} ${model}`.trim();
  }
  return (make || model || null);
}

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

  const off = new OffscreenCanvas ? new OffscreenCanvas(cw, ch) : (()=>{ const c=document.createElement("canvas"); c.width=cw; c.height=ch; return c; })();
  const ctx = off.getContext("2d");
  ctx.save();
  switch (orientation) {
    case 2: ctx.translate(cw, 0); ctx.scale(-1, 1); break;
    case 3: ctx.translate(cw, ch); ctx.rotate(Math.PI); break;
    case 4: ctx.translate(0, ch); ctx.scale(1, -1); break;
    case 5: ctx.rotate(0.5*Math.PI); ctx.scale(1, -1); ctx.translate(0, -h); break;
    case 6: ctx.rotate(0.5*Math.PI); ctx.translate(0, -h); break;
    case 7: ctx.rotate(0.5*Math.PI); ctx.translate(w, -h); ctx.scale(-1,1); break;
    case 8: ctx.rotate(-0.5*Math.PI); ctx.translate(-w, 0); break;
  }
  ctx.drawImage(bitmap, 0, 0);
  ctx.restore();
  return off;
}

async function resizeBitmap(bitmap, opts) {
  const long = Math.max(64, Math.min(4096, opts.size || 512));
  if (opts.square) {
    const s = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - s)/2;
    const sy = (bitmap.height - s)/2;
    const off = new OffscreenCanvas ? new OffscreenCanvas(long, long) : (()=>{ const c=document.createElement("canvas"); c.width=long; c.height=long; return c; })();
    const ctx = off.getContext("2d");
    ctx.drawImage(bitmap, sx, sy, s, s, 0, 0, long, long);
    if (opts.watermark) placeWatermark(ctx, long, long, opts.watermark);
    return { canvas: off, w: long, h: long };
  } else {
    const scale = bitmap.width >= bitmap.height ? long / bitmap.width : long / bitmap.height;
    const targetW = Math.max(1, Math.round(bitmap.width * scale));
    const targetH = Math.max(1, Math.round(bitmap.height * scale));
    const off = new OffscreenCanvas ? new OffscreenCanvas(targetW, targetH) : (()=>{ const c=document.createElement("canvas"); c.width=targetW; c.height=targetH; return c; })();
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

// Sample alpha existence quickly to decide PNG vs JPG in 'auto'
async function hasAlphaSampled(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width:w, height:h } = canvas;
  // Sample a grid up to 64x64 points to avoid heavy reads
  const stepsX = Math.min(64, w);
  const stepsY = Math.min(64, h);
  const stepX = Math.max(1, Math.floor(w/stepsX));
  const stepY = Math.max(1, Math.floor(h/stepsY));
  for (let y=0; y<h; y+=stepY) {
    const row = ctx.getImageData(0, y, w, 1).data;
    for (let x=0; x<w; x+=stepX) {
      // alpha channel at index 3
      if (row[(x*4)+3] < 255) return true;
    }
  }
  return false;
}

// Tiny sharpen
function tinySharpen(canvas, amount = 0.15) {
  const ctx = canvas.getContext("2d");
  const { width:w, height:h } = canvas;
  if (w < 3 || h < 3) return; // avoid tiny images artifacts
  const img = ctx.getImageData(0,0,w,h);
  const src = img.data;
  const out = new Uint8ClampedArray(src.length);
  const k = [
    0, -1*amount, 0,
    -1*amount, 1+4*amount, -1*amount,
    0, -1*amount, 0
  ];
  const idx = (x,y) => ((y*w)+x)*4;
  for (let y=1; y<h-1; y++) {
    for (let x=1; x<w-1; x++) {
      const p = idx(x,y);
      out[p+3] = src[p+3];
      for (let c=0; c<3; c++) {
        let v=0, i=0;
        for (let ky=-1; ky<=1; ky++) {
          for (let kx=-1; kx<=1; kx++, i++) v += src[idx(x+kx,y+ky)+c] * k[i];
        }
        out[p+c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  // Copy borders
  out.set(src.slice(0, w*4));
  out.set(src.slice((h-1)*w*4), (h-1)*w*4);
  for (let y=1; y<h-1; y++) {
    out.set(src.slice(idx(0,y), idx(0,y)+4), idx(0,y));
    out.set(src.slice(idx(w-1,y), idx(w-1,y)+4), idx(w-1,y));
  }
  img.data.set(out);
  ctx.putImageData(img,0,0);
}
