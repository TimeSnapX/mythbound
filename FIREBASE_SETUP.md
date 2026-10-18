# Mythbound cloud saves: Firebase setup

Mythbound v2.1 can sync your save between devices (for example a Pixel phone in Chrome and a PC) using
**Firebase Authentication (Sign in with Google)** and **Cloud Firestore**. Both are free on Firebase's **Spark** plan, and no
billing account is needed.

Until `js/firebase-config.js` has a real config, the game shows **"Cloud saves coming soon"**. It never downloads the Firebase
SDK and works exactly like v2.0 (saves stay in the browser).

Setup takes about 10 minutes and is all done in the browser.

## 1. Create the project
1. Go to <https://console.firebase.google.com> and sign in with your Google account.
2. Click **Create a project** (or **Add project**). Name it, for example, `mythbound`, accept the terms and click **Continue**.
3. Google Analytics isn't needed, so you can switch it **off**. Then click **Create project**, wait, and click **Continue**.
4. Leave the project on the free **Spark** plan.

## 2. Turn on Google sign-in
1. In the left menu, open **Build → Authentication** and click **Get started**.
2. On the **Sign-in method** tab, choose **Google** and switch on **Enable**.
3. Set **Public-facing name for project** to `Mythbound`, pick your email as the **Support email**, then click **Save**.

## 3. Add the GitHub Pages domain
1. Go to **Authentication → Settings → Authorized domains**.
2. Click **Add domain**, enter `timesnapx.github.io` and click **Add**.
   - Enter only the host: no `https://` and no `/mythbound/` path.
   - `localhost` is already on the list, so local testing works.

## 4. Create Firestore in production mode and add the rules
1. Open **Build → Firestore Database** and click **Create database**.
2. Choose a **location**, for example `australia-southeast1 (Sydney)`. You can't change the location later.
3. Choose **Start in production mode** and click **Create**.
4. Open the **Rules** tab, replace everything with the rules below (they are also in `firestore.rules`), and click **Publish**.

