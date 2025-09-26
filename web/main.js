import { runBatch } from "./worker/dispatcher.js";
import { saveZip } from "./zipper.js";

const fileInput = document.getElementById("fileInput");
const goBtn = document.getElementById("go");
const stopBtn = document.getElementById("stop");
const countEl = document.getElementById("count");
const statusEl = document.getElementById("status");
const barEl = document.getElementById("bar");
const qwrap = document.getElementById("qwrap");

let files = [];
let controller = null;

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
  qwrap.style.display = e.target.value === "jpg" ? "flex" : "none";
});

fileInput.addEventListener("change", ()=>{
  files = Array.from(fileInput.files || []);
  countEl.textContent = files.length ? `${files.length} files selected` : "No files selected";
  goBtn.disabled = files.length === 0;
});

document.getElementById("wmToggle").addEventListener("change", update);

function getSize() {
  const custom = parseInt(document.getElementById("customSize").value, 10);
  if (!isNaN(custom) && custom > 0) return custom;
  const active = document.querySelector("#presets .pill.active");
  return parseInt(active.dataset.size, 10);
}

function getOpts() {
  return {
    size: getSize(),
    square: document.getElementById("square").checked,
    format: document.getElementById("format").value,
    quality: parseInt(document.getElementById("quality").value, 10),
    watermark: document.getElementById("wmToggle").checked ? (document.getElementById("wmText").value || "©") : null
  };
}

function update() {
  goBtn.disabled = files.length === 0;
}

goBtn.addEventListener("click", async ()=>{
  controller = new AbortController();
  goBtn.disabled = true;
  stopBtn.disabled = false;
  statusEl.textContent = "Processing...";
  barEl.style.width = "0%";

  try {
    const opts = getOpts();
    const {zipBlob, manifestCsv} = await runBatch(files, opts, {
      signal: controller.signal,
      onProgress: (done, total)=> {
        statusEl.textContent = `Processing ${done}/${total}`;
        barEl.style.width = `${Math.round((done/total)*100)}%`;
      }
    });
    await saveZip(zipBlob, "thumbnails.zip");
    statusEl.textContent = `Done. ${files.length} files processed.`;
  } catch (e) {
    if (e.name === "AbortError") {
      statusEl.textContent = "Stopped.";
    } else {
      console.error(e);
      statusEl.textContent = "Error. See console for details.";
    }
  } finally {
    stopBtn.disabled = true;
    goBtn.disabled = files.length === 0;
  }
});

stopBtn.addEventListener("click", ()=>{
  if (controller) controller.abort();
});
