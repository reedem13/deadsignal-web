// Project Deadsignal - vertical traversal data + PS1-style dressing (Splinter Cell-ish climbing / co-op boost / grapple).
// Pure data + meshes; all gameplay logic lives in main.js (host-authoritative). Coordinates = main.js world (north = -z).
//   WALKS  : walkable tops that are NOT collision boxes (tunnel roof slab over the barracks crawlspace, gantry deck).
//            Crates + buildings in main.js WALLS are walkable too (their tops).
//   RAILS  : collision boxes that only exist up high (y0..h) - catwalk railings. Ignored by guards / sight / bullets.
//   CLIMBS : solo ladders / drainpipes. Stand at (x,z) facing a (toward the wall), climb to `top`, vault onto (lx,lz).
//   COOPS  : co-op boost walls (too high to climb solo). Face point (x,z) on the wall, a = facing into the wall.
//   LINKS  : vertical grapple lines up a wall face (hook bites the lip, rope hangs straight down). Two-way:
//            foot ring = GRAPPLE up, top ring = RAPPEL down.
import * as THREE from 'three';

export const TRAV = {
  climbSpeed: { ladder: 1.5, pipe: 1.15 }, // m/s up / down
  hangBelow: 1.1,   // feet this far under the top = hands on the lip -> auto vault
  mantleT: 0.62,    // crate / ledge mantle
  topVaultT: 0.7,   // ladder top -> roof
  downT: 0.45,      // roof -> onto the ladder
  mantleMax: 1.45,  // highest lip you can mantle onto from where you stand
  boostT: 1.9, pullT: 2.2, // co-op moves (host clock)
  landNoise: 4.2, landDrop: 1.8, // standing drop from > landDrop m = thud guards can hear (crouch = silent hang-drop)
};

export const WALKS = [
  { x1: -11.6, x2: -4.4, z1: -7.1, z2: -4.9, h: 3, name: 'BARRACKS ROOF' }, // slab over the crawlspace (joins the two barracks blocks)
  { x1: 4.2, x2: 17.5, z1: -3.3, z2: -2.3, h: 3.4, name: 'GANTRY' },          // catwalk over the switch lane
];
export const RAILS = [
  { x1: 4.2, x2: 17.5, z1: -3.38, z2: -3.3, y0: 3.4, h: 4.3 },
  { x1: 4.2, x2: 17.5, z1: -2.3, z2: -2.22, y0: 3.4, h: 4.3 },
  { x1: 17.5, x2: 17.58, z1: -3.38, z2: -2.22, y0: 3.4, h: 4.3 },
];
// support posts for the gantry (added to main.js WALLS as kind 'post')
export const GANTRY_POSTS = [6, 10.5, 14, 17.4].flatMap((x) => [[x, -3.22], [x, -2.38]]);

export const CLIMBS = [
  { name: 'BARRACKS LADDER', kind: 'ladder', x: -9.5, z: -3.1, a: -Math.PI / 2, top: 3, lx: -9.5, lz: -4.2 },
  { name: 'PUMP HOUSE PIPE', kind: 'pipe', x: 10.6, z: 1.2, a: 0, top: 2.2, lx: 11.6, lz: 1.2 },
];

export const COOPS = [
  { name: 'SIGNAL SHED', x: 3, z: -2.1, a: -Math.PI / 2, top: 3.4 },
];
// derived points for a co-op wall: base = booster kneels here (back to the wall), step = climber's run-up spot,
// hang = climber against the wall, edge = puller kneels here on the roof, land = where the climber ends up on top
export function coopGeom(c) {
  const dx = Math.cos(c.a), dz = Math.sin(c.a), P = (d) => ({ x: c.x + dx * d, z: c.z + dz * d });
  return { dx, dz, base: P(-0.45), step: P(-1.15), hang: P(-0.4), edge: P(0.35), land: P(0.65) };
}

