// "Sneaker" player character (Night Ops / Ash Fox / olive kits) - procedural PS1-era (MGS1-inspired, original) rig.
// Joint hierarchy of tapered faceted lofts (6-10 sided rings: thighs / calves / biceps / forearms / torso with a chest
// swell), deformed segmented boxes (head with jaw taper + brow/nose ridge, toe-sloped boots on thick lugged soles,
// mitt hands with a knuckle break) and a few small cylinders. Static parts are MERGED per bone + material at build
// time, so a player is ~3k tris in ~35 draw calls (old: ~1k tris in ~85 draws) - still cheap on phones.
// Textures are CanvasTextures (suit 128, torso 256 wrap, face / hair / boots 128, kit 64) drawn at load, then crushed to
// 15-bit colour with a 4x4 ordered dither and sampled with NearestFilter = crunchy PlayStation look, just sharper.
// Lofts wrap u around the limb with the FRONT (+x) at u = 0.5 and v = 1 at the top, so texture seams sit at the back.
// Local axes: forward = +x (matches the game's rotation.y = -angle convention), up = +y, character's right = +z.
// Two kits share the rig: 'player' (olive sneaker, open face) and 'enemy' (slate guard, helmet + balaclava + goggles +
// respirator -> NO face visible). Poses: stand / walk / run / crouch / PRONE (belly-down, commando crawl) / dead.
// Combat overlays (layered on top of the base pose): armed (s.armed: pistol out of the holster, carried low-ready in the
// right hand; false = holstered on the thigh), aim (handgun up in a soft two-hand hold: elbows stay bent and flare
// out away from the ribs, shoulders sit low, recoil on s.shot change),
// takedown (attacker: choke hold from behind + knife jabs, s.takedown = 0..1 progress) and held (victim: head back,
// clawing at the arm, knees buckle, s.held = 0..1 progress -> then dead).
import * as THREE from 'three';

// ---------------------------------------------------------------- tiny seeded RNG so textures are identical every load
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const hex = (r, g, b) => `rgb(${clamp(r | 0, 0, 255)},${clamp(g | 0, 0, 255)},${clamp(b | 0, 0, 255)})`;
const shade = ([r, g, b], f) => hex(r * f, g * f, b * f);
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// PS1 crush: 5 bits / channel with a 4x4 ordered dither (the console's 15-bit framebuffer look)
function psx(x, S) {
  const img = x.getImageData(0, 0, S, S), p = img.data;
  for (let k = 0, i = 0; k < p.length; k += 4, i++) {
    const d = (BAYER[((i / S | 0) & 3) * 4 + (i % S & 3)] / 16 - 0.5) * 8;
    for (let c = 0; c < 3; c++) p[k + c] = clamp(Math.round((p[k + c] + d) / 8) * 8, 0, 255);
  }
  x.putImageData(img, 0, 0);
}
function canvasTex(size, draw, crush = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'); x.imageSmoothingEnabled = false; draw(x, size); if (crush) psx(x, size);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; // loft u runs a hair past 1 (flat-front ring offset)
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// faceted triangle pattern (mimics the low-poly shading of the concept art) + per-pixel grain
function facets(x, S, base, seed, cells = 4, spread = 0.22, grain = 0.08) {
  const r = rng(seed), n = cells, step = S / n, pts = [];
  for (let j = 0; j <= n; j++) { pts[j] = []; for (let i = 0; i <= n; i++) {
    const edge = i === 0 || j === 0 || i === n || j === n;
    pts[j][i] = [i * step + (edge ? 0 : (r() - 0.5) * step * 0.8), j * step + (edge ? 0 : (r() - 0.5) * step * 0.8)];
  } }
  const tri = (a, b, c) => { x.fillStyle = shade(base, 1 - spread / 2 + r() * spread); x.beginPath(); x.moveTo(...a); x.lineTo(...b); x.lineTo(...c); x.closePath(); x.fill(); };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = pts[j][i], b = pts[j][i + 1], c = pts[j + 1][i + 1], d = pts[j + 1][i];
    if (r() < 0.5) { tri(a, b, c); tri(a, c, d); } else { tri(a, b, d); tri(b, c, d); }
  }
  const img = x.getImageData(0, 0, S, S), p = img.data;
  for (let k = 0; k < p.length; k += 4) { const f = 1 + (r() - 0.5) * grain * 2; p[k] *= f; p[k + 1] *= f; p[k + 2] *= f; }
  x.putImageData(img, 0, 0);
}
// fabric: diagonal twill every `step` px + sparse slub flecks
function weave(x, S, step = 3, dark = 0.88, seed = 1, fleck = 0.012) {
  const r = rng(seed), img = x.getImageData(0, 0, S, S), p = img.data;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const k = (j * S + i) * 4; let f = (i + j) % step === 0 ? dark : 1;
    if (r() < fleck) f *= r() < 0.5 ? 0.8 : 1.18;
    p[k] *= f; p[k + 1] *= f; p[k + 2] *= f;
  }
  x.putImageData(img, 0, 0);
}
const px = (x, c, X, Y, w = 1, h = 1) => { x.fillStyle = c; x.fillRect(X | 0, Y | 0, w, h); };
// 1px pixel line (DDA), optional dash pattern [on, off]
function pline(x, c, x0, y0, x1, y1, dash = null, w = 1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0 || 1; x.fillStyle = c;
  for (let i = 0; i <= n; i++) { if (dash && i % (dash[0] + dash[1]) >= dash[0]) continue; x.fillRect(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), w, w); }
}
// sewn seam: dark groove, lit lip beside it, stitch dashes on both sides
function seamV(x, X, y0, y1, base, light = 1.3) {
  pline(x, shade(base, 0.45), X, y0, X, y1); pline(x, shade(base, light), X + 1, y0, X + 1, y1);
  pline(x, shade(base, 0.7), X - 2, y0, X - 2, y1, [2, 2]); pline(x, shade(base, 0.7), X + 3, y0 + 2, X + 3, y1, [2, 2]);
}
function seamH(x, Y, x0, x1, base, light = 1.3) {
  pline(x, shade(base, 0.45), x0, Y, x1, Y); pline(x, shade(base, light), x0, Y + 1, x1, Y + 1);
  pline(x, shade(base, 0.7), x0, Y + 3, x1, Y + 3, [2, 2]);
}

// colours sampled from the reference sheets
const OLIVE = [104, 114, 74], OLIVE_DK = [80, 90, 58], BLACK = [34, 35, 36], SKIN = [206, 162, 120], HAIR = [42, 34, 28], BOOT = [44, 45, 46];

// enemy (guard) palette: slate fatigues, black kit, gunmetal helmet, black balaclava
const SLATE = [96, 104, 116], SLATE_DK = [64, 70, 82], MASK = [30, 30, 33], HELM = [86, 94, 88];

