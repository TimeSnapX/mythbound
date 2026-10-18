Firebase JS SDK 12.19.0 (modular ESM builds from https://www.gstatic.com/firebasejs/12.19.0/), Apache-2.0
(https://github.com/firebase/firebase-js-sdk/blob/main/LICENSE). Changes: the `firebase-app.js` import in
firebase-auth.js / firebase-firestore.js was made relative ("./firebase-app.js") and the sourceMappingURL comments were removed.
Loaded only by js/cloud-firebase.js, and only when js/firebase-config.js holds a real config.
