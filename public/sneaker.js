// Olive "sneaker" player character - procedural low-poly PS1-style rig.
// Built from boxes/cones in a joint hierarchy so it is easy to tweak and cheap on phones (~45 boxes, ~600 tris).
// Textures are tiny (32-64px) CanvasTextures drawn at load with NearestFilter = intentionally crunchy.
// Local axes: forward = +x (matches the game's rotation.y = -angle convention), up = +y, character's right = +z.
// Two kits share the rig: 'player' (olive sneaker, open face) and 'enemy' (slate guard, helmet + balaclava + goggles +
// respirator -> NO face visible). Poses: stand / walk / run / crouch / PRONE (belly-down, commando crawl) / dead.
// Combat overlays (layered on top of the base pose): armed (s.armed: pistol out of the holster, carried low-ready in the
// right hand; false = holstered on the thigh), aim (handgun up, two-hand grip, recoil on s.shot change),
// takedown (attacker: choke hold from behind + knife jabs, s.takedown = 0..1 progress) and held (victim: head back,
// clawing at the arm, knees buckle, s.held = 0..1 progress -> then dead).
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
    gun: canvasTex(16, (x, S) => { // gunmetal: dark slide with serration ticks + a lighter top edge
      facets(x, S, [40, 42, 46], 121, 2, 0.3, 0.08);
      px(x, '#6a6e74', 0, 0, S, 1); for (let i = 2; i < S; i += 3) px(x, '#1a1b1d', i, 3, 1, 4);
      px(x, '#24262a', 0, S - 4, S, 4);
    }),
    blade: canvasTex(16, (x, S) => { facets(x, S, [150, 156, 160], 131, 2, 0.35, 0.06); px(x, '#e8eef0', 0, 0, S, 2); px(x, '#5a5e60', 0, S - 2, S, 2); }),
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
  else { M.gun = L(T.gun); M.blade = L(T.blade); }
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
  let holstered = null;
  for (const side of [-1, 1]) { // -1 = left (-z), 1 = right (+z)
    const hip = pivot(hips, 0, -0.04, side * 0.11);
    at(box(0.21, THIGH, 0.19, M.suit), 0, -THIGH / 2, 0, hip);
    if (side === 1) { // thigh holster with two straps on the right leg
      at(box(0.14, 0.2, 0.06, M.pouch), 0.01, -0.2, 0.12, hip);
      at(box(0.06, 0.28, 0.04, M.gear), 0.02, -0.12, 0.15, hip);
      at(box(0.22, 0.04, 0.21, M.gear), 0, -0.14, 0, hip); at(box(0.22, 0.04, 0.21, M.gear), 0, -0.3, 0, hip);
      if (!enemy) { // holstered pistol: slide sunk in the holster, grip + hammer sticking out the top, angled back
        holstered = pivot(hip, 0.0, -0.08, 0.15);
        at(box(0.05, 0.2, 0.035, M.gun), 0.02, -0.08, 0, holstered); // slide (mostly inside the holster)
        const grip = at(box(0.1, 0.05, 0.04, M.gun), -0.04, 0.02, 0, holstered); grip.rotation.z = -0.25;
        at(box(0.03, 0.03, 0.03, M.gear), 0.02, 0.035, 0, holstered); // hammer / rear sight
      }
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
  // right hand props (player kit). Wrist-local: -y = along the forearm (barrel / blade direction), -x = "down" when aiming.
  let drawn = null, knife = null, flash = null;
  if (!enemy) {
    const wr = arms[1].wr;
    drawn = pivot(wr, 0, 0, 0);
    at(box(0.05, 0.22, 0.04, M.gun), 0.035, -0.13, 0, drawn); // slide + barrel, runs past the fist
    at(box(0.1, 0.05, 0.04, M.gun), -0.02, -0.07, 0, drawn).rotation.z = 0.2; // grip in the fist, raked back
    at(box(0.03, 0.06, 0.035, M.gear), -0.005, -0.13, 0, drawn); // trigger guard / frame
    at(box(0.015, 0.02, 0.015, M.metal), 0.065, -0.21, 0, drawn); // front sight
    at(box(0.07, 0.03, 0.03, M.gear), -0.075, -0.07, 0, drawn); // magazine base
    flash = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), new THREE.MeshBasicMaterial({ color: 0xffe080, transparent: true, opacity: 0.95, depthWrite: false }));
    flash.position.set(0.035, -0.3, 0); flash.scale.set(0.8, 1.6, 0.8); drawn.add(flash); flash.visible = false;
    knife = pivot(wr, 0, 0, 0);
    at(box(0.04, 0.06, 0.035, M.gear), 0.0, -0.1, 0, knife); // handle in the fist
    at(box(0.025, 0.04, 0.05, M.metal), 0.0, -0.14, 0, knife); // guard
    at(box(0.012, 0.2, 0.035, M.blade), 0.0, -0.26, 0, knife); // blade
    drawn.visible = knife.visible = false;
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
  // Blend weights use critically-damped springs (SmoothDamp) instead of plain exponential lerps: transitions ease in AND
  // out, so stance changes / starts / stops roll through instead of popping. Gait phase is distance-driven
  // (radians per metre), so feet don't skate while the body speeds up or coasts to a stop.
  const K = (smooth) => ({ x: 0, v: 0, smooth });
  const W = { crouch: K(0.13), prone: K(0.24), move: K(0.11), run: K(0.2), dead: K(0.22), spd: K(0.12), lean: K(0.16), roll: K(0.14), idle: K(0.4),
    aim: K(0.07), td: K(0.08), held: K(0.06), armed: K(0.1) };
  let phase = 0, prevSpd = 0, prevYaw = null, lastShot = 0, recoil = 0, flashT = 0;
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
    if (s.shot && s.shot !== lastShot) { recoil = 1; flashT = 0.07; lastShot = s.shot; }
    recoil = Math.max(0, recoil - dt * 7); flashT = Math.max(0, flashT - dt);
    // takedown: attacker sinks into a braced half-crouch; victim's knees give out as the hold finishes
    crouchK = Math.max(crouchK, tdK * 0.45, heldK * sstep((heldP - 0.45) / 0.55) * 0.8);
    const proneK = sstep(damp(W.prone, s.prone && !s.dead ? 1 : 0, dt));
    const deadK = sstep(damp(W.dead, s.dead ? 1 : 0, dt));
    // gait amplitude ramps up with speed (momentum: first steps are short, full stride only at cruising speed)
    const ref = s.prone ? 0.7 : s.crouch ? 1.2 : 2.2;
    const moveK = clamp(damp(W.move, s.dead ? 0 : sstep(spd / ref), dt), 0, 1);
    const runTarget = s.crouch || s.prone ? 0 : s.speed != null ? sstep((spd - 3.5) / 1.4) : (s.run ? 1 : 0);
    const runK = clamp(damp(W.run, runTarget, dt), 0, 1);
    // stride length: radians of gait phase per metre travelled (walk 2.65, run 2.1, crouch 3.6, prone crawl 3.8)
    const radPerM = mix(mix(mix(2.65, 2.1, runK), 3.6, crouchK), 3.8, proneK);
    phase += dt * Math.max(spd, moveK * 0.4) * radPerM;
    const sw = Math.sin(phase), t = performance.now() / 1000;
    // body reacts to momentum: lean into acceleration, rock back when braking, bank into turns
    const acc = dt > 0 ? (spd - prevSpd) / dt : 0; prevSpd = spd;
    const lean = damp(W.lean, clamp(acc * 0.018, -0.1, 0.12) * (1 - proneK), dt);
    const yaw = g.rotation.y; let yawRate = 0;
    if (prevYaw !== null && dt > 0) { let d = yaw - prevYaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; yawRate = d / dt; }
    prevYaw = yaw;
    const roll = damp(W.roll, clamp(-yawRate * spd * 0.012, -0.12, 0.12) * (1 - proneK), dt);
    const idle = damp(W.idle, 1 - moveK, dt) * (1 - deadK);
    const breathe = Math.sin(t * 1.7) * idle, sway = Math.sin(t * 0.55) * idle;

    // hip height: stand 0.92 -> crouch 0.56. Bob is lowest at full stride (sin^2), smooth instead of the old |cos| cusp.
    const bob = moveK * (0.022 + runK * 0.03) * sw * sw;
    hips.position.y = HIP_Y - crouchK * 0.26 - bob + breathe * 0.005;
    hips.position.z = moveK * Math.sin(phase - 0.4) * 0.022 * (1 - runK * 0.5) + sway * 0.012; // weight shift over the stance leg
    hips.rotation.y = moveK * Math.sin(phase - 0.15) * 0.12;
    const h = hips.position.y - 0.04; // hip joints sit 4cm below the hips pivot
    // torso: upright -> lean forward in crouch / run (negative z = forward), plus the momentum lean
    torso.rotation.z = -(crouchK * 0.6 + runK * moveK * 0.25 + moveK * 0.05 + lean) - breathe * 0.012;
    torso.rotation.y = -hips.rotation.y * 1.3;
    torso.rotation.x = -roll * 0.3 + sway * 0.015;
    // head: keep eyes on the horizon, slightly lagged so it settles rather than snaps
    headPivot.rotation.z = crouchK * 0.45 + runK * moveK * 0.2 + lean * 0.8;
    headPivot.rotation.y = -torso.rotation.y * 0.5 + sway * 0.06;
    // legs: crouch base pose (front/back stagger like the crouch ref) + walk swing, IK keeps feet planted-ish
    for (const lg of legs) {
      const ph = lg.side === 1 ? 0 : Math.PI;
      const swing = Math.sin(phase + ph) * moveK * (0.35 + runK * 0.25 - crouchK * 0.15);
      const base = crouchK * (lg.side === -1 ? 0.95 : -0.5); // left leg forward, right leg back (lunge)
      const th = base + swing;
      let kn = legIK(th, h);
      const up = Math.max(0, Math.cos(phase + ph)), liftS = up * up * (3 - 2 * up); // eased swing-through (no kink at contact)
      const lift = liftS * moveK * (0.5 + runK * 0.6);
      kn -= lift;
      lg.hip.rotation.z = th; lg.knee.rotation.z = kn; lg.ankle.rotation.z = -(th + kn) - lift * 0.4;
      lg.hip.rotation.x = -lg.side * crouchK * 0.08;
    }
    // arms: relaxed at sides, swing opposite to legs with a little follow-through lag; crouch = forearms up in a ready guard
    for (const a of arms) {
      const ph = a.side === 1 ? Math.PI : 0;
      const swing = Math.sin(phase + ph - 0.3) * moveK * (0.4 + runK * 0.4) * (1 - crouchK * 0.6);
      a.sh.rotation.z = swing + crouchK * (a.side === -1 ? 0.9 : 0.35) + runK * moveK * 0.2 + breathe * 0.02;
      a.sh.rotation.x = -a.side * (0.1 + crouchK * 0.15 + breathe * 0.015) + roll * 0.5;
      a.el.rotation.z = 0.15 + crouchK * (a.side === -1 ? 1.3 : 1.0) + runK * moveK * 1.0 + moveK * 0.2 + Math.max(0, swing) * 0.35;
      a.wr.rotation.z = crouchK * -0.2;
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
    // ---- LOW READY (pistol drawn, not aiming): right forearm brought forward, muzzle angled at the floor ahead.
    // Fades out when prone (crawl arms win) and under the full aim pose.
    const readyK = armK * (1 - pk) * (1 - aimK);
    if (readyK > 0.001) {
      const Rr = arms[1], k = readyK;
      Rr.sh.rotation.z = mix(Rr.sh.rotation.z, 0.38 + Rr.sh.rotation.z * 0.25, k); Rr.sh.rotation.x = mix(Rr.sh.rotation.x, 0.1, k);
      Rr.el.rotation.z = mix(Rr.el.rotation.z, 0.75, k); Rr.el.rotation.x = mix(Rr.el.rotation.x, 0, k);
      Rr.wr.rotation.z = mix(Rr.wr.rotation.z, 0.15, k);
    }
    // ---- HANDGUN AIM: right arm straight out along the facing, left hand cups the grip (Weaver-ish). Compensates the
    // torso lean so the barrel stays level in crouch. Prone: arm reaches forward past the head (rig is laid on its front).
    if (aimK > 0.001) {
      const [L, Rr] = arms, k = aimK, up = -torso.rotation.z + recoil * 0.3;
      const aimZ = mix(Math.PI / 2 + up, Math.PI - 0.15 - 0.14, pk), aimX = 0;
      Rr.sh.rotation.z = mix(Rr.sh.rotation.z, aimZ, k); Rr.sh.rotation.y = mix(0, 0.32 * (1 - pk), k); Rr.sh.rotation.x = mix(Rr.sh.rotation.x, aimX, k);
      Rr.el.rotation.z = mix(Rr.el.rotation.z, 0.04 + recoil * 0.35, k); Rr.el.rotation.x = mix(Rr.el.rotation.x, 0, k);
      Rr.wr.rotation.z = mix(Rr.wr.rotation.z, -recoil * 0.25, k);
      L.sh.rotation.z = mix(L.sh.rotation.z, mix(Math.PI / 2 - 0.12 + up, Math.PI - 0.35, pk), k); L.sh.rotation.y = mix(0, -0.62 * (1 - pk), k);
      L.sh.rotation.x = mix(L.sh.rotation.x, pk * 0.5, k);
      L.el.rotation.z = mix(L.el.rotation.z, 0.35 + recoil * 0.2, k); L.el.rotation.x = mix(L.el.rotation.x, 0, k);
      torso.rotation.y = mix(torso.rotation.y, -0.12 * (1 - pk), k); // blade the body a touch
    }
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
    if (holstered) {
      const out = aimK > 0.35 || (armK > 0.5 && tdK < 0.3);
      holstered.visible = !out; drawn.visible = out;
      knife.visible = tdK > 0.3 && tdP > 0.12 && tdP < 0.95 && !out;
      flash.visible = flashT > 0 && out; flash.rotation.y = t * 40;
    }
    // lay flat (prone) / topple forward (death, game-over screen). Rig pivots at the feet, so shift it back to stay centred.
    const flat = Math.max(deadK, pk);
    inner.rotation.z = -flat * Math.PI / 2;
    inner.position.y = mix(deadK * 0.16, 0.14, pk);
    inner.position.x = mix(deadK * 0.1, -0.78, pk);
    rig.rotation.x = roll * (1 - flat); // bank into turns from the feet
  }
  update(0, {});
  // world position of the pistol muzzle (for tracers); falls back to chest height in front of the body
  const muzzleWorld = (v) => { if (flash) { g.updateMatrixWorld(true); return flash.getWorldPosition(v); } return v.set(g.position.x, 1.25, g.position.z); };
  return { g, inner, update, materials: M, head: headPivot, muzzleWorld };
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
