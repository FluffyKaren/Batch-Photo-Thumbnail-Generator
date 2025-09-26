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
