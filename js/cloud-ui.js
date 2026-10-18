// Cloud saves glue: picks an adapter, wires CloudSync to the game, renders the sign-in box (title screen + Settings) and the
// "which save do you want to keep?" chooser. All cloud logic lives in cloud.js; Firebase specifics in cloud-firebase.js.
import { CloudSync } from './cloud.js';
import { firebaseConfig, CLOUD_SAVES_CONFIGURED, AUTH_FLOW } from './firebase-config.js';
import * as UI from './ui.js';

const esc = UI.esc;
const G_LOGO = '<svg class="g-logo" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
export const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'an unknown time');
const devName = (d) => (d === 'phone' ? 'phone' : d === 'pc' ? 'PC' : 'another device');

export async function pickAdapter(params) {
  const debug = params.has('debug');
  if (params.get('cloud') === 'off') return null;
  if (debug && window.MB_CLOUD_ADAPTER) return typeof window.MB_CLOUD_ADAPTER === 'function' ? await window.MB_CLOUD_ADAPTER() : window.MB_CLOUD_ADAPTER;
  if (debug && params.get('cloud') === 'mock') { const { MockCloudAdapter } = await import('./cloud-mock.js'); return new MockCloudAdapter(); }
  if (!CLOUD_SAVES_CONFIGURED) return null;
  const { createFirebaseAdapter } = await import('./cloud-firebase.js');
  return createFirebaseAdapter(firebaseConfig, { flow: AUTH_FLOW });
}

export function boxHtml(st, adapter) {
  if (st.status === 'disabled') return '<div class="cloud-soon">☁ Cloud saves coming soon</div>';
  if (st.status === 'loading') return '<div class="cloud-note">☁ Connecting cloud saves…</div>';
  if (st.status === 'error') return `<div class="cloud-note">☁ ${esc(st.message || 'Cloud saves are unavailable right now.')}</div>`;
  if (st.status === 'signedOut') return `<button class="gbtn" data-cloud="signin">${G_LOGO}<span>Sign in with Google</span></button><div class="cloud-note">${esc(adapter?.notice || 'Sign in to sync your progress between phone and PC.')}</div>`;
  const u = st.user || {};
  const ini = esc((u.name || '?').trim().charAt(0).toUpperCase() || '?');
  const av = `<span class="cloud-av">${ini}${u.photo ? `<img src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</span>`;
  const sync = { checking: 'Checking your cloud save…', saving: 'Saving to the cloud…', saved: `☁ Synced ${st.lastSyncAt ? new Date(st.lastSyncAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : ''}`, conflict: 'Choose which save to keep.', idle: '☁ Signed in' }[st.sync] ?? '';
  return `<div class="cloud-user">${av}<span class="cloud-name" title="${esc(u.email || '')}">${esc(u.name || 'Player')}</span><button class="link" data-cloud="signout">Sign out</button></div><div class="cloud-note cloud-${esc(st.sync)}">${esc(st.message || sync)}</div>`;
}

export function chooserHtml(c, here) {
  const cl = c.cloud, lo = c.local, newer = c.newer;
  const card = (side, label, d, when, dev) => `<div class="cloud-card ${newer === side ? 'newer' : ''}" data-side="${side}">
    ${newer === side ? '<span class="tagnew">Newer</span>' : ''}<p><b>${label}:</b> ${esc(d.characterName || '?')}, total level ${+d.totalLevel || 0}, saved ${esc(fmtTime(when))} on ${esc(devName(dev))}</p>
    <button data-cloud-pick="${side}" class="${newer === side ? 'primary' : ''}">${side === 'cloud' ? 'Keep cloud' : 'Keep this device'}</button></div>`;
  return `<div class="cloud-dlg" role="dialog" aria-modal="true" aria-labelledby="cloud-h"><h2 id="cloud-h">☁ Which save do you want?</h2>
    <p class="sub">Your cloud save and this device's save are different. Nothing is overwritten until you choose. The one you don't keep is kept as a backup.</p>
    ${card('cloud', 'Cloud save', cl, cl.clientUpdatedAt || cl.updatedAt, cl.device)}
    ${card('local', 'This device', lo, lo.clientUpdatedAt, here)}</div>`;
}

export function initCloud(game, params = new URLSearchParams(location.search)) {
  const device = game.touch ? 'phone' : 'pc';
  const ui = { adapter: null };
  const render = (st) => {
    const h = boxHtml(st, ui.adapter);
    for (const el of document.querySelectorAll('#cc-cloud, .cloud-slot')) if (el.innerHTML !== h) el.innerHTML = h;
    let dlg = document.getElementById('cloud-choose');
    if (st.conflict) {
      if (!dlg) { dlg = document.createElement('div'); dlg.id = 'cloud-choose'; document.body.appendChild(dlg); }
      dlg.innerHTML = chooserHtml(st.conflict, device); dlg.classList.remove('hidden');
      dlg.querySelector('.newer button')?.focus();
    } else if (dlg) dlg.classList.add('hidden');
  };
  const sync = new CloudSync({
    adapter: null, storage: localStorage, win: window,
    getLocal: () => game.localSaveDoc(device),
    applyCloud: (data) => game.applyCloudSave(data),
    onChange: render,
  });
  game.cloud = sync; ui.html = () => boxHtml(sync.state, ui.adapter); ui.render = () => render(sync.state); game.cloudUI = ui;
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cloud], [data-cloud-pick]'); if (!b) return;
    e.stopPropagation();
    if (b.dataset.cloudPick) return sync.resolve(b.dataset.cloudPick);
    const a = b.dataset.cloud;
    if (a === 'signin') { const p = sync.signIn(); Promise.resolve(p).catch((err) => { UI.toast(err?.message || 'Sign-in failed.', 'bad'); console.warn('[cloud] sign-in', err); }); }
    else if (a === 'signout') sync.signOut().then(() => UI.toast('Signed out. Progress keeps saving on this device.', '')).catch((err) => console.warn('[cloud] sign-out', err));
    else if (a === 'save') { game.save(); UI.toast(sync.state.user ? 'Saved (syncing to the cloud…)' : 'Saved on this device.', 'good'); sync.flush(); }
  }, true);
  const bye = () => { if (game.phase === 'play') game.save(); sync.flush(); };
  addEventListener('pagehide', bye);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') bye(); });
  const maybe = params.get('cloud') !== 'off' && (CLOUD_SAVES_CONFIGURED || (params.has('debug') && (!!window.MB_CLOUD_ADAPTER || params.get('cloud') === 'mock')));
  sync.state.status = maybe ? 'loading' : 'disabled';
  render(sync.state);
  (async () => {
    let adapter = null;
    try { adapter = await pickAdapter(params); }
    catch (e) { console.warn('[cloud] could not load cloud saves', e); sync.set({ status: 'error', message: navigator.onLine === false ? 'Offline: cloud saves will connect when you are back online.' : 'Cloud saves are unavailable right now.' }); return; }
    ui.adapter = adapter; sync.adapter = adapter;
    if (!adapter) return sync.set({ status: 'disabled' });
    sync.set({ status: 'loading' });
    await sync.start();
  })();
  return sync;
}
