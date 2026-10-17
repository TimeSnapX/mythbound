// Mythbound client config.
// Set DEFAULT_SERVER to your deployed server (e.g. 'wss://mythbound.fly.dev') to make GitHub Pages players join it
// automatically. Leave it empty for solo/offline by default. URL overrides: ?server=wss://host  ·  ?server=off (force solo)
export const DEFAULT_SERVER = '';

// ---- progression (v2) ----
// Exponential XP curve: xpForLevel(L) = round(XP_AT_MAX * (2^((L-1)/XP_DOUBLING) - 1) / (2^((MAX_LEVEL-1)/XP_DOUBLING) - 1))
// => level 2 ≈ 820 XP, level 50 = exactly 1,000,000 XP. Every 7 levels the XP needed roughly doubles.
export const MAX_LEVEL = 50;
export const XP_AT_MAX = 1000000;
export const XP_DOUBLING = 7;
export const INVENTORY_SLOTS = 30;   // stackables share a slot; gear takes one slot each; coins take none
export const BANK_SLOTS = 200;
