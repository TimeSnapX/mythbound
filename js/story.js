// Story: quests 1-3 + the pet quest, NPC dialogue, the Vael vision, quest targets/markers. Mixed into Game.prototype.
import { CAMP, FADE_ECHO, HEARTHSTONES, MINE_ENTRANCE, BRIDGE, PETS, SHOPS } from './shared.js';
import * as UI from './ui.js';

export const QUESTS = [
  { id: 'q1', name: 'The Hollow Barrow', flags: ['talked', 'entered', 'grapple', 'lever', 'boss', 'shard', 'done'], steps: [
    'Speak with Elder Maren in the village square.', 'Travel north to the Hollow Barrow and enter it.', 'Explore the Barrow. Find a way across the chasm.',
    'Grapple across the chasm (G / 🪝) and pull the lever.', 'Defeat the Barrow Warden. Strike his glowing back, or hit him while he is stunned after a slam.',
    "Open the Warden's chest to claim the Mythstone.", 'Return the Mythstone shard to Elder Maren.'] },
  { id: 'q2', name: 'The Fading Ridge', req: 'done', lockedText: 'Finish "The Hollow Barrow" first.', flags: ['q2_start', 'q2_camp', 'q2_echo', 'q2_lit', 'q2_done'], steps: [
    'Speak with Elder Maren about the grey fog in the east.', 'Cross the Ember Bridge east and find Scout Corin at Ashfall Camp.',
    'Investigate the Fade: find the Fade-echo inside the grey fog north of camp. Watch your Fade meter!', 'Relight the dormant Ridge Hearthstone inside the fog.', 'Return to Scout Corin at Ashfall Camp.'] },
  { id: 'q3', name: 'Into Cinderdeep', req: 'q2_done', lockedText: 'Finish "The Fading Ridge" first.', flags: ['q3_start', 'q3_enter', 'q3_cart', 'q3_bombs', 'q3_wall', 'q3_bridge', 'q3_boss', 'q3_shard', 'q3_done'], steps: [
    "Hear Corin's plan.", 'Enter Cinderdeep Mine at the foot of the volcano (east of camp).', 'Cart Junction: set the rail switch, then push the minecart into the boulder.',
    'Find the Blastcap Bombs in the Bomb Vault.', 'Bomb the cracked wall (R / 💣) to open the way north.', 'Lava Crossing: bomb the cracked pillar to topple it into a bridge.',
    'Defeat Magmaw: throw a bomb into its open maw, then strike its molten heart.', "Open Magmaw's chest to claim the Cinder Mythshard.", 'Bring the Cinder Mythshard to Elder Maren.'] },
  { id: 'pet', name: 'A Friend for the Road', lockedText: '', flags: ['p_start', 'p_found', 'p_done'], steps: [
    'Talk to Wren the Kennel-keeper in the village.', 'Find the three runaway animals around the village outskirts.', 'Return to Wren and choose your companion.'] },
];
export const NPC_DEFS = [
  { id: 'elder', name: 'Elder Maren', x: 0, z: 1.5, look: { skin: 0, hair: 1, hairColor: 4, tunic: 3 }, ry: 0 },
  { id: 'smith', name: 'Bram the Smith', x: -13, z: 13.5, look: { skin: 3, hair: 3, hairColor: 0, tunic: 5 }, ry: 2.4, shop: 'bram' },
  { id: 'pip', name: 'Pip the Builder', x: 7, z: 30, look: { skin: 1, hair: 2, hairColor: 2, tunic: 4 }, ry: Math.PI },
  { id: 'banker', name: 'Oswin the Banker', x: -8, z: 2, look: { skin: 2, hair: 0, hairColor: 4, tunic: 1 }, ry: 0.8 },
  { id: 'wren', name: 'Wren the Kennel-keeper', x: 7, z: 8, look: { skin: 4, hair: 1, hairColor: 3, tunic: 0 }, ry: -0.6 },
  { id: 'corin', name: 'Scout Corin', x: CAMP.x + 0.5, z: CAMP.z + 5.5, look: { skin: 1, hair: 0, hairColor: 1, tunic: 2 }, ry: Math.PI },
  { id: 'tamsin', name: 'Tamsin the Trader', x: CAMP.x - 4.5, z: CAMP.z - 1.5, look: { skin: 0, hair: 1, hairColor: 2, tunic: 4 }, ry: 1.2, shop: 'tamsin' },
];
export const RUNAWAYS = [{ type: 'dog', x: -30, z: 45, flag: 'p_dog' }, { type: 'cat', x: 35, z: 30, flag: 'p_cat' }, { type: 'bird', x: 10, z: -40, flag: 'p_bird' }];