```
rules_version = '2';
// Mythbound cloud saves. Each player can read/write only their own documents at users/{uid}/saves/{main|backup}.
// v2.2 adds co-op lobby signaling under /lobbies (below the save rules, which are unchanged).
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/saves/{slot} {
      function isOwner() { return request.auth != null && request.auth.uid == uid; }
      function validSave() {
        let d = request.resource.data;
        return d.keys().hasOnly(['data', 'version', 'updatedAt', 'clientUpdatedAt', 'device', 'playtime', 'totalLevel', 'characterName'])
          && d.keys().hasAll(['data', 'version', 'updatedAt', 'clientUpdatedAt', 'device'])
          && d.data is string && d.data.size() > 0 && d.data.size() <= 900000
          && d.version is number && d.clientUpdatedAt is number
          && d.updatedAt == request.time
          && d.device in ['phone', 'pc']
          && (!('playtime' in d) || d.playtime is number)
          && (!('totalLevel' in d) || d.totalLevel is number)
          && (!('characterName' in d) || (d.characterName is string && d.characterName.size() <= 32));
      }
      allow read: if isOwner() && slot in ['main', 'backup'];
      allow create, update: if isOwner() && slot in ['main', 'backup'] && validSave();
      allow delete: if isOwner();
    }

    // ---- v2.2 co-op signaling (WebRTC offer / answer / ICE candidates). The game itself runs peer-to-peer. ----
    // lobbies/{code}: one per hosted world, 6-character code, expires 2 h after it was opened (expiresAt, checked by
    // the game client and by the rules below). Only signed-in players can create or read lobbies.
    function signedIn() { return request.auth != null; }
    function lobbyCode(code) { return code.matches('^[A-HJ-NP-Z2-9]{6}$'); }
    function lobby(code) { return get(/databases/$(database)/documents/lobbies/$(code)).data; }
    function lobbyOpen(code) { return exists(/databases/$(database)/documents/lobbies/$(code)) && lobby(code).expiresAt > request.time; }
    function isHost(code) { return signedIn() && exists(/databases/$(database)/documents/lobbies/$(code)) && lobby(code).hostUid == request.auth.uid; }
    function sdpOk(x) { return x is map && x.keys().hasOnly(['type', 'sdp']) && x.type is string && x.sdp is string && x.sdp.size() <= 20000; }
    match /lobbies/{code} {
      function validLobby() {
        let d = request.resource.data;
        return lobbyCode(code)
          && d.keys().hasOnly(['code', 'hostUid', 'hostName', 'createdAt', 'expiresAt', 'max', 'v'])
          && d.keys().hasAll(['code', 'hostUid', 'hostName', 'createdAt', 'expiresAt'])
          && d.code == code && d.hostUid == request.auth.uid
          && d.hostName is string && d.hostName.size() <= 16
          && d.createdAt == request.time
          && d.expiresAt is timestamp && d.expiresAt > request.time && d.expiresAt <= request.time + duration.value(125, 'm')
          && (!('max' in d) || d.max == 4) && (!('v' in d) || d.v is number);
      }
      allow read: if signedIn();
      allow create: if signedIn() && validLobby();
      // re-open your own lobby, or take over a code whose lobby has expired
      allow update: if signedIn() && validLobby() && (resource.data.hostUid == request.auth.uid || resource.data.expiresAt < request.time);
      allow delete: if signedIn() && resource.data.hostUid == request.auth.uid;

      // lobbies/{code}/peers/{uid}: a guest's join request. The guest creates it; only the host writes the offer,
      // only that guest writes the answer.
      match /peers/{uid} {
        function isGuest() { return signedIn() && request.auth.uid == uid; }
        function freshJoin() {
          let d = request.resource.data;
          return d.keys().hasOnly(['uid', 'name', 'joinedAt']) && d.uid == uid && d.name is string && d.name.size() <= 16
            && d.joinedAt == request.time && lobbyOpen(code) && lobby(code).hostUid != uid;
        }
        function changed() { return request.resource.data.diff(resource.data).affectedKeys(); }
        allow read: if isGuest() || isHost(code);
        allow create: if isGuest() && freshJoin();
        allow update: if (isHost(code) && changed().hasOnly(['offer']) && sdpOk(request.resource.data.offer))
                      || (isGuest() && changed().hasOnly(['answer']) && sdpOk(request.resource.data.answer))
                      || (isGuest() && freshJoin());
        allow delete: if isGuest() || isHost(code);

        // trickled ICE candidates, one subcollection per side
        function validCand() {
          let d = request.resource.data;
          return d.keys().hasOnly(['cand', 'at']) && d.cand is string && d.cand.size() <= 2000 && d.at == request.time;
        }
        match /hostCandidates/{id} {
          allow read: if isGuest() || isHost(code);
          allow create: if isHost(code) && validCand();
          allow delete: if isGuest() || isHost(code);
        }
        match /guestCandidates/{id} {
          allow read: if isGuest() || isHost(code);
          allow create: if isGuest() && lobbyOpen(code) && validCand();
          allow delete: if isGuest() || isHost(code);
        }
      }
    }

    // everything else is closed
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

What the rules do:
- The cloud-save part (`users/{uid}/saves/...`) is unchanged from v2.1. v2.2 adds the co-op `lobbies` rules, see
  [COOP_SETUP.md](COOP_SETUP.md). Already published the v2.1 rules? Publish this whole file again.
- A signed-in player can only read and write `users/<their uid>/saves/main` and `users/<their uid>/saves/backup`.
- Everything else in the database is denied.
- A save must have the expected fields, `updatedAt` must be the server time, and the save JSON (`data`) is capped at
  900,000 characters. Firestore's own limit is 1 MiB per document.
- The game also refuses to upload anything larger and keeps that save on the device.

## 5. Register the web app and copy the config
1. Click the gear icon next to **Project Overview**, open **Project settings**, then the **General** tab.
2. Under **Your apps**, click the **Web** icon (`</>`).
3. Enter the nickname `Mythbound web`. **Leave "Also set up Firebase Hosting" unticked**, then click **Register app**.
4. Firebase shows a `firebaseConfig = { ... }` block. Copy the values. You can see them again later under
   Project settings → Your apps → **SDK setup and configuration → Config**.

## 6. Paste the config into the game
Open `js/firebase-config.js` and replace every `REPLACE_ME…` value:

| field | example | needed |
|---|---|---|
| `apiKey` | `AIzaSy…` (39 characters) | **required** |
| `authDomain` | `mythbound-12345.firebaseapp.com` | **required** |
| `projectId` | `mythbound-12345` | **required** |
| `appId` | `1:123456789012:web:abc123def456` | **required** |
| `storageBucket` | `mythbound-12345.firebasestorage.app` | optional (unused) |
| `messagingSenderId` | `123456789012` | optional (unused) |
| `measurementId` | only if Analytics is on | not used. Leave it out. |

Cloud saves switch on by themselves once none of the four required fields contains `REPLACE_ME`. The `CLOUD_SAVES_ENABLED`
switch in the same file can turn them off again. The web `apiKey` is not a secret. The rules and the authorised-domains list
protect your data.

Then publish the site as usual. No service-worker bump is needed for a config-only change because the worker is network-first.

## 7. Test it
1. On the PC, open <https://timesnapx.github.io/mythbound/> and click **Sign in with Google** on the title screen
   (it is also under ⚙ Settings). A Google pop-up appears. Afterwards your name and photo show with a **Sign out** link,
   and the note changes to "☁ Synced …".
2. In the Firebase console, open **Firestore → Data**. You should see `users/<uid>/saves/main`.
3. On the Pixel, open the same URL in Chrome and sign in with the **same** Google account.
   - If the phone has no save, it downloads the PC's save and offers **Continue as <name>**.
   - If both devices have a different save, a chooser appears: **Keep cloud** or **Keep this device**. The newer save is
     highlighted. The save you don't keep is backed up: a local one goes to `mythbound_save_v2_before_cloud` in
     localStorage, a cloud one goes to `users/<uid>/saves/backup`.

## How syncing behaves
- **On sign-in and on every load while signed in**, the cloud save and this device's save are compared:
  - If only one side has a save, that one is used. An empty cloud gets this device's save uploaded.
  - If only one side changed since the last sync, that side wins and you aren't asked.
  - If both changed, or this device has never synced, you get the chooser. Nothing is overwritten until you choose.
- **While you play**, autosave still writes to localStorage every 5 s. The cloud copy is pushed **at most once every 30 s**,
  and also right away on **💾 Save now** (Settings), when the tab is hidden or the app goes to the background, and on page close.
- **Offline**, the game keeps saving locally, marks the cloud copy as pending, and pushes automatically when the connection
  comes back (or the next time the game is opened online).
- Cloud saves go through the same **v1 → v2 migration** as local saves.
- The free quota is 20,000 writes/day. One push per 30 s is at most 120 writes per hour of play.

## Sign-in flow notes (phone / installed app)
- **Desktop:** `signInWithPopup`.
- **Phones and the installed (standalone) app:** `signInWithRedirect`, as configured by `AUTH_FLOW = 'auto'`. The redirect is
  also used whenever a pop-up is blocked, and `getRedirectResult` is handled on load.
- Recent Chrome, Safari and Firefox versions partition third-party storage. This can stop the redirect flow from finishing on
  `*.github.io` sites, because `authDomain` (`*.firebaseapp.com`) is a different site.
  - If a redirect comes back without a signed-in user, the game notices. It shows "Tap Sign in again; it will use a pop-up
    this time" and switches that device to pop-up sign-in (pop-ups open as a new tab or custom tab on Android and work there).
  - To always use the pop-up, set `AUTH_FLOW = 'popup'` in `js/firebase-config.js`.
- Details: <https://firebase.google.com/docs/auth/web/redirect-best-practices>

## Troubleshooting
- **"Sign-in is not enabled for this site yet"** (`auth/unauthorized-domain`): add `timesnapx.github.io` in step 3.
- **"Google sign-in is not enabled"** (`auth/operation-not-allowed`): finish step 2.
- **Signed in but nothing in Firestore / "Cloud save failed, will retry"**: make sure the database exists (step 4) and the rules
  were **published**.
- If you restrict the API key in Google Cloud Console (APIs & Services → Credentials), the HTTP referrers must include
  `https://timesnapx.github.io/*` **and** `https://<project-id>.firebaseapp.com/*`.
- For testing without a Firebase project, `?debug=1&cloud=mock` uses an in-memory mock, and `?cloud=off` hides cloud saves.

## Co-op (v2.2)
Online co-op uses the same project: the lobby rules above, plus an optional Realtime Database relay for players on strict
networks. See [COOP_SETUP.md](COOP_SETUP.md).
