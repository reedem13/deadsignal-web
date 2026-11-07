// Project Deadsignal - vertical traversal data + PS1-style dressing (Splinter Cell-ish climbing / co-op boost / grapple).
// Pure data + meshes; all gameplay logic lives in main.js (host-authoritative). Coordinates = main.js world (north = -z).
//   WALKS  : walkable tops that are NOT collision boxes (catwalks, bridges, roof slabs over crawlspaces). Open underneath.
//            Crates + buildings in main.js WALLS are walkable too (their tops).
//   RAILS  : collision boxes that only exist up high (y0..h) - catwalk railings. Ignored by guards / sight / bullets.
//   CLIMBS : solo ladders / drainpipes. Stand at (x,z) on floor y0 facing a (toward the wall), climb to `top`, vault onto (lx,lz).
//   COOPS  : hand-placed co-op boost walls (2P decal). main.js adds generated co-op spots on most other faces (COOP_ALL).
//   LINKS  : vertical grapple lines down a wall face (hook bites the lip, rope hangs straight down). TOP-ONLY:
//            top ring = RAPPEL down, or haul a teammate who waits at the foot ring up the rope. No ground -> up grapple.
import * as THREE from 'three';
import { WALKS, RAILS, DECK_POSTS, CLIMBS, COOPS, LINKS } from './mapcompile.js';

export { WALKS, RAILS, DECK_POSTS, CLIMBS, COOPS, LINKS };

export const TRAV = {
  climbSpeed: { ladder: 1.5, pipe: 1.15, net: 1.25 }, // m/s up / down. net = cargo net (same climb, wider mesh)
  hangBelow: 1.1,   // feet this far under the top = hands on the lip -> auto vault
  mantleT: 0.62,    // crate / ledge mantle
  topVaultT: 0.7,   // ladder top -> roof
  downT: 0.45,      // roof -> onto the ladder
  mantleMax: 1.45,  // highest lip you can mantle onto from where you stand
  boostT: 1.9, pullT: 2.2, // co-op moves (host clock)
  landNoise: 4.2, landDrop: 1.8, // standing drop from > landDrop m = thud guards can hear (crouch = silent hang-drop)
};

// Floor heights. Geometry itself lives in leveldata.js and is compiled by mapcompile.js,
// so the map editor and the game share one yard.
export const L1 = 3.2, L2 = 6.4, L3 = 9.6;
for (const c of CLIMBS) c.y0 = c.y0 || 0;

// derived points for a co-op wall: base = booster kneels here (back to the wall), step = climber's run-up spot,
// hang = climber against the wall, edge = puller kneels here on the roof, land = where the climber ends up on top
export function coopGeom(c) {
  const dx = Math.cos(c.a), dz = Math.sin(c.a), P = (d) => ({ x: c.x + dx * d, z: c.z + dz * d });
  return { dx, dz, base: P(-0.45), step: P(-1.15), hang: P(-0.4), edge: P(0.35), land: P(0.65) };
}

