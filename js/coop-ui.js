// Co-op glue + UI: picks the signaling/relay adapters, renders the Co-op lobby (title screen + Settings), the HUD party
// frames and quick emotes, and handles ?join=CODE invite links. Session logic lives in coop.js, transports in coop-net.js.
import { Coop, EMOTES } from './coop.js';
import { MAX_PLAYERS, normCode, validCode, inviteLink } from './coop-net.js';
import { effectiveConfig } from './firebase-config.js';
import * as UI from './ui.js';

const esc = UI.esc;
export async function pickCoopAdapters(game, params) {
  const debug = params.has('debug');
  if (debug && window.MB_COOP_ADAPTERS) return typeof window.MB_COOP_ADAPTERS === 'function' ? await window.MB_COOP_ADAPTERS(game) : window.MB_COOP_ADAPTERS;
  if (debug && params.get('coop') === 'mock' && params.get('coophub')) {
    const { createMockCoopAdapters } = await import('./coop-mock.js');
    return createMockCoopAdapters({ hub: params.get('coophub'), blockDirect: params.get('direct') === 'block', relay: params.get('relay') !== 'off' });
  }
  if (game.cloud?.adapter?.kind !== 'firebase') return null; // co-op rides on the same Google sign-in as cloud saves
  const { createCoopAdapters } = await import('./coop-firebase.js');
  return createCoopAdapters(effectiveConfig(params));
}
const miniHearts = (hp, mhp) => { let h = ''; const n = Math.ceil((mhp || 2) / 2); for (let i = 0; i < Math.min(n, 20); i++) { const v = hp - i * 2; h += `<i class="mh ${v >= 2 ? 'full' : v === 1 ? 'half' : ''}"></i>`; } return h; };
const pingTxt = (r) => (r.host ? 'host' : r.ping ? `${r.ping} ms` : '…');

