// GEAR: weapon / item table + MGS1-style pixel UI art (equipment slots, red pixel icons, 5x7 bitmap font).
// Everything is drawn into small canvases at 1:1 "PS1 pixels" and shown scaled with image-rendering: pixelated
// (DOM inventory grid + HUD boxes) or as NearestFilter CanvasTextures (map pickups). No external assets.

// Grid order mirrors the reference screen (3 rows x 4): null = empty slot.
// kind: wpn = goes in the weapon slot (G draws / holsters it, FIRE / ACT shoots, throws or plants it)
//       item = goes in the item slot (Q / tap the item box uses it; tog = on/off gear)
// No `start` counts: a mission begins with empty hands. Every weapon and item is a map locker / crate
// or a one-time drop off a guard (main.js PICKUPS + LOOT).
export const ITEMS = {
  supp:   { name: 'SUPP.',  kind: 'item', tog: true, desc: 'Suppressor for the P-9. ON = shots are near-silent (guards 3 m away hear it, not 12 m).' },
  box:    { name: 'C.BOX',  kind: 'item', tog: true, desc: 'Cardboard box. Hide inside: stand still and guards walk right past. Moving boxes look suspicious.' },
  stun:   { name: 'STUN.G', kind: 'wpn', max: 6, desc: 'Stun grenade. FIRE throws it ~7 m; the flash knocks out guards within 5 m for 7 s (no alert).' },
  fr5:    { name: 'FR-5',   kind: 'wpn', max: 90, desc: 'Bullpup assault rifle. 3-round bursts, heavy climb, LOUD. Drops guards at range.' },
  scope:  { name: 'SCOPE',  kind: 'item', tog: true, desc: 'Binoculars. ON = pull the view way out (top-down) or zoom in (first person).' },
  p9:     { name: 'P-9',    kind: 'wpn', max: 36, desc: 'Sidearm with laser sight. One hit drops a guard. Fit the SUPP. to make it quiet.' },
  mkt:    { name: 'MK-T',   kind: 'wpn', max: 12, desc: 'Tranquilizer pistol (built-in suppressor). A dart puts a guard to sleep for 30 s, nobody dies.' },
  ration: { name: 'RATION', kind: 'item', max: 4, desc: 'Field ration. Restores 40 LIFE.' },
  stim:   { name: 'STIM',   kind: 'item', max: 3, desc: 'Steadies your hands for 30 s: far less recoil bloom and no laser wobble.' },
  c4:     { name: 'C4',     kind: 'wpn', max: 4, desc: 'Plastic explosive. FIRE plants a charge at your feet; DET (T) blows every charge you planted.' },
};
export const GRID = ['supp', 'box', 'stun', 'fr5', 'scope', null, 'p9', 'mkt', 'ration', 'stim', 'c4', null];
export const GUN_IDS = ['p9', 'fr5', 'mkt']; // weapons that shoot (laser, arms up); stun / c4 are thrown / planted

// ---------------------------------------------------------------- 5x7 bitmap font (drawn bold: 6 px wide, 7 px advance)
const F = {
  A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110', C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11110 10001 10001 10001 10001 10001 11110', E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01111 10000 10000 10011 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001', I: '01110 00100 00100 00100 00100 00100 01110',
  J: '00111 00010 00010 00010 00010 10010 01100', K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 10001 11001 10101 10011 10001 10001', O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000', Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100', U: '10001 10001 10001 10001 10001 10001 01110',
  V: '10001 10001 10001 10001 10001 01010 00100', W: '10001 10001 10001 10101 10101 10101 01010', X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
  0: '01110 10001 10011 10101 11001 10001 01110', 1: '00100 01100 00100 00100 00100 00100 01110', 2: '01110 10001 00001 00010 00100 01000 11111',
  3: '11111 00010 00100 00010 00001 10001 01110', 4: '00010 00110 01010 10010 11111 00010 00010', 5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110', 7: '11111 00001 00010 00100 01000 01000 01000', 8: '01110 10001 10001 01110 10001 10001 01110',
  9: '01110 10001 10001 01111 00001 00010 01100',
  '.': '00000 00000 00000 00000 00000 01100 01100', '/': '00001 00001 00010 00100 01000 10000 10000', '-': '00000 00000 00000 11111 00000 00000 00000',
  ':': '00000 01100 01100 00000 01100 01100 00000', '+': '00000 00100 00100 11111 00100 00100 00000', '!': '00100 00100 00100 00100 00100 00000 00100',
  '?': '01110 10001 00001 00010 00100 00000 00100',  '=': '00000 00000 11111 00000 11111 00000 00000', ',': '00000 00000 00000 00000 01100 00100 01000',
  '(': '00010 00100 01000 01000 01000 00100 00010', ')': '01000 00100 00010 00010 00010 00100 01000', "'": '00100 00100 01000 00000 00000 00000 00000',
  '%': '11001 11010 00010 00100 01000 01011 10011', ' ': '00000 00000 00000 00000 00000 00000 00000',
};
const GLYPH = {};
for (const [k, v] of Object.entries(F)) GLYPH[k] = v.split(' ').map((r) => [...r].map((c) => c === '1'));
export const textW = (s) => String(s).length * 7 - 1;
// pixel text at (x, y) = top-left. sc = integer pixel scale. Bold = each lit pixel also lights its right neighbour.
export function pixText(ctx, s, X, Y, col = '#fff', sc = 1, shadow = null) {
  s = String(s).toUpperCase();
  const draw = (ox, oy, c) => {
    ctx.fillStyle = c; let cx = X + ox;
    for (const ch of s) { const g = GLYPH[ch] || GLYPH['?'];
      for (let r = 0; r < 7; r++) for (let q = 0; q < 5; q++) if (g[r][q]) ctx.fillRect(cx + q * sc, Y + oy + r * sc, sc * 2, sc);
      cx += 7 * sc; }
  };
  if (shadow) draw(sc, sc, shadow);
  draw(0, 0, col);
}