// Slow, deliberate timings (seconds). The ENTRY is a short automated sequence, then the player owns the rope:
//   UP entry  (foot ring): square up -> wind + throw -> claw bites, tug test  -> ON THE LINE at the bottom   [disabled: top-only grapple]
//   DOWN entry (top ring): face the drop -> kneel + clamp the claw, feed the line -> turn, step back over the edge -> ON THE LINE at the top
// ON THE LINE: hold up = hand-over-hand climb (pull, settle, pull...), hold down = controlled bounding descent (kick off, swing
// back in), let go of the stick = hang still on the rope. Up at the top -> mantle over the lip; down at the bottom -> land.
export const GRAPPLE = {
  up: { sq: 0.5, throw: 1.05, set: 0.8 }, dn: { sq: 0.5, set: 1.2, over: 1.3 }, mantle: 1.0, land: 0.4,
  upRate: 0.62, upStep: 0.34, upHold: 0.25, // climb m/s, metres per hand pull, fraction of each pull spent settling
  dnRate: 0.95, dnStep: 0.62, dnHold: 0.3,  // descent m/s, metres per bound
  flyFrom: 0.48, // fraction of the throw phase spent winding (claw spinning under the hand) before it flies
  hangDrop: 1.55, // feet this far under the lip = hands on it (top of the climbable line / start of the descent)
  kick: 0.22,     // how far you push off the wall at the top of a bound
};
// phases (wire index = position in this list): entry phases depend on the direction you came from
export const LINE_PH = ['sq', 'throw', 'set', 'over', 'line', 'mantle', 'land'];
export const LINE_ENTRY = { gp: ['sq', 'throw', 'set'], rp: ['sq', 'set', 'over'] };
/** duration of an automated phase (line = player-driven, no duration) */
export function lineDur(k, ph) {
  if (ph === 'mantle') return GRAPPLE.mantle; if (ph === 'land') return GRAPPLE.land;
  return (k === 'gp' ? GRAPPLE.up : GRAPPLE.dn)[ph] || 0;
}
const ss = (v) => { v = Math.max(0, Math.min(1, v)); return v * v * (3 - 2 * v); };
// stepped progress 0..1 over n beats: each beat eases in + out, so motion comes in deliberate pulls / bounds
export function beats(u, n, hold = 0.25) { const f = u * n, i = Math.min(n - 1, Math.floor(f)), k = f - i; return (i + ss(k / (1 - hold))) / n; }
/** distance covered (0..1 of one stroke) at stroke fraction f: pull / bound, then settle */
export const strokeAt = (f, hold) => ss(f / (1 - hold));
/** push-off from the wall during a descending bound at stroke fraction f */
export const kickAt = (f) => Math.sin(Math.PI * Math.min(1, Math.max(0, f) / 0.7)) * GRAPPLE.kick;
/**
 * body position during an automated phase. k = gp|rp (entry direction), ph, u = 0..1 in the phase,
 * s = where the move started (x,y,z), y0 = height the mantle / land starts from.
 */
export function lineAutoPos(L, k, ph, u, s, y0, out) {
  out.off = 0;
  if (ph === 'sq') { const e = ss(u), t = k === 'gp' ? L.foot : L.landP; out.x = s.x + (t.x - s.x) * e; out.z = s.z + (t.z - s.z) * e; out.y = s.y; }
  else if (ph === 'throw' || (ph === 'set' && k === 'gp')) { out.x = L.foot.x; out.z = L.foot.z; out.y = L.y0; }
  else if (ph === 'set') { out.x = L.landP.x; out.z = L.landP.z; out.y = L.top; }
  else if (ph === 'over') { const e = (u - 0.3) / 0.7, vh = ss(e / 0.6), vy = ss((e - 0.35) / 0.65); // turn around, back over the edge, onto the rope
    out.x = L.landP.x + (L.foot.x - L.landP.x) * vh; out.z = L.landP.z + (L.foot.z - L.landP.z) * vh; out.y = L.top + (L.hang - L.top) * vy; }
  else if (ph === 'mantle') { const vy = ss(u / 0.6), vh = ss((u - 0.35) / 0.65);
    out.y = y0 + (L.top - y0) * vy; out.x = L.foot.x + (L.landP.x - L.foot.x) * vh; out.z = L.foot.z + (L.landP.z - L.foot.z) * vh; }
  else { out.x = L.foot.x; out.z = L.foot.z; out.y = y0 + (L.y0 - y0) * ss(u * 2); } // land: last few cm, boots down
  return out;
}
/**
 * Wire encoding of a line move's state in one float: phase index + fraction. ON THE LINE the fraction packs
 * the motion slot (0 hang after climbing, 1 hang after descending, 2 climbing, 3 descending) + the stroke fraction.
 */
