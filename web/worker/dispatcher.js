import { makeZip } from "./zipper-worker.js";

const MAX_WORKERS = (navigator.hardwareConcurrency && navigator.hardwareConcurrency >= 8) ? 6 : 4;
const WORKERS = Math.max(2, Math.min(MAX_WORKERS, navigator.hardwareConcurrency || 2));

export async function runBatch(files, opts, {signal, onProgress}) {
  const queue = files.slice();
  let done = 0;

  const workers = Array.from({length: WORKERS}, () => new Worker("./img-worker.js", { type: "module" }));

  const results = [];
  const tasks = workers.map(async (w) => {
    while (queue.length && !signal.aborted) {
      const file = queue.shift();
      const arrayBuf = await file.arrayBuffer();
      const res = await callWorker(w, { arrayBuf, name: file.name, opts });
      results.push(res);
      done += 1;
      onProgress?.(done, files.length);
    }
  });

  signal.addEventListener("abort", ()=>workers.forEach(w=>w.terminate()), { once:true });
  await Promise.all(tasks);
  workers.forEach(w=>w.terminate());

  const { zipBlob, manifestCsv } = await makeZip(results);
  return { zipBlob, manifestCsv };
}

function callWorker(worker, msg) {
  return new Promise((resolve, reject) => {
    const onMessage = (e) => { worker.removeEventListener("message", onMessage); resolve(e.data); };
    const onError = (e) => { worker.removeEventListener("error", onError); reject(e.error || e); };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage(msg, [msg.arrayBuf]);
  });
}