// ---------------------------------------------------------------- pixel icons (52 x 30 box, red outline + black fill)
const RED = '#c41a1a', HOT = '#ff5a48', INK = '#100304', STEEL = '#5c5f6a';
function P(ctx, ox, oy) {
  const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(ox + x, oy + y, w, h); };
  return {
    R,
    S: (x, y, w, h, fill = INK, line = RED) => { R(x, y, w, h, line); if (w > 2 && h > 2) R(x + 1, y + 1, w - 2, h - 2, fill); }, // outlined block
    C: (cx, cy, r, c) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) R(cx + x, cy + y, 1, 1, c); },
  };
}
const ICONS = {
  p9(p) { const { S, R } = p;
    S(8, 7, 34, 8); R(10, 9, 30, 1, '#3a0a0a'); R(40, 8, 2, 2, HOT); R(11, 8, 2, 2, HOT); // slide + sights
    S(11, 14, 10, 7); S(9, 20, 9, 8); S(20, 14, 9, 6, INK); R(23, 15, 3, 3, '#000'); // grip + trigger guard
    for (let i = 0; i < 4; i++) R(25 + i * 4, 11, 2, 2, RED); // slide serrations / laser module
    S(30, 15, 9, 4, '#3a0a0a'); R(36, 16, 2, 2, '#ff2020'); },
  fr5(p) { const { S, R } = p;
    S(1, 11, 11, 10); S(10, 9, 24, 10); S(14, 4, 20, 4, INK); R(16, 5, 2, 3, RED); R(30, 5, 2, 3, RED); // stock, receiver, carry handle
    S(33, 11, 10, 6); S(42, 12, 9, 3); R(49, 11, 2, 5, HOT); // handguard, barrel, muzzle
    S(20, 18, 6, 10); S(28, 18, 5, 8); S(26, 18, 3, 4, INK); // magazine, grip, trigger
    R(12, 12, 20, 1, '#3a0a0a'); R(3, 14, 6, 1, HOT); },
  mkt(p) { const { S, R } = p;
    S(4, 8, 26, 8); S(29, 9, 20, 6, '#1a1a22', STEEL); for (let i = 0; i < 4; i++) R(33 + i * 4, 9, 1, 6, '#8a8f9c'); // slide + long can
    S(7, 15, 9, 7); S(5, 21, 9, 7); S(16, 15, 8, 6, INK); R(19, 16, 3, 3, '#000');
    R(28, 22, 14, 2, '#7fd6ff'); R(42, 21, 3, 4, '#7fd6ff'); R(26, 21, 3, 4, '#d8f0ff'); }, // dart
  stun(p) { const { S, R, C } = p;
    C(25, 18, 10, RED); C(25, 18, 9, INK); R(16, 16, 19, 4, '#d8b028'); R(16, 17, 19, 2, '#8a6a10'); // round body + yellow band
    S(21, 3, 9, 6); S(30, 4, 4, 12, INK); C(16, 6, 3, RED); C(16, 6, 2, '#a9b1b6'); R(18, 6, 3, 1, RED); // cap, spoon, pin ring
    R(22, 12, 2, 2, HOT); },
  c4(p) { const { S, R } = p;
    S(6, 11, 38, 16, '#2a0606'); R(8, 18, 34, 1, RED); R(8, 22, 34, 1, '#5a0c0c'); // brick + wrap lines
    S(19, 4, 12, 8); R(23, 6, 4, 3, '#ff2020'); R(24, 1, 2, 3, HOT); R(21, 0, 1, 2, HOT); R(28, 0, 1, 2, HOT); // detonator + blinking light
    R(10, 13, 2, 9, '#d8b028'); R(39, 13, 2, 9, '#d8b028'); },
  ration(p) { const { R, C } = p;
    C(26, 15, 13, '#1a5a1a'); C(26, 15, 12, '#3fcf3f'); C(26, 15, 10, '#1f8a1f'); // green tin like the reference
    R(17, 12, 18, 1, '#9cff9c'); R(17, 15, 18, 1, '#9cff9c'); R(17, 18, 18, 1, '#9cff9c'); R(22, 4, 8, 2, '#9cff9c'); },
  box(p) { const { S, R } = p;
    S(8, 9, 36, 19, '#3a1414'); S(8, 4, 18, 6, INK); S(26, 4, 18, 6, INK); // box + open flaps
    R(9, 15, 34, 3, '#7a1c1c'); R(18, 21, 16, 2, RED); R(20, 20, 2, 4, HOT); R(30, 20, 2, 4, HOT); },
  scope(p) { const { S, R, C } = p;
    C(15, 18, 10, RED); C(15, 18, 8, INK); C(37, 18, 10, RED); C(37, 18, 8, INK); // two barrels end-on
    C(15, 18, 4, '#3a0a0a'); C(37, 18, 4, '#3a0a0a'); R(13, 15, 2, 2, HOT); R(35, 15, 2, 2, HOT);
    S(21, 9, 10, 8); R(24, 5, 4, 5, RED); },
  supp(p) { const { S, R } = p;
    S(4, 10, 40, 11, '#1a1a22', STEEL); S(44, 12, 5, 7, INK, RED); // can + threaded end
    for (let i = 0; i < 6; i++) R(9 + i * 6, 11, 1, 9, '#8a8f9c'); R(6, 12, 36, 1, '#c8ccd8'); },
  stim(p) { const { R, C } = p;
    C(14, 15, 7, RED); C(38, 15, 7, '#e8e8e8'); R(14, 8, 12, 15, RED); R(26, 8, 12, 15, '#e8e8e8'); // capsule, red / white
    R(14, 9, 24, 1, '#ffb0a8'); R(26, 8, 1, 15, '#8a8a8a'); },
};
export function drawIcon(ctx, id, ox, oy) { const f = ICONS[id]; if (f) f(P(ctx, ox, oy)); }

