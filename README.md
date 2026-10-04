# Mythbound

Low-poly fantasy adventure in the browser: lock-on sword combat, RuneScape-style skills, grid building and the
Hollow Barrow dungeon. Plays on PC (keyboard + mouse) and phones (touch controls).

**Play:** https://timesnapx.github.io/mythbound/

This build is **single player**: it runs fully offline, needs no server, and saves progress in your browser's
localStorage. Multiplayer is coming soon.

Static site, no build step. three.js r170 is vendored in `vendor/` (MIT, see `vendor/THREE_LICENSE`).
Installable as an app (manifest + network-first service worker scoped to `/mythbound/`).

Run locally: `python3 -m http.server 8090` in this folder, then open http://localhost:8090/.