// PLAYER SUIT KITS (same rig, swappable at runtime via setKit):
//  'night' = NIGHT OPS (P1 default): charcoal / near-black sneak suit, olive webbing + pouches, olive neck gaiter, dark spiky hair.
//  'ash'   = ASH FOX  (P2 default): slate blue-grey suit, black webbing with vivid blue stripes, ash-blonde swept undercut.
//  'player' = legacy olive sneaker (character.html / old look).
const KITS = {
  player: { suit: OLIVE, suitDk: OLIVE_DK, camo: 6, web: BLACK, webStripe: null, pouch: BLACK, pad: [52, 53, 55], hair: HAIR, trim: [60, 62, 64], hairStyle: 'spiky', gaiter: null,
    seam: [62, 70, 44], piping: null, stubble: 0.25 },
  night: { suit: [46, 48, 52], suitDk: [30, 31, 35], camo: 5, web: [74, 84, 50], webStripe: null, pouch: [66, 76, 46], pad: [38, 39, 42], hair: [30, 25, 21],
    trim: [86, 98, 58], hairStyle: 'spiky', gaiter: [70, 80, 50], seam: [22, 23, 26], piping: null, stubble: 0.3 },
  ash: { suit: [88, 104, 128], suitDk: [66, 78, 98], camo: 4, web: [28, 30, 34], webStripe: [40, 120, 255], pouch: [30, 32, 36], pad: [40, 44, 52], hair: [236, 200, 128],
    trim: [40, 120, 255], hairStyle: 'swept', gaiter: null, seam: [50, 60, 78], piping: [40, 120, 255], stubble: 0 },
};
const TEX = {};
function textures(kit = 'player') {
  if (TEX[kit]) return TEX[kit];
  if (kit === 'enemy') return (TEX.enemy = enemyTextures());
  const K = KITS[kit] || KITS.player, SU = K.suit, SD = K.suitDk, WB = K.web, HR = K.hair, seed = kit === 'player' ? 0 : kit === 'night' ? 400 : 800;
  const swept = K.hairStyle === 'swept', SEAM = K.seam || SD;
  const camo = (x, S, n, sz) => { const r = rng(5 + seed); for (let i = 0; i < n; i++) { x.fillStyle = shade(SD, 0.9 + r() * 0.2); x.beginPath();
    const cx = r() * S, cy = r() * S; x.moveTo(cx, cy); for (let k = 0; k < 4; k++) x.lineTo(cx + (r() - 0.5) * sz, cy + (r() - 0.5) * sz); x.fill(); } };
  TEX[kit] = {
    // LIMBS (wrap): u 0.5 = front. Side seams, a back seam, two horizontal panel seams (knee / elbow break), twill.
    suit: canvasTex(128, (x, S) => {
      facets(x, S, SU, 11 + seed, 8, 0.2, 0.05); camo(x, S, K.camo * 2, 30); weave(x, S, 3, 0.9, 3 + seed);
      seamV(x, 30, 0, S, SEAM); seamV(x, 96, 0, S, SEAM); seamV(x, 2, 0, S, SEAM, 1.15);
      seamH(x, 40, 0, S, SEAM); seamH(x, 86, 0, S, SEAM);
      for (let y = 46; y < 84; y += 6) pline(x, shade(SU, 0.78), 44, y, 84, y); // quilted ribs over the front of knee / elbow
      if (K.piping) { pline(x, shade(K.piping, 0.9), 97, 0, 97, S); pline(x, shade(K.piping, 0.9), 31, 0, 31, S); }
    }),
    // TORSO (wrap, 256): zipper down the front, V yoke seams, ribbed abdomen, side panels, spine seam at the back
    suitFront: canvasTex(256, (x, S) => {
      facets(x, S, SU, 23 + seed, 10, 0.2, 0.05); camo(x, S, K.camo * 3, 50); weave(x, S, 3, 0.9, 7 + seed);
      // shoulder yoke (darker) across the top
      x.fillStyle = shade(SD, 0.95); x.beginPath(); x.moveTo(0, 0); x.lineTo(S, 0); x.lineTo(S, 40); x.lineTo(170, 52); x.lineTo(128, 96); x.lineTo(86, 52); x.lineTo(0, 40); x.fill();
      pline(x, shade(SEAM, 0.6), 0, 40, 86, 52); pline(x, shade(SEAM, 0.6), 86, 52, 128, 96); pline(x, shade(SEAM, 0.6), 128, 96, 170, 52); pline(x, shade(SEAM, 0.6), 170, 52, S, 40);
      pline(x, shade(SU, 1.3), 0, 41, 86, 53); pline(x, shade(SU, 1.3), 86, 53, 127, 97); pline(x, shade(SU, 1.3), 129, 97, 170, 53); pline(x, shade(SU, 1.3), 170, 53, S, 41);
      if (K.piping) { pline(x, shade(K.piping, 1), 0, 43, 86, 55); pline(x, shade(K.piping, 1), 86, 55, 126, 99); pline(x, shade(K.piping, 1), 130, 99, 170, 55); pline(x, shade(K.piping, 1), 170, 55, S, 43); }
      // ribbed abdomen panel
      for (let y = 150; y < 236; y += 7) { pline(x, shade(SD, 0.7), 84, y, 172, y); pline(x, shade(SU, 1.15), 84, y + 1, 172, y + 1); }
      seamV(x, 82, 140, S, SEAM); seamV(x, 172, 140, S, SEAM); seamH(x, 140, 84, 172, SEAM);
      // side panels + spine
      seamV(x, 60, 40, S, SEAM); seamV(x, 196, 40, S, SEAM); seamV(x, 2, 40, S, SEAM, 1.15);
      // chest pockets (flap + stitching) either side of the zip
      for (const cx of [92, 140]) { px(x, shade(SD, 0.8), cx, 104, 24, 26); px(x, shade(SU, 1.2), cx, 104, 24, 1); px(x, shade(SD, 0.5), cx, 112, 24, 2);
        pline(x, shade(SU, 1.35), cx + 1, 106, cx + 22, 106, [2, 1]); }
      // zipper: dark tape, alternating teeth, pull tab near the collar
      px(x, shade(SD, 0.5), 124, 0, 9, S); for (let y = 0; y < S; y += 2) { px(x, '#8c8f92', 126 + ((y >> 1) & 1) * 2, y, 3, 1); px(x, '#303234', 126 + (((y >> 1) + 1) & 1) * 2, y, 3, 1); }
      px(x, '#a8acb0', 125, 10, 7, 14); px(x, '#46484a', 127, 13, 3, 8);
    }),
    gear: canvasTex(64, (x, S) => { // small hardware: always black (gun frame, knife handle, antenna, cuffs)
      facets(x, S, BLACK, 31, 4, 0.25, 0.06); weave(x, S, 2, 0.85, 31, 0);
      px(x, shade(BLACK, 1.7), 0, 2, S, 1); px(x, shade(BLACK, 1.7), 0, S - 3, S, 1);
      for (let i = 1; i < S; i += 4) { px(x, shade(BLACK, 0.6), i, 5, 2, 1); px(x, shade(BLACK, 0.6), i, S - 6, 2, 1); }
    }),
    web: canvasTex(64, (x, S) => { // harness / belt / leg straps: kit webbing with ribbed weave, stitched edges (+ optional accent stripe)
      facets(x, S, WB, 33 + seed, 4, 0.22, 0.06);
      for (let i = 0; i < S; i += 2) pline(x, shade(WB, 0.78), i, 0, i, S); // nylon ribs
      px(x, shade(WB, 1.6), 0, 2, S, 1); px(x, shade(WB, 1.6), 0, S - 3, S, 1); px(x, shade(WB, 1.6), 2, 0, 1, S); px(x, shade(WB, 1.6), S - 3, 0, 1, S);
      pline(x, shade(WB, 0.5), 5, 5, S - 6, 5, [3, 2]); pline(x, shade(WB, 0.5), 5, S - 6, S - 6, S - 6, [3, 2]);
      pline(x, shade(WB, 0.5), 5, 5, 5, S - 6, [3, 2]); pline(x, shade(WB, 0.5), S - 6, 5, S - 6, S - 6, [3, 2]);
      if (K.webStripe) { px(x, shade(K.webStripe, 1), 14, 14, S - 28, S - 28); px(x, shade(K.webStripe, 1.3), 14, 14, S - 28, 3); px(x, shade(K.webStripe, 0.6), 14, S - 17, S - 28, 3); }
    }),
    pouch: canvasTex(64, (x, S) => { // pouch / radio face: flap with bound edge, press-stud, gusset shadow, stitching
      const PB = K.pouch; facets(x, S, PB, 41 + seed, 4, 0.26, 0.06); weave(x, S, 3, 0.86, 41 + seed, 0);
      px(x, shade(PB, 1.15), 0, 0, S, 24); px(x, shade(PB, 0.45), 0, 24, S, 3); px(x, shade(PB, 1.8), 0, 27, S, 1); // flap
      pline(x, shade(PB, 0.6), 3, 3, S - 4, 3, [2, 2]); pline(x, shade(PB, 0.6), 3, 3, 3, 21, [2, 2]); pline(x, shade(PB, 0.6), S - 4, 3, S - 4, 21, [2, 2]);
      px(x, '#7a7d80', 27, 14, 10, 8); px(x, '#2a2a2a', 29, 16, 6, 4); px(x, '#b0b4b8', 28, 14, 3, 1); // press-stud
      px(x, shade(PB, 0.6), 0, S - 4, S, 4); pline(x, shade(PB, 0.55), 4, 30, 4, S - 5); pline(x, shade(PB, 0.55), S - 5, 30, S - 5, S - 5);
    }),
    pad: canvasTex(64, (x, S) => { facets(x, S, K.pad, 51 + seed, 3, 0.32, 0.05); px(x, '#1c1c1c', 0, 0, S, 3); px(x, '#1c1c1c', 0, S - 3, S, 3);
      for (const y of [16, 30, 44]) { px(x, shade(K.pad, 1.5), 6, y, S - 12, 1); px(x, shade(K.pad, 0.6), 6, y + 1, S - 12, 2); } // moulded ridges
      px(x, '#505254', 6, 6, 3, 3); px(x, '#505254', S - 9, 6, 3, 3); }), // rivets
    trim: canvasTex(32, (x, S) => { facets(x, S, K.trim, 55 + seed, 2, 0.25, 0.06); px(x, shade(K.trim, 1.3), 0, 0, S, 2); px(x, shade(K.trim, 0.6), 0, S - 3, S, 3); }),
    gaiter: canvasTex(64, (x, S) => { // knit neck gaiter: rib columns + horizontal courses + loose fold line
      const GC = K.gaiter || SD; facets(x, S, GC, 57 + seed, 4, 0.28, 0.12);
      for (let i = 0; i < S; i += 3) pline(x, shade(GC, 0.75), i, 0, i, S);
      for (let y = 1; y < S; y += 4) px(x, shade(GC, 0.82), 0, y, S, 1);
      px(x, shade(GC, 1.35), 0, 20, S, 2); px(x, shade(GC, 0.5), 0, 22, S, 2);
    }),
    // boots (shaft loft + foot box): leather facets, toe-cap seam, criss-cross laces up the front, welt + sole band at the bottom
    boot: canvasTex(128, (x, S) => {
      facets(x, S, BOOT, 61, 6, 0.24, 0.06);
      px(x, '#18191a', 0, S - 22, S, 22); px(x, '#3a3b3c', 0, S - 22, S, 2); for (let i = 0; i < S; i += 8) px(x, '#2c2d2e', i, S - 16, 4, 10); // welt + lugs
      seamH(x, S - 40, 0, S, BOOT, 1.6);
      px(x, '#252627', 46, 0, 36, S - 40); // tongue
      for (let y = 6; y < S - 46; y += 10) { pline(x, '#6a6b6c', 48, y, 80, y + 8, null); pline(x, '#6a6b6c', 80, y, 48, y + 8, null); px(x, '#8a8c8e', 44, y, 4, 4); px(x, '#8a8c8e', 80, y, 4, 4); }
      seamV(x, 30, 0, S - 40, BOOT, 1.5); seamV(x, 98, 0, S - 40, BOOT, 1.5);
    }),
    sole: canvasTex(64, (x, S) => { facets(x, S, [26, 26, 27], 63, 3, 0.2, 0.05); for (let i = 0; i < S; i += 8) for (let j = 0; j < S; j += 8) px(x, '#121213', i + ((j >> 3) & 1) * 4, j, 4, 5); px(x, '#3c3d3e', 0, 0, S, 2); }),
    skin: canvasTex(64, (x, S) => { facets(x, S, SKIN, 71, 3, 0.14, 0.04); }),
    // shaved undercut sides (ash): skin with a dark-blonde stubble wash
    stubble: canvasTex(64, (x, S) => { facets(x, S, SKIN, 73, 3, 0.14, 0.04); const r = rng(13);
      x.fillStyle = 'rgba(150,128,92,0.35)'; x.fillRect(0, 0, S, S * 0.62); for (let i = 0; i < 260; i++) px(x, shade(HR, 0.5 + r() * 0.25), r() * S | 0, r() * S * 0.62 | 0); }),
    hair: canvasTex(128, (x, S) => {
      facets(x, S, HR, 81 + seed, 6, swept ? 0.28 : 0.36, 0.08);
      const r = rng(9 + seed);
      for (let i = 0; i < 520; i++) { // strands: vertical spikes (night) / long swept diagonals (ash)
        const X = r() * S, Y = r() * S, L = 4 + r() * (swept ? 18 : 12), f = (swept ? 0.65 : 0.45) + r() * (swept ? 0.65 : 0.95);
        if (swept) pline(x, shade(HR, f), X, Y, X + L, Y + L * 0.35); else pline(x, shade(HR, f), X, Y, X + (r() - 0.5) * 3, Y + L);
      }
      if (swept) for (let i = 0; i < 6; i++) { const Y = 10 + i * 20; pline(x, shade(HR, 1.18), 0, Y, S, Y + 30, [6, 3]); } // sheen bands
    }),
    face: canvasTex(128, (x, S) => drawFace(x, S, swept, HR, K.stubble)),
    gun: canvasTex(32, (x, S) => { // gunmetal: dark slide with serration ticks + a lighter top edge
      facets(x, S, [40, 42, 46], 121, 3, 0.28, 0.08);
      px(x, '#6a6e74', 0, 0, S, 2); for (let i = 3; i < S; i += 4) px(x, '#1a1b1d', i, 5, 2, 8);
      px(x, '#24262a', 0, S - 8, S, 8); px(x, '#4a4d52', 0, S - 9, S, 1);
    }),
    blade: canvasTex(32, (x, S) => { facets(x, S, [150, 156, 160], 131, 2, 0.35, 0.06); px(x, '#e8eef0', 0, 0, S, 3); px(x, '#5a5e60', 0, S - 3, S, 3); pline(x, '#c8d0d4', 0, 12, S, 9); }),
    glove: canvasTex(64, (x, S) => { // fingerless tactical glove: black leather, knuckle ridge, finger splits, skin tips at the bottom
      facets(x, S, BLACK, 101, 4, 0.25, 0.06); weave(x, S, 2, 0.9, 101, 0);
      px(x, shade(BLACK, 1.6), 0, 24, S, 2); px(x, shade(BLACK, 0.55), 0, 26, S, 2); // knuckle ridge
      for (let i = 4; i < S; i += 8) pline(x, shade(BLACK, 1.4), i, 6, i + 4, 6, [1, 1]);
      px(x, shade(SKIN, 1), 0, S - 16, S, 16); for (let i = 0; i < S; i += 16) { px(x, shade(SKIN, 0.68), i, S - 16, 2, 16); px(x, shade(BLACK, 0.8), i, S - 18, 16, 2); }
      for (let i = 4; i < S; i += 16) px(x, shade(SKIN, 1.12), i, S - 13, 6, 2); // nail highlights
    }),
  };
  return TEX[kit];
}
// face (front of the head box, 128px, u = across the face, v = up): features laid out on the old 32px grid x4 with
// lids, irises + catchlights, nose bridge / nostrils, lips, cheekbone + jaw shading and stubble.
function drawFace(x, S, swept, HR, stubble) {
  facets(x, S, SKIN, 91, 4, 0.12, 0.04);
  const r = rng(swept ? 33 : 34);
  px(x, shade(SKIN, 1.06), 20, 26, 88, 14); // forehead light
  px(x, shade(SKIN, 0.84), 0, 52, 22, 44); px(x, shade(SKIN, 0.84), 106, 52, 22, 44); // cheek sides in shadow
  px(x, shade(SKIN, 0.78), 0, 96, 18, 32); px(x, shade(SKIN, 0.78), 110, 96, 18, 32); // jaw corners
  pline(x, shade(SKIN, 0.74), 18, 96, 40, 118); pline(x, shade(SKIN, 0.74), 110, 96, 88, 118); // jaw line
  px(x, shade(SKIN, 1.1), 24, 70, 14, 4); px(x, shade(SKIN, 1.1), 90, 70, 14, 4); // cheekbone highlights
  if (stubble) { // five o'clock shadow round the jaw + upper lip
    for (let i = 0; i < 900 * stubble; i++) { const X = r() * S, Y = 86 + r() * 42; if (Y < 100 && X > 40 && X < 88 && Y > 92) continue; px(x, shade([60, 46, 38], 0.9 + r() * 0.4), X, Y); }
    for (let i = 0; i < 120 * stubble; i++) px(x, shade([60, 46, 38], 1), 46 + r() * 36, 88 + r() * 4);
  }
  if (swept) { // swept fringe: thick on one side, tapering diagonally across the forehead to the other temple
    for (let i = 0; i < S; i++) { const h = Math.max(6, 32 - (i * 26 / S | 0)); px(x, shade(HR, 0.95 + ((i * 5) % 3) * 0.1), i, 0, 1, h);
      if (i % 3 === 0) px(x, shade(HR, 0.7), i, h - 5, 1, 5); if (i % 7 === 0) px(x, shade(HR, 1.25), i, 2, 1, h - 8); }
    px(x, shade(HR, 0.55), 0, 30, 30, 2); // shadow under the fringe
  } else { // spiky fringe: jagged points
    px(x, shade(HR, 1), 0, 0, S, 18);
    for (let i = 0; i < S; i += 6) { const d = 6 + ((i * 7) % 11); for (let k = 0; k < d; k++) px(x, shade(HR, 1.05 + (k % 2) * 0.1), i + (k >> 2), 18 + k, Math.max(1, 5 - (k >> 1)), 1); }
    for (let i = 2; i < S; i += 5) pline(x, shade(HR, 1.5), i, 2, i + 1, 14, [3, 2]);
  }
  const brow = swept ? [110, 90, 62] : [43, 33, 27];
  for (const [bx, dir] of [[22, 1], [72, -1]]) { // brows angled down toward the nose (stern)
    for (let i = 0; i < 34; i++) px(x, shade(brow, 0.9 + (i % 3) * 0.08), bx + i, 44 + (dir > 0 ? (i / 11 | 0) : 3 - (i / 11 | 0)), 1, 5);
  }
  px(x, shade(SKIN, 0.7), 20, 54, 36, 2); px(x, shade(SKIN, 0.7), 72, 54, 36, 2); // brow-ridge shadow
  const iris = swept ? [44, 74, 102] : [29, 42, 48];
  for (const ex of [30, 76]) { // eyes: lid line, white, iris, pupil, catchlight, lower lid
    px(x, '#2a1e18', ex - 2, 57, 26, 2); px(x, '#e4d8c4', ex, 59, 22, 7); px(x, shade([228, 216, 196], 0.8), ex, 59, 22, 1);
    px(x, shade(iris, 1), ex + 7, 59, 9, 7); px(x, '#0c0c0e', ex + 9, 60, 5, 5); px(x, '#f4f0e8', ex + 8, 60, 2, 2);
    px(x, shade(SKIN, 0.78), ex, 66, 22, 2); px(x, shade(SKIN, 0.86), ex + 2, 69, 18, 2); // lower lid + bag
  }
  px(x, shade(SKIN, 0.82), 58, 56, 4, 24); px(x, shade(SKIN, 1.12), 62, 56, 4, 26); // nose bridge: shadow / lit side
  px(x, shade(SKIN, 0.66), 54, 80, 20, 3); px(x, shade(SKIN, 1.15), 60, 76, 8, 4); // nose tip + underside
  px(x, '#5a3a2c', 55, 81, 4, 2); px(x, '#5a3a2c', 69, 81, 4, 2); // nostrils
  px(x, shade(SKIN, 0.8), 62, 85, 4, 7); // philtrum
  px(x, '#6e4636', 46, 95, 36, 2); px(x, '#8a5a46', 50, 93, 28, 2); px(x, shade(SKIN, 1.08), 50, 98, 28, 3); // mouth + lips
  px(x, shade(SKIN, 0.8), 52, 104, 24, 2); px(x, shade(SKIN, 0.7), 50, 114, 28, 4); px(x, shade(SKIN, 1.08), 56, 108, 16, 4); // chin
}
export const PLAYER_KITS = ['night', 'ash', 'player'];

function enemyTextures() {
  return {
    suit: canvasTex(128, (x, S) => { // slate urban camo: facets + dark angular blotches + light chips, seams like the sneak suit
      facets(x, S, SLATE, 211, 8, 0.22, 0.05);
      const r = rng(17);
      for (let i = 0; i < 16; i++) { x.fillStyle = shade(SLATE_DK, 0.85 + r() * 0.2); x.beginPath();
        const cx = r() * S, cy = r() * S; x.moveTo(cx, cy); for (let k = 0; k < 4; k++) x.lineTo(cx + (r() - 0.5) * 36, cy + (r() - 0.5) * 36); x.fill(); }
      for (let i = 0; i < 30; i++) px(x, shade(SLATE, 1.3), r() * S | 0, r() * S | 0, 3, 2);
      weave(x, S, 3, 0.9, 211); seamV(x, 30, 0, S, SLATE_DK); seamV(x, 96, 0, S, SLATE_DK); seamH(x, 86, 0, S, SLATE_DK);
      for (let y = 46; y < 84; y += 8) pline(x, shade(SLATE_DK, 0.8), 46, y, 82, y);
    }),
    suitFront: canvasTex(256, (x, S) => { // fatigue blouse under the plate carrier: camo, button placket, side seams
      facets(x, S, SLATE, 223, 10, 0.22, 0.05);
      const r = rng(19);
      for (let i = 0; i < 26; i++) { x.fillStyle = shade(SLATE_DK, 0.85 + r() * 0.2); x.beginPath();
        const cx = r() * S, cy = r() * S; x.moveTo(cx, cy); for (let k = 0; k < 4; k++) x.lineTo(cx + (r() - 0.5) * 60, cy + (r() - 0.5) * 60); x.fill(); }
      weave(x, S, 3, 0.9, 223);
      px(x, shade(SLATE_DK, 0.7), 122, 0, 12, S); for (let y = 12; y < S; y += 40) { px(x, '#2a2c30', 126, y, 5, 5); }
      seamV(x, 60, 0, S, SLATE_DK); seamV(x, 196, 0, S, SLATE_DK); seamV(x, 2, 0, S, SLATE_DK);
    }),
    // plate carrier (front + back panels, mag pouches): black cordura with MOLLE rows + red unit tab
    vest: canvasTex(64, (x, S) => {
      facets(x, S, [36, 37, 40], 225, 4, 0.22, 0.05); weave(x, S, 2, 0.85, 225, 0);
      px(x, '#4a4c50', 0, 0, S, 2); px(x, '#4a4c50', 0, S - 2, S, 2); px(x, '#4a4c50', 0, 0, 2, S); px(x, '#4a4c50', S - 2, 0, 2, S);
      for (let y = 26; y < S - 4; y += 8) { px(x, '#1a1b1d', 4, y, S - 8, 3); for (let i = 6; i < S - 6; i += 10) px(x, '#55585c', i, y, 2, 3); }
      px(x, '#7a1414', 24, 8, 16, 9); px(x, '#a02020', 24, 8, 16, 2);
    }),
    gear: canvasTex(64, (x, S) => {
      facets(x, S, [28, 29, 31], 231, 4, 0.25, 0.06);
      px(x, shade(MASK, 1.8), 0, 2, S, 1); px(x, shade(MASK, 1.8), 0, S - 3, S, 1);
      for (let i = 1; i < S; i += 4) { px(x, shade(MASK, 0.6), i, 5, 2, 1); px(x, shade(MASK, 0.6), i, S - 6, 2, 1); }
    }),
    pouch: canvasTex(64, (x, S) => {
      facets(x, S, [32, 33, 35], 241, 4, 0.28, 0.06); weave(x, S, 3, 0.86, 241, 0);
      px(x, shade(MASK, 1.3), 0, 0, S, 24); px(x, shade(MASK, 0.5), 0, 24, S, 3); px(x, shade(MASK, 1.9), 0, 27, S, 1);
      px(x, '#5b5e62', 27, 14, 10, 8); px(x, '#2a2a2a', 29, 16, 6, 4);
    }),
    pad: canvasTex(64, (x, S) => { facets(x, S, [44, 46, 50], 251, 3, 0.32, 0.05); px(x, '#151515', 0, 0, S, 3); px(x, '#151515', 0, S - 3, S, 3);
      for (const y of [16, 30, 44]) { px(x, '#5a5c60', 6, y, S - 12, 1); px(x, '#202124', 6, y + 1, S - 12, 2); } }),
    boot: canvasTex(128, (x, S) => {
      facets(x, S, [36, 36, 38], 261, 6, 0.24, 0.06);
      px(x, '#141415', 0, S - 22, S, 22); for (let i = 0; i < S; i += 8) px(x, '#29292a', i, S - 16, 4, 10);
      seamH(x, S - 40, 0, S, [36, 36, 38], 1.6); px(x, '#202021', 46, 0, 36, S - 40);
      for (let y = 6; y < S - 46; y += 10) { pline(x, '#4a4b4c', 48, y, 80, y + 8); pline(x, '#4a4b4c', 80, y, 48, y + 8); }
    }),
    sole: canvasTex(64, (x, S) => { facets(x, S, [22, 22, 23], 263, 3, 0.2, 0.05); for (let i = 0; i < S; i += 8) for (let j = 0; j < S; j += 8) px(x, '#0e0e0f', i + ((j >> 3) & 1) * 4, j, 4, 5); }),
    // "skin" slot = balaclava knit (neck, sides/back of head) so no skin shows anywhere
    skin: canvasTex(64, (x, S) => { facets(x, S, MASK, 271, 4, 0.2, 0.1); for (let y = 1; y < S; y += 3) px(x, shade(MASK, 0.7), 0, y, S, 1); for (let i = 0; i < S; i += 3) pline(x, shade(MASK, 0.85), i, 0, i, S); }),
    hair: canvasTex(64, (x, S) => facets(x, S, MASK, 281, 4, 0.2, 0.1)),
    // front of head: fully masked. knit balaclava, goggle strap band, respirator seat - no eyes/nose/mouth
    face: canvasTex(128, (x, S) => {
      facets(x, S, MASK, 291, 4, 0.18, 0.1);
      for (let y = 1; y < S; y += 4) px(x, shade(MASK, 0.75), 0, y, S, 1); for (let i = 0; i < S; i += 3) pline(x, shade(MASK, 0.88), i, 0, i, S); // knit
      px(x, '#141416', 0, 40, S, 36); px(x, '#3a3c40', 0, 40, S, 2); px(x, '#3a3c40', 0, 74, S, 2); // goggle gasket band
      px(x, '#3d3f42', 36, 84, 56, 40); px(x, '#56595d', 40, 88, 48, 3); // respirator seat
      for (let i = 0; i < 6; i++) px(x, '#1a1b1d', 44 + i * 7, 98, 4, 20);
    }),
    glove: canvasTex(64, (x, S) => { facets(x, S, [26, 27, 29], 301, 4, 0.25, 0.06); px(x, '#3a3b3d', 0, 24, S, 2);
      for (let i = 0; i < S; i += 16) px(x, '#3a3b3d', i, S - 18, 2, 18); }),
    helmet: canvasTex(64, (x, S) => {
      facets(x, S, HELM, 311, 5, 0.28, 0.08);
      const r = rng(31); for (let i = 0; i < 60; i++) px(x, shade(HELM, 0.6 + r() * 0.3), r() * S | 0, r() * S | 0, 2 + (r() * 3 | 0), 1); // scuffs
      for (let i = 0; i < S; i += 6) px(x, shade(HELM, 0.75), i, 0, 3, S * 0.4); // cover weave
      px(x, shade(HELM, 0.55), 0, S - 6, S, 6); // rim shadow
    }),
    // FAMAS polymer furniture (64px): near-black grey plastic, moulded panel lines, cooling-vent slots on the lower half
    // (handguard), lighter worn edges + a few scuffs. Shared by every part of the rifle so the batch stays one draw.
    rifle: canvasTex(64, (x, S) => {
      facets(x, S, [74, 78, 78], 331, 4, 0.2, 0.05);
      px(x, '#8a8e8c', 0, 0, S, 2); px(x, '#26282a', 0, S - 2, S, 2); // lit top edge / shadowed bottom edge
      for (let i = 4; i < S - 4; i += 6) { px(x, '#1a1b1c', i, 38, 3, 10); px(x, '#5a5e5e', i + 3, 38, 1, 10); } // vents
      px(x, '#2e3030', 0, 30, S, 1); px(x, '#9a9e9c', 0, 31, S, 1); // panel seam
      const r = rng(37); for (let i = 0; i < 26; i++) px(x, '#a0a4a2', r() * S | 0, r() * 28 | 0, 2 + (r() * 3 | 0), 1); // scuffs
      px(x, '#3c3f40', 20, 8, 22, 14); px(x, '#5c6060', 22, 10, 18, 2); // moulded cheek / logo panel
    }),
    lens: canvasTex(32, (x, S) => { // opaque mirrored lens, red glint - nothing behind it shows
      x.fillStyle = '#1a0606'; x.fillRect(0, 0, S, S); x.fillStyle = '#5a1010'; x.fillRect(0, 0, S, S / 2);
      px(x, '#ff6a4a', 6, 6, 6, 4); px(x, '#ffd0b0', 8, 6, 2, 2);
    }, false),
  };
}