export function lineEncode(T) {
  const pi = LINE_PH.indexOf(T.ph);
  if (T.ph !== 'line') return pi + Math.min(0.999, Math.max(0, T.u || 0));
  const slot = T.dir > 0 ? 2 : T.dir < 0 ? 3 : T.last < 0 ? 1 : 0;
  return pi + slot * 0.2 + Math.min(0.999, Math.max(0, T.sf)) * 0.19;
}
export function lineDecode(tp) {
  const pi = Math.max(0, Math.min(LINE_PH.length - 1, Math.floor(tp + 1e-6))), ph = LINE_PH[pi], r = Math.max(0, tp - pi);
  if (ph !== 'line') return { ph, u: Math.min(1, r) };
  const slot = Math.min(3, Math.floor(r / 0.2 + 1e-6));
  return { ph, u: 0, slot, dir: slot === 2 ? 1 : slot === 3 ? -1 : 0, last: slot === 1 || slot === 3 ? -1 : 1, sf: Math.min(1, Math.max(0, (r - slot * 0.2) / 0.19)) };
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

// Many small static boxes (ladder rungs, rail posts / bars, deck grating, crate lips, boot scuffs) are batched into one
// InstancedMesh per material, so the stacked level stays a handful of draw calls on phones.
function batcher(scene) {
  const lists = new Map();
  return {
    box(m, w, h, d, x, y, z) { if (!lists.has(m)) lists.set(m, []); lists.get(m).push([w, h, d, x, y, z]); },
    flush() {
      const geo = new THREE.BoxGeometry(1, 1, 1), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3();
      for (const [m, L] of lists) {
        const im = new THREE.InstancedMesh(geo, m, L.length);
        L.forEach(([w, h, d, x, y, z], i) => im.setMatrixAt(i, M.compose(P.set(x, y, z), Q, S.set(w, h, d))));
        im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); scene.add(im);
      }
    },
  };
}

