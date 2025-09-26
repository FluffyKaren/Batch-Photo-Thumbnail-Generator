self.onmessage = async (e) => {
  const { arrayBuf, name, opts } = e.data;
  try {
    const blob = new Blob([arrayBuf]);
    const bitmap = await createImageBitmap(blob);
    const { canvas, w, h } = await resizeBitmap(bitmap, opts);
    const outType = opts.format === "png" ? "image/png" : "image/jpeg";
    const quality = opts.format === "png" ? undefined : Math.max(0.1, Math.min(1, (opts.quality || 85) / 100));
    const outBlob = await canvas.convertToBlob ? await canvas.convertToBlob({ type: outType, quality }) : await new Promise(r=>canvas.toBlob(r, outType, quality));
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

async function resizeBitmap(bitmap, opts) {
  const long = opts.size || 512;
  let targetW, targetH;

  if (opts.square) {
    const s = Math.min(bitmap.width, bitmap.height);
    targetW = targetH = long;
    const sx = (bitmap.width - s)/2;
    const sy = (bitmap.height - s)/2;
    const off = new OffscreenCanvas(long, long);
    const ctx = off.getContext("2d");
    ctx.drawImage(bitmap, sx, sy, s, s, 0, 0, long, long);
    if (opts.watermark) placeWatermark(ctx, long, long, opts.watermark);
    return { canvas: off, w: long, h: long };
  } else {
    const scale = bitmap.width >= bitmap.height ? long / bitmap.width : long / bitmap.height;
    targetW = Math.round(bitmap.width * scale);
    targetH = Math.round(bitmap.height * scale);
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
  ctx.font = `${Math.max(12, Math.round(w*0.05))}px system-ui`;
  ctx.textBaseline = "bottom";
  const pad = Math.max(8, Math.round(w*0.02));
  const metrics = ctx.measureText(text);
  const x = w - pad;
  const y = h - pad;
  ctx.textAlign = "right";
  ctx.fillText(text, x, y);
  ctx.restore();
}
