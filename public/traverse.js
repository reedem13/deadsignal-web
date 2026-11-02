// Project Deadsignal - vertical traversal data + PS1-style dressing (Splinter Cell-ish climbing / co-op boost / grapple).
// Pure data + meshes; all gameplay logic lives in main.js (host-authoritative). Coordinates = main.js world (north = -z).
//   WALKS  : walkable tops that are NOT collision boxes (tunnel roof slab over the barracks crawlspace, gantry deck).
//            Crates + buildings in main.js WALLS are walkable too (their tops).
//   RAILS  : collision boxes that only exist up high (y0..h) - catwalk railings. Ignored by guards / sight / bullets.
//   CLIMBS : solo ladders / drainpipes. Stand at (x,z) facing a (toward the wall), climb to `top`, vault onto (lx,lz).
//   COOPS  : co-op boost walls (too high to climb solo). Face point (x,z) on the wall, a = facing into the wall.
//   LINKS  : grapple / rappel lines. Fire from the `from` zone (radius r at height y) -> reel along a bezier
//            (from -> c -> to) to `to`; the rope hangs from `hook`.
import * as THREE from 'three';

export const TRAV = {
  climbSpeed: { ladder: 1.5, pipe: 1.15 }, // m/s up / down
  hangBelow: 1.1,   // feet this far under the top = hands on the lip -> auto vault
  mantleT: 0.62,    // crate / ledge mantle
  topVaultT: 0.7,   // ladder top -> roof
  downT: 0.45,      // roof -> onto the ladder
  mantleMax: 1.45,  // highest lip you can mantle onto from where you stand
  boostT: 1.9, pullT: 2.2, // co-op moves (host clock)
  fireT: 0.38, ropeSpeed: 7.5, // grapple: hook flight, then reel speed (m/s along the path)
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

export const LINKS = [
  { name: 'SHED HOOK', from: { x: -5.0, y: 3, z: -6.0, r: 0.9 }, to: { x: 2.3, y: 3.4, z: -2.9 }, c: { x: -1.4, y: 0.7, z: -4.6 }, hook: { x: 2.0, y: 4.7, z: -3.4, base: 3.4 } },
  { name: 'BARRACKS HOOK', from: { x: 2.5, y: 3.4, z: -3.05, r: 0.75 }, to: { x: -5.4, y: 3, z: -6.0 }, c: { x: -1.6, y: 0.8, z: -4.4 }, hook: { x: -5.0, y: 4.3, z: -6.7, base: 3 } },
  { name: 'GANTRY HOOK', from: { x: 12.1, y: 2.2, z: 0.6, r: 0.9 }, to: { x: 12, y: 3.4, z: -2.8 }, c: { x: 12, y: 4.6, z: -0.6 }, hook: { x: 12, y: 4.7, z: -2.26, base: 3.4 } },
  { name: 'WEST SWITCH DROP', from: { x: 6.5, y: 3.4, z: -2.8, r: 0.65 }, to: { x: 6.5, y: 0, z: -5.0 }, c: { x: 6.5, y: 4.6, z: -4.7 }, hook: { x: 6.5, y: 4.6, z: -3.34, base: 3.4 } },
  { name: 'WEST SWITCH LINE', from: { x: 8.6, y: 0, z: -4.6, r: 0.85 }, to: { x: 7.3, y: 3.4, z: -2.8 }, c: { x: 7.4, y: 5.2, z: -4.2 }, hook: { x: 6.5, y: 4.6, z: -3.34, base: 3.4 } },
  { name: 'EAST SWITCH DROP', from: { x: 16.5, y: 3.4, z: -2.8, r: 0.65 }, to: { x: 16.5, y: 0, z: -5.0 }, c: { x: 16.5, y: 4.6, z: -4.7 }, hook: { x: 16.5, y: 4.6, z: -3.34, base: 3.4 } },
  { name: 'EAST SWITCH LINE', from: { x: 14.4, y: 0, z: -4.6, r: 0.85 }, to: { x: 15.7, y: 3.4, z: -2.8 }, c: { x: 15.6, y: 5.2, z: -4.2 }, hook: { x: 16.5, y: 4.6, z: -3.34, base: 3.4 } },
];
// bezier position along a link (u 0..1); start = where the player actually fired from
export function linkPos(L, s, u, out) {
  const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
  out.x = a * s.x + b * L.c.x + c * L.to.x; out.y = a * s.y + b * L.c.y + c * L.to.y; out.z = a * s.z + b * L.c.z + c * L.to.z;
  return out;
}
for (const L of LINKS) { // approximate path length -> reel time; hook flight first
  let len = 0, p = { x: 0, y: 0, z: 0 }, q = { ...L.from };
  for (let i = 1; i <= 16; i++) { linkPos(L, L.from, i / 16, p); len += Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z); q = { ...p }; }
  L.len = len; L.reelT = Math.max(0.9, len / TRAV.ropeSpeed); L.dur = TRAV.fireT + L.reelT; L.up = L.to.y > L.from.y + 0.2;
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
  // grapple hooks (deduped) + launch rings
  const hookMat = basic(0xff8a2a), seen = new Map();
  const ringMat = () => new THREE.MeshBasicMaterial({ color: 0xff9a40, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
  LINKS.forEach((L, i) => {
    const k = `${L.hook.x},${L.hook.z}`;
    if (!seen.has(k)) {
      const h = L.hook, ph = h.y + 0.12 - h.base;
      boxAt(scene, 0.09, ph, 0.09, metal, h.x, h.base + ph / 2, h.z);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.035, 4, 8), hookMat); ring.position.set(h.x, h.y, h.z); ring.rotation.x = Math.PI / 2; scene.add(ring);
      const glow = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), basic(0xffc070, 0.9)); glow.position.set(h.x, h.y + 0.22, h.z); scene.add(glow);
      seen.set(k, { ring, glow });
    }
    const f = L.from, rm = ringMat();
    const ring = new THREE.Mesh(new THREE.RingGeometry(f.r - 0.1, f.r, 16), rm); ring.rotation.x = -Math.PI / 2; ring.position.set(f.x, f.y + 0.03, f.z); scene.add(ring);
    const a = Math.atan2(L.hook.z - f.z, L.hook.x - f.x);
    const ch = chevron(f.x + Math.cos(a) * 0.35, f.y, f.z + Math.sin(a) * 0.35, a, rm);
    hot.push({ mesh: ring, kind: 'link', i, extra: ch, hook: seen.get(k) });
  });
  let t = 0;
  return {
    hookFor: (i) => LINKS[i].hook,
    // near = { kind, i } of whatever ACT would use right now (or null): brighten it
    tick(dt, near) {
      t += dt;
      for (const h of hot) {
        const on = near && near.kind === h.kind && near.i === h.i;
        if (h.kind === 'link') { h.mesh.material.opacity = on ? 0.85 : 0.28 + 0.1 * Math.sin(t * 2 + h.i); }
        else if (h.kind === 'climb') h.mesh.material = on ? cueHot : cue;
        else h.mesh.material.opacity = on ? 1 : 0.55;
      }
      for (const { glow } of seen.values()) { glow.rotation.y += dt * 2; glow.material.opacity = 0.6 + 0.35 * Math.sin(t * 3); }
    },
  };
}
