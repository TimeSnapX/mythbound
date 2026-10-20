# Mythbound

Low-poly fantasy adventure in the browser: lock-on sword combat, RuneScape-style skills, grid building and the
Hollow Barrow dungeon. Plays on PC (keyboard + mouse) and phones (touch controls).

**Play:** https://timesnapx.github.io/mythbound/

Solo by default: it runs fully offline, needs no server, and saves progress in your browser's localStorage. **Cloud saves**
(Sign in with Google + Firestore) sync progress between phone and PC; see `FIREBASE_SETUP.md`. **Free online co-op for 2–4
players** (v2.2) runs peer-to-peer between the players' browsers, with no game server; see `COOP_SETUP.md`.

Static site, no build step. three.js r170 is vendored in `vendor/` (MIT, see `vendor/THREE_LICENSE`).
Installable as an app (manifest + network-first service worker scoped to `/mythbound/`). In-game "📲 Install app" button (title screen and HUD) uses `beforeinstallprompt`; otherwise: Chrome menu ⋮ > Add to Home screen / Install app.

Run locally: `python3 -m http.server 8090` in this folder, then open http://localhost:8090/.

## v3.0.0: the PvP mega update (changelog)

**PvP (co-op worlds; the host referees every hit)**
- **Duels**: challenge a nearby player. Rules are First-to-0 or Best-of-3, normalized stats (20 HP / 2 ATK) or your own gear, and potions on or off (max 3). A 3 s countdown starts each fight. Duels use a separate HP pool, so nobody loses items or real HP.
- **Ashfall Arena**: 1v1 and 2v2 matchmaking. First team to 3 KOs wins, or whoever leads after 90 s. Leaving the ring counts as a KO (ring-out). Respawns take 3 s with a spawn shield. You get a scoreboard and arena tokens (win 3, draw 2, loss 1).
- **Host validation**: the host checks reach (3.4 m, or 4.6 m for spin), the attack cooldown, roll i-frames, mounted attacks, unknown attack kinds, countdown hits, friendly fire and dead targets. Client stats are clamped. Stun diminishing returns: within 4 s, stuns go 100% → 50% → 25% → immune.
- **Fadelands** (Emberfall Ridge): an opt-in skull flag with real damage. Only flagged players can fight each other. If you die there, you lose at most 3 half-stacks; your gear, tokens, quest items and your 3 most valuable stacks are never lost. The flag fades 10 s after you leave.
- **Season leaderboard** (Firestore `/seasons`): the host records each match, every player acks it, and each player then updates only their own row (one claim per match, rating change of 32 or less).
- **Player trade** in co-op: two-phase escrow. Any change to an offer resets both accepts. Accepting an out-of-date offer is rejected. Every delivery is applied once by trade id. Untradeable items are blocked.

**World and story**
- **The Drowned Belfry** dungeon and **Vael**: the Act 1 ending.
- New regions: **Frostspire**, **Sunscar** (with a pyramid), **Mirewood** and **Starfall**. Also added: a world map with fast travel between the hearths you've discovered, and a day/night cycle with weather.
- Tasks (daily and weekly), an NPC market, farming and herblore, mounts, achievements and a collection log, a journal, and procedural music per zone.

**Phone and quality of life**
- Phone controls 2.0: scalable buttons, plus a layout editor to drag buttons and save them.
- The Install button is fixed.
- A What's-new splash.
- Saves from v2 migrate automatically, with nothing lost.
- The service worker is now `v3.0.0`. Firebase and Google domains are never cached.

### Firebase console steps for v3
1. Firestore → Rules: paste `firestore.rules` from this repo and Publish. The save, lobby and relay rules haven't changed. The new rules add `/seasons/{season}/{matches,players,claims}`.
2. No new indexes are needed (the leaderboard sorts at most 20 rows on the client).
3. Authentication: no change (Google sign-in). The leaderboard only appears for signed-in players in an online co-op world.
4. Optional: in Rules Playground, try writing `seasons/2026-S1/players/<someone-else>`. It should be denied.

## v2.2.0 — changelog
- **Online co-op (2–4 players, free)**: 👥 Co-op button on the title screen and in Settings.
  - **Host World** shows a 6-character code with 📋 Copy and 🔗 Invite buttons. Invite uses the phone share sheet when there is one, and otherwise copies a `?join=CODE` link. **Join World** takes a code; opening an invite link pre-fills it.
  - You must be signed in with Google to host or join. Everyone keeps their own character, skills, inventory and save, and progress only ever saves to your own cloud save.
  - The lobby lists players with hearts and ping. HUD party frames show names and hearts, and there are quick emotes (👋 🎉 👍 ❗ 😄 or `/wave` etc.) and chat with a light profanity filter.
- **How it works**: the host's browser is the authority. It runs enemies, bosses, drops, doors and dungeon puzzles, and validates every guest message (rate limits, movement speed and teleport checks, attack reach, damage caps; no item or XP injection).
  - Guests send inputs and actions and render 12 Hz snapshots with interpolation.
  - Transport is a WebRTC data channel (Google STUN) with Firestore signaling at `lobbies/{code}`. If a direct link is blocked, the game falls back automatically to a low-rate relay through the Firebase Realtime Database (`relay/{code}/{uid}`, 4 Hz). If `databaseURL` isn't set, players see "Couldn't connect directly, try another network".
- **Shared world rules**:
  - Kill XP goes to everyone within 30 m. Loot is personal: each player rolls their own drops.
  - Boss HP scales ×1 / ×1.75 / ×2.5 / ×3.25 with party size.
  - Building is allowed only on the host's home plot, and only when the host ticks "Let friends build".
  - Downed players can be revived by a friend holding interact for 3 s, or they respawn at a Hearthstone after 20 s.
- **Disconnects**: if the host leaves, guests return to their own world with their progress saved. If a guest leaves, the host carries on.
- **Solo is unchanged**: nothing co-op related loads or connects until you press Host or Join.
- **Files**:
  - `js/coop.js` (session logic), `js/coop-net.js` (links, limits, codes), `js/coop-ui.js`, `js/coop-firebase.js`, `js/coop-mock.js` (tests).
  - `vendor/firebase/firebase-database.js`, loaded only when the relay is needed.
  - `firestore.rules` gains the lobby rules (save rules unchanged). `database.rules.json` holds the relay rules.
- **Debug**: `?debug=1&coop=mock&coophub=ws://…` (test hub), `&direct=block`, `&relay=off`, `&p2ptimeout=ms`, `window.MB_COOP_ADAPTERS`. Use `?debug=1&fbconfig=placeholder` or `window.MB_FIREBASE_CONFIG` to simulate an unconfigured build.
- **Service worker**: v2.2.0. Firebase and Google hosts, including `*.firebasedatabase.app`, are network-only.

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