// ---------------------------------------------------------------- geometry helpers
// loft: rings [y, rx, rz, cx = 0, cz = 0] (any order; sorted bottom -> top), n sides. Flat face toward +x (front),
// u wraps with the front at 0.5, v = 0 at the lowest ring .. 1 at the top. caps: [bottom, top].
function loft(rings, n = 8, caps = [true, true]) {
  rings = [...rings].sort((a, b) => a[0] - b[0]);
  const y0 = rings[0][0], y1 = rings[rings.length - 1][0], pos = [], uv = [], idx = [];
  for (const [y, rx, rz, cx = 0, cz = 0] of rings) for (let i = 0; i <= n; i++) {
    const th = -Math.PI + (i + 0.5) / n * 2 * Math.PI;
    pos.push(cx + Math.cos(th) * rx, y, cz + Math.sin(th) * rz); uv.push((th + Math.PI) / (2 * Math.PI), (y - y0) / (y1 - y0 || 1));
  }
  const R = rings.length, W = n + 1;
  for (let j = 0; j < R - 1; j++) for (let i = 0; i < n; i++) {
    const a = j * W + i, b = a + 1, d = a + W, c = d + 1; idx.push(a, d, b, b, d, c);
  }
  const cap = (j, top) => { const [y, , , cx = 0, cz = 0] = rings[j], ci = pos.length / 3; pos.push(cx, y, cz); uv.push(0.5, top ? 1 : 0);
    for (let i = 0; i < n; i++) { const a = j * W + i, b = a + 1; if (top) idx.push(ci, b, a); else idx.push(ci, a, b); } };
  if (caps[0]) cap(0, false); if (caps[1]) cap(R - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
// thin band around a loft (belt, straps round a limb, cuffs): two rings of the same section
const band = (y, h, rx, rz, n = 8, cx = 0, cz = 0) => loft([[y - h / 2, rx, rz, cx, cz], [y + h / 2, rx, rz, cx, cz]], n, [false, false]);
// segmented box with a vertex deformer fn(v, nx, ny, nz) (normalised -1..1 coords) - keeps BoxGeometry face groups / UVs
function shaped(w, h, d, seg = [1, 1, 1], fn = null) {
  const g = new THREE.BoxGeometry(w, h, d, ...seg);
  if (fn) { const p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v, v.x / (w / 2), v.y / (h / 2), v.z / (d / 2)); p.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals(); }
  return g;
}
const BOXG = {};
const boxG = (w, h, d) => BOXG[w + ',' + h + ',' + d] ??= new THREE.BoxGeometry(w, h, d);
// merge static parts per (bone, material, kit tag): far fewer draw calls with the extra polys
const _o = new THREE.Object3D();
function batcher() {
  const items = [];
  return {
    // o: { r: [rx, ry, rz], s: [sx, sy, sz] (positive only), tag: 'night' | 'ash' | 'night+player' ... }
    add(parent, geo, mat, x = 0, y = 0, z = 0, o = {}) { items.push({ parent, geo, mat, x, y, z, o }); },
    // strap / tube along a polyline in the x-y plane at depth z (each leg = a box oriented along the segment)
    strap(parent, pts, z, w, t, mat, o = {}) {
      for (let i = 0; i < pts.length - 1; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
        this.add(parent, boxG(t, L + t * 0.6, w), mat, (ax + bx) / 2, (ay + by) / 2, z, { ...o, r: [0, 0, Math.atan2(-dx, dy)] }); }
    },
    flush(kitParts) {
      const groups = new Map();
      for (const { parent, geo, mat, x, y, z, o } of items) {
        const key = parent.uuid + '|' + mat.uuid + '|' + (o.tag || '');
        if (!groups.has(key)) groups.set(key, { parent, mat, tag: o.tag, list: [] });
        _o.position.set(x, y, z); _o.rotation.set(...(o.r || [0, 0, 0])); _o.scale.set(...(o.s || [1, 1, 1])); _o.updateMatrix();
        groups.get(key).list.push((geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(_o.matrix));
      }
      for (const gr of groups.values()) {
        const mesh = new THREE.Mesh(mergeGeos(gr.list), gr.mat); gr.parent.add(mesh);
        if (gr.tag) for (const t of gr.tag.split('+')) kitParts[t].push(mesh);
      }
      items.length = 0;
    },
  };
}
function mergeGeos(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2); let o = 0;
  for (const g of list) { const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3); if (!g.attributes.normal) g.computeVertexNormals(); nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2); o += c; g.dispose(); }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  m.computeBoundingSphere(); return m;
}
function box(w, h, d, m) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); }
function at(mesh, x, y, z, parent) { mesh.position.set(x, y, z); parent.add(mesh); return mesh; }
function pivot(parent, x, y, z) { const p = new THREE.Group(); p.position.set(x, y, z); parent.add(p); return p; }

// leg / arm lengths used by the pose solver
const THIGH = 0.42, SHIN = 0.4, ANKLE = 0.1, HIP_Y = THIGH + SHIN + ANKLE; // 0.92

// shared shapes (built once, cloned into the per-bone batches)
const SHAPES = {};
function shapes() {
  if (SHAPES.ready) return SHAPES;
  Object.assign(SHAPES, {
    ready: true,
    pelvis: loft([[-0.13, 0.105, 0.17], [-0.06, 0.122, 0.2], [0.04, 0.128, 0.198], [0.12, 0.124, 0.192]], 10),
    belt: band(0.07, 0.075, 0.142, 0.218, 10),
    torso: loft([[0, 0.126, 0.194], [0.1, 0.13, 0.192], [0.2, 0.142, 0.212, 0.004], [0.3, 0.152, 0.236, 0.008], [0.4, 0.15, 0.246, 0.004], [0.465, 0.128, 0.226], [0.52, 0.085, 0.13]], 10),
    collar: loft([[0.47, 0.088, 0.1, 0.01], [0.56, 0.08, 0.092, 0.012]], 8, [false, true]),
    thigh: loft([[0.04, 0.098, 0.098], [-0.05, 0.112, 0.108], [-0.18, 0.108, 0.103, 0.004], [-0.32, 0.09, 0.086], [-0.43, 0.078, 0.077]], 8),
    knee: loft([[0.05, 0.05, 0.05], [0, 0.084, 0.08], [-0.06, 0.062, 0.06]], 8),
    shin: loft([[0.01, 0.082, 0.079], [-0.09, 0.089, 0.085, -0.008], [-0.19, 0.083, 0.08, -0.01], [-0.3, 0.068, 0.068], [-0.38, 0.07, 0.07]], 8),
    cuff: loft([[-0.33, 0.082, 0.08], [-0.37, 0.09, 0.088], [-0.405, 0.085, 0.083]], 8, [false, false]),
    bootShaft: loft([[-0.075, 0.098, 0.088, 0.008], [0.0, 0.092, 0.085], [0.085, 0.084, 0.079]], 8),
    // foot: toe slopes down + narrows, heel rounded
    foot: shaped(0.3, 0.075, 0.172, [3, 1, 2], (v, nx, ny, nz) => {
      if (nx > 0.2 && ny > 0) v.y -= 0.034 * (nx - 0.2) / 0.8; if (nx > 0.6) v.z *= 0.86; if (nx < -0.6) v.z *= 0.9;
      if (nx > 0.98 && ny > 0) v.x -= 0.012; }),
    sole: shaped(0.318, 0.032, 0.186, [3, 1, 1], (v, nx, ny, nz) => { if (nx > 0.6) v.z *= 0.88; if (nx > 0.98) v.x -= 0.004; }),
    kneePad: shaped(0.05, 0.135, 0.15, [1, 2, 2], (v, nx, ny, nz) => { const c = (1 - nz * nz) * (1 - 0.5 * ny * ny); v.x += c * 0.016 - (1 - c) * 0.004; v.z *= 1 - 0.12 * (ny < 0 ? -ny : 0); }),
    deltoid: loft([[0.085, 0.035, 0.035], [0.055, 0.078, 0.074], [-0.02, 0.09, 0.086], [-0.1, 0.074, 0.07]], 8),
    upperArm: loft([[-0.04, 0.072, 0.068], [-0.12, 0.075, 0.071, 0.006], [-0.24, 0.063, 0.06], [-0.32, 0.057, 0.056]], 8),
    elbow: loft([[0.04, 0.042, 0.042], [0, 0.06, 0.058], [-0.04, 0.05, 0.05]], 6),
    forearm: loft([[0.02, 0.057, 0.055], [-0.07, 0.064, 0.06, 0.004], [-0.17, 0.052, 0.05], [-0.25, 0.045, 0.044]], 8),
    gauntlet: loft([[-0.19, 0.052, 0.05], [-0.255, 0.06, 0.058], [-0.28, 0.055, 0.053]], 8, [false, true]),
    palm: shaped(0.1, 0.078, 0.074, [1, 2, 1], (v, nx, ny) => { if (ny < 0) { v.x *= 0.95; v.z *= 0.94; } if (ny > 0.9) { v.x *= 0.88; v.z *= 0.9; } }),
    fingers: shaped(0.096, 0.044, 0.07, [2, 1, 1], (v, nx, ny) => { if (nx > 0.9) v.y -= 0.008; }),
    fingerTips: shaped(0.05, 0.034, 0.068, [1, 1, 1], (v, nx, ny) => { if (ny < 0) v.x *= 0.85; }),
    thumb: shaped(0.034, 0.05, 0.03, [1, 1, 1], (v, nx, ny) => { if (ny < 0) { v.x *= 0.8; v.z *= 0.8; } }),
    neck: loft([[-0.03, 0.048, 0.052], [0.07, 0.044, 0.048]], 8),
    // head: jaw tapers in, crown rounds off, brow + nose ridge down the centre of the face, back of skull bulges
    head: shaped(0.215, 0.27, 0.198, [2, 4, 2], (v, nx, ny, nz) => {
      if (ny < -0.2) { const k = (-0.2 - ny) / 0.8; v.z *= 1 - 0.2 * k; if (nx < 0) v.x *= 1 - 0.28 * k; }
      if (ny > 0.45) { const k = (ny - 0.45) / 0.55; v.z *= 1 - 0.1 * k; v.x *= 1 - 0.08 * k; }
      if (nx > 0.99 && Math.abs(nz) < 0.01 && ny > -0.9 && ny < 0.6) v.x += 0.012;
      if (nx > 0.99 && Math.abs(nz) > 0.99 && ny > -0.6 && ny < 0.2) v.x -= 0.008; // cheeks recede -> face plane reads
      if (nx < -0.99 && ny > -0.3 && ny < 0.6) v.x -= 0.01;
      if (Math.abs(nx) > 0.99 && Math.abs(nz) > 0.99) { v.x *= 0.95; v.z *= 0.93; } // chamfered vertical edges -> octagonal skull
      if (ny < -0.99 && nx > 0.99 && Math.abs(nz) < 0.01) { v.x += 0.006; v.y -= 0.006; } // chin point
    }),
    ear: shaped(0.045, 0.065, 0.022, [1, 2, 1], (v, nx, ny) => { if (ny < -0.5) v.x *= 0.6; }),
    pouch: shaped(0.064, 0.1, 0.074, [1, 2, 1], (v, nx, ny) => { if (ny > 0.9) { v.x *= 0.9; } if (ny < -0.9) { v.x *= 0.85; v.z *= 0.95; } }),
    flap: shaped(0.07, 0.03, 0.08, [1, 1, 1], (v, nx, ny) => { if (nx > 0.9 && ny < 0) v.y -= 0.006; }),
    spike: new THREE.ConeGeometry(0.05, 0.12, 5),
    tip: new THREE.ConeGeometry(0.045, 0.14, 4),
  });
  return SHAPES;
}

/**
 * Build one sneaker. opts.kit = 'night' (Night Ops, default) | 'ash' (Ash Fox) | 'player' (legacy olive) | 'enemy'.
 * opts.accent = hex colour for P1/P2 accents (shoulder patch, radio LED, marker),
 * opts.tint = optional subtle suit tint. Returns { g, inner, update(dt, state), setKit(kit) }.
 */