// Vertical grapple lines: the hook bites the top lip of a wall (or the gantry rail) and the rope hangs straight down the
// face. Every line is two-way: stand at the FOOT ring (ground, facing the wall) -> GRAPPLE up; stand at the TOP ring
// (just back from the lip) -> RAPPEL down. No swings, no lateral arcs - you only ever move up / down the face.
//   x,z  = foot spot (where you stand / hang, `wall` m off the face)   a = facing INTO the wall
//   y0   = foot floor height   top = floor up top   lip = height the claw bites (roof edge or rail top)
//   land = how far past the face you end up on top
export const LINKS = [
  { name: 'SHED WEST WALL', x: 1.42, z: -2.9, a: 0, y0: 0, top: 3.4, lip: 3.46, wall: 0.38, land: 0.55 },
  { name: 'BARRACKS NORTH WALL', x: -6.6, z: -8.88, a: Math.PI / 2, y0: 0, top: 3, lip: 3.06, wall: 0.38, land: 0.6 },
  { name: 'GANTRY WEST LINE', x: 6.5, z: -3.78, a: Math.PI / 2, y0: 0, top: 3.4, lip: 4.32, wall: 0.38, land: 0.62, rail: 1 },
  { name: 'GANTRY SOUTH LINE', x: 12, z: -1.82, a: -Math.PI / 2, y0: 0, top: 3.4, lip: 4.32, wall: 0.38, land: 0.62, rail: 1 },
  { name: 'GANTRY EAST LINE', x: 16.5, z: -3.78, a: Math.PI / 2, y0: 0, top: 3.4, lip: 4.32, wall: 0.38, land: 0.62, rail: 1 },
];
// Slow, deliberate timings (seconds). UP: square up -> wind + throw -> claw bites, tug test -> hand-over-hand climb
// (pull, settle, pull...) -> mantle over the lip. DOWN: face the drop at the lip -> kneel + clamp the claw, feed the rope
// down -> turn your back to the drop, step back over the edge -> controlled bounding drops down the face -> land.
export const GRAPPLE = {
  up: { sq: 0.5, throw: 1.05, set: 0.8, mantle: 1.0 }, upRate: 0.62, upStep: 0.34, // climb m/s, metres per hand pull
  dn: { sq: 0.5, set: 1.2, over: 1.3, land: 0.4 }, dnRate: 0.95, dnStep: 0.62,   // rappel m/s, metres per bound
  flyFrom: 0.48, // fraction of the throw phase spent winding (claw spinning under the hand) before it flies
  hangDrop: 1.55, // feet this far under the lip = hands on it (end of the climb / start of the rappel)
};
const UP_ORDER = ['sq', 'throw', 'set', 'climb', 'mantle'], DN_ORDER = ['sq', 'set', 'over', 'drop', 'land'];
for (const L of LINKS) {
  L.dx = Math.cos(L.a); L.dz = Math.sin(L.a);
  L.face = { x: L.x + L.dx * L.wall, z: L.z + L.dz * L.wall };
  L.anchor = { x: L.face.x + L.dx * 0.03, y: L.lip, z: L.face.z + L.dz * 0.03 }; // claw over the lip
  L.rope = { x: L.face.x - L.dx * 0.07, z: L.face.z - L.dz * 0.07 };              // rope hangs just off the face
  L.foot = { x: L.x, y: L.y0, z: L.z };
  L.landP = { x: L.face.x + L.dx * L.land, y: L.top, z: L.face.z + L.dz * L.land };
  L.hang = Math.max(L.y0 + 0.4, L.lip - GRAPPLE.hangDrop);
  const run = L.hang - L.y0;
  L.upT = { ...GRAPPLE.up, climb: run / GRAPPLE.upRate }; L.dnT = { ...GRAPPLE.dn, drop: run / GRAPPLE.dnRate };
  L.upDur = UP_ORDER.reduce((a, k) => a + L.upT[k], 0); L.dnDur = DN_ORDER.reduce((a, k) => a + L.dnT[k], 0);
  L.upSteps = Math.max(1, Math.round(run / GRAPPLE.upStep)); L.dnSteps = Math.max(1, Math.round(run / GRAPPLE.dnStep));
}
// which phase of a grapple (up = true) / rappel we're in at time t: { ph, u (0..1 inside the phase), t }
export function grapplePhase(L, up, t) {
  const order = up ? UP_ORDER : DN_ORDER, T = up ? L.upT : L.dnT; let acc = 0;
  for (const k of order) { if (t < acc + T[k]) return { ph: k, u: (t - acc) / T[k], t }; acc += T[k]; }
  return { ph: order[order.length - 1], u: 1, t, done: true };
}
const ss = (v) => { v = Math.max(0, Math.min(1, v)); return v * v * (3 - 2 * v); };
// stepped progress 0..1 over n beats: each beat eases in + out, so motion comes in deliberate pulls / bounds
export function beats(u, n, hold = 0.25) { const f = u * n, i = Math.min(n - 1, Math.floor(f)), k = f - i; return (i + ss(k / (1 - hold))) / n; }
/** body position along a vertical grapple. s = where the move started (x,y,z). Returns out with an extra `.off` (push-off). */
export function grapplePos(L, up, t, s, out) {
  const P = grapplePhase(L, up, t), u = P.u; out.off = 0;
  if (up) {
    if (P.ph === 'sq') { const k = ss(u); out.x = s.x + (L.foot.x - s.x) * k; out.z = s.z + (L.foot.z - s.z) * k; out.y = s.y; }
    else if (P.ph === 'throw' || P.ph === 'set') { out.x = L.foot.x; out.z = L.foot.z; out.y = L.y0; }
    else if (P.ph === 'climb') { out.x = L.foot.x; out.z = L.foot.z; out.y = L.y0 + (L.hang - L.y0) * beats(u, L.upSteps); }
    else { const vy = ss(u / 0.6), vh = ss((u - 0.35) / 0.65);
      out.y = L.hang + (L.top - L.hang) * vy; out.x = L.foot.x + (L.landP.x - L.foot.x) * vh; out.z = L.foot.z + (L.landP.z - L.foot.z) * vh; }
  } else {
    if (P.ph === 'sq') { const k = ss(u); out.x = s.x + (L.landP.x - s.x) * k; out.z = s.z + (L.landP.z - s.z) * k; out.y = s.y; }
    else if (P.ph === 'set') { out.x = L.landP.x; out.z = L.landP.z; out.y = L.top; }
    else if (P.ph === 'over') { const k = (u - 0.3) / 0.7, vh = ss(k / 0.6), vy = ss((k - 0.35) / 0.65); // turn around, back over the edge, lower onto the rope
      out.x = L.landP.x + (L.foot.x - L.landP.x) * vh; out.z = L.landP.z + (L.foot.z - L.landP.z) * vh; out.y = L.top + (L.hang - L.top) * vy; }
    else if (P.ph === 'drop') { const n = L.dnSteps, f = u * n, k = f - Math.min(n - 1, Math.floor(f));
      out.x = L.foot.x; out.z = L.foot.z; out.y = L.hang - (L.hang - L.y0) * beats(u, n, 0.3);
      out.off = Math.sin(Math.PI * Math.min(1, k / 0.7)) * 0.22; } // kick off the wall each bound, swing back in to plant
    else { out.x = L.foot.x; out.z = L.foot.z; out.y = L.y0; }
  }
  return out;
}

