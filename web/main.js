import { runBatch } from "./worker/dispatcher.js";
import { saveZip, saveFilesToFolder, reOpenFolder } from "./zipper.js";

const fileInput = document.getElementById("fileInput");
const folderInput = document.getElementById("folderInput");
const goBtn = document.getElementById("go");
const stopBtn = document.getElementById("stop");
const saveZipBtn = document.getElementById("saveZip");
const saveFolderBtn = document.getElementById("saveFolder");
const openFolderBtn = document.getElementById("openFolder");
const countEl = document.getElementById("count");
const statusEl = document.getElementById("status");
const barEl = document.getElementById("bar");
const qwrap = document.getElementById("qwrap");
const errorList = document.getElementById("errorList");
const errorBox = document.getElementById("errorBox");
const errorCount = document.getElementById("errorCount");
const drop = document.getElementById("drop");
const toasts = document.getElementById("toasts");
const shapeSel = document.getElementById("shape");
const padColorWrap = document.getElementById("padColorWrap");
const padColorSel = document.getElementById("padColor");
const padCustom = document.getElementById("padCustom");

let files = [];
let controller = null;
let lastFilesForFolder = null;
let palette = {};

const MAX_FILES = 60;

initPalette(); // async fill color menu

async function initPalette() {
  try {
    const res = await fetch("./assets/palette.json");
    palette = await res.json();
  } catch {
    palette = {};
  }
  // Build options (soft greys first)
  const pairs = Object.entries(palette);
  const pref = ["ce-bg","ce-surface","ce-border","ce-muted","ce-black"];
  const sorted = [...pref.filter(k=>palette[k]).map(k=>[k,palette[k]]), ...pairs.filter(([k])=>!pref.includes(k))];
  padColorSel.innerHTML = sorted.map(([k,v])=>`<option value="${v}">${k} (${v})</option>`).join("");
  // Default to ce-bg if present, else first entry
  if (palette["ce-bg"]) padColorSel.value = palette["ce-bg"];
}

document.getElementById("format").addEventListener("change", (e)=>{
  qwrap.style.display = e.target.value === "jpg" ? "flex" : "none";
});

shapeSel.addEventListener("change", ()=>{
  padColorWrap.style.display = shapeSel.value === "square-pad" ? "flex" : "none";
});

fileInput.addEventListener("change", ()=>{
  setFiles(Array.from(fileInput.files || []));
});
folderInput.addEventListener("change", ()=>{
  setFiles(Array.from(folderInput.files || []));
});

document.getElementById("wmToggle").addEventListener("change", update);

// Presets
const presetEls = Array.from(document.querySelectorAll("#presets .pill"));
presetEls.forEach(el=>{
  el.addEventListener("click", ()=>{
    presetEls.forEach(p=>p.classList.remove("active"));
    el.classList.add("active");
    document.getElementById("customSize").value = "";
    update();
  });
});
document.getElementById("customSize").addEventListener("input", ()=>{
  presetEls.forEach(p=>p.classList.remove("active"));
  update();
});

// Drag–drop folder & files
;["dragenter","dragover"].forEach(ev=>{
  drop.addEventListener(ev, (e)=>{ e.preventDefault(); e.stopPropagation(); drop.classList.add("highlight"); });
  document.addEventListener(ev, (e)=>{ e.preventDefault(); });
});
;["dragleave","drop"].forEach(ev=>{
  drop.addEventListener(ev, (e)=>{ e.preventDefault(); e.stopPropagation(); drop.classList.remove("highlight"); });
});
drop.addEventListener("drop", async (e)=>{
  const dt = e.dataTransfer;
  if (!dt) return;
  const entries = dt.items && dt.items[0] && "webkitGetAsEntry" in dt.items[0] ? Array.from(dt.items).map(i=>i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean) : null;
  if (entries && entries.length) {
    const gathered = [];
    for (const entry of entries) await walkEntry(entry, gathered);
    setFiles(gathered);
  } else {
    const fl = Array.from(dt.files || []).filter(f=>f && (f.type?.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/i.test(f.name)));
    if (fl.length === 0) { toast("No images detected in drop."); return; }
    setFiles((files||[]).concat(fl));
  }
});

async function walkEntry(entry, out) {
  if (entry.isFile) {
    await new Promise((res)=> entry.file((f)=>{ out.push(f); res(); }, ()=>res()));
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    let batch;
    do {
      batch = await new Promise((res)=> reader.readEntries(res, ()=>res([])));
      for (const e of batch) await walkEntry(e, out);
    } while (batch.length);
  }
}

