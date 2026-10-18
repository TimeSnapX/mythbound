# Mythbound

Low-poly fantasy adventure in the browser: lock-on sword combat, RuneScape-style skills, grid building and the
Hollow Barrow dungeon. Plays on PC (keyboard + mouse) and phones (touch controls).

**Play:** https://timesnapx.github.io/mythbound/

This build is **single player**: it runs fully offline, needs no server, and saves progress in your browser's
localStorage. Optional **cloud saves** (Sign in with Google + Firestore) sync progress between phone and PC once a Firebase
project is configured. See `FIREBASE_SETUP.md`. Multiplayer is coming soon.

Static site, no build step. three.js r170 is vendored in `vendor/` (MIT, see `vendor/THREE_LICENSE`).
Installable as an app (manifest + network-first service worker scoped to `/mythbound/`). In-game "📲 Install app" button (title screen and HUD) uses `beforeinstallprompt`; otherwise: Chrome menu ⋮ > Add to Home screen / Install app.

Run locally: `python3 -m http.server 8090` in this folder, then open http://localhost:8090/.

## v2.1.0 — changelog
- **Cloud saves**:
  - "Sign in with Google" on the title screen and in Settings shows your name, avatar and **Sign out**.
  - Saves sync to Firestore at `users/{uid}/saves/main`.
  - **Keep cloud / Keep this device** chooser when the two saves differ. The newer one is highlighted, nothing is overwritten silently, and the loser is kept as a backup.
  - Autosave pushes at most every 30 s, plus right away on 💾 Save now, when the tab is hidden, and on page close.
  - Offline: saves stay local and are pushed when the connection is back.
  - Cloud saves go through the same v1 → v2 migration.
- **Setup**: `js/firebase-config.js` ships with placeholders. Until they are filled in the game shows "Cloud saves coming soon" and behaves exactly like v2.0.0. Setup steps and `firestore.rules` are in `FIREBASE_SETUP.md`.
- **SDK**: the Firebase JS SDK 12.19.0 (app, auth, firestore) is vendored in `vendor/firebase/` and loaded only when configured.
- **Code**: the cloud layer sits behind an adapter (`js/cloud.js` logic, `js/cloud-firebase.js`, `js/cloud-mock.js`). Use `?debug=1&cloud=mock` or `window.MB_CLOUD_ADAPTER` for testing, and `?cloud=off` to disable it.
- **Service worker**: v2.1.0. Google and Firebase hosts are explicitly network-only.
- **Saves**: they now record `savedAt` and `playtime`.

## v2.0.0 — changelog
- **Save migration**: v1 saves (`mythbound_save_v1`) are migrated automatically into `mythbound_save_v2`. Inventory, flags, builds, hearts and position are kept. Each skill keeps its v1 level (capped at 50) and is re-based onto the new curve. The v1 sword becomes the equipped weapon. The v1 key is left in place as a backup. The service worker cache is now `v2.0.0`.
- **XP curve**: max level 50, `xpForLevel(L) = round(1e6·(2^((L-1)/7) − 1)/127)`.
- **Skills (12)**: Combat, Archery, Magic, Woodcutting, Mining, Fishing, Hunting, Smithing, Cooking, Crafting, Fletching, Runemaking.
  - A total-level ⭐ badge sits on the HUD and name tag, with a milestone toast every 50 levels.
  - Level 50 unlocks that skill's cape, chosen with a cape selector.
- **New zones**:
  - Emberfall Ridge, with the Fade fog, a Fade meter, and Hearthstone safe circles.
  - The Ashfall merchant camp (Corin, and Tamsin's shop).
  - Cinderdeep Mine: minecart and switch puzzle, cracked walls, a lava bridge, and the Magmaw boss (weak point and phases).
- **Quests**:
  - Q2 The Fading Ridge and Q3 Cinderdeep, plus the pet quest with Wren (choose a dog, cat or bird, then name it).
  - Quest journal (L), world quest markers, and the Vael vision.
- **Economy**:
  - Gold coins and shops for buying and selling.
  - Inventory is capped at 30 slots; stacks share one slot and a toast warns when it is full.
  - A bank (200 slots) at the Banker booth, plus a buildable bank chest.
  - Coal and steel smithing, gems with enchanting, bombs, a bow, arrows, and rune spells.
- **Building v2**:
  - Aim where you look, with a ghost preview and R to rotate.
  - New pieces: doors that save their open state, stairs, roof, and grapple anchor posts for the Hook Cast.
  - Home plot (P, 100 coins) with a Hearthstone respawn point.
- **Presentation**:
  - WebAudio sound effects and per-zone music, with volume settings.
  - NPC idle, talk and wave animations.
  - A settings menu (O) and phone landscape controls for bomb, bow, spell, quick item, bag and journal.
- **Debug** (`?debug=1`): `MB.debug.teleport/give/gold/setLevel/maxSkill/maxAll/flag/tod/pet/heal/god`.
- **Logo**: `assets/logo.webp`. Regenerate it with `python3 make-logo.py <src.jpg>` in mythbound-v2-tests.