export function makeSneaker(scene, opts = {}) {
  const enemy = opts.kit === 'enemy';
  let kit = enemy ? 'enemy' : KITS[opts.kit] ? opts.kit : 'night';
  const T = textures(kit), G = shapes();
  const L = (map, color = 0xffffff) => new THREE.MeshLambertMaterial({ map, color, flatShading: true });
  const suitTint = opts.tint ?? 0xffffff;
  const M = {
    suit: L(T.suit, suitTint), gear: L(T.gear), pouch: L(T.pouch), pad: L(T.pad), boot: L(T.boot), sole: L(T.sole),
    skin: L(T.skin), hair: L(T.hair), glove: L(T.glove),
    web: L(T.web ?? T.gear), trim: L(T.trim ?? T.gear), gaiter: L(T.gaiter ?? T.skin), face: L(T.face), headSide: L(T.skin),
    metal: new THREE.MeshLambertMaterial({ color: 0x6b6d6e, flatShading: true }),
    accent: new THREE.MeshBasicMaterial({ color: opts.accent ?? 0x6fb0ff }),
    patch: new THREE.MeshLambertMaterial({ color: new THREE.Color(opts.accent ?? 0x6fb0ff).multiplyScalar(0.55), flatShading: true }),
  };
  if (enemy) { M.helmet = L(T.helmet); M.lens = new THREE.MeshBasicMaterial({ map: T.lens }); M.vest = L(T.vest); }
  else { M.gun = L(T.gun); M.blade = L(T.blade);
    M.nvg = new THREE.MeshBasicMaterial({ color: 0x7dff6a }); // Night Ops NVG lens glow
    M.hud = new THREE.MeshBasicMaterial({ color: 0x58d8ff, transparent: true, opacity: 0.85 }); // Ash Fox HUD monocle glass
  }
  const suitFrontMat = M.suitFront = L(T.suitFront, suitTint);
  // box face order: +x(front) -x(back) +y -y +z(right) -z(left)
  const headMats = enemy ? [M.face, M.skin, M.hair, M.skin, M.skin, M.skin] : [M.face, M.headSide, M.hair, M.skin, M.headSide, M.headSide];
  const kitParts = { night: [], ash: [], player: [] }; // per-kit extra meshes (hair style, gaiter, trims) toggled by setKit
  const B = batcher(), add = B.add.bind(B);

  const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner);
  const rig = new THREE.Group(); rig.scale.setScalar(opts.scale ?? 0.93); inner.add(rig);

  // --- hips (root of the skeleton)
  const hips = pivot(rig, 0, HIP_Y, 0);
  add(hips, G.pelvis, M.suit, 0, -0.02, 0);
  // belt + pouches (body + flap + stud) + buckle
  add(hips, G.belt, M.web);
  add(hips, boxG(0.03, 0.065, 0.085), M.metal, 0.147, 0.07, 0); add(hips, boxG(0.012, 0.03, 0.05), M.gear, 0.163, 0.07, 0);
  for (const z of [-0.165, -0.085, 0.085, 0.165]) {
    const rz = Math.sign(z) * Math.abs(z) * 0.5; // follow the belt curve
    add(hips, G.pouch, M.pouch, 0.152 - Math.abs(z) * 0.12, 0.045, z, { r: [0, -rz * 1.6, 0] });
    add(hips, G.flap, M.pouch, 0.153 - Math.abs(z) * 0.12, 0.098, z, { r: [0, -rz * 1.6, 0] });
  }
  add(hips, G.pouch, M.pouch, -0.15, 0.045, 0.11, { s: [1.1, 1, 1.15] }); add(hips, G.flap, M.pouch, -0.152, 0.1, 0.11, { s: [1.1, 1, 1.15] });
  add(hips, G.pouch, M.pouch, -0.13, 0.045, -0.15, { r: [0, 0.6, 0], s: [0.9, 0.9, 0.9] }); // canteen / dump pouch, left rear

  // --- legs
  const legs = [];
  let holstered = null;
  for (const side of [-1, 1]) { // -1 = left (-z), 1 = right (+z)
    const hip = pivot(hips, 0, -0.04, side * 0.11);
    add(hip, G.thigh, M.suit);
    if (side === 1) { // drop-leg holster: tapered body + flap, two straps wrapping the thigh, hanger strap to the belt
      add(hip, shaped(0.15, 0.21, 0.055, [1, 2, 1], (v, nx, ny) => { if (ny < 0) v.x *= 0.8; }), M.pouch, 0.012, -0.2, 0.128);
      add(hip, boxG(0.06, 0.3, 0.035), M.web, 0.02, -0.12, 0.153);
      add(hip, band(-0.14, 0.04, 0.118, 0.114), M.web); add(hip, band(-0.3, 0.04, 0.1, 0.096), M.web);
      add(hip, boxG(0.03, 0.03, 0.02), M.metal, 0.02, -0.02, 0.17); // QD buckle
      if (!enemy) { // holstered pistol: slide sunk in the holster, grip + hammer sticking out the top, angled back
        holstered = pivot(hip, 0.0, -0.08, 0.15);
        add(holstered, boxG(0.05, 0.2, 0.035), M.gun, 0.02, -0.08, 0); // slide (mostly inside the holster)
        add(holstered, shaped(0.1, 0.05, 0.04, [2, 1, 1], (v, nx) => { if (nx < -0.9) v.y -= 0.006; }), M.gun, -0.04, 0.02, 0, { r: [0, 0, -0.25] });
        add(holstered, boxG(0.03, 0.03, 0.03), M.gear, 0.02, 0.035, 0); // hammer / rear sight
      }
    } else add(hip, band(-0.2, 0.03, 0.115, 0.11), M.web); // map-pocket strap on the left thigh
    const knee = pivot(hip, 0, -THIGH, 0);
    add(knee, G.knee, M.suit);
    add(knee, G.shin, M.suit);
    add(knee, G.kneePad, M.pad, 0.083, -0.035, 0);
    add(knee, band(-0.1, 0.022, 0.092, 0.088), M.web); // knee-pad strap behind the calf
    add(knee, G.cuff, M.suit); // trouser bloused over the boot
    const ankle = pivot(knee, 0, -SHIN, 0);
    add(ankle, G.bootShaft, M.boot);
    if (!enemy) add(ankle, band(0.06, 0.03, 0.088, 0.083), M.trim); // ankle band (olive on Night Ops, blue on Ash Fox)
    add(ankle, G.foot, M.boot, 0.05, -ANKLE + 0.067, 0);
    add(ankle, G.sole, M.sole, 0.05, -ANKLE + 0.016, 0);
    add(ankle, boxG(0.05, 0.035, 0.18), M.sole, -0.075, -ANKLE + 0.042, 0); // heel block
    legs.push({ hip, knee, ankle, side });
  }

  // --- torso (pivot at waist so it can lean)
  const torso = pivot(hips, 0, 0.08, 0);
  // Both shoulders hang off this so aim yaw/pitch turns the two-hand grip as one piece.
  const aimPivot = pivot(torso, 0, 0, 0);
  add(torso, G.torso, suitFrontMat);
  add(torso, G.collar, M.suit); // high collar
  // harness: two shoulder straps that follow the chest curve and run over the shoulders to the back, chest strap, buckles
  for (const z of [-0.11, 0.11]) {
    B.strap(torso, [[0.134, 0.0], [0.15, 0.16], [0.16, 0.3], [0.148, 0.43], [0.06, 0.5], [-0.06, 0.5], [-0.148, 0.43], [-0.16, 0.3], [-0.15, 0.16], [-0.134, 0.0]], z, 0.05, 0.018, M.web);
    add(torso, boxG(0.022, 0.045, 0.045), M.metal, 0.168, 0.25, z); add(torso, boxG(0.012, 0.025, 0.028), M.gear, 0.178, 0.25, z);
  }
  add(torso, shaped(0.02, 0.04, 0.3, [1, 1, 4], (v, nx, ny, nz) => { v.x -= 0.012 * nz * nz; }), M.web, 0.168, 0.36, 0);
  add(torso, boxG(0.02, 0.18, 0.1), M.web, -0.168, 0.3, 0, { r: [0.78, 0, 0] }); add(torso, boxG(0.02, 0.18, 0.1), M.web, -0.168, 0.3, 0, { r: [-0.78, 0, 0] }); // back X
  add(torso, boxG(0.03, 0.05, 0.05), M.metal, -0.172, 0.3, 0);
  if (!enemy) add(torso, band(0.535, 0.016, 0.086, 0.097, 8, 0.011), M.trim, 0, 0, 0, { tag: 'ash' }); // Ash Fox: accent stripe round the collar
  if (enemy) { // plate carrier: curved front + back plates, shoulder pads, three rifle-mag pouches
    const plate = shaped(0.05, 0.3, 0.36, [1, 2, 3], (v, nx, ny, nz) => { v.x += 0.022 * (1 - nz * nz) * Math.sign(nx || 1); if (ny > 0.9) v.z *= 0.85; });
    add(torso, plate, M.vest, 0.15, 0.3, 0); add(torso, plate, M.vest, -0.145, 0.3, 0, { r: [0, Math.PI, 0] });
    for (const z of [-0.08, 0.08]) B.strap(torso, [[0.13, 0.44], [0.04, 0.5], [-0.04, 0.5], [-0.13, 0.44]], z, 0.07, 0.025, M.vest);
    for (const z of [-0.1, 0, 0.1]) { add(torso, G.pouch, M.pouch, 0.2, 0.2, z, { s: [0.75, 1.15, 1.2] }); add(torso, G.flap, M.pouch, 0.2, 0.26, z, { s: [0.75, 1, 1.2] }); }
    add(torso, boxG(0.04, 0.12, 0.08), M.pouch, 0.2, 0.36, -0.12); // radio
  }
  // chest radio on the right strap + antenna + LED (P1/P2 accent)
  add(torso, shaped(0.06, 0.14, 0.09, [1, 2, 1], (v, nx, ny) => { if (nx > 0.9 && Math.abs(ny) > 0.9) v.x -= 0.006; }), M.pouch, 0.185, 0.33, 0.13);
  add(torso, boxG(0.012, 0.03, 0.06), M.metal, 0.217, 0.37, 0.13); // dial / PTT
  const ant = pivot(torso, 0.18, 0.48, 0.16);
  add(ant, new THREE.CylinderGeometry(0.006, 0.01, 0.16, 4), M.gear);
  add(torso, boxG(0.012, 0.025, 0.025), M.accent, 0.218, 0.33, 0.11);
  add(ant, boxG(0.025, 0.025, 0.025), M.accent, 0, 0.08, 0);

  // --- head
  const neck = pivot(torso, 0.01, 0.52, 0);
  add(neck, G.neck, M.skin);
  const headPivot = pivot(neck, 0, 0.03, 0);
  let tails = null; // Ash Fox bandana tails (animated)
  if (enemy) buildEnemyHead(headPivot, M, headMats, B, G);
  else {
    at(new THREE.Mesh(G.head, headMats), 0.01, 0.13, 0, headPivot);
    for (const s of [-1, 1]) add(headPivot, G.ear, M.skin, -0.012, 0.125, s * 0.1);
    // SPIKY (olive + Night Ops): rounded hair cap + back + sideburns, a crown of tilted 5-sided spikes swept back
    const NP = { tag: 'night+player' };
    add(headPivot, shaped(0.235, 0.075, 0.218, [2, 1, 2], (v, nx, ny, nz) => { if (ny > 0) v.y += 0.018 * (1 - nx * nx) * (1 - nz * nz); if (nx > 0.9) v.y -= 0.01; }), M.hair, 0.0, 0.27, 0, NP);
    add(headPivot, shaped(0.055, 0.18, 0.214, [1, 2, 2], (v, nx, ny, nz) => { if (ny < -0.5) v.z *= 0.86; v.x -= 0.008 * (1 - nz * nz); }), M.hair, -0.098, 0.18, 0, NP);
    for (const s of [-1, 1]) add(headPivot, boxG(0.11, 0.07, 0.014), M.hair, -0.02, 0.235, s * 0.1, NP); // temples above the ears
    for (const s of [-1, 1]) add(headPivot, boxG(0.024, 0.05, 0.012), M.hair, 0.05, 0.19, s * 0.099, NP); // sideburns
    const r = rng(77);
    for (let i = 0; i < 16; i++) { // short spiky hair: tilted cones, raked back
      const row = i % 4, col = i >> 2;
      add(headPivot, G.spike, M.hair, -0.09 + row * 0.06 + (r() - 0.5) * 0.02, 0.3 + (r() - 0.5) * 0.02, -0.08 + col * 0.053 + (r() - 0.5) * 0.015,
        { ...NP, r: [(r() - 0.5) * 0.9, r() * 3, -0.55 + (r() - 0.5) * 0.6], s: Array(3).fill(0.75 + r() * 0.5) });
    }
    for (let i = 0; i < 5; i++) add(headPivot, G.spike, M.hair, 0.112, 0.262, -0.08 + i * 0.04, { ...NP, r: [0, 0, -1.25], s: [0.55, 0.6 + r() * 0.2, 0.55] }); // fringe spikes
    for (let i = 0; i < 6; i++) add(headPivot, G.spike, M.hair, -0.12, 0.22 + (i % 2) * 0.05, -0.07 + (i >> 1) * 0.07, { ...NP, r: [0, 0, 1.9 + (r() - 0.5) * 0.4], s: [0.6, 0.7, 0.6] }); // nape
    // NIGHT OPS neck gaiter: bunched knit tube (alternating fold rings) + rolled lip under the jaw + slack throat fold
    add(neck, loft([[-0.05, 0.088, 0.096], [-0.025, 0.094, 0.102], [0.0, 0.086, 0.094], [0.025, 0.092, 0.1], [0.045, 0.082, 0.09]], 10, [false, false]), M.gaiter, 0, 0, 0, { tag: 'night' });
    add(neck, band(0.05, 0.022, 0.078, 0.088, 10, 0.004), M.gaiter, 0, 0, 0, { tag: 'night' });
    add(neck, shaped(0.05, 0.08, 0.15, [1, 2, 2], (v, nx, ny, nz) => { v.x += 0.01 * (1 - nz * nz); }), M.gaiter, 0.078, -0.03, 0, { tag: 'night', r: [0, 0, -0.25] });
    // ASH FOX swept undercut: shaved sides (stubble texture on head sides), long top swept up + over to the right,
    // a fringe strand falling across the left of the forehead. Segmented boxes rounded off + flat wedges.
    const A = (geo, x, y, z, rx = 0, ry = 0, rz = 0, s) => add(headPivot, geo, M.hair, x, y, z, { tag: 'ash', r: [rx, ry, rz], s });
    const round = (w, h, d, k = 0.012) => shaped(w, h, d, [2, 2, 2], (v, nx, ny, nz) => { if (ny > 0) v.y += k * (1 - nx * nx) * (1 - nz * nz); if (Math.abs(nx) > 0.9 && Math.abs(nz) > 0.9) { v.x *= 0.92; v.z *= 0.92; } });
    A(round(0.24, 0.06, 0.17), 0.005, 0.285, 0.015); // top slab (narrower than the head = undercut)
    A(round(0.22, 0.09, 0.13, 0.015), 0.02, 0.33, 0.04, -0.35); // swept volume, rising to the right
    A(round(0.18, 0.06, 0.09), 0.03, 0.37, 0.09, -0.7); // crest rolling over the right side
    A(round(0.09, 0.13, 0.17), 0.1, 0.315, 0.03, -0.2, 0, 0.3); // tall front quiff
    A(shaped(0.035, 0.07, 0.14, [1, 2, 1], (v, nx, ny) => { if (ny < 0) v.z *= 0.6; }), 0.12, 0.24, -0.035, 0.45); // fringe strand down to the left temple
    A(round(0.05, 0.11, 0.18), -0.095, 0.24, 0.01); // back (above the shaved nape)
    for (let i = 0; i < 5; i++) A(G.tip, -0.08 + i * 0.048, 0.35, 0.1, 1.15, 0, 0.15, [1, 1, 0.55]); // swept tips over the right ear
    for (let i = 0; i < 3; i++) A(G.tip, 0.09 - i * 0.01, 0.37 - i * 0.012, -0.02 + i * 0.05, -0.3, 0, -1.0, [0.8, 0.9, 0.5]); // quiff points
    for (let i = 0; i < 4; i++) A(G.tip, -0.06 + i * 0.05, 0.315, -0.075, -0.9, 0, 0.1, [0.7, 0.8, 0.45]); // short layer over the left side of the undercut
    for (let i = 0; i < 3; i++) A(G.tip, -0.115, 0.27 + i * 0.02, -0.05 + i * 0.06, 0, 0, 1.75, [0.75, 0.8, 0.5]); // tapered back

    // ESPIONAGE HEADGEAR - different silhouette per kit so P1 / P2 read apart from the top-down camera.
    // NIGHT OPS: head harness (olive band + crown strap) carrying a flipped-up QUAD-TUBE NVG on a forehead mount -
    // four stubby tubes jutting forward-up with green-lit lenses (a forward "prow" over the face).
    const NV = { tag: 'night' };
    add(headPivot, band(0.24, 0.032, 0.128, 0.118, 10, 0.01), M.web, 0, 0, 0, NV); // harness band round the skull
    add(headPivot, shaped(0.24, 0.014, 0.034, [4, 1, 1], (v, nx) => { v.y -= 0.075 * nx * nx; }), M.web, 0.005, 0.335, 0, NV); // crown strap, front to back
    for (const z of [-0.075, 0.075]) add(headPivot, shaped(0.014, 0.1, 0.03, [1, 2, 1], (v, nx, ny) => { v.z *= 1 + 0.2 * ny; }), M.web, 0.0, 0.29, z * 1.45, { ...NV, r: [-Math.sign(z) * 0.5, 0, 0] }); // side straps over the temples
    add(headPivot, boxG(0.03, 0.06, 0.075), M.metal, 0.128, 0.27, 0, NV); // forehead mount plate
    add(headPivot, boxG(0.05, 0.022, 0.03), M.gear, 0.15, 0.3, 0, { ...NV, r: [0, 0, -0.5] }); // flip-up arm
    add(headPivot, shaped(0.07, 0.055, 0.2, [1, 1, 2], (v, nx, ny, nz) => { v.x -= 0.01 * nz * nz; }), M.gear, 0.17, 0.315, 0, { ...NV, r: [0, 0, -0.85] }); // NVG housing / bridge
    const tube = new THREE.CylinderGeometry(0.022, 0.025, 0.1, 6), lensG = new THREE.CylinderGeometry(0.019, 0.019, 0.012, 6);
    for (const [z, ry] of [[-0.078, 0.22], [-0.027, 0.05], [0.027, -0.05], [0.078, -0.22]]) { // quad tubes, outer pair canted out
      const ax = Math.sin(0.85), ay = Math.cos(0.85), cx = 0.195, cy = 0.335;
      add(headPivot, tube, M.gear, cx, cy, z, { ...NV, r: [ry, 0, -0.85] });
      add(headPivot, lensG, M.nvg, cx + ax * 0.054, cy + ay * 0.054, z + ry * 0.02, { ...NV, r: [ry, 0, -0.85] }); // lit lens
    }
    add(headPivot, boxG(0.05, 0.03, 0.04), M.pouch, -0.13, 0.25, 0, NV); // battery pack on the back of the harness
    // ASH FOX: long knotted BANDANA (blue) with two tails that stream behind when moving, a left-ear comms
    // earpiece + boom mic, and a cyan HUD monocle over the right eye (a trailing "tail" + side glint silhouette).
    const AF = { tag: 'ash' };
    add(headPivot, band(0.235, 0.042, 0.132, 0.12, 10, 0.012), M.trim, 0, 0, 0, AF); // bandana band, under the swept top
    add(headPivot, shaped(0.045, 0.055, 0.065, [1, 2, 1], (v, nx, ny) => { v.z *= 1 - 0.25 * Math.abs(ny); }), M.trim, -0.13, 0.235, 0, AF); // knot
    tails = pivot(headPivot, -0.14, 0.235, 0);
    add(tails, shaped(0.26, 0.012, 0.045, [3, 1, 1], (v, nx) => { v.z *= 1 - 0.35 * Math.max(0, -nx); v.y += 0.012 * Math.sin(nx * 3); }), M.trim, -0.13, 0, 0.02, { ...AF, r: [0.25, 0.15, 0] });
    add(tails, shaped(0.2, 0.012, 0.04, [3, 1, 1], (v, nx) => { v.z *= 1 - 0.35 * Math.max(0, -nx); v.y -= 0.01 * Math.sin(nx * 3); }), M.trim, -0.1, -0.02, -0.02, { ...AF, r: [-0.3, -0.2, 0.15] });
    add(headPivot, shaped(0.05, 0.065, 0.026, [1, 2, 1], (v, nx, ny) => { v.x *= 1 - 0.15 * Math.abs(ny); }), M.gear, -0.01, 0.13, -0.116, AF); // earpiece (left)
    add(headPivot, boxG(0.012, 0.012, 0.012), M.accent, -0.01, 0.15, -0.131, AF); // earpiece LED (P accent)
    add(headPivot, boxG(0.14, 0.012, 0.012), M.metal, 0.065, 0.075, -0.112, { ...AF, r: [0, 0.12, -0.38] }); // boom mic arm
    add(headPivot, boxG(0.028, 0.022, 0.024), M.gear, 0.13, 0.048, -0.094, AF); // mic
    add(headPivot, boxG(0.12, 0.012, 0.014), M.gear, 0.055, 0.2, 0.112, AF); // monocle arm along the right temple
    add(headPivot, boxG(0.014, 0.06, 0.07), M.gear, 0.124, 0.165, 0.05, AF); // monocle frame
    add(headPivot, boxG(0.008, 0.046, 0.056), M.hud, 0.133, 0.165, 0.05, AF); // HUD glass
  }

  // --- arms
  const arms = [];
  for (const side of [-1, 1]) {
    const sh = pivot(aimPivot, 0, 0.42, side * 0.28);
    add(sh, G.deltoid, M.suit);
    add(sh, G.upperArm, M.suit);
    add(sh, boxG(0.075, 0.08, 0.014), M.patch, 0, -0.1, side * 0.073); // sleeve patch (P1/P2 accent)
    if (!enemy) add(sh, shaped(0.13, 0.03, 0.14, [2, 1, 3], (v, nx, ny, nz) => { v.y -= 0.03 * nz * nz + 0.01 * nx * nx; }), M.pad, 0.0, 0.07, side * 0.03, { r: [-side * 0.38, 0, 0] }); // moulded shoulder plate
    else add(sh, shaped(0.15, 0.04, 0.15, [2, 1, 2], (v, nx, ny, nz) => { v.y -= 0.02 * nz * nz; }), M.vest, 0.0, 0.07, side * 0.015, { r: [-side * 0.3, 0, 0] });
    const el = pivot(sh, 0, -0.32, 0);
    add(el, G.elbow, M.suit);
    add(el, G.forearm, M.suit);
    if (!enemy) add(el, shaped(0.05, 0.085, 0.1, [1, 1, 2], (v, nx, ny, nz) => { if (nx < 0) v.x -= 0.01 * (1 - nz * nz); }), M.pad, -0.058, -0.01, 0); // elbow pad
    add(el, G.gauntlet, M.gear); // glove gauntlet cuff
    const wr = pivot(el, 0, -0.27, 0);
    // mitt hand with a knuckle break: palm, finger block, curled tips, two-segment thumb
    add(wr, G.palm, M.glove, 0.008, -0.04, 0);
    add(wr, G.fingers, M.glove, 0.004, -0.098, 0, { r: [0, 0, 0.12] });
    add(wr, G.fingerTips, M.glove, -0.03, -0.122, 0, { r: [0, 0, 0.55] });
    add(wr, G.thumb, M.glove, 0.05, -0.03, -side * 0.035, { r: [side * 0.3, 0, -0.35] });
    add(wr, G.thumb, M.glove, 0.064, -0.068, -side * 0.035, { r: [side * 0.2, 0, -0.1], s: [0.85, 0.8, 0.85] });
    arms.push({ sh, el, wr, side });
  }
  // right hand props (player kit). Wrist-local: -y = along the forearm (barrel / blade direction), -x = "down" when aiming.
  let drawn = null, knife = null, flash = null, wx = null;
  if (!enemy) {
    const wr = arms[1].wr;
    drawn = pivot(wr, 0, 0, 0);
    add(drawn, shaped(0.05, 0.22, 0.04, [1, 2, 1], (v, nx, ny, nz) => { if (nx > 0.9) v.z *= 0.8; }), M.gun, 0.035, -0.13, 0); // slide + barrel, runs past the fist
    add(drawn, boxG(0.1, 0.05, 0.04), M.gun, -0.02, -0.07, 0, { r: [0, 0, 0.2] }); // grip in the fist, raked back
    add(drawn, boxG(0.03, 0.06, 0.035), M.gear, -0.005, -0.13, 0); // trigger guard / frame
    add(drawn, boxG(0.015, 0.02, 0.015), M.metal, 0.065, -0.21, 0); // front sight
    add(drawn, boxG(0.015, 0.02, 0.03), M.metal, 0.065, -0.03, 0); // rear sight
    add(drawn, boxG(0.07, 0.03, 0.03), M.gear, -0.075, -0.07, 0); // magazine base
    flash = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), new THREE.MeshBasicMaterial({ color: 0xffe080, transparent: true, opacity: 0.95, depthWrite: false }));
    flash.position.set(0.035, -0.3, 0); flash.scale.set(0.8, 1.6, 0.8); drawn.add(flash); flash.visible = false;
    // weapon variants on the same wrist pivot (own sub-pivots so the batcher keeps them separately toggleable):
    // FR-5 = long barrel / handguard / mag / stock + rail; can = suppressor screwed onto the P-9 (also the MK-T's built-in can)
    wx = { rifle: pivot(drawn, 0, 0, 0), supp: pivot(drawn, 0, 0, 0) };
    add(wx.rifle, boxG(0.045, 0.34, 0.045), M.gun, 0.035, -0.38, 0); // barrel
    add(wx.rifle, boxG(0.07, 0.16, 0.06), M.gear, 0.03, -0.3, 0); // handguard
    add(wx.rifle, boxG(0.09, 0.05, 0.035), M.gun, -0.04, -0.2, 0, { r: [0, 0, 0.15] }); // curved mag
    add(wx.rifle, boxG(0.06, 0.16, 0.04), M.gun, 0.01, 0.09, 0); // stock back along the forearm
    add(wx.rifle, boxG(0.02, 0.2, 0.03), M.metal, 0.075, -0.18, 0); // top rail
    add(wx.supp, boxG(0.045, 0.16, 0.045), M.metal, 0.035, -0.32, 0);
    knife = pivot(wr, 0, 0, 0);
    add(knife, shaped(0.04, 0.06, 0.035, [1, 2, 1], (v, nx, ny) => { if (Math.abs(ny) < 0.1) v.x *= 0.85; }), M.gear, 0.0, -0.1, 0); // handle in the fist
    add(knife, boxG(0.025, 0.04, 0.05), M.metal, 0.0, -0.14, 0); // guard
    add(knife, shaped(0.012, 0.2, 0.035, [1, 2, 1], (v, nx, ny, nz) => { if (ny < -0.9) v.z = nz > 0 ? v.z * 0.1 : v.z; }), M.blade, 0.0, -0.26, 0); // blade with a clipped point
    drawn.visible = knife.visible = false;
  }

  // ENEMY FAMAS (original low-poly bullpup inspired by the MGS1 guards' rifle). Pivot = butt plate, so recoil climb
  // rotates the gun about the shoulder pocket. Rifle-local: +x = barrel, +y = up, +z = right. ~0.8 m long.
  // Parts: rubber butt pad + stock, long receiver with the magazine BEHIND the grip (bullpup), cheek rest, the signature
  // full-length carrying handle (rear post, long top bar with sights, front post), charging lever under it, big
  // full-hand trigger guard, vented handguard, folded bipod legs along its sides, barrel + grenade-ring flash hider.
  let rifle = null, rflash = null;
  const RIFLE = { grip: [0.4, -0.05, 0], fore: [0.56, -0.045, 0], muzzle: 0.8 };
  if (enemy) {
    M.rifle = L(T.rifle);
    rifle = pivot(torso, 0.08, 0.24, 0.16); rifle.scale.setScalar(1.1); // a touch oversized so it reads from the top-down camera
    const R = (geo, m, x, y, z, o) => add(rifle, geo, m, x, y, z, o);
    R(shaped(0.1, 0.105, 0.05, [2, 2, 1], (v, nx, ny) => { if (nx < 0 && ny < 0) v.x += 0.01; if (ny > 0.9 && nx > 0) v.y -= 0.01; }), M.rifle, 0.055, -0.022, 0); // stock
    R(boxG(0.016, 0.112, 0.056), M.gear, 0.006, -0.022, 0); // rubber butt pad
    R(shaped(0.38, 0.075, 0.052, [4, 1, 1], (v, nx, ny) => { if (nx > 0.4 && ny < 0) v.y += 0.008 * (nx - 0.4); }), M.rifle, 0.28, 0.002, 0); // receiver
    R(shaped(0.14, 0.018, 0.046, [2, 1, 1], (v, nx, ny) => { if (Math.abs(nx) > 0.9) v.y -= 0.005; }), M.rifle, 0.14, 0.048, 0); // cheek rest
    R(shaped(0.42, 0.022, 0.03, [4, 1, 1], (v, nx, ny) => { if (ny > 0) v.y += 0.004 * (1 - nx * nx); }), M.rifle, 0.33, 0.112, 0); // carry handle bar
    R(shaped(0.05, 0.07, 0.03, [1, 2, 1], (v, nx, ny) => { if (ny > 0) v.x -= 0.008 * nx; }), M.rifle, 0.145, 0.072, 0); // rear post
    R(shaped(0.04, 0.085, 0.03, [1, 2, 1], (v, nx, ny) => { if (ny < 0) v.x += 0.01; }), M.rifle, 0.52, 0.066, 0); // front post
    R(boxG(0.026, 0.016, 0.022), M.gear, 0.16, 0.13, 0); R(boxG(0.012, 0.022, 0.012), M.gear, 0.53, 0.132, 0); // sights
    R(boxG(0.07, 0.014, 0.014), M.metal, 0.3, 0.05, 0.014); R(boxG(0.014, 0.03, 0.014), M.metal, 0.335, 0.062, 0.014); // charging lever
    R(shaped(0.045, 0.125, 0.028, [1, 2, 1], (v, nx, ny) => { if (ny < 0) v.x += 0.014 * -ny; }), M.gear, 0.24, -0.095, 0); // magazine (behind the grip)
    R(boxG(0.06, 0.02, 0.05), M.rifle, 0.24, -0.04, 0); // mag well lip
    R(shaped(0.042, 0.1, 0.036, [1, 2, 1], (v, nx, ny) => { if (ny < 0) v.x -= 0.022 * -ny; }), M.rifle, 0.405, -0.082, 0); // pistol grip, raked back
    R(boxG(0.14, 0.012, 0.03), M.rifle, 0.42, -0.137, 0); R(boxG(0.012, 0.1, 0.028), M.rifle, 0.488, -0.088, 0); // full-hand trigger guard
    R(shaped(0.17, 0.064, 0.054, [3, 1, 1], (v, nx, ny) => { if (nx > 0.5) { v.y *= 1 - 0.18 * (nx - 0.5); v.z *= 1 - 0.12 * (nx - 0.5); } }), M.rifle, 0.555, -0.004, 0); // handguard
    for (const z of [-0.031, 0.031]) R(boxG(0.2, 0.011, 0.01), M.metal, 0.6, -0.03, z); // folded bipod legs
    R(boxG(0.03, 0.022, 0.07), M.gear, 0.665, -0.026, 0); // bipod hinge block
    R(new THREE.CylinderGeometry(0.012, 0.012, 0.13, 6), M.metal, 0.7, 0.0, 0, { r: [0, 0, -Math.PI / 2] }); // barrel
    R(new THREE.CylinderGeometry(0.019, 0.017, 0.045, 7), M.gear, 0.775, 0.0, 0, { r: [0, 0, -Math.PI / 2] }); // flash hider / grenade ring
    rflash = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.95, depthWrite: false }));
    rflash.position.set(RIFLE.muzzle + 0.07, 0, 0); rflash.scale.set(2.0, 0.8, 0.8); rflash.visible = false; rifle.add(rflash);
  }

  B.flush(kitParts);
  scene.add(g);

  // ---------------------------------------------------------------- pose / animation
  const legIK = (t, h) => { // knee angle so that the foot sole is on the ground when hip is at height h (foot kept flat)
    const c = clamp((h - ANKLE - THIGH * Math.cos(t)) / SHIN, -1, 1);
    return -Math.acos(c) - t;
  };
  // Blend weights use critically-damped springs (SmoothDamp) instead of plain exponential lerps: transitions ease in AND
  // out, so stance changes / starts / stops roll through instead of popping. `smooth` is the approximate seconds to
  // arrive (higher = heavier). Locomotion and the pistol draw / aim are slow enough to read as weight; shoulder
  // tracking (aYaw / aPitch) stays quicker so the barrel still settles on a target. Gait phase is distance-driven
  // (radians per metre), so feet don't skate while the body speeds up or coasts to a stop.
    const K = (smooth) => ({ x: 0, v: 0, smooth });
  const W = { crouch: K(0.24), prone: K(0.40), move: K(0.22), run: K(0.36), dead: K(0.34), spd: K(0.20), lean: K(0.30), roll: K(0.26), idle: K(0.55),
    aim: K(0.22), td: K(0.08), held: K(0.06), armed: K(0.24), aYaw: K(0.16), aPitch: K(0.16), trav: K(0.07), raim: K(0.09), tail: K(0.25),
    swim: K(0.26), dive: K(0.2) };
  // SHOULDER AIM: the aim pose is turned at the shoulder joints (both arms together, so the two-hand grip holds) until
  // the pistol barrel points at s.aimAt (world point: auto-aim lock target, or a point straight ahead when nothing is
  // locked). aimGoal = shoulder offsets [yaw, pitch] solved each frame from the finished pose; the springs above ease
  // the arms toward it. The laser in main.js only ever reads the barrel (muzzleWorld + muzzleDir) - it never aims itself.
  const aimGoal = [0, 0], AIM_MAX = [1.1, 0.6];
  let aimHad = false;
  let phase = 0, prevSpd = 0, prevYaw = null, lastShot = 0, recoil = 0, flashT = 0, kickYaw = 0;
  // HIT REACT: s.hurt = damage counter (bump it on every hit), s.hurtFrom = world angle the hit came FROM (attacker),
  // s.hurtAmt = damage. A change snaps `hit` up (stacks a little over a FAMAS burst) and it bleeds off in ~0.4s;
  // hitF / hitS = where the hit came from relative to the facing (front / right side), hitJ = random head jolt.
  let lastHurt = 0, hit = 0, hitF = 1, hitS = 0, hitJ = 0;
  const bump = (x, a, b) => { const u = clamp((x - a) / (b - a), 0, 1); return Math.sin(u * Math.PI); }; // 0 -> 1 -> 0 over [a,b]
  const mix = (a, b, k) => a + (b - a) * k;
  const sstep = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  function damp(st, target, dt) {
    if (dt <= 0) return st.x;
    const om = 2 / st.smooth, x = om * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const ch = st.x - target, tmp = (st.v + om * ch) * dt;
    st.v = (st.v - om * tmp) * e; st.x = target + (ch + tmp) * e;
    return st.x;
  }
  const FALLBACK = { prone: 1.1, crouch: 1.8, run: 5.2, walk: 3.2 };
  // analytic 2-bone arm IK in the TORSO frame: put the hand (wrist + palm, ~0.33 m below the elbow) on point t.
  // sh.rotation.y swings the arm's plane toward the target, sh.rotation.z raises the upper arm, el.rotation.z bends.
  const _rq1 = new THREE.Quaternion(), _rq2 = new THREE.Quaternion(), _rq3 = new THREE.Quaternion(), _re = new THREE.Euler();
  const _rp1 = new THREE.Vector3(), _rp2 = new THREE.Vector3(), _rv = new THREE.Vector3();
  const UA = 0.32, FA = 0.33;
  function armIK(a, t, k, wrz = 0) {
    const x = t.x - a.sh.position.x, y = t.y - a.sh.position.y, z = t.z - a.sh.position.z;
    const phi = Math.atan2(-z, x), u = Math.hypot(x, z), d = clamp(Math.hypot(u, y), 0.08, UA + FA - 0.003), al = Math.atan2(u, -y);
    const beta = Math.PI - Math.acos(clamp((UA * UA + FA * FA - d * d) / (2 * UA * FA), -1, 1));
    const th = al - Math.acos(clamp((UA * UA + d * d - FA * FA) / (2 * UA * d), -1, 1));
    a.sh.rotation.x = mix(a.sh.rotation.x, 0, k); a.sh.rotation.y = mix(a.sh.rotation.y, phi, k); a.sh.rotation.z = mix(a.sh.rotation.z, th, k);
    a.el.rotation.z = mix(a.el.rotation.z, beta, k); a.el.rotation.x = mix(a.el.rotation.x, 0, k); a.wr.rotation.z = mix(a.wr.rotation.z, wrz, k);
  }
  function update(dt, s) {
    // speed in m/s: real speed from the game if given, else derived from the flags (character.html preview)
    const flagSpd = s.moving && !s.dead ? (s.prone ? FALLBACK.prone : s.crouch ? FALLBACK.crouch : s.run ? FALLBACK.run : FALLBACK.walk) : 0;
    const spd = Math.max(0, damp(W.spd, s.dead ? 0 : (s.speed ?? flagSpd), dt));
    let crouchK = sstep(damp(W.crouch, s.crouch && !s.prone ? 1 : 0, dt));
    // combat overlays (weights + progress)
    const tdP = s.takedown ?? 0, heldP = s.held ?? 0;
    const tdK = sstep(damp(W.td, s.takedown != null && !s.dead ? 1 : 0, dt));
    const heldK = sstep(damp(W.held, s.held != null && !s.dead ? 1 : 0, dt));
    const aimK = sstep(damp(W.aim, s.aim && s.takedown == null && !s.dead ? 1 : 0, dt));
    const armK = sstep(damp(W.armed, s.armed && s.takedown == null && !s.dead ? 1 : 0, dt)); // pistol in hand (low ready)
    // RECOIL (big + gamey): every shot snaps `recoil` up (stacking for the guards' FAMAS bursts -> muzzle climb), then it
    // bleeds off. kickYaw = a random sideways throw per shot, scaled by the live recoil so it settles with it.
    if (s.shot && s.shot !== lastShot) {
      recoil = Math.min(enemy ? 1.7 : 1.6, recoil + (enemy ? 0.75 : 1));
      kickYaw = (Math.random() - 0.5) * (enemy ? 0.55 : 0.8); flashT = enemy ? 0.05 : 0.08; lastShot = s.shot;
    }
    recoil = Math.max(0, recoil - dt * (enemy ? 4.6 : 2.4)); flashT = Math.max(0, flashT - dt);
    if (s.hurt && s.hurt !== lastHurt) {
      const rel = (s.hurtFrom ?? -g.rotation.y) + g.rotation.y; // attacker angle relative to the facing (a = -rotation.y)
      hitF = Math.cos(rel); hitS = Math.sin(rel); hitJ = (Math.random() - 0.5) * 2;
      hit = Math.min(1.5, hit + clamp((s.hurtAmt ?? 10) / 12, 0.55, 1.2)); lastHurt = s.hurt;
    }
    hit = clamp(hit - Math.max(0, dt) * 3.2, 0, 1.5); // (dt can come in negative on a first preview frame)
    // takedown: attacker sinks into a braced half-crouch; victim's knees give out as the hold finishes
    crouchK = Math.max(crouchK, tdK * 0.45, heldK * sstep((heldP - 0.45) / 0.55) * 0.8);
    const proneK = sstep(damp(W.prone, s.prone && !s.dead ? 1 : 0, dt));
    const deadK = sstep(damp(W.dead, s.dead ? 1 : 0, dt));
    // gait amplitude ramps up with speed (momentum: first steps are short, full stride only at cruising speed)
    const ref = s.prone ? 0.7 : s.crouch ? 1.2 : 2.2;
    const moveK = clamp(damp(W.move, s.dead ? 0 : sstep(spd / ref), dt), 0, 1);
    const runTarget = s.crouch || s.prone ? 0 : s.speed != null ? sstep((spd - 3.5) / 1.4) : (s.run ? 1 : 0);
    const runK = clamp(damp(W.run, runTarget, dt), 0, 1);
    // stride length: radians of gait phase per metre. Heavier than a brisk game-walk (longer steps, fewer of them):
    // walk 1.95, run 1.55, crouch 2.65, prone crawl 2.75. Swing / lift below are opened up so the slower cycle still covers the stride.
    const radPerM = mix(mix(mix(1.95, 1.55, runK), 2.65, crouchK), 2.75, proneK);
    phase += dt * Math.max(spd, moveK * 0.4) * radPerM;
    if (s.swim && !s.dead) phase += dt * (0.6 + (s.dive ? 0.2 : moveK) * 2.6); // crawl stroke, slower than a land stride
    const sw = Math.sin(phase), t = performance.now() / 1000;
    // body reacts to momentum: lean into acceleration, rock back when braking, bank into turns
    const acc = dt > 0 ? (spd - prevSpd) / dt : 0; prevSpd = spd;
    const lean = damp(W.lean, clamp(acc * 0.018, -0.1, 0.12) * (1 - proneK), dt);
    const yaw = g.rotation.y; let yawRate = 0;
    if (prevYaw !== null && dt > 0) { let d = yaw - prevYaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; yawRate = d / dt; }
    prevYaw = yaw;
    // body snapped onto the target (shot with auto-aim): carry the arms' current world aim over so they don't flick
    if (s.aimAt && aimHad && Math.abs(yawRate * dt) > 0.15) { W.aYaw.x -= yawRate * dt; aimGoal[0] -= yawRate * dt; }
    const roll = damp(W.roll, clamp(-yawRate * spd * 0.012, -0.12, 0.12) * (1 - proneK), dt);
    const idle = damp(W.idle, 1 - moveK, dt) * (1 - deadK);
    const breathe = Math.sin(t * 1.05) * idle, sway = Math.sin(t * 0.36) * idle;

    // hip height: stand 0.92 -> crouch 0.56. Bob is lowest at full stride (sin^2), smooth instead of the old |cos| cusp.
    const bob = moveK * (0.034 + runK * 0.045) * sw * sw;
    hips.position.y = HIP_Y - crouchK * 0.26 - bob + breathe * 0.008;
    hips.position.z = moveK * Math.sin(phase - 0.4) * 0.034 * (1 - runK * 0.5) + sway * 0.016; // weight shift over the stance leg
    hips.rotation.y = moveK * Math.sin(phase - 0.15) * 0.17;
    const h = hips.position.y - 0.04; // hip joints sit 4cm below the hips pivot
    // torso: upright -> lean forward in crouch / run (negative z = forward), plus the momentum lean
    torso.rotation.z = -(crouchK * 0.6 + runK * moveK * 0.36 + moveK * 0.07 + lean) - breathe * 0.018;
    torso.rotation.y = -hips.rotation.y * 1.3;
    torso.rotation.x = -roll * 0.3 + sway * 0.015;
    // head: keep eyes on the horizon, slightly lagged so it settles rather than snaps
    headPivot.rotation.z = crouchK * 0.45 + runK * moveK * 0.2 + lean * 0.8;
    headPivot.rotation.y = -torso.rotation.y * 0.5 + sway * 0.06;
    // legs: crouch base pose (front/back stagger like the crouch ref) + walk swing, IK keeps feet planted-ish
    for (const lg of legs) {
      const ph = lg.side === 1 ? 0 : Math.PI;
      const swing = Math.sin(phase + ph) * moveK * (0.48 + runK * 0.32 - crouchK * 0.18);
      const base = crouchK * (lg.side === -1 ? 0.95 : -0.5); // left leg forward, right leg back (lunge)
      const th = base + swing;
      let kn = legIK(th, h);
      const up = Math.max(0, Math.cos(phase + ph)), liftS = up * up * (3 - 2 * up); // eased swing-through (no kink at contact)
      const lift = liftS * moveK * (0.64 + runK * 0.72);
      kn -= lift;
      lg.hip.rotation.z = th; lg.knee.rotation.z = kn; lg.ankle.rotation.z = -(th + kn) - lift * 0.4;
      lg.hip.rotation.x = -lg.side * crouchK * 0.08;
    }
    // arms: relaxed at sides, swing opposite to legs with a little follow-through lag; crouch = forearms up in a ready guard
    for (const a of arms) {
      const ph = a.side === 1 ? Math.PI : 0;
      const swing = Math.sin(phase + ph - 0.48) * moveK * (0.55 + runK * 0.5) * (1 - crouchK * 0.6);
      a.sh.rotation.z = swing + crouchK * (a.side === -1 ? 0.9 : 0.35) + runK * moveK * 0.28 + breathe * 0.03;
      a.sh.rotation.x = -a.side * (0.12 + crouchK * 0.15 + breathe * 0.02) + roll * 0.5;
      a.el.rotation.z = 0.22 + crouchK * (a.side === -1 ? 1.3 : 1.0) + runK * moveK * 1.05 + moveK * 0.28 + Math.max(0, swing) * 0.42;
      a.wr.rotation.x = 0; a.wr.rotation.y = 0; a.wr.rotation.z = crouchK * -0.2;
    }
    // PRONE: blend every joint toward a belly-down pose, then lay the whole rig flat (head forward along +x).
    // Commando crawl while moving: one knee drawn up and out to the side while the opposite arm reaches forward.
    const pk = proneK;
    if (pk > 0.001) {
      const crawl = moveK * pk, cs = Math.sin(phase);
      hips.position.y = mix(hips.position.y, HIP_Y, pk);
      hips.position.z = mix(hips.position.z, 0, pk);
      hips.rotation.y = mix(hips.rotation.y, 0, pk);
      hips.rotation.x = crawl * cs * 0.12; // hips roll side to side
      torso.rotation.z = mix(torso.rotation.z, 0.14 + breathe * 0.02, pk); // chest propped up a little on the elbows
      torso.rotation.y = mix(torso.rotation.y, crawl * Math.sin(phase - 0.3) * 0.1, pk);
      torso.rotation.x = mix(torso.rotation.x, -crawl * cs * 0.08, pk);
      headPivot.rotation.z = mix(headPivot.rotation.z, 1.2, pk); // chin up, eyes forward
      headPivot.rotation.y = mix(headPivot.rotation.y, -crawl * cs * 0.06, pk);
      for (const lg of legs) {
        const pull = Math.max(0, lg.side * cs), pullS = pull * pull * (3 - 2 * pull);
        const draw = 0.12 + crawl * pullS * 1.1; // 0 = straight leg, 1 = knee pulled up beside the hip
        lg.hip.rotation.z = mix(lg.hip.rotation.z, 0.05, pk);
        lg.knee.rotation.z = mix(lg.knee.rotation.z, 0, pk);
        lg.ankle.rotation.z = mix(lg.ankle.rotation.z, -1.1, pk); // toes dug in
        lg.hip.rotation.x = mix(lg.hip.rotation.x, -lg.side * 1.25 * draw, pk);
        lg.knee.rotation.x = mix(0, lg.side * 1.5 * draw, pk);
      }
      for (const a of arms) {
        const rr = Math.max(0, -a.side * Math.sin(phase - 0.25)), reach = crawl * rr * rr * (3 - 2 * rr); // opposite arm reaches
        a.sh.rotation.z = mix(a.sh.rotation.z, 0, pk);
        a.el.rotation.z = mix(a.el.rotation.z, 0, pk);
        a.wr.rotation.z = mix(a.wr.rotation.z, 0, pk);
        a.sh.rotation.x = mix(a.sh.rotation.x, -a.side * (1.3 + 1.3 * reach), pk); // elbows out to the sides
        a.el.rotation.x = mix(0, -a.side * 1.8 * (1 - reach), pk); // forearms forward, hands near the head
      }
    } else {
      hips.rotation.x = 0;
      for (const lg of legs) lg.knee.rotation.x = 0;
      for (const a of arms) a.el.rotation.x = 0;
    }
    for (const a of arms) a.sh.rotation.y = 0;
    aimPivot.rotation.set(0, 0, 0);
    // ---- LOW READY (pistol drawn, not aiming): firing elbow flared off the ribs, muzzle at the floor ahead.
    // Right shoulder.x is negative so the upper arm abducts outward (the previous -0.34 only cleared the shoulder
    // by a few centimetres and still read tucked). Fades out when prone (crawl arms win) and under the full aim pose.
    const readyK = armK * (1 - pk) * (1 - aimK);
    if (readyK > 0.001) {
      const Rr = arms[1], k = readyK, bob = Math.sin(t * 0.85) * 0.045;
      Rr.sh.rotation.x = mix(Rr.sh.rotation.x, -1.131, k); // elbow out, away from the ribcage
      Rr.sh.rotation.y = mix(Rr.sh.rotation.y, 0.456, k);
      Rr.sh.rotation.z = mix(Rr.sh.rotation.z, 0.56 + bob, k);
      Rr.el.rotation.z = mix(Rr.el.rotation.z, 0.94 + bob * 0.45, k); Rr.el.rotation.x = mix(Rr.el.rotation.x, 0, k);
      Rr.wr.rotation.x = mix(Rr.wr.rotation.x, 0, k);
      Rr.wr.rotation.y = mix(Rr.wr.rotation.y, -1.117, k); // keep the pistol upright while the forearm points down-range
      Rr.wr.rotation.z = mix(Rr.wr.rotation.z, 0, k);
    }
    // ---- HANDGUN AIM: two-hand chest hold, elbows bent and bowed OUT. The previous pass set the firing shoulder.x
    // positive, which swings that elbow into the ribs (and the support elbow with it). Negative x on the right arm
    // and positive x on the left abduct both elbows outside the chest; the wrists cant so the short forearms still
    // meet on the grip. Shoulders stay below a locked T. Base angles already put the barrel level, so shoulder aim
    // only trims onto a target. Prone: the flare fades and the arms reach past the head.
    if (aimK > 0.001) {
      const [L, Rr] = arms, k = aimK, open = 1 - pk;
      // Muzzle flip only. Torso lean (crouch) is left to the shoulder-aim solver: baking the full lean into
      // these already-raised arms made the solver wind a big yaw and the two elbows stopped matching.
      const kick = recoil * 0.45;
      const settle = Math.sin(t * 0.85) * 0.03, settleL = Math.sin(t * 0.85 + 0.8) * 0.025;
      const aimZR = mix(1.349 + kick, Math.PI - 0.55, pk), aimZL = mix(1.346 + kick, Math.PI - 0.7, pk);
      Rr.sh.rotation.z = mix(Rr.sh.rotation.z, aimZR, k); Rr.sh.rotation.y = mix(0, 0.286 * open, k);
      Rr.sh.rotation.x = mix(Rr.sh.rotation.x, -1.520 * open, k);
      Rr.el.rotation.z = mix(Rr.el.rotation.z, mix(1.731 + settle + recoil * 0.22, 0.50, pk), k);
      Rr.el.rotation.x = mix(Rr.el.rotation.x, 0, k);
      Rr.wr.rotation.x = mix(Rr.wr.rotation.x, -1.522 * open, k);
      Rr.wr.rotation.y = mix(Rr.wr.rotation.y, -0.047 * open, k);
      Rr.wr.rotation.z = mix(Rr.wr.rotation.z, mix(-1.282, -recoil * 0.35, pk), k);
      L.sh.rotation.z = mix(L.sh.rotation.z, aimZL, k); L.sh.rotation.y = mix(0, -0.297 * open, k);
      L.sh.rotation.x = mix(L.sh.rotation.x, 1.506 * open, k);
      L.el.rotation.z = mix(L.el.rotation.z, mix(1.730 + settleL + recoil * 0.12, 0.50, pk), k);
      L.el.rotation.x = mix(L.el.rotation.x, 0, k);
      L.wr.rotation.x = mix(L.wr.rotation.x, 1.509 * open, k);
      L.wr.rotation.y = mix(L.wr.rotation.y, 0.047 * open, k);
      L.wr.rotation.z = mix(L.wr.rotation.z, -1.271 * open, k);
      torso.rotation.y = mix(torso.rotation.y, -0.12 * (1 - pk), k); // blade the body a touch
      // Crouch leans the torso forward. Pitch the shared aim pivot by that lean so both elbows rise together
      // and the barrel stays level. Recoil rock is applied after, so the kick still shows.
      const lean = torso.rotation.z;
      if (pk < 0.25) aimPivot.rotation.z += -lean;
      // recoil body language: rock back from the waist, head snaps back, guns thrown sideways (settles with the kick)
      torso.rotation.z += recoil * 0.16 * k * (1 - pk); headPivot.rotation.z += recoil * 0.2 * k;
      for (const a of arms) a.sh.rotation.y += kickYaw * recoil * 0.45 * k * (1 - pk);
      // shoulder aim offsets (yaw, pitch) on the shared aim pivot, so the two-hand grip turns as one piece
      shoulderAim(damp(W.aYaw, aimGoal[0], dt) * k, damp(W.aPitch, aimGoal[1], dt) * k, pk);
    } else { damp(W.aYaw, 0, dt); damp(W.aPitch, 0, dt); }
    // ---- TAKEDOWN (attacker, from behind): reach in, hook the left forearm across the guard's throat, two knife jabs
    // with the right hand, then lower him down.
    if (tdK > 0.001) {
      const [L, Rr] = arms, k = tdK, p = tdP;
      const reach = sstep(p / 0.18), release = sstep((p - 0.86) / 0.14);
      const hold = reach * (1 - release);
      torso.rotation.z = mix(torso.rotation.z, -0.18 - 0.2 * release, k);
      headPivot.rotation.z = mix(headPivot.rotation.z, 0.1, k);
      // choke arm: up and across the throat
      L.sh.rotation.z = mix(L.sh.rotation.z, mix(0.3, 1.75, hold), k); L.sh.rotation.y = mix(0, -0.3 * hold, k);
      L.sh.rotation.x = mix(L.sh.rotation.x, 0, k);
      L.el.rotation.z = mix(L.el.rotation.z, mix(0.3, 0.25, hold), k); L.el.rotation.x = mix(L.el.rotation.x, -1.5 * hold, k);
      L.wr.rotation.z = mix(L.wr.rotation.z, 0, k);
      // knife arm: cocked low by the hip, punches forward into the guard's side on each jab
      const jab = Math.max(bump(p, 0.32, 0.48), bump(p, 0.56, 0.72));
      Rr.sh.rotation.z = mix(Rr.sh.rotation.z, mix(0.25, 0.55 + jab * 0.45, hold), k); Rr.sh.rotation.y = mix(0, -0.2 * hold, k);
      Rr.sh.rotation.x = mix(Rr.sh.rotation.x, -0.15 * hold, k);
      Rr.el.rotation.z = mix(Rr.el.rotation.z, mix(0.2, 1.6 - jab * 0.75, hold), k); Rr.el.rotation.x = mix(Rr.el.rotation.x, 0, k);
      Rr.wr.rotation.z = mix(Rr.wr.rotation.z, -0.3 * hold, k);
    }
    // ---- HELD (victim): yanked back by the throat, head tipped up, both hands clawing at the forearm, struggle fades
    if (heldK > 0.001) {
      const k = heldK, p = heldP, fight = (1 - sstep((p - 0.3) / 0.6));
      const thr = Math.sin(t * 23) * fight, thr2 = Math.sin(t * 17 + 1) * fight;
      torso.rotation.z = mix(torso.rotation.z, 0.22 + 0.06 * thr2 - 0.25 * sstep((p - 0.75) / 0.25), k);
      headPivot.rotation.z = mix(headPivot.rotation.z, 0.55 - 0.5 * sstep((p - 0.7) / 0.3), k);
      headPivot.rotation.y = mix(headPivot.rotation.y, thr * 0.15, k);
      for (const a of arms) {
        const lim = 1 - sstep((p - 0.72) / 0.28);
        a.sh.rotation.z = mix(a.sh.rotation.z, mix(0.1, 1.15 + 0.18 * (a.side > 0 ? thr : thr2), lim), k);
        a.sh.rotation.y = mix(0, a.side * 0.25 * lim, k);
        a.sh.rotation.x = mix(a.sh.rotation.x, -a.side * 0.15, k);
        a.el.rotation.z = mix(a.el.rotation.z, mix(0.2, 2.0, lim), k); a.el.rotation.x = mix(a.el.rotation.x, 0, k);
        a.wr.rotation.z = mix(a.wr.rotation.z, 0, k);
      }
    }
    // ---- ENEMY FAMAS: blends slung across the chest (held / dead) <-> low ready (patrol, carried across the body, muzzle
    // down-left) <-> shouldered (s.rifleAim: stock in the right shoulder, body bladed, barrel held level along the facing
    // whatever the torso does). Recoil per round: gun driven back into the shoulder + pitched up (stacks over a burst
    // = cyclic climb) + thrown sideways, torso / head jolt. Both hands ride the rifle via 2-bone IK.
    if (rifle) {
      const holdK = (1 - heldK) * (1 - deadK) * (1 - pk);
      const raimK = sstep(damp(W.raim, s.rifleAim && !s.dead && s.held == null ? 1 : 0, dt)) * holdK, rk = recoil;
      torso.rotation.y = mix(torso.rotation.y, -0.45, raimK); // blade: left shoulder forward
      torso.rotation.z = mix(torso.rotation.z, -0.06, raimK) + rk * 0.14 * raimK; // stand tall, rock back on each round
      headPivot.rotation.z = mix(headPivot.rotation.z, 0.08, raimK) + rk * 0.18 * raimK; headPivot.rotation.y = mix(headPivot.rotation.y, 0.3, raimK);
      hips.rotation.y = mix(hips.rotation.y, 0, raimK); hips.position.y -= 0.025 * raimK;
      legs[0].hip.rotation.z += 0.28 * raimK; legs[1].hip.rotation.z -= 0.16 * raimK; // staggered firing stance
      for (const lg of legs) lg.ankle.rotation.z = -(lg.hip.rotation.z + lg.knee.rotation.z);
      // pose targets (torso frame)
      _rq1.setFromEuler(_re.set(0, 1.3, 0.7)); _rp1.set(0.22, 0.12, 0.16); // slung
      _rq2.setFromEuler(_re.set(0, 0.55, -0.42)); _rp2.set(0.14, 0.3, 0.14); // low ready
      _rq1.slerp(_rq2, holdK); _rp1.lerp(_rp2, holdK);
      if (raimK > 0.001) { // aim: desired orientation in the rig frame, expressed in the torso frame (cancels hips + torso)
        hips.updateMatrix(); torso.updateMatrix();
        _rq3.copy(hips.quaternion).multiply(torso.quaternion).invert()
          .multiply(_rq2.setFromEuler(_re.set(0, kickYaw * rk * 0.4, rk * 0.34 - 0.02)));
        _rp2.set(0.06 - 0.07 * rk, 0.36 + 0.015 * rk, 0.17);
        _rq1.slerp(_rq3, raimK); _rp1.lerp(_rp2, raimK);
      }
      rifle.quaternion.copy(_rq1); rifle.position.copy(_rp1);
      if (holdK > 0.001) {
        rifle.updateMatrix();
        _rv.set(...RIFLE.grip).applyMatrix4(rifle.matrix); armIK(arms[1], _rv, holdK, -0.25);
        _rv.set(...RIFLE.fore).applyMatrix4(rifle.matrix); armIK(arms[0], _rv, holdK, 0.1);
      }
      rflash.visible = flashT > 0 && holdK > 0.5; rflash.rotation.x = t * 40;
    }
    // ---- SWIM (surface crawl, or a short glide when diving). Overrides the walk so the stroke reads from above.
    const swimK = sstep(damp(W.swim, s.swim && !s.dead && !s.trav ? 1 : 0, dt));
    const diveK = sstep(damp(W.dive, !!(s.swim && s.dive) && !s.dead && !s.trav ? 1 : 0, dt));
    if (swimK > 0.001) {
      const glide = diveK, stroke = Math.sin(phase);
      const bob = Math.sin(t * (1.5 + moveK * 3)) * (0.01 + moveK * 0.012);
      hips.position.y = mix(hips.position.y, HIP_Y - 0.05 - glide * 0.28 + bob, swimK);
      hips.position.z = mix(hips.position.z, glide * 0.04, swimK);
      hips.rotation.y = mix(hips.rotation.y, stroke * 0.07 * (1 - glide), swimK);
      torso.rotation.z = mix(torso.rotation.z, -0.34 - glide * 0.9, swimK);
      torso.rotation.y = mix(torso.rotation.y, -stroke * 0.12 * moveK * (1 - glide), swimK);
      torso.rotation.x = mix(torso.rotation.x, 0, swimK);
      headPivot.rotation.z = mix(headPivot.rotation.z, 0.38 + glide * 0.45, swimK);
      headPivot.rotation.y = mix(headPivot.rotation.y, 0, swimK);
      for (const a of arms) {
        const ph = a.side === 1 ? 0 : Math.PI;
        const reach = mix((Math.sin(phase + ph) + 1) * 0.5, 0.94, glide);
        a.sh.rotation.z = mix(a.sh.rotation.z, mix(-0.05, 1.7, reach), swimK);
        a.sh.rotation.x = mix(a.sh.rotation.x, -a.side * (0.22 + 0.9 * reach) * (1 - glide * 0.25), swimK);
        a.sh.rotation.y = mix(a.sh.rotation.y, a.side * 0.18 * (1 - reach), swimK);
        a.el.rotation.z = mix(a.el.rotation.z, mix(1.02, 0.16, reach), swimK);
        a.el.rotation.x = mix(a.el.rotation.x, 0, swimK);
        a.wr.rotation.x = mix(a.wr.rotation.x, 0, swimK);
        a.wr.rotation.y = mix(a.wr.rotation.y, 0, swimK);
        a.wr.rotation.z = mix(a.wr.rotation.z, 0, swimK);
      }
      for (const lg of legs) {
        const k = Math.sin(phase * 2 + (lg.side === 1 ? 0 : Math.PI));
        lg.hip.rotation.z = mix(lg.hip.rotation.z, 0.12 + k * (0.2 + moveK * 0.22) * (1 - glide * 0.35), swimK);
        lg.knee.rotation.z = mix(lg.knee.rotation.z, -0.42 - Math.max(0, -k) * 0.32, swimK);
        lg.ankle.rotation.z = mix(lg.ankle.rotation.z, 0.22, swimK);
        lg.hip.rotation.x = mix(lg.hip.rotation.x, 0, swimK);
        lg.knee.rotation.x = mix(lg.knee.rotation.x, 0, swimK);
      }
    }
    // ---- HIT REACT (flinch): snap away from the hit - rock back (front hit) / pitch forward (from behind), lean off the
    // side it came from, head whips, arms jerk up, knees give a little. Additive on top of whatever pose is running;
    // applied BEFORE traversal so ladders / ropes / mantles keep their grip (traversal blends over it), damped prone.
    const hk = hit > 0.001 ? sstep(Math.min(1, hit)) * (1 - 0.6 * pk) : 0;
    if (hk > 0) {
      torso.rotation.z += hitF * hk * 0.42; torso.rotation.x -= hitS * hk * 0.28; torso.rotation.y += hitJ * hk * 0.18;
      headPivot.rotation.z += hitF * hk * 0.55; headPivot.rotation.y += hitJ * hk * 0.35; headPivot.rotation.x = -hitS * hk * 0.3;
      for (const a of arms) { a.sh.rotation.z += hk * 0.3 * (1 - aimK * 0.6); a.sh.rotation.x -= a.side * hk * 0.25; a.el.rotation.z += hk * 0.35; }
      if (pk < 0.5) for (const lg of legs) { lg.knee.rotation.z -= hk * 0.22; lg.hip.rotation.z += hk * 0.11; lg.ankle.rotation.z = -(lg.hip.rotation.z + lg.knee.rotation.z); }
      hips.position.y -= hk * 0.035 * (1 - pk);
    } else headPivot.rotation.x = 0;
    // ---- TRAVERSAL (ladder / drainpipe climb, rope hang, mantle, co-op boost kneel + lift, pull-up, grapple throw / tug / rope / hookset)
    applyTrav(dt, s);
    if (holstered) {
      // empty weapon string = bare hands (on-site procurement: nothing is holstered until you find a gun)
      const bare = !s.weapon;
      const out = !bare && (aimK > 0.35 || (armK > 0.5 && tdK < 0.3));
      holstered.visible = !bare && !out; drawn.visible = !bare && out;
      knife.visible = tdK > 0.3 && tdP > 0.12 && tdP < 0.95 && !out;
      flash.visible = !bare && flashT > 0 && out; flash.rotation.y = t * 40;
      if (!bare) {
        const wid = s.weapon, rif = wid === 'fr5', can = wid === 'sd' || wid === 'mkt';
        wx.rifle.visible = rif; wx.supp.visible = can && !rif;
        flash.position.y = rif ? -0.6 : can ? -0.42 : -0.3; flash.scale.set(can ? 0.35 : 0.8, can ? 0.6 : 1.6, can ? 0.35 : 0.8);
      }
    }
    // lay flat (prone) / topple forward (death, game-over screen). Rig pivots at the feet, so shift it back to stay centred.
    const flat = Math.max(deadK, pk);
    inner.rotation.z = -flat * Math.PI / 2;
    inner.position.y = mix(deadK * 0.16, 0.14, pk);
    inner.position.x = mix(deadK * 0.1, -0.78, pk);
    rig.rotation.x = roll * (1 - flat); // bank into turns from the feet
    // hit stagger: the whole body is shoved a few cm away from the shot (eases back with `hit`; off while climbing)
    if (hit > 0.001 && !s.trav) { const sk = sstep(Math.min(1, hit)) * (1 - flat) * 0.07; inner.position.x -= hitF * sk; inner.position.z = -hitS * sk; } else inner.position.z = 0;
    // bandana tails: hang + sway at rest, stream out behind with speed, flick on a hit
    if (tails) { const st = damp(W.tail, clamp(spd / 4.5, 0, 1), dt);
      tails.rotation.z = mix(1.05, 0.12, st) + flat * -0.6 + Math.sin(t * (2 + st * 9)) * (0.08 + st * 0.12) - hit * 0.4;
      tails.rotation.x = Math.sin(t * (1.3 + st * 7) + 1) * (0.1 + st * 0.18) + hitS * hit * 0.4; }
    aimHad = !!s.aimAt;
    solveShoulderAim(s, aimK, pk);
  }
  // ---------------------------------------------------------------- traversal poses
  // s.trav = { k, p, ph, up }: k = climb | hang | mantle | kneel | lift | pull | throw | tug | rope | hookset, p = 0..1 progress, ph = climb phase.
  // Each builder starts from the finished base pose and overrides only the joints it owns; switching kinds cross-fades
  // over ~0.16s, entering / leaving eases on the W.trav spring. Joint vector (JN floats) - see readPose().
  const JN = 26, trCur = new Float32Array(JN), trFrom = new Float32Array(JN), trTgt = new Float32Array(JN), trOut = new Float32Array(JN);
  let trLast = null, trKind = null, trXf = 1;
  function readPose(o) {
    o[0] = hips.position.y; o[1] = torso.rotation.z; o[2] = torso.rotation.x; o[3] = headPivot.rotation.z; let j = 4;
    for (const a of arms) { o[j++] = a.sh.rotation.x; o[j++] = a.sh.rotation.y; o[j++] = a.sh.rotation.z; o[j++] = a.el.rotation.z; o[j++] = a.el.rotation.x; o[j++] = a.wr.rotation.z; }
    for (const lg of legs) { o[j++] = lg.hip.rotation.z; o[j++] = lg.hip.rotation.x; o[j++] = lg.knee.rotation.z; o[j++] = lg.knee.rotation.x; o[j++] = lg.ankle.rotation.z; }
  }
  function writePose(o) {
    hips.position.y = o[0]; torso.rotation.z = o[1]; torso.rotation.x = o[2]; headPivot.rotation.z = o[3]; let j = 4;
    for (const a of arms) { a.sh.rotation.x = o[j++]; a.sh.rotation.y = o[j++]; a.sh.rotation.z = o[j++]; a.el.rotation.z = o[j++]; a.el.rotation.x = o[j++]; a.wr.rotation.z = o[j++]; }
    for (const lg of legs) { lg.hip.rotation.z = o[j++]; lg.hip.rotation.x = o[j++]; lg.knee.rotation.z = o[j++]; lg.knee.rotation.x = o[j++]; lg.ankle.rotation.z = o[j++]; }
  }
  // setters on a pose vector. arm(i: 0 = left, 1 = right), leg(i)
  const setArm = (o, i, shx, shy, shz, elz, wrz = 0) => { const j = 4 + i * 6; o[j] = shx; o[j + 1] = shy; o[j + 2] = shz; o[j + 3] = elz; o[j + 4] = 0; o[j + 5] = wrz; };
  const setLeg = (o, i, th, kn, ank = null, hx = 0) => { const j = 16 + i * 5; o[j] = th; o[j + 1] = hx; o[j + 2] = kn; o[j + 3] = 0; o[j + 4] = ank ?? -(th + kn); };
  const setBody = (o, hy, tz, hz, tx = 0) => { o[0] = hy; o[1] = tz; o[2] = tx; o[3] = hz; };
  const P = { a: new Float32Array(JN), b: new Float32Array(JN) };
  const blendInto = (o, a, b, k) => { for (let i = 0; i < JN; i++) o[i] = mix(a[i], b[i], k); };
  const KNEEL = (o) => { setBody(o, 0.5, -0.3, 0.35); for (let i = 0; i < 2; i++) { const sd = i ? 1 : -1; setArm(o, i, 0, sd * 0.5, 0.8, 1.15, -0.3); }
    setLeg(o, 0, 1.45, -1.5); setLeg(o, 1, -0.05, -1.55, 0.9); };
  const HANG = (o, ph) => { const sw = Math.sin(ph); setBody(o, 0.92, 0.06, 0.45);
    for (let i = 0; i < 2; i++) { const sd = i ? 1 : -1; setArm(o, i, -sd * 0.16, 0, 2.95, 0.22); }
    setLeg(o, 0, 0.32 + 0.22 * sw, -0.55, -0.1); setLeg(o, 1, 0.32 - 0.22 * sw, -0.75, -0.1); };
  const CLIMB = (o, ph) => { const sn = Math.sin(ph); setBody(o, 0.86, -0.08, 0.35);
    setArm(o, 0, 0.12, 0, 2.55 + 0.35 * sn, 0.42 - 0.27 * sn); setArm(o, 1, -0.12, 0, 2.55 - 0.35 * sn, 0.42 + 0.27 * sn);
    setLeg(o, 0, 0.55 - 0.45 * sn, -(0.4 + 0.5 - 0.5 * sn), null, 0.06); setLeg(o, 1, 0.55 + 0.45 * sn, -(0.4 + 0.5 + 0.5 * sn), null, -0.06); };
  function travTarget(tr, o) { // fills o, returns the pose weight (fades for moves that end standing)
    const p = clamp(tr.p ?? 0, 0, 1), pa = Math.min(1, p / 0.45);
    switch (tr.k) {
      case 'climb': CLIMB(o, tr.ph ?? 0); return 1;
      case 'hang': HANG(o, tr.ph ?? performance.now() / 333); return 1;
      case 'kneel': KNEEL(o); return 1;
      case 'mantle': { // hands on the lip -> push over with knees tucked -> stand up
        P.a.set(o); P.b.set(o);
        setBody(P.a, 0.9, -0.2, 0.5); setArm(P.a, 0, 0.1, 0, mix(2.7, 1.6, pa), mix(0.3, 1.0, pa)); setArm(P.a, 1, -0.1, 0, mix(2.7, 1.6, pa), mix(0.3, 1.0, pa));
        setLeg(P.a, 0, 1.0, -1.6); setLeg(P.a, 1, 0.2, -0.5);
        setBody(P.b, 0.72, -0.75, 0.7); setArm(P.b, 0, 0.05, 0, 0.35, 0.15); setArm(P.b, 1, -0.05, 0, 0.35, 0.15);
        setLeg(P.b, 0, 1.4, -2.0); setLeg(P.b, 1, 1.0, -1.6);
        blendInto(o, P.a, P.b, sstep((p - 0.3) / 0.32)); return 1 - sstep((p - 0.78) / 0.22);
      }
      case 'lift': { // booster: kneel with cupped hands -> stand up driving the hands overhead -> lower
        P.a.set(o); P.b.set(o); KNEEL(P.a);
        setBody(P.b, 0.9, -0.05, 0.5); for (let i = 0; i < 2; i++) { const sd = i ? 1 : -1; setArm(P.b, i, -sd * 0.1, sd * 0.3, 2.45, 0.55); }
        setLeg(P.b, 0, 0.3, -0.35); setLeg(P.b, 1, -0.15, -0.15);
        blendInto(o, P.a, P.b, sstep((p - 0.25) / 0.4)); return 1 - sstep((p - 0.86) / 0.14);
      }
      case 'pull': { // on the roof edge facing out: kneel, lean over, reach down -> haul back
        P.a.set(o); P.b.set(o); KNEEL(P.a); KNEEL(P.b);
        setBody(P.a, 0.5, -1.1, 1.05); for (let i = 0; i < 2; i++) { const sd = i ? 1 : -1; setArm(P.a, i, -sd * 0.05, sd * 0.15, 1.55, 0.1); }
        setBody(P.b, 0.55, -0.35, 0.45); for (let i = 0; i < 2; i++) { const sd = i ? 1 : -1; setArm(P.b, i, 0, sd * 0.3, 1.25, 1.6); }
        blendInto(o, P.a, P.b, sstep((p - 0.2) / 0.55)); return 1 - sstep((p - 0.86) / 0.14);
      }
      case 'throw': { // grapple: claw spins low on the right hand (eyes on the lip) -> big overhead sling -> both hands take in the line
        const w = 0.48, wind = Math.min(1, p / w), sling = sstep((p - w) / 0.17), take = sstep((p - 0.68) / 0.32), spin = Math.sin(p * 34);
        setBody(o, o[0] - 0.04 * (1 - take), 0.08 + 0.14 * sling - 0.06 * take, 0.42 + 0.15 * sling);
        const rz = p < w ? 0.55 + 0.3 * wind + 0.28 * spin : mix(mix(0.85, 3.0, sling), 2.35, take);
        setArm(o, 1, -0.08, 0.1 * (1 - sling), rz, p < w ? 0.35 + 0.2 * spin : mix(0.15, 0.55, take), 0);
        setArm(o, 0, 0.08, -0.15 * (1 - take), mix(0.85, 2.1, take), mix(1.15, 0.6, take));
        setLeg(o, 0, 0.32 * (1 - take * 0.5), -0.22, null, 0.04); setLeg(o, 1, -0.14, -0.2, null, -0.04); // staggered stance
        return 1;
      }
      case 'tug': { // claw bit: two hard tugs on the line, one boot up on the wall, then lean back into it
        const pull = Math.abs(Math.sin(Math.min(1, p / 0.7) * Math.PI * 2)), settle = sstep((p - 0.7) / 0.3);
        setBody(o, o[0], 0.1 + 0.22 * pull + 0.15 * settle, 0.5);
        for (let i = 0; i < 2; i++) { const sd = i ? 1 : -1; setArm(o, i, -sd * 0.06, 0, (i ? 2.55 : 2.25) - 0.25 * pull, 0.35 + 0.65 * pull); }
        setLeg(o, 0, mix(0.15, 0.95, settle), mix(-0.2, -0.9, settle), null, 0.05); setLeg(o, 1, -0.05 * pull, -0.15);
        return 1;
      }
      case 'rope': { // on the line, feet on the wall. up: hand-over-hand, boots walk the face. down: L-sit, guide hand high,
        // brake hand at the hip, legs straighten on each kick-off and soak the plant
        const sn = Math.sin(tr.ph ?? 0);
        if (tr.up) {
          setBody(o, 0.86, 0.32, 0.42);
          setArm(o, 0, 0.1, 0, 2.5 + 0.38 * sn, 0.5 - 0.35 * sn); setArm(o, 1, -0.1, 0, 2.5 - 0.38 * sn, 0.5 + 0.35 * sn);
          setLeg(o, 0, 1.1 + 0.28 * sn, -(0.85 + 0.35 * sn), null, 0.08); setLeg(o, 1, 1.1 - 0.28 * sn, -(0.85 - 0.35 * sn), null, -0.08);
        } else {
          const kick = Math.max(0, sn);
          setBody(o, 0.84, 0.48 - 0.12 * kick, -0.25 - 0.1 * kick);
          setArm(o, 0, 0.08, 0, 2.45, 0.55 - 0.2 * kick); setArm(o, 1, -0.2, 0.25, 0.25 + 0.35 * kick, 0.55);
          setLeg(o, 0, 1.25 - 0.15 * kick, -(0.75 - 0.5 * kick), null, 0.1); setLeg(o, 1, 1.25 - 0.15 * kick, -(0.75 - 0.5 * kick), null, -0.1);
        }
        return 1;
      }
      case 'hookset': { // rappel prep at the lip: kneel, reach out + clamp the claw, two checks, toss the line down the face
        KNEEL(o); const reach = sstep(p / 0.3) * (1 - sstep((p - 0.5) / 0.15)), toss = Math.sin(Math.PI * clamp((p - 0.52) / 0.3, 0, 1));
        setBody(o, 0.5, -0.3 - 0.4 * reach, 0.1 - 0.35 * reach);
        setArm(o, 1, -0.05, 0.1, mix(0.8, 1.35, reach) + 0.9 * toss, mix(1.15, 0.2, reach) + 0.3 * toss, 0);
        setArm(o, 0, 0.05, -0.3, mix(0.8, 1.15, reach), mix(1.15, 0.5, reach));
        return 1;
      }
    }
    return 0;
  }
  function applyTrav(dt, s) {
    const trK = sstep(damp(W.trav, s.trav && !s.dead ? 1 : 0, dt));
    if (s.trav) trLast = s.trav;
    if (trK < 0.001 || !trLast) { trKind = null; return; }
    readPose(trCur); trTgt.set(trCur);
    const w = travTarget(trLast, trTgt);
    if (trKind !== trLast.k) { if (trKind === null) { trFrom.set(trTgt); trXf = 1; } else { trFrom.set(trOut); trXf = 0; } trKind = trLast.k; }
    trXf = Math.min(1, trXf + dt / 0.16);
    const xf = sstep(trXf), k = trK * w;
    for (let i = 0; i < JN; i++) { trOut[i] = mix(trFrom[i], trTgt[i], xf); trCur[i] = mix(trCur[i], trOut[i], k); }
    writePose(trCur);
    hips.position.z *= 1 - k; hips.rotation.y *= 1 - k; torso.rotation.y *= 1 - k;
  }
  // add a yaw / pitch offset to the aim. Standing: both shoulders share aimPivot, so yaw (around torso up)
  // and pitch (around torso right) turn the two-hand grip together. Adding the same Euler to each shoulder
  // instead splits the elbows once they are abducted — shoulder.y is no longer "turn". Prone keeps the old
  // per-shoulder mapping: the torso is lying on its front, so world-yaw is carried by rotation.x.
  function shoulderAim(yo, po, pk) {
    if (pk > 0.45) {
      for (const a of arms) { a.sh.rotation.y += yo * (1 - pk); a.sh.rotation.x -= yo * pk; a.sh.rotation.z += po; }
      return;
    }
    aimPivot.rotation.y += yo;
    aimPivot.rotation.z += po;
  }
  const _m = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _tgt = new THREE.Vector3();
  const barrel = () => { g.updateMatrixWorld(true); flash.getWorldPosition(_m); drawn.getWorldQuaternion(_q); return _d.set(0, -1, 0).applyQuaternion(_q); };
  // barrel error vs muzzle -> target, as [yaw, elevation] (world yaw sign matches rotation.y)
  const aimErr = () => {
    const d = barrel(), tx = _tgt.x - _m.x, ty = _tgt.y - _m.y, tz = _tgt.z - _m.z;
    let ey = Math.atan2(-tz, tx) - Math.atan2(-d.z, d.x); while (ey > Math.PI) ey -= 2 * Math.PI; while (ey < -Math.PI) ey += 2 * Math.PI;
    return [ey, Math.atan2(ty, Math.hypot(tx, tz)) - Math.atan2(d.y, Math.hypot(d.x, d.z))];
  };
  // Solve the shoulder offsets that put the barrel on target: measure the finished pose, probe each offset a little
  // (numeric 2x2 Jacobian, so it stays right in crouch / prone / blading), Newton step -> aimGoal for the next frame.
  function solveShoulderAim(s, aimK, pk) {
    if (!drawn || aimK < 0.5 || s.dead) { aimGoal[0] = aimGoal[1] = 0; return; }
    if (s.aimAt) _tgt.set(s.aimAt.x, s.aimAt.y, s.aimAt.z);
    else { barrel(); const a = -g.rotation.y; _tgt.set(g.position.x + Math.cos(a) * 10, _m.y, g.position.z + Math.sin(a) * 10); } // dead ahead, level
    if (recoil > 0.05) return; // let the kick play out instead of fighting it
    const e0 = aimErr(), eps = 0.02, k = aimK;
    shoulderAim(eps * k, 0, pk); const e1 = aimErr(); shoulderAim(-eps * k, 0, pk);
    shoulderAim(0, eps * k, pk); const e2 = aimErr(); shoulderAim(0, -eps * k, pk);
    g.updateMatrixWorld(true);
    // columns = d(err)/d(offset) (err falls as the offset closes it, hence the minus)
    const a11 = -(e1[0] - e0[0]) / eps, a21 = -(e1[1] - e0[1]) / eps, a12 = -(e2[0] - e0[0]) / eps, a22 = -(e2[1] - e0[1]) / eps;
    const det = a11 * a22 - a12 * a21; if (Math.abs(det) < 1e-4) return;
    const dy = (a22 * e0[0] - a12 * e0[1]) / det, dp = (a11 * e0[1] - a21 * e0[0]) / det;
    aimGoal[0] = clamp(W.aYaw.x + clamp(dy, -0.5, 0.5), -AIM_MAX[0], AIM_MAX[0]);
    aimGoal[1] = clamp(W.aPitch.x + clamp(dp, -0.5, 0.5), -AIM_MAX[1], AIM_MAX[1]);
  }
  update(0, {});
  // world position of the pistol muzzle (for tracers); falls back to chest height in front of the body
  const muzzleWorld = (v) => { if (rflash) { g.updateMatrixWorld(true); return rflash.getWorldPosition(v); }
    if (flash) { g.updateMatrixWorld(true); return flash.getWorldPosition(v); } return v.set(g.position.x, 1.25, g.position.z); };
  // world direction the barrel points (unit); falls back to the body facing
  const muzzleDir = (v) => { if (rifle) { g.updateMatrixWorld(true); rifle.getWorldQuaternion(_q); return v.set(1, 0, 0).applyQuaternion(_q); }
    if (drawn) { g.updateMatrixWorld(true); drawn.getWorldQuaternion(_q); return v.set(0, -1, 0).applyQuaternion(_q); } return v.set(Math.cos(-g.rotation.y), 0, Math.sin(-g.rotation.y)); };
  // world position of a hand (side 1 = right, -1 = left) - grapple rope attaches here
  const handWorld = (v, side = 1) => { g.updateMatrixWorld(true); return arms[side > 0 ? 1 : 0].wr.getWorldPosition(v); };
  // swap the suit kit in place (same rig / meshes): re-point material maps + toggle the kit's hair / gaiter / trims
  const MAPS = { suit: 'suit', suitFront: 'suitFront', gear: 'gear', web: 'web', pouch: 'pouch', pad: 'pad', boot: 'boot', skin: 'skin', hair: 'hair',
    glove: 'glove', sole: 'sole', face: 'face', trim: 'trim', gaiter: 'gaiter', gun: 'gun', blade: 'blade' };
  function setKit(k) {
    if (enemy || !KITS[k]) return kit;
    const TT = textures(k);
    for (const [m, t] of Object.entries(MAPS)) if (M[m] && TT[t]) { M[m].map = TT[t]; M[m].needsUpdate = true; }
    M.headSide.map = KITS[k].hairStyle === 'swept' ? TT.stubble : TT.skin; M.headSide.needsUpdate = true;
    const on = new Set(kitParts[k]);
    for (const list of Object.values(kitParts)) for (const m of list) m.visible = on.has(m);
    kit = k; return kit;
  }
  if (!enemy) setKit(kit);
  return { g, inner, update, materials: M, head: headPivot, muzzleWorld, muzzleDir, handWorld, setKit, get kit() { return kit; } };
}