export function initCoop(game, params = new URLSearchParams(location.search)) {
  game.coopOpts = params.has('debug') && params.get('p2ptimeout') ? { p2pTimeout: Math.max(1000, +params.get('p2ptimeout') || 0) } : {};
  const coop = new Coop(game, () => pickCoopAdapters(game, params));
  game.coop = coop;
  const box = document.createElement('div'); box.id = 'coop'; box.className = 'hidden'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'coop-h'); document.body.appendChild(box);
  const bar = document.createElement('div'); bar.id = 'coopbar'; bar.className = 'hidden';
  bar.innerHTML = `<div id="party"></div><div id="emotes">${Object.entries(EMOTES).map(([k, e]) => `<button data-emote="${k}" title="${k}" aria-label="Emote: ${k}">${e}</button>`).join('')}</div>`;
  document.getElementById('hud').appendChild(bar);
  // title-screen + settings buttons
  const cc = document.getElementById('cc-cloud');
  const tb = document.createElement('button'); tb.id = 'cc-coop'; tb.className = 'coop-btn'; tb.innerHTML = '👥 Co-op <small>2–4 players</small>'; cc.parentElement.insertBefore(tb, cc);
  const ui = { invite: null, codeDraft: '', busy: false };
  const joinParam = normCode(params.get('join') || '');
  if (validCode(joinParam)) { ui.invite = joinParam; ui.codeDraft = joinParam; }

  const players = () => {
    const list = coop.isHost ? coop.roster : coop.isGuest ? coop.roster : [];
    if (!list.length) return '';
    return `<h3>Players <small>${list.length}/${MAX_PLAYERS}</small></h3><ul class="coop-list">${list.map((r) => `<li data-pid="${esc(r.id)}"><b>${r.host ? '👑 ' : ''}${esc(r.name)}${r.id === coop.me ? ' <small>(you)</small>' : ''}</b><span class="mhs">${miniHearts(r.hp, r.mhp)}</span><span class="ping">${esc(r.id === coop.me && !r.host ? (coop.ping ? coop.ping + ' ms' : '…') : pingTxt(r))}${r.via === 'relay' ? ' · relay' : ''}</span></li>`).join('')}</ul>`;
  };
  const html = () => {
    const cs = game.cloud?.state || {}, signed = cs.status === 'signedIn';
    let h = `<button class="close" data-coop="close" aria-label="Close">✕</button><h2 id="coop-h">👥 Co-op</h2>`;
    if (ui.invite && !coop.role) h += `<p class="coop-invite">You've been invited to world <b>${esc(ui.invite)}</b>!</p>`;
    if (cs.status === 'disabled' || cs.status === 'error') return h + `<p class="sub">Co-op needs Google sign-in, which isn't available right now${cs.status === 'error' ? ' (offline?)' : ''}. Solo play works as normal.</p>`;
    if (!signed && !coop.role) return h + `<p class="sub">Play with up to ${MAX_PLAYERS - 1} friends, free. Sign in with Google to host or join; everyone keeps their own character and save.</p><div class="cloud-slot">${game.cloudUI?.html() || ''}</div>`;
    if (coop.isHost) {
      return h + `<p class="sub">Your world is open. Friends join with this code:</p><div class="coop-code" id="coop-code">${esc(coop.code)}</div>
        <div class="coop-row"><button data-coop="copy">📋 Copy code</button><button data-coop="invite" class="primary">🔗 Invite</button></div>
        <label class="set chk"><input type="checkbox" data-coop-build ${coop.allowBuild ? 'checked' : ''}> Let friends build on my home plot${game.s.home?.plot ? '' : ' <small>(claim one first)</small>'}</label>
        ${players() || '<p class="sub">Waiting for friends…</p>'}<p class="sub small">Invite codes expire after 2 hours. Bosses get tougher with more players.</p>
        <div class="coop-row"><button data-coop="end" class="danger">End co-op</button></div>`;
    }
    if (coop.role === 'guest') {
      return h + `<p class="coop-status">${esc(coop.status || 'Connecting…')}</p>${players()}<div class="coop-row"><button data-coop="leave" class="danger">${coop.joined ? 'Leave world' : 'Cancel'}</button></div>`;
    }
    const need = game.phase !== 'play' && !game.hasSave;
    return h + `<p class="sub">Host your world or join a friend's. Everyone brings their own character, skills, items and save.</p>
      ${need ? '<p class="coop-err">Create your character first (Begin your legend), then open Co-op.</p>' : ''}
      <div class="coop-row"><button data-coop="host" class="primary" ${need || ui.busy ? 'disabled' : ''}>🏠 Host World</button></div>
      <div class="coop-join"><input id="coop-code-in" maxlength="20" placeholder="Join code" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(ui.codeDraft)}" aria-label="Join code"><button data-coop="join" ${need || ui.busy ? 'disabled' : ''}>Join World</button></div>
      ${coop.error ? `<p class="coop-err" role="alert">${esc(coop.error)}</p>` : coop.status ? `<p class="coop-status">${esc(coop.status)}</p>` : ''}
      <p class="sub small">Free peer-to-peer play: no servers. A few strict networks block direct links; then the game tries a relay.</p>`;
  };
  const render = () => {
    if (!box.classList.contains('hidden')) {
      const a = document.activeElement, keep = a?.id === 'coop-code-in' ? { v: a.value, s: a.selectionStart } : null;
      const h = html(); if (box.dataset.h !== h) { box.innerHTML = `<div class="coop-dlg">${h}</div>`; box.dataset.h = h; if (keep) { const n = document.getElementById('coop-code-in'); n.value = keep.v; n.focus(); n.setSelectionRange(keep.s, keep.s); } }
    }
    renderParty();
  };
  const renderParty = () => {
    const on = coop.active && game.phase === 'play'; bar.classList.toggle('hidden', !on); if (!on) return;
    const list = coop.roster.filter((r) => r.id !== coop.me);
    const h = list.map((r) => { const rem = game.remotes.get(r.id), dead = rem ? rem.dead : r.dead; return `<div class="pf${dead ? ' down' : ''}" data-pid="${esc(r.id)}"><span class="pf-n">${r.host ? '👑 ' : ''}${esc(r.name)}${dead ? ' 💀' : ''}</span><span class="mhs">${miniHearts(r.hp, r.mhp)}</span><span class="pf-p">${esc(pingTxt(r))}</span></div>`; }).join('');
    const p = document.getElementById('party'); if (p.innerHTML !== h) p.innerHTML = h;
  };
  coop.onChange = render; game.coopUI = { render, open: () => open(), close: () => close() };
  game.onCoopChange = () => { render(); };
  const open = () => { box.classList.remove('hidden'); delete box.dataset.h; render(); if (document.pointerLockElement) document.exitPointerLock(); setTimeout(() => (box.querySelector('#coop-code-in:not([disabled])') || box.querySelector('button.primary:not([disabled])'))?.focus(), 0); };
  const close = () => { box.classList.add('hidden'); };
  tb.onclick = () => { game.audio.play('ui'); open(); };
  const ensurePlaying = async () => { if (game.phase === 'play') return true; if (!game.hasSave) return false; await game.start(false); return true; };
  const run = async (fn) => {
    ui.busy = true; render();
    try { if (!(await ensurePlaying())) throw new Error('Create your character first.'); await fn(); }
    catch (e) { if (!coop.error) coop.setStatus('', e?.message || String(e)); console.warn('[coop]', e?.message || e); }
    finally { ui.busy = false; render(); }
  };
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-coop]'); if (!b) { if (e.target === box) close(); return; }
    const a = b.dataset.coop; game.audio.play('ui');
    if (a === 'close') return close();
    if (a === 'host') return run(async () => { await coop.host(); ui.invite = null; });
    if (a === 'join') { const v = document.getElementById('coop-code-in')?.value || ui.codeDraft; ui.codeDraft = normCode(v); return run(async () => { await coop.join(v); ui.invite = null; close(); }); }
    if (a === 'leave') { coop.leave(); return render(); }
    if (a === 'end') { coop.end(); return render(); }
    if (a === 'copy' || a === 'invite') {
      const link = inviteLink(coop.code), text = `Join my Mythbound world! Code ${coop.code}`;
      if (a === 'invite' && navigator.share && (game.touch || navigator.userAgentData?.mobile)) { try { await navigator.share({ title: 'Mythbound co-op', text, url: link }); return; } catch (err) { if (err?.name === 'AbortError') return; } }
      const val = a === 'copy' ? coop.code : link;
      try { await navigator.clipboard.writeText(val); UI.toast(a === 'copy' ? `Code ${coop.code} copied` : 'Invite link copied', 'good'); }
      catch { UI.toast(a === 'copy' ? `Your code: ${coop.code}` : `Invite link: ${esc(link)}`, ''); }
      ui.lastCopied = val;
    }
  });
  box.addEventListener('change', (e) => { if (e.target.matches('[data-coop-build]')) coop.setAllowBuild(e.target.checked); });
  box.addEventListener('input', (e) => { if (e.target.id === 'coop-code-in') { const c = e.target.selectionStart, v = e.target.value.toUpperCase(); if (v !== e.target.value) { e.target.value = v; e.target.setSelectionRange(c, c); } ui.codeDraft = v; } });
  box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); if (e.key === 'Enter' && e.target.id === 'coop-code-in') box.querySelector('[data-coop="join"]')?.click(); });
  bar.addEventListener('click', (e) => { const b = e.target.closest('[data-emote]'); if (b) { coop.emote(b.dataset.emote); b.blur(); } });
  document.getElementById('panel').addEventListener('click', (e) => { if (e.target.closest('[data-coop-open]')) { game.closePanel(); open(); } });
  // keep the lobby + party frames fresh (pings, hearts); re-render when sign-in state changes
  setInterval(() => { if (coop.active || !box.classList.contains('hidden')) render(); }, 500);
  const prevChange = game.cloud?.o?.onChange;
  if (game.cloud) game.cloud.o.onChange = (st, s) => { prevChange?.(st, s); if (!box.classList.contains('hidden')) render(); };
  addEventListener('pagehide', () => { if (coop.isHost) coop.end(); else if (coop.role === 'guest') coop.leave(true); });
  if (ui.invite) setTimeout(open, 300);
  return coop;
}