function setFiles(incoming) {
  const normalized = normalizeFiles(incoming);
  const { usable, heic, tooMany } = partitionFiles(normalized);
  files = usable.slice(0, MAX_FILES);
  countEl.textContent = files.length ? `${files.length} files selected` : "No files selected";
  goBtn.disabled = files.length === 0;

  saveZipBtn.disabled = true;
  saveFolderBtn.disabled = true;
  openFolderBtn.disabled = true;

  if (heic.length) toast(`Some HEIC images were skipped. Convert first: ${heic.slice(0,3).map(f=>f.name).join(", ")}${heic.length>3?"…":""}`);
  if (tooMany) toast(`Capped to ${MAX_FILES} files. Run another batch after this.`);
}

function normalizeFiles(arr) {
  const seen = new Set();
  const out = [];
  for (const f of arr) {
    if (!f) continue;
    const key = `${f.name}__${f.size}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function partitionFiles(arr) {
  const usable = [];
  const heic = [];
  for (const f of arr) {
    const isHeic = /image\/heic/i.test(f.type) || /\.heic$/i.test(f.name);
    if (isHeic) heic.push(f);
    else if (f.type?.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(f.name)) usable.push(f);
  }
  return { usable, heic, tooMany: arr.length > MAX_FILES };
}

function getSize() {
  const custom = parseInt(document.getElementById("customSize").value, 10);
  if (!isNaN(custom) && custom > 0) return Math.min(4096, Math.max(64, custom));
  const active = document.querySelector("#presets .pill.active");
  return parseInt(active.dataset.size, 10);
}

function getOpts() {
  // resolve pad color: custom hex takes precedence; else selected; else fallback to ce-bg or white
  let padColor = (padCustom.value || "").trim();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(padColor)) padColor = padColorSel.value || palette["ce-bg"] || "#ffffff";
  return {
    size: getSize(),
    shape: shapeSel.value, // 'fit' | 'square-crop' | 'square-pad'
    padColor,
    format: document.getElementById("format").value, // 'auto'|'jpg'|'png'
    quality: parseInt(document.getElementById("quality").value, 10),
    watermark: document.getElementById("wmToggle").checked ? (document.getElementById("wmText").value || "©") : null
  };
}

function update() {
  goBtn.disabled = files.length === 0;
}

goBtn.addEventListener("click", async ()=>{
  if (!files.length) { toast("Pick images first."); return; }

  controller = new AbortController();
  goBtn.disabled = true;
  stopBtn.disabled = false;
  statusEl.textContent = "Processing...";
  barEl.style.width = "0%";
  errorList.innerHTML = "";
  errorCount.textContent = "0";
  errorBox.open = false;

  try {
    const opts = getOpts();
    const {zipBlob, manifestCsv, failures, filesForFolder} = await runBatch(files, opts, {
      signal: controller.signal,
      onProgress: (done, total)=> {
        statusEl.textContent = `Processing ${done}/${total}`;
        barEl.style.width = `${Math.round((done/total)*100)}%`;
      }
    });

    lastFilesForFolder = filesForFolder;
    saveZipBtn.disabled = false;
    saveFolderBtn.disabled = !("showDirectoryPicker" in window);
    openFolderBtn.disabled = !("showDirectoryPicker" in window);

    statusEl.textContent = `Done. ${files.length} files processed. Choose how to save.`;

    if (failures.length) {
      errorCount.textContent = String(failures.length);
      errorList.innerHTML = failures.map(f => `<li><strong>${escapeHtml(f.name)}</strong> — ${escapeHtml(f.error)}</li>`).join("");
      errorBox.open = true;
      toast(`Completed with ${failures.length} error${failures.length>1?"s":""}. See details below.`);
    } else {
      toast("All images processed successfully.");
    }

    saveZipBtn.onclick = async ()=> {
      await saveZip(zipBlob, "thumbnails.zip");
      toast("ZIP downloaded.");
    };
    saveFolderBtn.onclick = async ()=> {
      if (!lastFilesForFolder) return;
      const ok = await saveFilesToFolder(lastFilesForFolder, "thumbs");
      if (ok) toast("Saved to selected folder.");
    };
    openFolderBtn.onclick = async ()=> {
      await reOpenFolder();
    };

  } catch (e) {
    if (e.name === "AbortError") {
      statusEl.textContent = "Stopped.";
      toast("Batch stopped.");
    } else {
      console.error(e);
      statusEl.textContent = "Error. See console for details.";
      toast("Unexpected error. See console.");
    }
  } finally {
    stopBtn.disabled = true;
    goBtn.disabled = files.length === 0;
  }
});

stopBtn.addEventListener("click", ()=>{
  if (controller) controller.abort();
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m]));
}
function toast(msg, ms=3500) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  toasts.appendChild(el);
  setTimeout(()=> { el.style.opacity = "0"; el.style.transform = "translateY(-6px)"; }, ms);
  setTimeout(()=> el.remove(), ms+400);
}