// enemy head: balaclava (head shape), domed helmet shell + brim + NVG mount, opaque goggles, respirator with twin filters.
function buildEnemyHead(hp, M, headMats, B, G) {
  at(new THREE.Mesh(G.head, headMats), 0.01, 0.13, 0, hp); // balaclava-covered head
  for (const s of [-1, 1]) B.add(hp, G.ear, M.skin, -0.012, 0.125, s * 0.1, { s: [1.1, 1.1, 1.4] }); // covered ears
  B.add(hp, loft([[0.2, 0.152, 0.147, -0.005], [0.255, 0.16, 0.155, -0.005], [0.315, 0.145, 0.14, -0.01], [0.36, 0.11, 0.105, -0.01], [0.39, 0.05, 0.05, -0.01]], 10, [false, true]), M.helmet); // helmet shell
  B.add(hp, band(0.205, 0.022, 0.168, 0.162, 10, 0.004), M.helmet); // brim / rim
  B.add(hp, shaped(0.06, 0.13, 0.27, [1, 2, 2], (v, nx, ny, nz) => { v.z *= 1 - 0.08 * (ny < 0 ? -ny : 0); v.x -= 0.012 * nz * nz; }), M.helmet, -0.12, 0.17, 0); // neck guard
  B.add(hp, boxG(0.03, 0.05, 0.07), M.metal, 0.155, 0.3, 0); B.add(hp, boxG(0.02, 0.02, 0.03), M.gear, 0.172, 0.29, 0); // NVG mount
  for (const s of [-1, 1]) B.add(hp, boxG(0.05, 0.03, 0.02), M.gear, 0.03, 0.26, s * 0.158); // side rails
  B.add(hp, shaped(0.02, 0.055, 0.215, [1, 1, 2], (v, nx, ny, nz) => { v.x -= 0.01 * nz * nz; }), M.gear, 0.118, 0.17, 0); // goggle frame
  for (const z of [-0.05, 0.05]) B.add(hp, boxG(0.025, 0.045, 0.075), M.lens, 0.132, 0.17, z); // lenses (opaque)
  B.add(hp, shaped(0.06, 0.08, 0.09, [1, 2, 2], (v, nx, ny, nz) => { if (nx > 0) v.x += 0.01 * (1 - nz * nz); }), M.pouch, 0.13, 0.055, 0, { r: [0, 0, -0.2] }); // respirator
  const filt = new THREE.CylinderGeometry(0.03, 0.03, 0.04, 6);
  for (const z of [-0.07, 0.07]) B.add(hp, filt, M.gear, 0.13, 0.04, z, { r: [Math.PI / 2, 0, 0.5 * Math.sign(z)] });
  B.add(hp, boxG(0.03, 0.02, 0.24), M.gear, 0.03, 0.2, 0); // chin strap / headset band
}

/** Guard model: same rig + PS1 texture pipeline as the sneaker, enemy kit (fully masked face). */
export function makeEnemy(scene, opts = {}) {
  return makeSneaker(scene, { accent: 0xff3a2a, scale: 0.97, ...opts, kit: 'enemy' });
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