export const Story = {
  questStage() { const f = QUESTS[0].flags, i = f.findIndex((k) => !this.s.flags[k]); return i === -1 ? 7 : i; }, // v1 compatibility
  qStage(q) { const i = q.flags.findIndex((k) => !this.s.flags[k]); return i === -1 ? q.flags.length : i; },
  qState(q) { if (q.req && !this.s.flags[q.req]) return 'locked'; const st = this.qStage(q); return st >= q.flags.length ? 'done' : 'active'; },
  questList() { return QUESTS.map((q) => ({ ...q, state: this.qState(q), stage: this.qStage(q), steps: q.id === 'pet' ? q.steps.map((t, i) => i === 1 ? `${t} (${RUNAWAYS.filter((r) => this.s.flags[r.flag]).length}/3)` : t) : q.steps })); },
  activeQuest() {
    for (const q of QUESTS.slice(0, 3)) if (this.qState(q) === 'active') return q;
    const p = QUESTS[3]; if (this.s.flags.p_start && this.qState(p) === 'active') return p;
    return null;
  },
  questHud() {
    const q = this.activeQuest();
    if (!q) return { title: '📜 Mythbound', text: this.s.flags.q3_done ? 'Act II complete! Train your skills, build a home, find a pet friend… more of the story is coming.' : 'Explore, gather, forge and build.', tgt: null };
    const st = this.qStage(q); let text = q.steps[st];
    if (q.id === 'pet' && st === 1) text += ` (${RUNAWAYS.filter((r) => this.s.flags[r.flag]).length}/3)`;
    return { title: '📜 ' + q.name, text, tgt: this.questTarget(q, st) };
  },
  npc(id) { return this.npcs.find((n) => n.id === id); },
  questTarget(q, st) {
    const inD = this.inDungeon, D = this.dungeon, Mn = this.mine, f = this.s.flags;
    const onIsle = this.p.x < 150 && !inD, here = (id) => { const n = this.npc(id); return { x: n.x, z: n.z }; };
    const toRidge = (t) => (onIsle ? { x: BRIDGE.x0, z: BRIDGE.z } : t);
    const exitTo = (t) => (inD ? (this.dungeonId === 'mine' ? Mn.exitA : D.exitA) : t);
    if (q.id === 'q1') {
      if (st === 0 || st === 6) return inD ? D.exitA : here('elder');
      if (st === 1) return inD ? null : this.world.entrance;
      if (inD) return st === 2 ? D.chest : st === 3 ? D.lever : st === 4 ? { x: D.chest.x, z: -82 } : st === 5 ? D.bossChest : null;
      return this.world.entrance;
    }
    if (q.id === 'q2') {
      if (st === 0) return exitTo(onIsle ? here('elder') : here('elder'));
      if (st === 1 || st === 4) return exitTo(toRidge(here('corin')));
      if (st === 2) return exitTo(toRidge(FADE_ECHO));
      if (st === 3) { const h = HEARTHSTONES[1]; return exitTo(toRidge(h)); }
    }
    if (q.id === 'q3') {
      if (st === 0) return exitTo(toRidge(here('corin')));
      if (st === 8) return exitTo(here('elder'));
      if (!inD || this.dungeonId !== 'mine') return toRidge(this.ridge.mineEntrance);
      if (st === 2) return f.m_switch ? Mn.cart : Mn.sw;
      if (st === 3) return Mn.bombChest;
      if (st === 4) return { x: Mn.cracked[0].x, z: Mn.cracked[0].z + 1.5 };
      if (st === 5) return Mn.pillar;
      if (st === 6) return { x: Mn.exitG.x, z: -122 };
      if (st === 7) return Mn.bossChest;
    }
    if (q.id === 'pet') {
      if (st === 0 || st === 2) return exitTo(here('wren'));
      const r = RUNAWAYS.find((r) => !f[r.flag]); return r ? exitTo(r) : here('wren');
    }
    return null;
  },
  npcMarker(id) {
    const f = this.s.flags;
    if (id === 'elder') { if (!f.talked || (f.done && !f.q2_start)) return '!'; if ((f.shard && !f.done) || (f.q3_shard && !f.q3_done)) return '?'; }
    if (id === 'corin') { if (f.q2_start && !f.q2_camp) return '!'; if (f.q2_lit && !f.q2_done) return '?'; }
    if (id === 'wren') { if (!f.p_start) return '!'; if (f.p_found && !f.p_done) return '?'; }
    return null;
  },
  // ---------- dialogue runner ----------
  // steps: string | { text, who?, choices?: [..], pick?(i) } ; after() runs when finished
  runDialog(name, steps, after, cls = '', npc = null) {
    let i = 0; this.inDialog = true; this.talkNpc = npc;
    const next = (choice) => {
      const cur = steps[i - 1];
      if (cur && cur.choices) { if (choice === undefined) return; cur.pick?.(choice); }
      if (i >= steps.length) { UI.closeDialog(); this.inDialog = false; this.dialogNext = null; this.talkNpc = null; after?.(); return; }
      const st = steps[i++]; const s = typeof st === 'string' ? { text: st } : st;
      if (s.fn) { s.fn(); return next(); }
      UI.dialog(s.who || name, s.text, next, cls, s.choices || null);
      this.audio.play('ui');
    };
    this.dialogNext = () => { const cur = steps[i - 1]; if (!(cur && cur.choices)) next(); };
    this.dialogChoose = (c) => { const cur = steps[i - 1]; if (cur && cur.choices && c < cur.choices.length) next(c); };
    next();
  },
  talk(npc) {
    const n = this.s.name, f = this.s.flags, T = this.touch;
    let lines, after = null;
    const say = (l, a) => { lines = l; after = a; };
    if (npc.id === 'elder') {
      if (!f.talked) {
        say([`Ah, a new face! Welcome to Mythbound Isle, ${n}.`, 'Long ago our heroes were bound into legend — that is why the isle bears its name.', 'But the old Hollow Barrow to the north has begun to stir. Mosslings and Grubkins creep closer every night.', 'Deep inside, a Warden of stone guards a Mythstone shard — a piece of the old legend. Will you bring it back?',
          T ? 'Follow the path north. Use 🎯 to lock on, 🛡 to block and ⤾ to roll. Hold ⚔ to charge a spin attack!' : 'Follow the path north. Tab or right-click locks on, hold Q to block, Space to roll. Hold attack to charge a spin!'],
        () => { f.talked = true; UI.toast('Quest started: The Hollow Barrow', 'good'); this.audio.play('quest'); this.save(); });
      } else if (f.shard && !f.done) {
        say(['You… you found it! The Mythstone shard hums with old power.', 'Take this Heart Container. You have more than earned it.', `There are more shards out there, ${n}. And I fear something is eating at the edges of our world.`],
          () => { f.done = true; this.s.inv.mythstone = Math.max(0, (this.s.inv.mythstone || 1) - 1); this.s.maxHearts += 1; this.p.hp = this.maxHp; UI.banner('Quest complete!', 'Heart Container: +1 max heart'); this.audio.play('quest'); this.save(); });
      } else if (f.done && !f.q2_start) {
        say(['The shard showed me something, child. A grey fog — the Fade — creeping over Emberfall Ridge, across the Ember Bridge to the east.', 'Where the Fade rolls in, the world forgets itself. Colour first, then sound, then substance.', 'You are Mythbound: the shard in your chest lets you walk in the Fade… for a while. Hearthstones push it back.', 'Find Scout Corin of the Lanternwardens at Ashfall Camp. Follow the road out of the east gate.'],
          () => { f.q2_start = true; UI.toast('Quest started: The Fading Ridge', 'good'); this.audio.play('quest'); this.save(); });
      } else if (f.q3_shard && !f.q3_done) {
        say(['A second shard! Warm as a hearth… the Cinder Mythshard.', '“Vael”, you say? The Archivist of the old Loom… so the stories were true.', 'She cut the Loom of Tales, and the Fade pours through the wound. Every shard we save is a thread woven back.', `Rest, ${n}. Take this Vitality Ember — and know the isle sings your name tonight.`],
          () => { f.q3_done = true; this.s.inv.cinder_shard = Math.max(0, (this.s.inv.cinder_shard || 1) - 1); this.s.maxHearts += 1; this.p.hp = this.maxHp; this.giveGold(200); UI.banner('Act II complete!', 'Vitality Ember: +1 max heart · 200 coins'); this.audio.play('quest'); this.save(); });
      } else if (f.q2_start && !f.q3_done) say(['The Ember Bridge lies beyond the east gate. Keep a Hearthstone close when the fog thickens.']);
      else if (f.done) say(['The isle sleeps easier thanks to you. Why not build yourself a home out in the Wilds? Pip can explain.']);
      else say(['The Hollow Barrow lies to the north. Watch your foes — they flash red just before they strike.']);
    } else if (npc.id === 'smith') {
      return this.runDialog(npc.name, [{ text: 'Hammer and tongs, what can I do for you?', choices: ['Trade', 'Smithing tips', 'Goodbye'], pick: (i) => { this._pick = i; } }],
        () => { if (this._pick === 0) this.openPanel('shop:bram'); else if (this._pick === 1) this.runDialog(npc.name, ['Copper and tin from the eastern hills make bronze. Iron needs Smithing 8; steel needs Smithing 18 — one iron ore and two coal.', 'Coal? Mining 15, and the best seams are out on Emberfall Ridge.', 'Find a Hook Cast and I reckon you could forge grapple anchors on my anvil. Gems, too — an Emerald or Diamond blade, if you\'re a master.']); }, '', npc);
    } else if (npc.id === 'pip') {
      say([T ? 'Tap 🧱 out in the Wilds to build. Aim with the camera — the ghost shows where it goes. ↻ rotates.' : 'Press B out in the Wilds to build! Aim with the camera, the ghost shows where it lands. R rotates, wheel or 1-0 picks a piece.',
        'Walls, doors that open, windows, roofs, stairs, fences, torches, chests, a workbench… Planks come from my workbench here — logs in, planks out.',
        'Want a home? Press P (or 🏠) in build mode to claim a plot — 100 coins. Only on your own plot can you raise a Hearthstone: you\'ll respawn there.']);
    } else if (npc.id === 'banker') {
      return this.runDialog(npc.name, ['Welcome to the Lanternhold Bank, Oakhollow branch. Your valuables are safe with us.'], () => this.openPanel('bank'), '', npc);
    } else if (npc.id === 'wren') {
      if (!f.p_start) say(['Oh! Oh dear. Have you seen them? My three little rascals got out — a pup, a kitten and a bluebird.', 'They\'re hiding somewhere around the village outskirts. Bring them back and one of them can go with you. They\'ve taken a shine to adventurers.'],
        () => { f.p_start = true; UI.toast('Quest started: A Friend for the Road', 'good'); this.audio.play('quest'); this.save(); });
      else if (f.p_found && !f.p_done) {
        const types = ['dog', 'cat', 'bird'];
        return this.runDialog(npc.name, ['You found all three! They\'re already following you about, look.', { text: 'Which one will you take with you?', choices: types.map((t) => `${PETS[t].icon} ${PETS[t].name} — ${PETS[t].perk}`), pick: (i) => { this._petPick = types[i]; } }],
          () => this.namePet(this._petPick || 'dog'), '', npc);
      } else if (f.p_done) say([`How is ${this.s.pet?.name || 'your friend'}? Remember to feed them scraps… they forage plenty on their own.`]);
      else say(['The pup loves the woods to the south-west, the kitten the warm stones east of here, and the bird the trees north along the barrow road.']);
    } else if (npc.id === 'corin') {
      if (f.q2_start && !f.q2_camp) say([`A Mythbound! Maren said you\'d come. I\'m Corin, Lanternwarden scout.`, 'Look north — that grey wall. That\'s the Fade, eating the ridge. The old Ridge Hearthstone in there went cold a week ago.', 'Something in the fog… a Fade-echo. A memory that\'s been forgotten. Touch it — your shard might let you see what it saw.', 'Mind the meter. Too long in the Fade and it starts taking you apart. Step back near a lit Hearthstone to recover.'],
        () => { f.q2_camp = true; this.save(); });
      else if (f.q2_camp && !f.q2_lit) say(['The echo, then the Hearthstone. Your shard can wake it — just touch it.']);
      else if (f.q2_lit && !f.q2_done) say(['The fog… it\'s pulling back! You did it.', '“Vael”? That name is old. Older than the Lanternwardens. If she\'s real, she\'s feeding the Fade from somewhere.', 'The miners of Cinderdeep vanished the day the fog came. The mine\'s at the foot of the volcano — and that\'s where the fog flows from.', 'Take these coins. And talk to Tamsin; she\'ll have bombs once you find a bomb bag down there.'],
        () => { f.q2_done = true; f.q3_start = true; this.giveGold(100); UI.banner('Quest complete: The Fading Ridge', '+100 coins · New quest: Into Cinderdeep'); this.audio.play('quest'); this.save(); });
      else if (f.q3_start && !f.q3_shard) say(['Cinderdeep is east, at the volcano\'s foot. Watch the imps — block their fireballs with your shield.']);
      else say(['The ridge is warmer every day. Thank you, Mythbound.']);
    } else if (npc.id === 'tamsin') {
      return this.runDialog(npc.name, [{ text: f.q3_bombs ? 'Bombs, eel, coal — the ridge provides! What\'ll it be?' : 'Supplies for the brave and the foolish. What\'ll it be?', choices: ['Trade', 'Goodbye'], pick: (i) => { this._pick = i; } }], () => { if (this._pick === 0) this.openPanel('shop:tamsin'); }, '', npc);
    }
    this.runDialog(npc.name, lines, after, '', npc);
  },
  namePet(type) {
    const def = PETS[type];
    UI.panel(`<h2>${def.icon} Name your ${def.name}</h2><p class="sub">${def.perk}</p><input id="pet-name" maxlength="14" value="${type === 'dog' ? 'Biscuit' : type === 'cat' ? 'Ember' : 'Pip-squeak'}" autocomplete="off"><button class="recipe primary" data-petname="${type}">Adopt</button>`);
    this.panelKind = 'petname';
    setTimeout(() => document.getElementById('pet-name')?.focus(), 50);
  },
  adoptPet(type, name) {
    this.s.pet = { type, name: (name || PETS[type].name).slice(0, 14) }; this.s.flags.p_done = true;
    this.spawnPet(); this.closePanel(); this.audio.play('pet');
    UI.banner(`${PETS[type].icon} ${this.s.pet.name} joins you!`, PETS[type].perk); this.save();
  },
  findRunaway(r) {
    this.s.flags[r.flag] = true; this.audio.play('pet');
    this.particles.burst(r.x, this.terrainH(r.x, r.z) + 0.8, r.z, 0xffe9a8, 14, 3, 0.6);
    const n = RUNAWAYS.filter((q) => this.s.flags[q.flag]).length;
    UI.toast(`You calmed the runaway ${PETS[r.type].name.toLowerCase()} (${n}/3). It trots back to Wren.`, 'good');
    if (n === 3) { this.s.flags.p_found = true; UI.toast('All three found — return to Wren!', 'good'); }
    this.save();
  },
  // ---------- Vael vision (quest 2) ----------
  vision() {
    this.s.flags.q2_echo = true; this.visionOn = true; document.body.classList.add('vision'); this.audio.setTrack('vael');
    const V = 'Vael, the Unwriter';
    this.runDialog(V, [
      { who: '???', text: 'The echo flares white. The ridge, the fog, your own hands — all of it turns to blank paper.' },
      { who: V, text: '…another one who remembers. How tiresome.' },
      { who: V, text: 'I am Vael. I was the last Archivist of the Loom of Tales. I read every story your gods ever wrote.' },
      { who: V, text: 'Every one of them holds a famine, a war, a grave. Caer Ilith burned because a story said it must.' },
      { who: V, text: 'So I cut the thread. The Fade is not a curse, little Mythbound. It is a kindness. A page with nothing on it cannot hurt anyone.' },
      { who: V, text: 'Go home. Forget. It is so much easier than you think.' },
      { who: this.s.name, text: 'The paper tears. You are kneeling in the ash beside a cold Hearthstone — and the shard in your chest is burning.' },
    ], () => { this.visionOn = false; document.body.classList.remove('vision'); this.audio.setTrack(null); UI.toast('Relight the Ridge Hearthstone!', 'good'); this.save(); }, 'vael');
  },
};
