import { parseExifMeta } from "./exif.js";

self.onmessage = async (e) => {
  const { arrayBuf, name, opts, sizeBytes } = e.data;
  const out = await processOne(arrayBuf, name, opts, sizeBytes).catch(err => ({ ok:false, name, error:String(err) }));
  if (out && out.ok && out.data && out.data.buffer) self.postMessage(out, [out.data.buffer]); else self.postMessage(out);
};

export async function processOne(arrayBuf, name, opts, sizeBytes) {
  const meta = parseExifMeta(arrayBuf);
  const blob = new Blob([arrayBuf]);
  const bitmap = await createImageBitmap(blob);

  const oriented = await orientBitmap(bitmap, meta.orientation || 1);
  const { canvas, w, h } = await renderWithShape(oriented, opts);

  const detectedAlpha = opts.shape === "square-pad" ? true : await hasAlphaSampled(canvas);
  const outMime =
    opts.format === "png" ? "image/png" :
    opts.format === "jpg" ? "image/jpeg" :
    detectedAlpha ? "image/png" : "image/jpeg";

  const quality = outMime === "image/jpeg" ? Math.max(0.1, Math.min(1, (opts.quality || 85) / 100)) : undefined;
  try { tinySharpen(canvas, 0.15); } catch {}

  const outBlob = await canvasToBlob(canvas, outMime, quality);
  const buf = await outBlob.arrayBuffer();
  const thumbName = makeName(name, w, h, opts.shape === "square-crop" ? "crop" : (opts.shape === "square-pad" ? "pad" : "fit"), outMime);

  return {
    ok: true, name, thumbName, width: w, height: h, sizeBytes,
    exif_camera: compactCamera(meta.make, meta.model),
    exif_datetime: meta.dateTimeOriginal || null,
    data: new Uint8Array(buf)
  };
}

async function renderWithShape(bitmap, opts) {
  const long = Math.max(64, Math.min(4096, opts.size || 512));
  if (opts.shape === "square-crop") {
    const s = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - s)/2;
    const sy = (bitmap.height - s)/2;
    const off = newCanvas(long, long);
    const ctx = off.getContext("2d");
    ctx.drawImage(bitmap, sx, sy, s, s, 0, 0, long, long);
    if (opts.watermark) placeWatermark(ctx, long, long, opts.watermark);
    return { canvas: off, w: long, h: long };
  }
  if (opts.shape === "square-pad") {
    const scale = bitmap.width >= bitmap.height ? long / bitmap.width : long / bitmap.height;
    const targetW = Math.max(1, Math.round(bitmap.width * scale));
    const targetH = Math.max(1, Math.round(bitmap.height * scale));
    const off = newCanvas(long, long);
    const ctx = off.getContext("2d");
    // Fill pad color
    ctx.fillStyle = opts.padColor || "#ffffff";
    ctx.fillRect(0,0,long,long);
    // Draw centered
    const dx = Math.floor((long - targetW)/2);
    const dy = Math.floor((long - targetH)/2);
    ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, dx, dy, targetW, targetH);
    if (opts.watermark) placeWatermark(ctx, long, long, opts.watermark);
    return { canvas: off, w: long, h: long };
  }
  // 'fit' (original aspect)
  const scale = bitmap.width >= bitmap.height ? long / bitmap.width : long / bitmap.height;
  const targetW = Math.max(1, Math.round(bitmap.width * scale));
  const targetH = Math.max(1, Math.round(bitmap.height * scale));
  const off = newCanvas(targetW, targetH);
  const ctx = off.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  if (opts.watermark) placeWatermark(ctx, targetW, targetH, opts.watermark);
  return { canvas: off, w: targetW, h: targetH };
}

function newCanvas(w,h){ return (typeof OffscreenCanvas!=="undefined")? new OffscreenCanvas(w,h) : (()=>{ const c=document.createElement("canvas"); c.width=w; c.height=h; return c; })(); }

async function orientBitmap(bitmap, orientation) {
  if (orientation === 1) return bitmap;
  let w = bitmap.width, h = bitmap.height;
  const swap = [5,6,7,8].includes(orientation);
  const cw = swap ? h : w, ch = swap ? w : h;
  const off = newCanvas(cw, ch);
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

async function hasAlphaSampled(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width:w, height:h } = canvas;
  const stepsX = Math.min(64, w), stepsY = Math.min(64, h);
  const stepX = Math.max(1, Math.floor(w/stepsX));
  const stepY = Math.max(1, Math.floor(h/stepsY));
  for (let y=0; y<h; y+=stepY) {
    const row = ctx.getImageData(0, y, w, 1).data;
    for (let x=0; x<w; x+=stepX) if (row[(x*4)+3] < 255) return true;
  }
  return false;
}

async function canvasToBlob(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  const w = canvas.width, h = canvas.height;
  const off = newCanvas(w,h);
  const ctx = off.getContext("2d"); ctx.drawImage(canvas,0,0);
  if (off.convertToBlob) return off.convertToBlob({ type, quality });
  if (off.toDataURL) { const url = off.toDataURL(type, quality); const res = await fetch(url); return await res.blob(); }
  throw new Error("Cannot create blob from canvas in this environment.");
}

function placeWatermark(ctx, w, h, text) {
  ctx.save(); ctx.globalAlpha = 0.35; ctx.font = `${Math.max(12, Math.round(w*0.05))}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.textBaseline = "bottom"; const pad = Math.max(8, Math.round(w*0.02));
  ctx.textAlign = "right"; ctx.fillText(text, w - pad, h - pad); ctx.restore();
}
function tinySharpen(canvas, amount = 0.15) {
  const ctx = canvas.getContext("2d"); const { width:w, height:h } = canvas; if (w<3||h<3) return;
  const img = ctx.getImageData(0,0,w,h), src = img.data, out = new Uint8ClampedArray(src.length);
  const k = [0,-1*amount,0,-1*amount,1+4*amount,-1*amount,0,-1*amount,0]; const idx = (x,y)=>((y*w)+x)*4;
  for (let y=1; y<h-1; y++) for (let x=1; x<w-1; x++){ const p=idx(x,y); out[p+3]=src[p+3]; let i=0;
    for (let c=0;c<3;c++){ let v=0; for (let ky=-1; ky<=1; ky++) for (let kx=-1; kx<=1; kx++,i++) v += src[idx(x+kx,y+ky)+c]*k[i-((c*9))]; out[p+c]=v<0?0:v>255?255:v; } }
  out.set(src.slice(0, w*4)); out.set(src.slice((h-1)*w*4), (h-1)*w*4);
  for (let y=1; y<h-1; y++){ out.set(src.slice(idx(0,y), idx(0,y)+4), idx(0,y)); out.set(src.slice(idx(w-1,y), idx(w-1,y)+4), idx(w-1,y)); }
  img.data.set(out); ctx.putImageData(img,0,0);
}

function compactCamera(make, model){ if(!make&&!model)return null; if(make&&model)return model.toLowerCase().startsWith((make||"").toLowerCase())?model:`${make} ${model}`.trim(); return (make||model||null); }
function makeName(original,w,h,mode,mime){ const base=original.replace(/\.[^.]+$/,""); const ext=mime==="image/png"?"png":"jpg"; return `${base}__w${w}_h${h}__${mode}.${ext}`; }