/** Build ladders, pipes, decks, rails, hooks, launch rings, co-op markers, crate lip highlights. walls = main.js WALLS. */
export function buildTraversal(scene, { walls, hazardMat }) {
  const metal = lam(0x6b7378), rust = lam(0x8a5a32), yellow = lam(0xc8a030);
  const cue = basic(0xf0e0a0, 0.38), cueHot = basic(0xffe9a0, 0.85);
  const hot = []; // {mesh, kind, i} things that brighten when you can use them
  const I = batcher(scene);
  // crate lips: thin pale trim on the top edges = "you can mantle this"
  for (const b of walls) {
    if (b.kind !== 'crate') continue;
    const w = b.x2 - b.x1, d = b.z2 - b.z1, cx = (b.x1 + b.x2) / 2, cz = (b.z1 + b.z2) / 2, y = b.h + 0.01;
    I.box(cue, w + 0.04, 0.035, 0.05, cx, y, b.z1); I.box(cue, w + 0.04, 0.035, 0.05, cx, y, b.z2);
    I.box(cue, 0.05, 0.035, d, b.x1, y, cz); I.box(cue, 0.05, 0.035, d, b.x2, y, cz);
  }
  // ground chevron at the foot of every climb spot
  const chevGeo = new THREE.ConeGeometry(0.16, 0.3, 3); chevGeo.rotateX(Math.PI / 2);
  const chevron = (x, y, z, a, m = cue) => { const c = new THREE.Mesh(chevGeo, m); c.scale.y = 0.15; c.position.set(x, y + 0.03, z); c.rotation.y = -a + Math.PI / 2; scene.add(c); return c; };
  const pipeMat = lam(0x4f5d52), ropeMat = lam(0x8d6b3a);
  CLIMBS.forEach((c, i) => {
    const dx = Math.cos(c.a), dz = Math.sin(c.a), tx = -dz, tz = dx; // tangent along the wall
    const fx = c.x + dx * 0.34, fz = c.z + dz * 0.34, y0 = c.y0 || 0; // just off the wall face
    if (c.kind === 'ladder') {
      const h = c.top - y0 + 0.55;
      for (const s of [-0.24, 0.24]) I.box(yellow, Math.abs(tx) * 0.05 + 0.05, h, Math.abs(tz) * 0.05 + 0.05, fx + tx * s, y0 + h / 2, fz + tz * s);
      for (let y = y0 + 0.3; y < c.top + 0.05; y += 0.3) I.box(metal, Math.abs(tx) * 0.48 + 0.035, 0.035, Math.abs(tz) * 0.48 + 0.035, fx, y, fz);
      // grab hoops over the lip
      for (const s of [-0.24, 0.24]) I.box(yellow, Math.abs(dx) * 0.32 + 0.05, 0.05, Math.abs(dz) * 0.32 + 0.05, fx + tx * s + dx * 0.16, y0 + h, fz + tz * s + dz * 0.16);
    } else if (c.kind === 'net') {
      // Cargo net: a rope grid on the wall. You still climb the centre, same as a ladder.
      const span = c.span || 1.6, h = c.top - y0;
      const ropes = Math.max(2, Math.round(span / 0.4));
      for (let k = 0; k < ropes; k++) {
        const s = (k / (ropes - 1) - 0.5) * span;
        I.box(ropeMat, Math.abs(tx) * 0.04 + 0.035, h, Math.abs(tz) * 0.04 + 0.035, fx + tx * s, y0 + h / 2, fz + tz * s);
      }
      for (let y = y0 + 0.35; y < c.top - 0.05; y += 0.4) I.box(ropeMat, Math.abs(tx) * span + 0.04, 0.04, Math.abs(tz) * span + 0.04, fx, y, fz);
    } else {
      const len = c.top - y0 + 0.2;
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, len, 6), pipeMat); pipe.position.set(fx + dx * 0.04, y0 + len / 2, fz + dz * 0.04); scene.add(pipe);
      for (let y = y0 + 0.5; y < c.top; y += 0.7) I.box(metal, Math.abs(dx) * 0.12 + 0.04 + Math.abs(tx) * 0.16, 0.04, Math.abs(dz) * 0.12 + 0.04 + Math.abs(tz) * 0.16, fx + dx * 0.1, y, fz + dz * 0.1);
      I.box(cue, 0.02, c.top - y0 + 0.1, 0.02, fx - dx * 0.03 + tx * 0.04, y0 + (c.top - y0 + 0.1) / 2, fz - dz * 0.03 + tz * 0.04);
    }
    hot.push({ mesh: chevron(c.x - dx * 0.2, y0, c.z - dz * 0.2, c.a), kind: 'climb', i });
  });
  // decks: one see-through slab each (own material so it can fade out when someone is underneath it) + grating stripes.
  // L2 decks are a lighter steel so the two layers read apart from straight above.
  const decks = [];
  for (const w of WALKS) {
    if (w.noDeck) continue;
    const lx = w.x2 - w.x1, lz = w.z2 - w.z1, cx = (w.x1 + w.x2) / 2, cz = (w.z1 + w.z2) / 2, hi = w.h > 5, sky = w.h > 8;
    const m = lam(sky ? 0x9aa8b0 : hi ? 0x7d8a92 : 0x5c666c, { transparent: true, opacity: DECK_A, depthWrite: false });
    const slab = boxAt(scene, lx, 0.14, lz, m, cx, w.h - 0.07, cz); slab.renderOrder = 2;
    const along = lx >= lz, gm = hi ? rust : metal;
    if (along) for (let x = w.x1 + 0.3; x < w.x2; x += 0.6) I.box(gm, 0.04, 0.02, lz, x, w.h + 0.005, cz);
    else for (let z = w.z1 + 0.3; z < w.z2; z += 0.6) I.box(gm, lx, 0.02, 0.04, cx, w.h + 0.005, z);
    decks.push({ w, m, k: DECK_A });
  }
  for (const r of RAILS) {
    const lx = r.x2 - r.x1, lz = r.z2 - r.z1, cx = (r.x1 + r.x2) / 2, cz = (r.z1 + r.z2) / 2;
    I.box(rust, lx, 0.05, lz, cx, r.h - 0.02, cz); I.box(rust, lx, 0.04, lz, cx, r.y0 + 0.45, cz);
    const along = lx > lz, len = along ? lx : lz, n = Math.max(1, Math.round(len / 1.1));
    for (let k = 0; k <= n; k++) { const s = (k / n) * len; I.box(rust, 0.05, r.h - r.y0, 0.05, along ? r.x1 + s : cx, (r.y0 + r.h) / 2, along ? cz : r.z1 + s); }
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
  // grapple walls: orange anchor plate + scuffed boot-mark stripe down the face, foot ring on the floor, top ring
  // behind the lip, small glow over the anchor
  const hookMat = basic(0xff8a2a), scuff = basic(0x1a1612, 0.55), seen = [];
  const ringMat = () => new THREE.MeshBasicMaterial({ color: 0xff9a40, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
  const glowGeo = new THREE.OctahedronGeometry(0.08, 0);
  LINKS.forEach((L, i) => {
    const tx = -L.dz, tz = L.dx, A = L.anchor;
    // anchor plate bolted at the lip (on the rail: a clamp bar)
    I.box(hookMat, Math.abs(L.dx) * 0.05 + Math.abs(tx) * 0.34, L.rail ? 0.06 : 0.12, Math.abs(L.dz) * 0.05 + Math.abs(tz) * 0.34, L.face.x - L.dx * 0.02, A.y - (L.rail ? 0.03 : 0.08), L.face.z - L.dz * 0.02);
    if (!L.rail) for (let y = L.y0 + 0.35; y < L.top - 0.3; y += 0.42) // boot scuffs: tells you this face takes a rope
      I.box(scuff, Math.abs(L.dx) * 0.012 + Math.abs(tx) * 0.16, 0.06, Math.abs(L.dz) * 0.012 + Math.abs(tz) * 0.16, L.face.x - L.dx * 0.012 + tx * ((y * 7) % 0.1 - 0.05), y, L.face.z - L.dz * 0.012 + tz * ((y * 7) % 0.1 - 0.05));
    const glow = new THREE.Mesh(glowGeo, basic(0xffc070, 0.9)); glow.position.set(L.face.x - L.dx * 0.12, A.y + 0.22, L.face.z - L.dz * 0.12); scene.add(glow);
    seen.push({ glow });
    const ring = (p, r) => { const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.1, r, 16), ringMat()); m.rotation.x = -Math.PI / 2; m.position.set(p.x, p.y + 0.03, p.z); scene.add(m); return m; };
    const bot = ring({ x: L.foot.x - L.dx * 0.12, y: L.y0, z: L.foot.z - L.dz * 0.12 }, 0.62), top = ring(L.landP, 0.52);
    const ch = chevron(L.foot.x + L.dx * 0.2, L.y0, L.foot.z + L.dz * 0.2, L.a, bot.material);
    const chT = chevron(L.landP.x - L.dx * 0.28, L.top, L.landP.z - L.dz * 0.28, L.a + Math.PI, top.material);
    hot.push({ mesh: bot, kind: 'link', i, extra: ch }, { mesh: top, kind: 'linkTop', i, extra: chT }); // foot ring = rope pickup (haul) point
  });
  I.flush();
  let t = 0;
  return {
    anchorFor: (i) => LINKS[i].anchor,
    // near = { kind, i } of whatever ACT would use right now (or null): brighten it.
    // viewers = [{x, y, z}] players: a deck fades out while one of them is under it (or hidden behind it from the camera)
    tick(dt, near, viewers = []) {
      t += dt;
      for (const h of hot) {
        const on = near && near.kind === h.kind && near.i === h.i;
        if (h.kind === 'link' || h.kind === 'linkTop') { h.mesh.material.opacity = on ? 0.85 : 0.28 + 0.1 * Math.sin(t * 2 + h.i); }
        else if (h.kind === 'climb') h.mesh.material = on ? cueHot : cue;
        else h.mesh.material.opacity = on ? 1 : 0.55;
      }
      for (const { glow } of seen) { glow.rotation.y += dt * 2; glow.material.opacity = 0.6 + 0.35 * Math.sin(t * 3); }
      for (const d of decks) {
        const w = d.w, under = viewers.some((v) => v && v.y < w.h - 0.8 && occludes(w, w.h, v));
        d.k += ((under ? DECK_FADE : DECK_A) - d.k) * Math.min(1, dt * 8); d.m.opacity = d.k;
      }
    },
  };
}
const DECK_A = 0.8, DECK_FADE = 0.18;
/**
 * Does something with footprint b (x1..x2, z1..z2) and top height h hide player v from the angled top-down camera?
 * The camera sits south (+z) and above, looking north-down (~0.6 m of northward shift per metre of height), so a thing
 * of height h covers the player if he is under it or up to (h - his chest) * 0.6 m north of it.
 */
export function occludes(b, h, v, pad = 0.6) {
  const rise = Math.max(0, h - (v.y + 1.1)) * 0.62;
  return v.x > b.x1 - pad && v.x < b.x2 + pad && v.z < b.z2 + pad && v.z > b.z1 - rise - pad;
}
