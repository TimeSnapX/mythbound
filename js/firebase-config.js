// Mythbound cloud saves: Firebase config (Sign in with Google + Cloud Firestore, both on the free Spark plan).
//
// ▶ HOW TO TURN CLOUD SAVES ON: see FIREBASE_SETUP.md. In short, create a Firebase project, register a web app, then
//   paste the values from "Project settings → Your apps → SDK setup and configuration → Config" over the
//   REPLACE_ME placeholders below. The web apiKey is not a secret: access is protected by firestore.rules
//   and the authorised-domains list in Firebase Authentication.
//
// While ANY field below still starts with "REPLACE_ME", CLOUD_SAVES_CONFIGURED is false. The title screen and Settings
// then show "Cloud saves coming soon", the Firebase SDK is never downloaded, and the game behaves exactly like v2.0.0
// (saves stay in this browser's localStorage).
export const firebaseConfig = {
  apiKey: 'AIzaSyCoDXzxpW8iD4Qt6px2f75sN8E6YdePg8Y',                       // e.g. 'AIzaSy…' (39 chars)
  authDomain: 'mythbound-1f1f1.firebaseapp.com', // e.g. 'mythbound-12345.firebaseapp.com'
  projectId: 'mythbound-1f1f1',                  // e.g. 'mythbound-12345'
  storageBucket: 'mythbound-1f1f1.firebasestorage.app', // e.g. 'mythbound-12345.firebasestorage.app' (not used by the game)
  messagingSenderId: '778539563904',           // e.g. '123456789012' (not used by the game)
  appId: '1:778539563904:web:fe5000e6721d1062b45f65',                          // e.g. '1:123456789012:web:abc123def456'
};

// Master switch. Set to false to hide cloud saves even when the config above is filled in.
export const CLOUD_SAVES_ENABLED = true;

// Sign-in flow: 'auto' = pop-up on desktop; full-page redirect on phones and installed (standalone) apps, and whenever
// the pop-up is blocked. If a redirect comes back without a signed-in user (some browsers block the storage the redirect
// flow needs), the game switches that device to pop-up sign-in on the next tap. 'popup' / 'redirect' force one flow.
export const AUTH_FLOW = 'auto';

const REQUIRED = ['apiKey', 'authDomain', 'projectId', 'appId'];
export function isConfigured(cfg = firebaseConfig) {
  return REQUIRED.every((k) => typeof cfg[k] === 'string' && cfg[k].trim() && !/REPLACE_ME/i.test(cfg[k]));
}
// true only once the placeholders have been replaced with a real project's values.
export const CLOUD_SAVES_CONFIGURED = CLOUD_SAVES_ENABLED && isConfigured();
