import { runBatch } from "./worker/dispatcher.js";
import { saveZip } from "./zipper.js";

const fileInput = document.getElementById("fileInput");
const goBtn = document.getElementById("go");
const stopBtn = document.getElementById("stop");
const countEl = document.getElementById("count");
const statusEl = document.getElementById("status");
const barEl = document.getElementById("bar");
const qwrap = document.getElementById("qwrap");
const errorList = document.getElementById("errorList");
const errorBox = document.getElementById("errorBox");
const errorCount = document.getElementById("errorCount");
const drop = document.getElementById("drop");
const toasts = document.getElementById("toasts");

let files = [];
let controller = null;

const MAX_FILES = 60;

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

document.getElementById("format").addEventListener("change", (e)=>{
  // hide quality when PNG or Auto (PNG chosen)
  qwrap.style.display = e.target.value === "jpg" ? "flex" : "none";
});

fileInput.addEventListener("change", ()=>{
  setFiles(Array.from(fileInput.files || []));
});

document.getElementById("wmToggle").addEventListener("change", update);

// Drag–drop handlers
;["dragenter","dragover"].forEach(ev=>{
  drop.addEventListener(ev, (e)=>{ e.preventDefault(); e.stopPropagation(); drop.classList.add("highlight"); });
  document.addEventListener(ev, (e)=>{ e.preventDefault(); });
});
;["dragleave","drop"].forEach(ev=>{
  drop.addEventListener(ev, (e)=>{ e.preventDefault(); e.stopPropagation(); drop.classList.remove("highlight"); });
});
drop.addEventListener("drop", (e)=>{
  const fl = Array.from(e.dataTransfer?.files || []).filter(f=>f && f.type?.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
  if (fl.length === 0) { toast("No images detected in drop."); return; }
  setFiles((files||[]).concat(fl));
});

function setFiles(incoming) {
  const normalized = normalizeFiles(incoming);
  const { usable, heic, tooMany } = partitionFiles(normalized);
  files = usable.slice(0, MAX_FILES);
  countEl.textContent = files.length ? `${files.length} files selected` : "No files selected";
  goBtn.disabled = files.length === 0;

  if (heic.length) {
    toast(`Some HEIC images were skipped (not supported by many browsers). Convert first: ${heic.slice(0,3).map(f=>f.name).join(", ")}${heic.length>3?"…":""}`);
  }
  if (tooMany) {
    toast(`Capped to ${MAX_FILES} files for stability. You can run another batch after this.`);
  }
}

function normalizeFiles(arr) {
  // De-dupe by name+size to avoid accidental duplicates
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
    else usable.push(f);
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
  return {
    size: getSize(),
    square: document.getElementById("square").checked,
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
    const {zipBlob, manifestCsv, failures} = await runBatch(files, opts, {
      signal: controller.signal,
      onProgress: (done, total)=> {
        statusEl.textContent = `Processing ${done}/${total}`;
        barEl.style.width = `${Math.round((done/total)*100)}%`;
      }
    });
    await saveZip(zipBlob, "thumbnails.zip");
    statusEl.textContent = `Done. ${files.length} files processed.`;
    if (failures.length) {
      errorCount.textContent = String(failures.length);
      errorList.innerHTML = failures.map(f => `<li><strong>${escapeHtml(f.name)}</strong> — ${escapeHtml(f.error)}</li>`).join("");
      errorBox.open = true;
      toast(`Completed with ${failures.length} error${failures.length>1?"s":""}. See details below.`);
    } else {
      toast("All images processed successfully.");
    }
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
  setTimeout(()=> {
    el.style.opacity = "0";
    el.style.transform = "translateY(-6px)";
  }, ms);
  setTimeout(()=> el.remove(), ms+400);
}
