import os, zipfile, datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DIST = os.path.join(ROOT, "dist")
VERSION_FILE = os.path.join(os.path.dirname(__file__), "VERSION")

def main():
    os.makedirs(DIST, exist_ok=True)
    with open(VERSION_FILE, "r", encoding="utf-8") as f:
        ver = f.read().strip()
    ts = datetime.datetime.utcnow().strftime("%Y%m%d%H%M%S")
    out = os.path.join(DIST, f"cerclenclume-thumbgen-pwa-{ver}-{ts}.zip")

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in ["README.md", "LICENSE"]:
            z.write(os.path.join(ROOT, rel), rel)
        for base in ["web", "docs"]:
            for dirpath, _, filenames in os.walk(os.path.join(ROOT, base)):
                for name in filenames:
                    full = os.path.join(dirpath, name)
                    relp = os.path.relpath(full, ROOT)
                    z.write(full, relp)
    print("Packed:", out)

if __name__ == "__main__":
    main()
