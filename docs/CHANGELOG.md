# Changelog

## [0.1.0] - 2025-09-27
- Initial PWA skeleton created (mobile-first, offline-ready).
- Brand tokens wired; index + workers + service worker + manifest added.

[0.1.1] - 2025-09-27

Added EXIF orientation handling for JPEGs.

Added light sharpen pass to improve downscaled clarity.

Wired service worker registration in index.

Added local dev guide and GitHub Pages workflow.

## [0.1.2] - 2025-09-27
- Manifest.csv now includes filesize_bytes, exif_camera, exif_datetime.
- Error log drawer added to UI; shows per-file failures after run.
- Service worker cache bumped and now includes exif worker.
