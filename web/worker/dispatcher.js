import { makeZip, buildFileList } from "./zipper-worker.js";

const MAX_WORKERS = (navigator.hardwareConcurrency && navigator.hardwareConcurrency >= 8) ? 6 : 4;
const WORKERS = Math.max(2, Math.min(MAX_WORKERS, navigator.hardwareConcurrency || 2));

export async function runBatch(files, opts, {signal, onProgress}) {
  const canWorkers = typeof Worker !== "undefined";
  let results = [];

  if (canWorkers) {
    const queue = files.slice();
    let done = 0;
    const workers = Array.from({length: WORKERS}, () => new Worker("./img-worker.js", { type: "module" }));

    const tasks = workers.map(async (w) => {
      while (queue.length && !signal.aborted) {
        const file = queue.shift();
        try {
          const arrayBuf = await file.arrayBuffer();
          const res = await callWorker(w, { arrayBuf, name: file.name, opts, sizeBytes: file.size });
          results.push(res);
        } catch (err) {
          results.push({ ok:false, name:file.name, error:String(err) });
        }
        done += 1;
        onProgress?.(done, files.length);
      }
    });

    signal.addEventListener("abort", ()=>workers.forEach(w=>w.terminate()), { once:true });
    await Promise.allSettled(tasks);
    workers.forEach(w=>w.terminate());
  }

  // If workers are unavailable OR everything failed, retry sequentially on main thread
  if (!results.length || results.every(r => !r.ok)) {
    results = await runSequentialOnMainCollect(files, opts, {signal, onProgress});
  }

  const { zipBlob, manifestCsv } = await makeZip(results);
  const filesForFolder = await buildFileList(results, manifestCsv);
  const failures = results.filter(r => !r.ok).map(r => ({ name: r.name, error: r.error || "Unknown error" }));
  return { zipBlob, manifestCsv, failures, filesForFolder };
}

function callWorker(worker, msg) {
  return new Promise((resolve, reject) => {
    const onMessage = (e) => { cleanup(); resolve(e.data); };
    const onError = (e) => { cleanup(); reject(e.error || e.message || e); };
    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    };
    try { worker.postMessage(msg, [msg.arrayBuf]); }
    catch (err) { cleanup(); reject(err); return; }
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
  });
}

// Main-thread pass used as a robust fallback
async function runSequentialOnMainCollect(files, opts, {signal, onProgress}) {
  const results = [];
  let done = 0;
  const mod = await import("./img-worker.js");
  for (const f of files) {
    if (signal.aborted) break;
    try {
      const arrayBuf = await f.arrayBuffer();
      const res = await mod.processOne(arrayBuf, f.name, opts, f.size);
      results.push(res);
    } catch (err) {
      results.push({ ok:false, name:f.name, error:String(err) });
    }
    done += 1;
    onProgress?.(done, files.length);
  }
  return results;
}
