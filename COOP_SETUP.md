# Mythbound co-op (v2.2): Firebase setup

Co-op is free and runs **peer-to-peer**. The host's browser is the game server for its friends, so Firebase only does
three small jobs, all on the free **Spark** plan:

| Job | Firebase product | Path | Needed? |
|---|---|---|---|
| Google sign-in (same as cloud saves) | Authentication | – | yes (already set up for cloud saves) |
| Lobby + WebRTC signaling (offer / answer / ICE) | Cloud Firestore | `lobbies/{code}/…` | yes: publish the new `firestore.rules` |
| Relay for strict networks (fallback only) | Realtime Database | `relay/{code}/{uid}/…` | optional, recommended |

Without the Realtime Database, co-op still works for most players. When two players can't make a direct link (some
mobile carriers, strict corporate or school Wi-Fi, symmetric NAT), the joining player sees **"Couldn't connect directly,
try another network"**.

## 1. Publish the updated Firestore rules (required)
1. Open <https://console.firebase.google.com> and choose the **mythbound-1f1f1** project.
2. Open **Build → Firestore Database → Rules**.
3. Replace everything with the contents of `firestore.rules` from this build and click **Publish**.
   - The cloud-save rules (`users/{uid}/saves/{slot}`) are byte-for-byte the same as v2.1. Only the `lobbies` block is new.

What the lobby rules allow:
- `lobbies/{code}`: any signed-in player can **read**. A signed-in player can **create** one only with
  `hostUid == their uid`, a valid 6-character code, `createdAt` = server time, and `expiresAt` no more than ~2 h ahead.
  Only the host can update or delete it. An *expired* code may be taken over by a new host.
- `lobbies/{code}/peers/{uid}`: a guest creates their own join doc (only while the lobby hasn't expired, and not in their
  own lobby). **Only the host can write `offer`. Only that guest can write `answer`.** Each side can read only its own doc;
  the host can read all of them.
- `…/peers/{uid}/hostCandidates` are written only by the host, and `…/guestCandidates` only by that guest.
- Everything else is still denied.
- The game also checks `expiresAt` itself: it refuses expired invites ("That invite has expired").
- Optional tidy-up: in **Firestore → TTL policies** (if your console offers it), add a policy on collection group `lobbies`,
  field `expiresAt`. The game already deletes its lobby when the host ends co-op or closes the tab, so this only catches
  crashed sessions. Note: TTL deletes don't cascade to subcollections. Leftovers are tiny and unreadable once expired.

## 2. Create the Realtime Database for the relay (optional, recommended)
1. In the same project, open **Build → Realtime Database** and click **Create Database**.
2. **Location**: there is no Australian region for the Realtime Database. Pick **Singapore (asia-southeast1)**, the
   closest one. The other choices are us-central1 and europe-west1.
3. Choose **Start in locked mode** and click **Enable**.
4. The **Data** tab now shows the database URL at the top, for example
   `https://mythbound-1f1f1-default-rtdb.asia-southeast1.firebasedatabase.app`. Copy it exactly (Singapore databases end in
   `.firebasedatabase.app`; us-central1 ones look like `https://mythbound-1f1f1-default-rtdb.firebaseio.com`).
5. Open the **Rules** tab, replace everything with the rules below (they are also in `database.rules.json`), and click **Publish**.

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "relay": {
      "$code": {
        ".validate": "$code.matches(/^[A-HJ-NP-Z2-9]{6}$/)",
        "$to": {
          ".read": "auth != null && auth.uid === $to",
          ".write": "auth != null && auth.uid === $to && !newData.exists()",
          "$msg": {
            ".write": "auth != null && ((!data.exists() && newData.exists() && newData.child('f').val() === auth.uid && auth.uid !== $to) || (data.exists() && !newData.exists() && auth.uid === $to))",
            ".validate": "newData.hasChildren(['f', 'd', 't'])",
            "f": { ".validate": "newData.isString() && newData.val() === auth.uid" },
            "d": { ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 60000" },
            "t": { ".validate": "newData.isNumber() && newData.val() <= now + 60000" },
            "$other": { ".validate": false }
          }
        }
      }
    }
  }
}
```

What the relay rules do:
- `relay/{code}/{uid}` is a per-player inbox. **Only that player can read it**, and only they can delete messages from it
  (the game deletes each message as soon as it has read it, and clears the inbox when the session ends).
- Any signed-in player can drop a message in someone else's inbox, but the sender field `f` must be their own uid, so
  nobody can pretend to be the host or another guest. A message is `{ f, d (≤ 60,000 chars of JSON), t (server time) }`
  and nothing else. The code must look like a real lobby code.
- The game only accepts relay messages from the lobby's host (guests) or from players who joined the lobby (host). The
  host then runs the same validation as on a direct link.

## 3. Put the URL in the game
In `js/firebase-config.js`, set:

```js
  databaseURL: 'https://mythbound-1f1f1-default-rtdb.asia-southeast1.firebasedatabase.app',
```

(use the exact URL from step 2.4), then deploy as usual. Nothing else changes. The Realtime Database SDK
(`vendor/firebase/firebase-database.js`) is downloaded only when a player actually needs the relay.

## Free-plan limits (Spark)
- **Firestore**: 50,000 reads, 20,000 writes and 20,000 deletes per day. One join costs roughly 10–30 writes (join doc, offer,
  answer, a handful of ICE candidates) and about the same in deletes when it is cleaned up, which is thousands of joins a day.
  During play, Firestore isn't used at all.
- **Realtime Database**: 100 simultaneous connections, 1 GB stored, 10 GB downloaded per month. The relay only carries
  players who couldn't link directly. It sends at most 4 batched messages a second per player, about 5–15 KB/s down for
  a relayed guest, so roughly 200+ hours of relayed play a month. Messages are deleted as soon as they are read, so
  storage stays near zero.

## Known limits
- **4 players maximum** (host + 3). A 5th player is told the world is full.
- **Strict NAT / blocked UDP**: there is no TURN server (that would cost money). Those players use the relay, which is
  slower: 4 Hz instead of 12 Hz, and enemies look a little steppier. Without `databaseURL` they can't join from that
  network at all.
- The host's device does all the work for the world. A slow phone hosting 3 friends may drop frames, so a PC is the best host.
- When the host leaves, the session ends for everyone. Guests return to their own world with everything they earned
  saved (XP, items, gold). The host's world (builds, puzzle state) is never written into a guest's save.
- Lobby codes expire 2 hours after hosting. Friends who are already in can keep playing; host again for a new code.
- Bombable mine walls are per player, and each player's Hearthstone and home plot stay their own.