// ---------------------------------------------------------------- equipment slot (104 x 52 px), the reference look:
// black plate, white frame, light grey-blue icon panel on the right, qty "n/max" over black on the left, name bottom-right.
export const SLOT_W = 104, SLOT_H = 52;
export function drawSlot(ctx, id, o = {}) {
  const W = SLOT_W, H = SLOT_H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const it = id && ITEMS[id];
  const frame = o.sel ? (o.blink ? '#ffe24a' : '#fff6b0') : it && o.owned ? '#e8ecef' : '#3a4248';
  ctx.fillStyle = frame; ctx.fillRect(0, 0, W, 2); ctx.fillRect(0, H - 2, W, 2); ctx.fillRect(0, 0, 2, H); ctx.fillRect(W - 2, 0, 2, H);
  if (!it || !o.owned) { if (it && o.hint) pixText(ctx, '- - -', 34, 22, '#3a4248'); return; }
  ctx.fillStyle = o.dim ? '#6a7176' : '#a9b1b6'; ctx.fillRect(44, 4, W - 48, 34); // icon panel
  ctx.fillStyle = '#c9d0d4'; ctx.fillRect(44, 4, W - 48, 1);
  drawIcon(ctx, id, 47, 6);
  if (o.qty != null) { const s = String(o.qty), w = textW(s); ctx.fillStyle = '#000'; ctx.fillRect(3, 24, w + 4, 10); pixText(ctx, s, 5, 25, o.empty ? '#ff6a5a' : '#fff'); }
  const name = it.name, nw = textW(name);
  ctx.fillStyle = '#000'; ctx.fillRect(W - nw - 8, 38, nw + 6, 12);
  pixText(ctx, name, W - nw - 5, 41, '#fff');
  if (o.tag) { const tw = textW(o.tag); ctx.fillStyle = o.tagCol || '#c41a1a'; ctx.fillRect(3, 4, tw + 4, 10); pixText(ctx, o.tag, 5, 5, '#fff'); }
}
// standalone canvas for a pickup sprite: icon on its grey panel with a white frame (reads from the top-down cam)
export function iconCanvas(id) {
  const c = document.createElement('canvas'); c.width = 60; c.height = 38; const x = c.getContext('2d');
  x.fillStyle = '#e8ecef'; x.fillRect(0, 0, 60, 38); x.fillStyle = '#a9b1b6'; x.fillRect(2, 2, 56, 34);
  drawIcon(x, id, 4, 4); return c;
}
