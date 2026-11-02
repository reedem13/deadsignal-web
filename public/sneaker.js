// Olive "sneaker" player character - procedural low-poly PS1-style rig.
// Built from boxes/cones in a joint hierarchy so it is easy to tweak and cheap on phones (~45 boxes, ~600 tris).
// Textures are tiny (32-64px) CanvasTextures drawn at load with NearestFilter = intentionally crunchy.
// Local axes: forward = +x (matches the game's rotation.y = -angle convention), up = +y, character's right = +z.
// Two kits share the rig: 'player' (olive sneaker, open face) and 'enemy' (slate guard, helmet + balaclava + goggles +
// respirator -> NO face visible). Poses: stand / walk / run / crouch / PRONE (belly-down, commando crawl) / dead.
import * as THREE from 'three';

// ---------------------------------------------------------------- tiny seeded RNG so textures are identical every load
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const hex = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`;
const shade = ([r, g, b], f) => hex(r * f, g * f, b * f);

function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'); x.imageSmoothingEnabled = false; draw(x, size);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
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
const px = (x, c, X, Y, w = 1, h = 1) => { x.fillStyle = c; x.fillRect(X, Y, w, h); };

// colours sampled from the reference sheets
const OLIVE = [104, 114, 74], OLIVE_DK = [80, 90, 58], BLACK = [34, 35, 36], SKIN = [206, 162, 120], HAIR = [42, 34, 28], BOOT = [44, 45, 46];

// enemy (guard) palette: slate fatigues, black kit, gunmetal helmet, black balaclava
const SLATE = [96, 104, 116], SLATE_DK = [64, 70, 82], MASK = [30, 30, 33], HELM = [86, 94, 88];

const TEX = {};
function textures(kit = 'player') {
  if (TEX[kit]) return TEX[kit];
  if (kit === 'enemy') return (TEX.enemy = enemyTextures());
  TEX.player = {
    suit: canvasTex(64, (x, S) => {
      facets(x, S, OLIVE, 11, 5, 0.26);
      const r = rng(5); // darker camo blotches
      for (let i = 0; i < 6; i++) { x.fillStyle = shade(OLIVE_DK, 0.9 + r() * 0.2); x.beginPath();
        const cx = r() * S, cy = r() * S; x.moveTo(cx, cy); for (let k = 0; k < 4; k++) x.lineTo(cx + (r() - 0.5) * 22, cy + (r() - 0.5) * 22); x.fill(); }
    }),
    suitFront: canvasTex(64, (x, S) => { // torso front: zipper + chest seams
      facets(x, S, OLIVE, 23, 5, 0.26);
      px(x, shade(OLIVE_DK, 0.7), 31, 0, 2, S); px(x, shade(OLIVE, 1.25), 31, 0, 1, S);
      for (let y = 2; y < S; y += 4) px(x, shade(OLIVE_DK, 0.55), 32, y, 1, 1);
      px(x, shade(OLIVE_DK, 0.8), 6, 26, 20, 1); px(x, shade(OLIVE_DK, 0.8), 38, 26, 20, 1);
    }),
    gear: canvasTex(32, (x, S) => { // black webbing: dark with stitched edges
      facets(x, S, BLACK, 31, 3, 0.25, 0.06);
      px(x, shade(BLACK, 1.7), 0, 1, S, 1); px(x, shade(BLACK, 1.7), 0, S - 2, S, 1);
      for (let i = 1; i < S; i += 3) { px(x, shade(BLACK, 0.6), i, 3); px(x, shade(BLACK, 0.6), i, S - 4); }
    }),
    pouch: canvasTex(32, (x, S) => { // pouch / radio face: flap line + snap
      facets(x, S, BLACK, 41, 3, 0.3, 0.06);
      px(x, shade(BLACK, 0.5), 2, 11, S - 4, 2); px(x, shade(BLACK, 1.8), 2, 13, S - 4, 1);
      px(x, '#6b6d6e', 14, 8, 4, 4); px(x, '#2a2a2a', 15, 9, 2, 2);
    }),
    pad: canvasTex(32, (x, S) => { facets(x, S, [52, 53, 55], 51, 2, 0.35, 0.05); px(x, '#1c1c1c', 0, 0, S, 2); px(x, '#1c1c1c', 0, S - 2, S, 2); }),
    boot: canvasTex(32, (x, S) => {
      facets(x, S, BOOT, 61, 3, 0.25, 0.06);
      px(x, '#18191a', 0, S - 8, S, 8); for (let i = 0; i < S; i += 4) px(x, '#2e2f30', i, S - 6, 2, 3); // lugged sole
      for (let y = 4; y < S - 10; y += 5) px(x, '#5a5b5c', 10, y, 12, 1); // laces
    }),
    skin: canvasTex(32, (x, S) => facets(x, S, SKIN, 71, 2, 0.16, 0.05)),
    hair: canvasTex(32, (x, S) => {
      facets(x, S, HAIR, 81, 4, 0.4, 0.1);
      const r = rng(9); for (let i = 0; i < 40; i++) px(x, shade(HAIR, 0.5 + r() * 0.9), r() * S | 0, r() * S | 0, 1, 2 + (r() * 4 | 0));
    }),
    face: canvasTex(32, (x, S) => { // front of head: fringe, brows, eyes, nose shadow, mouth (stern sneaker look)
      facets(x, S, SKIN, 91, 2, 0.14, 0.05);
      px(x, shade(HAIR, 1), 0, 0, S, 5); for (let i = 0; i < S; i += 3) px(x, shade(HAIR, 1.1), i, 5, 2, 1 + ((i * 7) % 4)); // spiky fringe
      px(x, shade(SKIN, 0.82), 0, 13, 7, 9); px(x, shade(SKIN, 0.82), 25, 13, 7, 9); // cheek shading
      px(x, '#2b211b', 6, 11, 8, 2); px(x, '#2b211b', 18, 11, 8, 2); // brows (angled)
      px(x, '#2b211b', 12, 12, 2, 1); px(x, '#2b211b', 18, 12, 2, 1);
      px(x, '#e8dcc8', 8, 14, 5, 2); px(x, '#e8dcc8', 19, 14, 5, 2); // eyes
      px(x, '#1d2a30', 10, 14, 2, 2); px(x, '#1d2a30', 20, 14, 2, 2);
      px(x, shade(SKIN, 0.72), 15, 15, 2, 6); px(x, shade(SKIN, 0.62), 14, 20, 4, 1); // nose
      px(x, '#7a4e3c', 12, 24, 8, 1); px(x, shade(SKIN, 0.85), 11, 27, 10, 2); // mouth + chin shadow
    }),
    glove: canvasTex(32, (x, S) => { // fingerless glove: black with skin finger tips at the bottom
      facets(x, S, BLACK, 101, 3, 0.25, 0.06);
      px(x, shade(SKIN, 1), 0, S - 9, S, 9); for (let i = 0; i < S; i += 8) px(x, shade(SKIN, 0.7), i, S - 9, 1, 9);
    }),
  };
  return TEX.player;
}

function enemyTextures() {
  return {
    suit: canvasTex(64, (x, S) => { // slate urban camo: facets + dark angular blotches + a few light chips
      facets(x, S, SLATE, 211, 5, 0.24);
      const r = rng(17);
      for (let i = 0; i < 7; i++) { x.fillStyle = shade(SLATE_DK, 0.85 + r() * 0.2); x.beginPath();
        const cx = r() * S, cy = r() * S; x.moveTo(cx, cy); for (let k = 0; k < 4; k++) x.lineTo(cx + (r() - 0.5) * 20, cy + (r() - 0.5) * 20); x.fill(); }
      for (let i = 0; i < 10; i++) px(x, shade(SLATE, 1.3), r() * S | 0, r() * S | 0, 2, 1);
    }),
    suitFront: canvasTex(64, (x, S) => { // armoured vest front: plate outline + magazine pouch row
      facets(x, S, SLATE, 223, 5, 0.24);
      px(x, shade(MASK, 1.2), 8, 4, 48, 40); // vest plate
      px(x, shade(MASK, 1.6), 8, 4, 48, 1); px(x, shade(MASK, 1.6), 8, 43, 48, 1);
      for (let i = 0; i < 3; i++) { px(x, shade(MASK, 0.8), 12 + i * 14, 24, 11, 16); px(x, shade(MASK, 1.9), 12 + i * 14, 24, 11, 1); }
      px(x, '#7a1414', 28, 8, 8, 4); // red unit tab
    }),
    gear: canvasTex(32, (x, S) => {
      facets(x, S, [28, 29, 31], 231, 3, 0.25, 0.06);
      px(x, shade(MASK, 1.8), 0, 1, S, 1); px(x, shade(MASK, 1.8), 0, S - 2, S, 1);
      for (let i = 1; i < S; i += 3) { px(x, shade(MASK, 0.6), i, 3); px(x, shade(MASK, 0.6), i, S - 4); }
    }),
    pouch: canvasTex(32, (x, S) => {
      facets(x, S, [32, 33, 35], 241, 3, 0.3, 0.06);
      px(x, shade(MASK, 0.5), 2, 11, S - 4, 2); px(x, shade(MASK, 1.9), 2, 13, S - 4, 1);
      px(x, '#5b5e62', 14, 8, 4, 4);
    }),
    pad: canvasTex(32, (x, S) => { facets(x, S, [44, 46, 50], 251, 2, 0.35, 0.05); px(x, '#151515', 0, 0, S, 2); px(x, '#151515', 0, S - 2, S, 2); }),
    boot: canvasTex(32, (x, S) => {
      facets(x, S, [36, 36, 38], 261, 3, 0.25, 0.06);
      px(x, '#141415', 0, S - 8, S, 8); for (let i = 0; i < S; i += 4) px(x, '#29292a', i, S - 6, 2, 3);
      for (let y = 4; y < S - 10; y += 5) px(x, '#4a4b4c', 10, y, 12, 1);
    }),
    // "skin" slot = balaclava knit (neck, sides/back of head) so no skin shows anywhere
    skin: canvasTex(32, (x, S) => { facets(x, S, MASK, 271, 3, 0.2, 0.1); for (let y = 1; y < S; y += 3) px(x, shade(MASK, 0.7), 0, y, S, 1); }),
    hair: canvasTex(32, (x, S) => facets(x, S, MASK, 281, 3, 0.2, 0.1)),
    // front of head: fully masked. knit balaclava, goggle strap band, respirator seat - no eyes/nose/mouth
    face: canvasTex(32, (x, S) => {
      facets(x, S, MASK, 291, 3, 0.18, 0.1);
      for (let y = 1; y < S; y += 3) px(x, shade(MASK, 0.75), 0, y, S, 1); // knit rows
      px(x, '#141416', 0, 10, S, 9); // goggle gasket band
      px(x, '#3a3c40', 0, 10, S, 1); px(x, '#3a3c40', 0, 18, S, 1);
      px(x, '#3d3f42', 9, 21, 14, 10); px(x, '#56595d', 10, 22, 12, 1); // respirator seat
      for (let i = 0; i < 4; i++) px(x, '#1a1b1d', 11 + i * 3, 25, 2, 5);
    }),
    glove: canvasTex(32, (x, S) => { facets(x, S, [26, 27, 29], 301, 3, 0.25, 0.06); for (let i = 0; i < S; i += 8) px(x, '#3a3b3d', i, S - 9, 1, 9); }),
    helmet: canvasTex(32, (x, S) => {
      facets(x, S, HELM, 311, 3, 0.3, 0.08);
      const r = rng(31); for (let i = 0; i < 14; i++) px(x, shade(HELM, 0.6 + r() * 0.3), r() * S | 0, r() * S | 0, 2, 1); // scuffs
      px(x, shade(HELM, 0.55), 0, S - 3, S, 3); // rim shadow
    }),
    lens: canvasTex(16, (x, S) => { // opaque mirrored lens, red glint - nothing behind it shows
      x.fillStyle = '#1a0606'; x.fillRect(0, 0, S, S); x.fillStyle = '#5a1010'; x.fillRect(0, 0, S, S / 2);
      px(x, '#ff6a4a', 3, 3, 3, 2); px(x, '#ffd0b0', 4, 3, 1, 1);
    }),
  };
}

// ---------------------------------------------------------------- build helpers
function box(w, h, d, m) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); }
function at(mesh, x, y, z, parent) { mesh.position.set(x, y, z); parent.add(mesh); return mesh; }
function pivot(parent, x, y, z) { const p = new THREE.Group(); p.position.set(x, y, z); parent.add(p); return p; }

// leg / arm lengths used by the pose solver
const THIGH = 0.42, SHIN = 0.4, ANKLE = 0.1, HIP_Y = THIGH + SHIN + ANKLE; // 0.92

/**
 * Build one sneaker. opts.accent = hex colour for P1/P2 accents (shoulder patch, radio LED, marker),
 * opts.tint = optional subtle suit tint. Returns { g, inner, update(dt, state) }.
 */
export function makeSneaker(scene, opts = {}) {
  const enemy = opts.kit === 'enemy';
  const T = textures(enemy ? 'enemy' : 'player');
  const L = (map, color = 0xffffff) => new THREE.MeshLambertMaterial({ map, color, flatShading: true });
  const suitTint = opts.tint ?? 0xffffff;
  const M = {
    suit: L(T.suit, suitTint), gear: L(T.gear), pouch: L(T.pouch), pad: L(T.pad), boot: L(T.boot),
    skin: L(T.skin), hair: L(T.hair), glove: L(T.glove),
    metal: new THREE.MeshLambertMaterial({ color: 0x6b6d6e, flatShading: true }),
    accent: new THREE.MeshBasicMaterial({ color: opts.accent ?? 0x6fb0ff }),
    patch: new THREE.MeshLambertMaterial({ color: new THREE.Color(opts.accent ?? 0x6fb0ff).multiplyScalar(0.55), flatShading: true }),
  };
  if (enemy) { M.helmet = L(T.helmet); M.lens = new THREE.MeshBasicMaterial({ map: T.lens }); }
  const suitFrontMat = L(T.suitFront, suitTint);
  // box face order: +x(front) -x(back) +y -y +z(right) -z(left)
  const torsoMats = [suitFrontMat, M.suit, M.suit, M.suit, M.suit, M.suit];
  const headMats = [L(T.face), M.skin, M.hair, M.skin, M.skin, M.skin];

  const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner);
  const rig = new THREE.Group(); rig.scale.setScalar(opts.scale ?? 0.93); inner.add(rig);

  // --- hips (root of the skeleton)
  const hips = pivot(rig, 0, HIP_Y, 0);
  at(box(0.24, 0.18, 0.4, M.suit), 0, -0.02, 0, hips);
  // belt + pouches + buckle
  at(box(0.28, 0.08, 0.44, M.gear), 0, 0.07, 0, hips);
  at(box(0.03, 0.06, 0.08, M.metal), 0.145, 0.07, 0, hips);
  for (const z of [-0.16, -0.08, 0.08, 0.16]) at(box(0.06, 0.1, 0.07, M.pouch), 0.15, 0.05, z, hips);
  at(box(0.07, 0.1, 0.08, M.pouch), -0.15, 0.05, 0.12, hips);

  // --- legs
  const legs = [];
  for (const side of [-1, 1]) { // -1 = left (-z), 1 = right (+z)
    const hip = pivot(hips, 0, -0.04, side * 0.11);
    at(box(0.21, THIGH, 0.19, M.suit), 0, -THIGH / 2, 0, hip);
    if (side === 1) { // thigh holster with two straps on the right leg
      at(box(0.14, 0.2, 0.06, M.pouch), 0.01, -0.2, 0.12, hip);
      at(box(0.06, 0.28, 0.04, M.gear), 0.02, -0.12, 0.15, hip);
      at(box(0.22, 0.04, 0.21, M.gear), 0, -0.14, 0, hip); at(box(0.22, 0.04, 0.21, M.gear), 0, -0.3, 0, hip);
    }
    const knee = pivot(hip, 0, -THIGH, 0);
    at(box(0.18, SHIN, 0.17, M.suit), 0, -SHIN / 2, 0, knee);
    at(box(0.07, 0.15, 0.17, M.pad), 0.1, -0.04, 0, knee); // knee pad
    at(box(0.19, 0.06, 0.18, M.suit), 0, -SHIN + 0.04, 0, knee); // trouser cuff over boot
    const ankle = pivot(knee, 0, -SHIN, 0);
    at(box(0.19, 0.16, 0.17, M.boot), 0, -0.02, 0, ankle); // boot shaft
    at(box(0.3, 0.09, 0.18, M.boot), 0.05, -ANKLE + 0.045, 0, ankle); // boot foot
    legs.push({ hip, knee, ankle, side });
  }

  // --- torso (pivot at waist so it can lean)
  const torso = pivot(hips, 0, 0.08, 0);
  at(box(0.26, 0.24, 0.4, torsoMats), 0, 0.12, 0, torso); // abdomen
  at(box(0.28, 0.24, 0.46, torsoMats), 0, 0.34, 0, torso); // chest (broader)
  at(box(0.2, 0.08, 0.2, M.suit), 0.01, 0.49, 0, torso); // high collar
  // harness: two shoulder straps front + back, chest strap, buckles
  for (const z of [-0.11, 0.11]) {
    at(box(0.02, 0.44, 0.05, M.gear), 0.145, 0.24, z, torso);
    at(box(0.02, 0.44, 0.05, M.gear), -0.145, 0.24, z, torso);
    at(box(0.3, 0.02, 0.05, M.gear), 0, 0.465, z, torso);
    at(box(0.025, 0.04, 0.04, M.metal), 0.155, 0.3, z, torso);
  }
  at(box(0.02, 0.04, 0.3, M.gear), 0.15, 0.36, 0, torso);
  at(box(0.02, 0.18, 0.1, M.gear), -0.15, 0.3, 0, torso); // back X-panel
  // chest radio on the right strap + antenna + LED (P1/P2 accent)
  at(box(0.06, 0.14, 0.09, M.pouch), 0.17, 0.33, 0.13, torso);
  const ant = at(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 3), M.gear), 0.17, 0.48, 0.16, torso);
  at(box(0.012, 0.025, 0.025, M.accent), 0.2, 0.37, 0.11, torso);
  at(box(0.025, 0.025, 0.025, M.accent), 0, 0.08, 0, ant);

  // --- head
  const neck = pivot(torso, 0.01, 0.52, 0);
  at(box(0.09, 0.06, 0.1, M.skin), 0, 0.0, 0, neck);
  const headPivot = pivot(neck, 0, 0.03, 0);
  if (enemy) buildEnemyHead(headPivot, M, headMats);
  else {
    at(box(0.22, 0.26, 0.2, headMats), 0.01, 0.13, 0, headPivot);
    at(box(0.03, 0.06, 0.03, M.skin), -0.01, 0.12, 0.11, headPivot); at(box(0.03, 0.06, 0.03, M.skin), -0.01, 0.12, -0.11, headPivot); // ears
    at(box(0.22, 0.06, 0.22, M.hair), 0.0, 0.27, 0, headPivot); // hair cap
    at(box(0.05, 0.16, 0.22, M.hair), -0.1, 0.17, 0, headPivot); // back of hair
    const spike = new THREE.ConeGeometry(0.05, 0.12, 4);
    const r = rng(77);
    for (let i = 0; i < 9; i++) { // short spiky hair: random-ish tilted 4-sided cones
      const s = at(new THREE.Mesh(spike, M.hair), -0.08 + (i % 3) * 0.075 + (r() - 0.5) * 0.02, 0.31, -0.075 + Math.floor(i / 3) * 0.075, headPivot);
      s.rotation.set((r() - 0.5) * 0.9, r() * 3, -0.5 + (r() - 0.5) * 0.6); s.scale.setScalar(0.8 + r() * 0.5);
    }
    for (let i = 0; i < 4; i++) { const s = at(new THREE.Mesh(spike, M.hair), 0.11, 0.26, -0.075 + i * 0.05, headPivot); s.rotation.set(0, 0, -1.2); s.scale.setScalar(0.6); }
  }

  // --- arms
  const arms = [];
  for (const side of [-1, 1]) {
    const sh = pivot(torso, 0, 0.42, side * 0.28);
    at(box(0.17, 0.12, 0.13, M.suit), 0, -0.02, 0, sh); // shoulder cap
    at(box(0.13, 0.3, 0.12, M.suit), 0, -0.17, 0, sh);
    at(box(0.08, 0.08, 0.02, M.patch), 0, -0.1, side * 0.065, sh); // sleeve patch (P1/P2 accent)
    const el = pivot(sh, 0, -0.32, 0);
    at(box(0.12, 0.26, 0.11, M.suit), 0, -0.12, 0, el);
    at(box(0.13, 0.06, 0.12, M.gear), 0, -0.24, 0, el); // glove cuff
    const wr = pivot(el, 0, -0.27, 0);
    at(box(0.11, 0.12, 0.08, M.glove), 0.01, -0.06, 0, wr);
    at(box(0.04, 0.05, 0.03, M.glove), 0.05, -0.03, -side * 0.04, wr); // thumb
    arms.push({ sh, el, wr, side });
  }

  if (enemy) { // slung carbine across the vest (low-poly: receiver, barrel, mag, stock)
    const rifle = pivot(torso, 0.19, 0.28, 0); rifle.rotation.x = 0.75;
    at(box(0.05, 0.07, 0.36, M.gear), 0, 0, 0, rifle);
    at(box(0.025, 0.025, 0.2, M.metal), 0, 0.01, 0.27, rifle);
    at(box(0.04, 0.11, 0.05, M.pouch), 0, -0.08, 0.06, rifle);
    at(box(0.04, 0.07, 0.14, M.gear), 0, -0.01, -0.24, rifle);
    at(box(0.03, 0.03, 0.06, M.metal), 0, 0.055, 0.02, rifle); // optic
  }

  scene.add(g);

  // ---------------------------------------------------------------- pose / animation
  const legIK = (t, h) => { // knee angle so that the foot sole is on the ground when hip is at height h (foot kept flat)
    const c = clamp((h - ANKLE - THIGH * Math.cos(t)) / SHIN, -1, 1);
    return -Math.acos(c) - t;
  };
  let phase = 0, crouchK = 0, moveK = 0, runK = 0, deadK = 0, proneK = 0;
  const mix = (a, b, k) => a + (b - a) * k;
  function update(dt, s) {
    const lerp = (a, b, k) => a + (b - a) * Math.min(1, k * dt);
    crouchK = lerp(crouchK, s.crouch && !s.prone ? 1 : 0, 10);
    proneK = lerp(proneK, s.prone && !s.dead ? 1 : 0, 6);
    moveK = lerp(moveK, s.moving && !s.dead ? 1 : 0, 10);
    runK = lerp(runK, s.run ? 1 : 0, 6);
    deadK = lerp(deadK, s.dead ? 1 : 0, 6);
    const stride = s.prone ? 4.2 : s.crouch ? 6.5 : s.run ? 11 : 8.5;
    phase += dt * stride * moveK;
    const sw = Math.sin(phase), cw = Math.cos(phase), t = performance.now() / 1000;

    // hip height: stand 0.92 -> crouch 0.56, small bob while walking
    const bob = moveK * (0.02 + runK * 0.03) * Math.abs(cw);
    hips.position.y = HIP_Y - crouchK * 0.26 - bob + (1 - moveK) * Math.sin(t * 2) * 0.004;
    hips.rotation.y = moveK * sw * 0.12;
    const h = hips.position.y - 0.04; // hip joints sit 4cm below the hips pivot
    // torso: upright -> lean forward in crouch / run (negative z = forward)
    torso.rotation.z = -(crouchK * 0.6 + runK * moveK * 0.25 + moveK * 0.05);
    torso.rotation.y = -hips.rotation.y * 1.3;
    headPivot.rotation.z = crouchK * 0.45 + runK * moveK * 0.2; // keep eyes on the horizon
    // legs: crouch base pose (front/back stagger like the crouch ref) + walk swing, IK keeps feet planted-ish
    for (const lg of legs) {
      const ph = lg.side === 1 ? 0 : Math.PI;
      const swing = Math.sin(phase + ph) * moveK * (0.35 + runK * 0.25 - crouchK * 0.15);
      const base = crouchK * (lg.side === -1 ? 0.95 : -0.5); // left leg forward, right leg back (lunge)
      const th = base + swing;
      let kn = legIK(th, h);
      const lift = Math.max(0, Math.cos(phase + ph)) * moveK * (0.5 + runK * 0.6); // bend knee on the swing-through
      kn -= lift;
      lg.hip.rotation.z = th; lg.knee.rotation.z = kn; lg.ankle.rotation.z = -(th + kn) - lift * 0.4;
      lg.hip.rotation.x = -lg.side * crouchK * 0.08;
    }
    // arms: relaxed at sides, swing opposite to legs; crouch = forearms up in a ready guard like the ref
    for (const a of arms) {
      const ph = a.side === 1 ? Math.PI : 0;
      const swing = Math.sin(phase + ph) * moveK * (0.4 + runK * 0.4) * (1 - crouchK * 0.6);
      a.sh.rotation.z = swing + crouchK * (a.side === -1 ? 0.9 : 0.35) + runK * moveK * 0.2;
      a.sh.rotation.x = -a.side * (0.1 + crouchK * 0.15);
      a.el.rotation.z = 0.15 + crouchK * (a.side === -1 ? 1.3 : 1.0) + runK * moveK * 1.0 + moveK * 0.2;
      a.wr.rotation.z = crouchK * -0.2;
    }
    // PRONE: blend every joint toward a belly-down pose, then lay the whole rig flat (head forward along +x).
    // Commando crawl while moving: one knee drawn up and out to the side while the opposite arm reaches forward.
    const pk = proneK;
    if (pk > 0.001) {
      const crawl = moveK * pk, cs = Math.sin(phase);
      hips.position.y = mix(hips.position.y, HIP_Y, pk);
      hips.rotation.y = mix(hips.rotation.y, 0, pk);
      hips.rotation.x = crawl * cs * 0.12; // hips roll side to side
      torso.rotation.z = mix(torso.rotation.z, 0.14, pk); // chest propped up a little on the elbows
      torso.rotation.y = mix(torso.rotation.y, crawl * cs * 0.1, pk);
      torso.rotation.x = -crawl * cs * 0.08;
      headPivot.rotation.z = mix(headPivot.rotation.z, 1.2, pk); // chin up, eyes forward
      for (const lg of legs) {
        const draw = 0.12 + crawl * Math.max(0, lg.side * cs) * 1.1; // 0 = straight leg, 1 = knee pulled up beside the hip
        lg.hip.rotation.z = mix(lg.hip.rotation.z, 0.05, pk);
        lg.knee.rotation.z = mix(lg.knee.rotation.z, 0, pk);
        lg.ankle.rotation.z = mix(lg.ankle.rotation.z, -1.1, pk); // toes dug in
        lg.hip.rotation.x = mix(lg.hip.rotation.x, -lg.side * 1.25 * draw, pk);
        lg.knee.rotation.x = mix(0, lg.side * 1.5 * draw, pk);
      }
      for (const a of arms) {
        const reach = crawl * Math.max(0, -a.side * cs); // opposite arm to the drawn knee reaches forward
        a.sh.rotation.z = mix(a.sh.rotation.z, 0, pk);
        a.el.rotation.z = mix(a.el.rotation.z, 0, pk);
        a.wr.rotation.z = mix(a.wr.rotation.z, 0, pk);
        a.sh.rotation.x = mix(a.sh.rotation.x, -a.side * (1.3 + 1.3 * reach), pk); // elbows out to the sides
        a.el.rotation.x = mix(0, -a.side * 1.8 * (1 - reach), pk); // forearms forward, hands near the head
      }
    } else {
      hips.rotation.x = 0; torso.rotation.x = 0;
      for (const lg of legs) lg.knee.rotation.x = 0;
      for (const a of arms) a.el.rotation.x = 0;
    }
    // lay flat (prone) / topple forward (death, game-over screen). Rig pivots at the feet, so shift it back to stay centred.
    const flat = Math.max(deadK, pk);
    inner.rotation.z = -flat * Math.PI / 2;
    inner.position.y = mix(deadK * 0.16, 0.14, pk);
    inner.position.x = mix(deadK * 0.1, -0.78, pk);
  }
  update(0, {});
  return { g, inner, update, materials: M, head: headPivot };
}

// enemy head: balaclava (head box), helmet shell + brim + NVG mount, opaque goggles, respirator with twin filters.
function buildEnemyHead(hp, M, headMats) {
  at(box(0.22, 0.26, 0.2, headMats), 0.01, 0.13, 0, hp); // balaclava-covered head
  at(box(0.04, 0.07, 0.04, M.skin), -0.01, 0.12, 0.11, hp); at(box(0.04, 0.07, 0.04, M.skin), -0.01, 0.12, -0.11, hp); // covered ears
  at(box(0.27, 0.13, 0.26, M.helmet), 0.0, 0.29, 0, hp); // helmet shell
  at(box(0.2, 0.05, 0.2, M.helmet), -0.005, 0.375, 0, hp); // crown
  at(box(0.3, 0.025, 0.29, M.helmet), 0.01, 0.225, 0, hp); // brim
  at(box(0.06, 0.13, 0.27, M.helmet), -0.12, 0.17, 0, hp); // neck guard
  at(box(0.03, 0.05, 0.07, M.metal), 0.145, 0.3, 0, hp); // NVG mount
  at(box(0.02, 0.055, 0.215, M.gear), 0.115, 0.17, 0, hp); // goggle frame
  for (const z of [-0.05, 0.05]) at(box(0.025, 0.045, 0.075, M.lens), 0.13, 0.17, z, hp); // lenses (opaque)
  const resp = at(box(0.06, 0.08, 0.09, M.pouch), 0.13, 0.055, 0, hp); // respirator
  resp.rotation.z = -0.2;
  const filt = new THREE.CylinderGeometry(0.03, 0.03, 0.04, 6);
  for (const z of [-0.07, 0.07]) { const f = at(new THREE.Mesh(filt, M.gear), 0.13, 0.04, z, hp); f.rotation.set(Math.PI / 2, 0, 0.5 * Math.sign(z)); }
  at(box(0.03, 0.02, 0.24, M.gear), 0.03, 0.2, 0, hp); // chin strap / headset band
}

/** Guard model: same rig + PS1 texture pipeline as the sneaker, enemy kit (fully masked face). */
export function makeEnemy(scene, opts = {}) {
  return makeSneaker(scene, { accent: 0xff3a2a, scale: 0.97, ...opts, kit: 'enemy' });
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
