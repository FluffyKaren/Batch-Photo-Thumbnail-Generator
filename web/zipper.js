let lastDirHandle = null;

export async function saveZip(blob, filename) {
  // Prefer native File System Access if available
  if (window.showSaveFilePicker) {
    const handle = await showSaveFilePicker({ suggestedName: filename, types: [{ description: "Zip", accept: { "application/zip": [".zip"] } }] });
    const stream = await handle.createWritable();
    await stream.write(blob);
    await stream.close();
  } else {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
  }
}

export async function saveFilesToFolder(files, subdir = "thumbs") {
  if (!("showDirectoryPicker" in window)) {
    alert("Your browser does not support saving to a folder. Use Download ZIP instead.");
    return false;
  }
  try {
    const dir = await showDirectoryPicker({ mode: "readwrite" });
    lastDirHandle = dir;

    // Create subdir if needed
    const thumbsDir = await ensureDir(dir, subdir);

    // Write manifest at root
    for (const f of files) {
      const pathParts = f.name.split("/");
      if (pathParts.length === 1) {
        await writeFile(dir, f.name, f.data);
      } else {
        // e.g. thumbs/foo.jpg
        const targetDir = await ensureDir(dir, pathParts[0]);
        await writeFile(targetDir, pathParts.slice(1).join("/"), f.data);
      }
    }
    return true;
  } catch (e) {
    console.error(e);
    alert("Could not save to folder.");
    return false;
  }
}

export async function reOpenFolder() {
  if (!("showDirectoryPicker" in window)) return;
  try {
    // We cannot auto-open the OS explorer, but we can prompt with the picker.
    const dir = await showDirectoryPicker({ startIn: lastDirHandle || "documents" });
    lastDirHandle = dir;
  } catch {
    // user cancelled
  }
}

async function ensureDir(root, name) {
  return await root.getDirectoryHandle(name, { create: true });
}

async function writeFile(dirHandle, path, data) {
  const parts = path.split("/");
  let current = dirHandle;
  for (let i=0; i<parts.length-1; i++) {
    current = await current.getDirectoryHandle(parts[i], { create: true });
  }
  const fileHandle = await current.getFileHandle(parts[parts.length-1], { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}