// ---------------------------------------------------------------- meshes
const lam = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...extra });
const basic = (c, o = 1) => new THREE.MeshBasicMaterial({ color: c, transparent: o < 1, opacity: o, depthWrite: o >= 1 });
function boxAt(scene, w, h, d, m, x, y, z) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); scene.add(b); return b; }
function labelTex(txt, color) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 32; const x = c.getContext('2d');
  x.fillStyle = 'rgba(0,0,0,0)'; x.fillRect(0, 0, 64, 32); x.strokeStyle = color; x.lineWidth = 3; x.strokeRect(3, 3, 58, 26);
  x.font = 'bold 18px monospace'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = color; x.fillText(txt, 32, 17);
  const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; return t;
}

/** Build ladders, pipe, gantry, hooks, launch rings, co-op markers, crate lip highlights. walls = main.js WALLS. */
export function buildTraversal(scene, { walls, hazardMat }) {
  const metal = lam(0x6b7378), rust = lam(0x8a5a32), yellow = lam(0xc8a030), deckMat = lam(0x5c666c, { transparent: true, opacity: 0.88 });
  const cue = basic(0xf0e0a0, 0.38), cueHot = basic(0xffe9a0, 0.85);
  const hot = []; // {mesh, kind, i} things that brighten when you can use them
  // crate lips: thin pale trim on the top edges = "you can mantle this"
  for (const b of walls) {
    if (b.kind !== 'crate') continue;
    const w = b.x2 - b.x1, d = b.z2 - b.z1, cx = (b.x1 + b.x2) / 2, cz = (b.z1 + b.z2) / 2, y = b.h + 0.01;
    boxAt(scene, w + 0.04, 0.035, 0.05, cue, cx, y, b.z1); boxAt(scene, w + 0.04, 0.035, 0.05, cue, cx, y, b.z2);
    boxAt(scene, 0.05, 0.035, d, cue, b.x1, y, cz); boxAt(scene, 0.05, 0.035, d, cue, b.x2, y, cz);
  }
  // ground chevron at the foot of every climb spot
  const chevGeo = new THREE.ConeGeometry(0.16, 0.3, 3); chevGeo.rotateX(Math.PI / 2);
  const chevron = (x, y, z, a, m = cue) => { const c = new THREE.Mesh(chevGeo, m); c.scale.y = 0.15; c.position.set(x, y + 0.03, z); c.rotation.y = -a + Math.PI / 2; scene.add(c); return c; };
  CLIMBS.forEach((c, i) => {
    const dx = Math.cos(c.a), dz = Math.sin(c.a), tx = -dz, tz = dx; // tangent along the wall
    const fx = c.x + dx * 0.34, fz = c.z + dz * 0.34; // just off the wall face
    if (c.kind === 'ladder') {
      const h = c.top + 0.55;
      for (const s of [-0.24, 0.24]) boxAt(scene, Math.abs(tx) * 0.05 + 0.05, h, Math.abs(tz) * 0.05 + 0.05, yellow, fx + tx * s, h / 2, fz + tz * s);
      for (let y = 0.3; y < c.top + 0.05; y += 0.3) boxAt(scene, Math.abs(tx) * 0.48 + 0.035, 0.035, Math.abs(tz) * 0.48 + 0.035, metal, fx, y, fz);
      // grab hoops over the lip
      for (const s of [-0.24, 0.24]) boxAt(scene, Math.abs(dx) * 0.32 + 0.05, 0.05, Math.abs(dz) * 0.32 + 0.05, yellow, fx + tx * s + dx * 0.16, h, fz + tz * s + dz * 0.16);
    } else {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, c.top + 0.2, 6), lam(0x4f5d52)); pipe.position.set(fx + dx * 0.04, (c.top + 0.2) / 2, fz + dz * 0.04); scene.add(pipe);
      for (let y = 0.5; y < c.top; y += 0.7) boxAt(scene, Math.abs(dx) * 0.12 + 0.04 + Math.abs(tx) * 0.16, 0.04, Math.abs(dz) * 0.12 + 0.04 + Math.abs(tz) * 0.16, metal, fx + dx * 0.1, y, fz + dz * 0.1);
      const glint = new THREE.Mesh(new THREE.BoxGeometry(0.02, c.top + 0.1, 0.02), cue); glint.position.set(fx - dx * 0.03 + tx * 0.04, (c.top + 0.1) / 2, fz - dz * 0.03 + tz * 0.04); scene.add(glint);
    }
    hot.push({ mesh: chevron(c.x - dx * 0.2, 0, c.z - dz * 0.2, c.a), kind: 'climb', i });
  });
  // gantry: deck + grating stripes, rails, posts are WALLS (drawn by main.js)
  for (const w of WALKS) if (w.name === 'GANTRY') {
    const lx = w.x2 - w.x1, lz = w.z2 - w.z1, cx = (w.x1 + w.x2) / 2, cz = (w.z1 + w.z2) / 2;
    boxAt(scene, lx, 0.14, lz, deckMat, cx, w.h - 0.07, cz);
    for (let x = w.x1 + 0.3; x < w.x2; x += 0.6) boxAt(scene, 0.04, 0.02, lz, metal, x, w.h + 0.005, cz);
  }
  for (const r of RAILS) {
    const lx = r.x2 - r.x1, lz = r.z2 - r.z1, cx = (r.x1 + r.x2) / 2, cz = (r.z1 + r.z2) / 2;
    boxAt(scene, lx, 0.05, lz, rust, cx, r.h - 0.02, cz); boxAt(scene, lx, 0.04, lz, rust, cx, r.y0 + 0.45, cz);
    const along = lx > lz;
    for (let s = 0; s <= (along ? lx : lz) + 0.01; s += 1.1) boxAt(scene, 0.05, r.h - r.y0, 0.05, rust, along ? r.x1 + s : cx, (r.y0 + r.h) / 2, along ? cz : r.z1 + s);
  }
  // co-op walls: hazard lip along the top edge + "2P" decal where the booster kneels
  const coopTex = labelTex('2P', '#ffd27f');
  COOPS.forEach((c, i) => {
    const g = coopGeom(c), tx = -g.dz, tz = g.dx;
    boxAt(scene, Math.abs(tx) * 1.8 + 0.12, 0.12, Math.abs(tz) * 1.8 + 0.12, hazardMat, c.x - g.dx * 0.02, c.top - 0.06, c.z - g.dz * 0.02);
    const dec = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5), new THREE.MeshBasicMaterial({ map: coopTex, transparent: true, opacity: 0.6, depthWrite: false }));
    dec.rotation.x = -Math.PI / 2; dec.rotation.z = -c.a - Math.PI / 2; dec.position.set(g.base.x - g.dx * 0.25, 0.04, g.base.z - g.dz * 0.25); scene.add(dec);
    hot.push({ mesh: dec, kind: 'coop', i });
  });
  // grapple walls: orange anchor plate + scuffed boot-mark stripe down the face, foot ring on the ground, top ring
  // behind the lip, small glow over the anchor
  const hookMat = basic(0xff8a2a), scuff = basic(0x1a1612, 0.55), seen = [];
  const ringMat = () => new THREE.MeshBasicMaterial({ color: 0xff9a40, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
  LINKS.forEach((L, i) => {
    const tx = -L.dz, tz = L.dx, A = L.anchor;
    // anchor plate bolted at the lip (on the rail: a clamp bar)
    boxAt(scene, Math.abs(L.dx) * 0.05 + Math.abs(tx) * 0.34, L.rail ? 0.06 : 0.12, Math.abs(L.dz) * 0.05 + Math.abs(tz) * 0.34, hookMat, L.face.x - L.dx * 0.02, A.y - (L.rail ? 0.03 : 0.08), L.face.z - L.dz * 0.02);
    if (!L.rail) for (let y = L.y0 + 0.35; y < L.top - 0.3; y += 0.42) // boot scuffs: tells you this face takes a rope
      boxAt(scene, Math.abs(L.dx) * 0.012 + Math.abs(tx) * 0.16, 0.06, Math.abs(L.dz) * 0.012 + Math.abs(tz) * 0.16, scuff, L.face.x - L.dx * 0.012 + tx * ((y * 7) % 0.1 - 0.05), y, L.face.z - L.dz * 0.012 + tz * ((y * 7) % 0.1 - 0.05));
    const glow = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), basic(0xffc070, 0.9)); glow.position.set(L.face.x - L.dx * 0.12, A.y + 0.22, L.face.z - L.dz * 0.12); scene.add(glow);
    seen.push({ glow });
    const ring = (p, r) => { const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.1, r, 16), ringMat()); m.rotation.x = -Math.PI / 2; m.position.set(p.x, p.y + 0.03, p.z); scene.add(m); return m; };
    const bot = ring({ x: L.foot.x - L.dx * 0.12, y: L.y0, z: L.foot.z - L.dz * 0.12 }, 0.62), top = ring(L.landP, 0.52);
    const ch = chevron(L.foot.x + L.dx * 0.2, L.y0, L.foot.z + L.dz * 0.2, L.a, bot.material);
    const chT = chevron(L.landP.x - L.dx * 0.28, L.top, L.landP.z - L.dz * 0.28, L.a + Math.PI, top.material);
    hot.push({ mesh: bot, kind: 'link', i, extra: ch }, { mesh: top, kind: 'linkTop', i, extra: chT });
  });
  let t = 0;
  return {
    anchorFor: (i) => LINKS[i].anchor,
    // near = { kind, i } of whatever ACT would use right now (or null): brighten it
    tick(dt, near) {
      t += dt;
      for (const h of hot) {
        const on = near && near.kind === h.kind && near.i === h.i;
        if (h.kind === 'link' || h.kind === 'linkTop') { h.mesh.material.opacity = on ? 0.85 : 0.28 + 0.1 * Math.sin(t * 2 + h.i); }
        else if (h.kind === 'climb') h.mesh.material = on ? cueHot : cue;
        else h.mesh.material.opacity = on ? 1 : 0.55;
      }
      for (const { glow } of seen) { glow.rotation.y += dt * 2; glow.material.opacity = 0.6 + 0.35 * Math.sin(t * 3); }
    },
  };
}
