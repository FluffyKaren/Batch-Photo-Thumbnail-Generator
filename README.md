# CerclEnclume — Batch Photo Thumbnail Generator (PWA)
Mobile-first, installable web app that bulk-generates thumbnails client-side (no uploads). Outputs a ZIP of thumbnails plus manifest.csv.

## Quick Start
- Open /web/index.html (via live server or host on any static site).
- Add to Home Screen to install as PWA.
- Pick up to 30 photos → choose size (256/512/1024) → Generate → Download ZIP.

## Folders
- /web — PWA app (UI, workers, service worker, assets)
- /src — reserved by CE shell (not used in v1)
- /build — versioning, zip packer
- /docs — quickstart and changelog
- /tests — basic Playwright smoke (optional later)
- /dist — artifacts (gitignored)

## Notes
- Colors from /web/assets/brand-tokens.css. Do not hardcode.
- Drop your logo file at /web/assets/logo.png (see /docs/quickstart.md).
- This app processes images locally in browser. No server, no telemetry.
