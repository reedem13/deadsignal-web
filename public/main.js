// Project Deadsignal - browser co-op stealth prototype.
// Camera choice: fixed angled top-down follow cam (north is always up) - easiest to read & control on phones.
// Netcode: listen-server style. Host simulates guards, alert, door, extract & win. Each client owns its own
// movement (sent 20x/s); host broadcasts world state 15x/s. Messages go through server.js (WebSocket relay).
import * as THREE from 'three';

// ---------------------------------------------------------------- level data (greybox yard)
const B = (cx, cz, w, d, h, kind = 'crate') => ({ x1: cx - w / 2, x2: cx + w / 2, z1: cz - d / 2, z2: cz + d / 2, h, kind });
const WALLS = [
  // outer fence
  B(0, -15.5, 42, 1, 2.5, 'wall'), B(0, 15.5, 42, 1, 2.5, 'wall'), B(-20.5, 0, 1, 32, 2.5, 'wall'), B(20.5, 0, 1, 32, 2.5, 'wall'),
  // extraction compound (north-east), door between the two switches
  B(7, -8.25, 6, 0.5, 2.5, 'wall'), B(16.5, -8.25, 7, 0.5, 2.5, 'wall'), B(4.25, -11.75, 0.5, 7, 2.5, 'wall'),
  B(11.5, -8.25, 3, 0.5, 2.5, 'door'),
  // cover: building (tall) and crates (low: crouch behind them to break line of sight)
  B(-8, -6, 6, 5, 3, 'building'),
  B(0, 1, 2, 2, 1), B(-4, 8, 1.5, 1.5, 1), B(7, 6, 3, 1.5, 1), B(12, 2, 2, 4, 2.2, 'building'), B(-14, 0, 2, 2, 1),
  B(-2, -4, 1.5, 3, 1), B(16, 8, 2, 2, 1), B(-11, 12, 1.2, 2.5, 1), B(9, -3, 1.5, 1.5, 1),
];
const SWITCHES = [{ x: 6.5, z: -6.6 }, { x: 16.5, z: -6.6 }]; // 10 units apart -> one person can't hit both in time
const EXTRACT = { x: 16, z: -12, r: 2.2 };
const SPAWNS = [{ x: -17, z: 13 }, { x: -15.5, z: 13.2 }];
const GUARD_PATHS = [
  [[-7, 4], [5, 4], [5, 10], [-7, 10]],
  [[2, -5.2], [19, -5.2]],
  [[-17, -1], [-17, -12], [-2, -12], [-2, -7], [-2, -12], [-17, -12]],
];
const SWITCH_WINDOW = 2.0; // seconds both switches must overlap
const SPEED = { crouch: 1.8, walk: 3.2, run: 5.2, patrol: 1.8, investigate: 2.6, chase: 4.6 };
const NOISE = { run: 6, walk: 2.2 };
const SIGHT = { stand: 9, crouch: 6, fovHalf: 0.62 };
const ALERT_TIME = 15, CAUTION_TIME = 10;

// ---------------------------------------------------------------- params / state
const qs = new URLSearchParams(location.search);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (!isTouch) document.body.classList.add('desktop');
const $ = (id) => document.getElementById(id);

let role = null;          // 'host' | 'guest'
let solo = false;
let roomCode = '';
let peerConnected = false;
const me = { x: SPAWNS[0].x, z: SPAWNS[0].z, a: -Math.PI / 2, c: false, run: false, moving: false };
const other = { x: SPAWNS[1].x, z: SPAWNS[1].z, a: -Math.PI / 2, c: false, noise: 0, inv: 0, rx: SPAWNS[1].x, rz: SPAWNS[1].z, ra: 0 };
let world = freshWorld();
let lastAlert = 0, lastPhase = 'play';

function freshWorld() {
  return {
    guards: GUARD_PATHS.map((p) => ({ x: p[0][0], z: p[0][1], a: 0, path: p, wp: 1, st: 'patrol', meter: 0, tx: 0, tz: 0, wait: 0, give: 0,
      rx: p[0][0], rz: p[0][1], ra: 0 })),
    alert: 0, alertT: 0, cautionT: 0, sw: [0, 0], swBy: [-1, -1], door: false, phase: 'play', t: 0, caught: 0, alerts: 0,
    ext: [false, false], inv: [0, 0], finalT: 0, dead: -1, // dead: index of the player who died (-1 = nobody)
  };
}

// ---------------------------------------------------------------- math / collision helpers
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const solids = () => WALLS.filter((w) => !(w.kind === 'door' && world.door));

function collide(p, r) {
  for (let it = 0; it < 2; it++) for (const b of solids()) {
    const cx = clamp(p.x, b.x1, b.x2), cz = clamp(p.z, b.z1, b.z2);
    const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) { const d = Math.sqrt(d2); p.x += (dx / d) * (r - d); p.z += (dz / d) * (r - d); }
    else { // centre inside box: push out along smallest penetration
      const pen = [p.x - b.x1 + r, b.x2 - p.x + r, p.z - b.z1 + r, b.z2 - p.z + r], m = Math.min(...pen);
      if (m === pen[0]) p.x -= pen[0]; else if (m === pen[1]) p.x += pen[1]; else if (m === pen[2]) p.z -= pen[2]; else p.z += pen[3];
    }
  }
}
function segHitsBox(ax, az, bx, bz, b) {
  let t0 = 0, t1 = 1; const dx = bx - ax, dz = bz - az;
  for (const [p, d, lo, hi] of [[ax, dx, b.x1, b.x2], [az, dz, b.z1, b.z2]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; }
    else { let ta = (lo - p) / d, tb = (hi - p) / d; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return false; }
  }
  return true;
}
// low crates (h < 1.3) only hide a crouching target
function lineOfSight(g, p) {
  for (const b of solids()) { if (b.h < 1.3 && !p.c) continue; if (segHitsBox(g.x, g.z, p.x, p.z, b)) return false; }
  return true;
}
function moveToward(o, tx, tz, speed, dt, r = 0.45) {
  const dx = tx - o.x, dz = tz - o.z, d = Math.hypot(dx, dz);
  if (d < 0.15) return true;
  const s = Math.min(d, speed * dt);
  const px = o.x, pz = o.z;
  o.x += (dx / d) * s; o.z += (dz / d) * s; collide(o, r);
  turnToward(o, Math.atan2(dz, dx), dt * 6);
  if (Math.hypot(o.x - px, o.z - pz) < s * 0.2) o.stuck = (o.stuck || 0) + dt; else o.stuck = 0;
  return false;
}
function turnToward(o, a, maxStep) { const d = angDiff(a, o.a); o.a += clamp(d, -maxStep, maxStep); }

// ---------------------------------------------------------------- three.js scene
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const PIXEL_SCALE = 0.5; // chunky PS1-ish pixels, also keeps phones fast
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1418);
scene.fog = new THREE.Fog(0x0a1418, 22, 48);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 160);
scene.add(new THREE.HemisphereLight(0x9fc3d9, 0x1a2a20, 1.1));
const sun = new THREE.DirectionalLight(0xbfd8ff, 0.9); sun.position.set(-8, 20, 6); scene.add(sun);

const mat = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...extra });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(42, 32), mat(0x26352e));
ground.rotation.x = -Math.PI / 2; scene.add(ground);
const grid = new THREE.GridHelper(42, 21, 0x35503f, 0x2d4236); grid.position.y = 0.01; scene.add(grid);
const compoundFloor = new THREE.Mesh(new THREE.PlaneGeometry(15.5, 6.5), mat(0x2f3a44));
compoundFloor.rotation.x = -Math.PI / 2; compoundFloor.position.set(12.25, 0.02, -11.75); scene.add(compoundFloor);

const COLORS = { wall: 0x56636b, building: 0x4a5866, crate: 0x7a6440, door: 0x9a2a2a };
let doorMesh = null;
for (const w of WALLS) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w.x2 - w.x1, w.h, w.z2 - w.z1), mat(COLORS[w.kind]));
  m.position.set((w.x1 + w.x2) / 2, w.h / 2, (w.z1 + w.z2) / 2); scene.add(m);
  if (w.kind === 'door') doorMesh = m;
}
const switchMeshes = SWITCHES.map((s) => {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.08, 12), new THREE.MeshBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.6 }));
  pad.position.y = 0.04; g.add(pad);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.1, 0.3), mat(0x888888)); post.position.set(0, 0.55, -0.9); g.add(post);
  const light = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.32), new THREE.MeshBasicMaterial({ color: 0x660000 })); light.position.set(0, 1.0, -0.9); g.add(light);
  g.position.set(s.x, 0, s.z); scene.add(g);
  return { pad, light };
});
const extractMesh = new THREE.Mesh(new THREE.RingGeometry(EXTRACT.r - 0.3, EXTRACT.r, 24), new THREE.MeshBasicMaterial({ color: 0x40ff80, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
extractMesh.rotation.x = -Math.PI / 2; extractMesh.position.set(EXTRACT.x, 0.05, EXTRACT.z); scene.add(extractMesh);

function makeCharacter(bodyColor, headColor) {
  const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.6), mat(0x223028)); legs.position.y = 0.3; inner.add(legs);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.75), mat(bodyColor)); body.position.y = 0.9; inner.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.38, 0.4), mat(headColor)); head.position.y = 1.4; inner.add(head);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.2), mat(0x111111)); nose.position.set(0.28, 1.42, 0); inner.add(nose);
  scene.add(g); return { g, inner };
}
function marker(color) { // little floating triangle so you can find each other
  const m = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.4, 3), new THREE.MeshBasicMaterial({ color }));
  m.rotation.x = Math.PI; return m;
}
const meMesh = makeCharacter(0x3a6ea8, 0xd8b090);
const otherMesh = makeCharacter(0x3f8f4a, 0xd8b090);
for (const [ch, col] of [[meMesh, 0x6fb0ff], [otherMesh, 0x7fff8f]]) { const m = marker(col); m.position.y = 2.1; ch.g.add(m); }

function textSprite(txt, color) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  x.font = 'bold 56px monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 8; x.strokeStyle = '#000'; x.strokeText(txt, 32, 34); x.fillStyle = color; x.fillText(txt, 32, 34);
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false })); s.scale.set(1.1, 1.1, 1); s.position.y = 2.4; return s;
}
const guardMeshes = GUARD_PATHS.map(() => {
  const ch = makeCharacter(0x6d4a3a, 0x9b8a6a);
  const coneMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  const cone = new THREE.Mesh(new THREE.CircleGeometry(1, 18, -SIGHT.fovHalf, SIGHT.fovHalf * 2), coneMat);
  cone.rotation.x = -Math.PI / 2; cone.position.y = 0.06;
  const coneHolder = new THREE.Group(); coneHolder.add(cone); ch.g.add(coneHolder);
  const q = textSprite('?', '#ffe066'), ex = textSprite('!', '#ff4040'); ch.g.add(q, ex);
  return { ...ch, cone, coneMat, coneHolder, q, ex };
});

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2) * PIXEL_SCALE);
  renderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ---------------------------------------------------------------- audio (unlocked on first tap - required on iOS)
let actx = null;
function unlockAudio() { try { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch {} }
function beep(freq = 880, dur = 0.12, type = 'square', vol = 0.08) {
  if (!actx) return;
  const o = actx.createOscillator(), g = actx.createGain(); o.type = type; o.frequency.value = freq; g.gain.value = vol;
  o.connect(g); g.connect(actx.destination); o.start(); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur); o.stop(actx.currentTime + dur);
}
const alertSound = () => { beep(1046, 0.1); setTimeout(() => beep(1396, 0.25), 110); };

// ---------------------------------------------------------------- input
const input = { jx: 0, jz: 0, kRun: false, keys: new Set() };
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  input.keys.add(e.code);
  if (e.code === 'KeyC' || e.code === 'ControlLeft') toggleCrouch();
  if (e.code === 'KeyE' || e.code === 'Space') { e.preventDefault(); doInteract(); }
});
addEventListener('keyup', (e) => input.keys.delete(e.code));
addEventListener('blur', () => input.keys.clear());

const zone = $('stickZone'), base = $('stickBase'), knob = $('stickKnob');
let stickId = null, sx = 0, sy = 0;
const R = 60;
zone.addEventListener('pointerdown', (e) => {
  unlockAudio(); if (stickId !== null) return;
  stickId = e.pointerId; sx = e.clientX; sy = e.clientY; zone.setPointerCapture(e.pointerId);
  base.style.left = sx + 'px'; base.style.top = (sy - zone.getBoundingClientRect().top) + 'px'; base.classList.remove('hidden');
  knob.style.transform = 'translate(0,0)';
});
zone.addEventListener('pointermove', (e) => {
  if (e.pointerId !== stickId) return;
  let dx = e.clientX - sx, dy = e.clientY - sy; const d = Math.hypot(dx, dy);
  if (d > R) { dx *= R / d; dy *= R / d; }
  knob.style.transform = `translate(${dx}px,${dy}px)`;
  input.jx = dx / R; input.jz = dy / R;
});
const endStick = (e) => { if (e.pointerId !== stickId) return; stickId = null; input.jx = input.jz = 0; base.classList.add('hidden'); };
zone.addEventListener('pointerup', endStick); zone.addEventListener('pointercancel', endStick);
$('btnCrouch').addEventListener('pointerdown', (e) => { e.preventDefault(); unlockAudio(); toggleCrouch(); });
$('btnAct').addEventListener('pointerdown', (e) => { e.preventDefault(); unlockAudio(); doInteract(); });
document.addEventListener('touchmove', (e) => { if (!e.target.closest('.panel')) e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

function toggleCrouch() { me.c = !me.c; $('btnCrouch').classList.toggle('on', me.c); }
function flash(el) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 180); }
function doInteract() {
  if (!role || world.phase !== 'play') return;
  flash($('btnAct'));
  const near = SWITCHES.some((s) => Math.hypot(me.x - s.x, me.z - s.z) < 1.8);
  if (!near) { toast('Nothing to use here', 900, '#ccc'); return; }
  beep(660, 0.08);
  if (role === 'host') armSwitch(0); else net.relay({ t: 'i' });
}

// ---------------------------------------------------------------- local movement (both roles)
function updateLocal(dt) {
  let jx = input.jx, jz = input.jz, kb = false;
  const k = input.keys;
  if (k.has('KeyA') || k.has('ArrowLeft')) { jx -= 1; kb = true; }
  if (k.has('KeyD') || k.has('ArrowRight')) { jx += 1; kb = true; }
  if (k.has('KeyW') || k.has('ArrowUp')) { jz -= 1; kb = true; }
  if (k.has('KeyS') || k.has('ArrowDown')) { jz += 1; kb = true; }
  let mag = Math.hypot(jx, jz);
  if (mag > 1) { jx /= mag; jz /= mag; mag = 1; }
  me.moving = mag > 0.15 && world.phase === 'play';
  me.run = me.moving && !me.c && (kb ? (k.has('ShiftLeft') || k.has('ShiftRight')) : mag > 0.92);
  if (me.moving) {
    const sp = me.c ? SPEED.crouch : me.run ? SPEED.run : SPEED.walk * (kb ? 1 : clamp(mag / 0.9, 0.4, 1));
    me.x += (jx / mag) * sp * dt; me.z += (jz / mag) * sp * dt; collide(me, 0.38);
    turnToward(me, Math.atan2(jz, jx), dt * 14);
  }
  $('stance').textContent = me.c ? 'CROUCH (silent)' : me.run ? 'RUN (loud!)' : me.moving ? 'WALK' : 'STILL';
}
const noiseOf = (p) => (!p.moving ? 0 : p.run ? NOISE.run : p.c ? 0 : NOISE.walk);

// ---------------------------------------------------------------- host simulation (authoritative)
function players() {
  const list = [{ x: me.x, z: me.z, c: me.c, noise: noiseOf(me), idx: 0 }];
  if (peerConnected) list.push({ x: other.x, z: other.z, c: other.c, noise: other.noise, idx: 1 });
  return list;
}
function armSwitch(pi) {
  const p = pi === 0 ? me : other;
  SWITCHES.forEach((s, i) => {
    if (Math.hypot(p.x - s.x, p.z - s.z) < 1.8) { world.sw[i] = SWITCH_WINDOW; world.swBy[i] = pi; }
  });
  if (!world.door && world.sw[0] > 0 && world.sw[1] > 0 && (solo || world.swBy[0] !== world.swBy[1])) world.door = true;
  if (solo && !world.door && (world.sw[0] > 0 || world.sw[1] > 0)) world.door = true;
}
function triggerAlert(p) {
  if (world.alert < 2) { world.alerts++; }
  world.alert = 2; world.alertT = ALERT_TIME;
  for (const g of world.guards) { g.st = 'chase'; g.tx = p.x; g.tz = p.z; g.give = 8; }
}
// Being caught = death = GAME OVER for both players. Host decides; phase 'over' is broadcast in every state packet.
function catchPlayer(idx) {
  if (world.phase !== 'play') return;
  world.caught++; world.dead = idx; world.phase = 'over'; world.finalT = world.t;
  if (peerConnected) sendState(); // push immediately so both screens flip together
}
function hostUpdate(dt) {
  if (world.phase !== 'play') return;
  world.t += dt;
  world.inv = world.inv.map((v) => Math.max(0, v - dt));
  world.sw = world.sw.map((v) => Math.max(0, v - dt));
  const ps = players();
  let anySeen = false;
  for (const g of world.guards) {
    // --- sight
    let seen = null, seenD = 1e9, seenRange = 1;
    for (const p of ps) {
      if (world.inv[p.idx] > 0) continue;
      const dx = p.x - g.x, dz = p.z - g.z, d = Math.hypot(dx, dz);
      const range = (p.c ? SIGHT.crouch : SIGHT.stand) + (world.alert > 0 ? 2 : 0);
      if (d > range) continue;
      if ((Math.abs(angDiff(Math.atan2(dz, dx), g.a)) < SIGHT.fovHalf || d < 1.1) && lineOfSight(g, p) && d < seenD) { seen = p; seenD = d; seenRange = range; }
    }
    if (seen) {
      anySeen = true;
      const rate = (world.alert === 2 ? 6 : world.alert === 1 ? 2.2 : 1.3) * (1 + 2 * (1 - seenD / seenRange)) * (seen.c ? 0.6 : 1);
      g.meter = Math.min(1, g.meter + rate * dt);
      if (g.meter >= 1) { triggerAlert(seen); }
      if (world.alert === 2) { g.st = 'chase'; g.tx = seen.x; g.tz = seen.z; g.give = 8; world.alertT = ALERT_TIME; }
      else if (g.meter > 0.3 && g.st !== 'chase') { g.st = 'investigate'; g.tx = seen.x; g.tz = seen.z; g.wait = 3; g.give = 7; }
    } else g.meter = Math.max(0, g.meter - 0.3 * dt);
    // --- hearing
    if (g.st === 'patrol' || g.st === 'investigate' || g.st === 'search') {
      for (const p of ps) if (p.noise > 0 && Math.hypot(p.x - g.x, p.z - g.z) < p.noise) {
        g.st = 'investigate'; g.tx = p.x; g.tz = p.z; g.wait = 3; g.give = 7; g.meter = Math.max(g.meter, 0.35);
      }
    }
    // --- act
    if (g.st === 'patrol') {
      const [tx, tz] = g.path[g.wp];
      if (moveToward(g, tx, tz, SPEED.patrol, dt)) g.wp = (g.wp + 1) % g.path.length;
    } else if (g.st === 'investigate') {
      g.give -= dt;
      if (moveToward(g, g.tx, g.tz, SPEED.investigate, dt) || g.give <= 0 || g.stuck > 1) {
        g.wait -= dt; g.a += Math.sin(world.t * 2.5) * dt * 2.2; // look around
        if (g.wait <= 0) g.st = 'patrol';
      }
    } else if (g.st === 'chase') {
      g.give -= dt;
      if (moveToward(g, g.tx, g.tz, SPEED.chase, dt) || g.give <= 0 || g.stuck > 1) { g.st = 'search'; g.wait = 2.5; }
    } else if (g.st === 'search') {
      g.a += dt * 2.4; g.wait -= dt;
      if (g.wait <= 0) { g.st = 'chase'; g.tx = clamp(g.x + (Math.random() - 0.5) * 10, -19, 19); g.tz = clamp(g.z + (Math.random() - 0.5) * 10, -14, 14); g.give = 4; }
    }
    // --- catch
    if (world.alert === 2 && world.phase === 'play') for (const p of ps) if (world.inv[p.idx] <= 0 && Math.hypot(p.x - g.x, p.z - g.z) < 0.95) { catchPlayer(p.idx); break; }
    if (world.phase !== 'play') return;
  }
  // --- alert phases
  if (world.alert === 2 && !anySeen) { world.alertT -= dt; if (world.alertT <= 0) { world.alert = 1; world.cautionT = CAUTION_TIME; world.guards.forEach((g) => { g.st = 'patrol'; g.meter = 0; }); } }
  else if (world.alert === 1) { world.cautionT -= dt; if (world.cautionT <= 0) world.alert = 0; }
  // --- extract
  world.ext = [Math.hypot(me.x - EXTRACT.x, me.z - EXTRACT.z) < EXTRACT.r, peerConnected && Math.hypot(other.x - EXTRACT.x, other.z - EXTRACT.z) < EXTRACT.r];
  if (world.door && world.ext[0] && (solo || world.ext[1])) { world.phase = 'win'; world.finalT = world.t; }
}
function hostRestart() {
  world = freshWorld();
  me.x = SPAWNS[0].x; me.z = SPAWNS[0].z; other.x = other.rx = SPAWNS[1].x; other.z = other.rz = SPAWNS[1].z;
  net.relay({ t: 'tp', x: SPAWNS[1].x, z: SPAWNS[1].z, silent: true });
  sendState();
}

// ---------------------------------------------------------------- network
const r2 = (v) => Math.round(v * 100) / 100;
function sendState() {
  net.relay({ t: 's',
    g: world.guards.map((g) => [r2(g.x), r2(g.z), r2(g.a), g.st[0], r2(g.meter)]),
    al: world.alert, at: r2(world.alertT), sw: world.sw.map(r2), door: world.door, ph: world.phase, tm: r2(world.t), ft: r2(world.finalT), dd: world.dead,
    c: world.caught, n: world.alerts, ext: world.ext, solo,
    h: [r2(me.x), r2(me.z), r2(me.a), me.c ? 1 : 0] });
}
function sendPlayer() { net.relay({ t: 'p', x: r2(me.x), z: r2(me.z), a: r2(me.a), c: me.c ? 1 : 0, n: noiseOf(me) }); }

function onGameMsg(d) {
  if (d.t === 'p' && role === 'host') { other.x = d.x; other.z = d.z; other.a = d.a; other.c = !!d.c; other.noise = d.n || 0; }
  else if (d.t === 'i' && role === 'host') { if (world.phase === 'play') armSwitch(1); }
  else if (d.t === 'r' && role === 'host') { if (world.phase !== 'play') hostRestart(); }
  else if (d.t === 's' && role === 'guest') {
    d.g.forEach((a, i) => { const g = world.guards[i]; if (!g) return; g.x = a[0]; g.z = a[1]; g.a = a[2]; g.st = { p: 'patrol', i: 'investigate', c: 'chase', s: 'search' }[a[3]]; g.meter = a[4]; });
    Object.assign(world, { alert: d.al, alertT: d.at, sw: d.sw, door: d.door, phase: d.ph, t: d.tm, finalT: d.ft, caught: d.c, alerts: d.n, ext: d.ext, dead: d.dd ?? -1 });
    solo = d.solo;
    other.x = d.h[0]; other.z = d.h[1]; other.a = d.h[2]; other.c = !!d.h[3];
  } else if (d.t === 'tp' && role === 'guest') {
    me.x = d.x; me.z = d.z; if (!d.silent) toast('CAUGHT! Back to start', 1600);
  }
}

const net = {
  ws: null, url: null, wantRoom: null, retry: 0, pingT: 0, rtt: 0,
  connect() {
    const u = qs.get('server') || ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    this.url = u;
    const ws = new WebSocket(u); this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      if (role === 'host') ws.send(JSON.stringify({ t: 'create', code: roomCode || undefined, resume: !!roomCode }));
      else ws.send(JSON.stringify({ t: 'join', code: roomCode }));
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === 'msg') onGameMsg(m.d);
      else if (m.t === 'created' || m.t === 'joined') { roomCode = m.code; setPeer(!!m.peer); enterGame(); }
      else if (m.t === 'peer-joined') { setPeer(true); if (role === 'host') sendState(); }
      else if (m.t === 'peer-left') setPeer(false);
      else if (m.t === 'pong') { this.rtt = performance.now() - m.ts; $('ping').textContent = Math.round(this.rtt) + 'ms'; }
      else if (m.t === 'error') { this.fatal = true; ws.close(); showLobby(m.msg); }
    };
    ws.onclose = () => {
      if (this.fatal || !role) { this.fatal = false; return; }
      setPeer(false); $('peerStatus').textContent = 'reconnecting...';
      this.retry++; setTimeout(() => this.connect(), Math.min(5000, 400 * this.retry));
    };
    ws.onerror = () => { if (!roomCode && role) { /* first connect failed */ } };
  },
  relay(d) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'relay', d })); },
};
// iOS freezes background tabs; when we come back make sure the socket is alive.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && role && net.ws && net.ws.readyState > 1) net.connect();
});

function setPeer(v) {
  peerConnected = v;
  const el = $('peerStatus');
  el.textContent = solo ? 'solo test' : v ? (role === 'host' ? 'partner in' : 'with host') : (role === 'host' ? 'waiting for partner' : 'host offline');
  el.className = v || solo ? 'good' : 'bad';
  $('btnShare').classList.toggle('hidden', role !== 'host' || v || solo);
}

// ---------------------------------------------------------------- lobby / UI
function joinLink() { return location.origin + location.pathname + '?room=' + roomCode + (qs.get('server') ? '&server=' + encodeURIComponent(qs.get('server')) : ''); }
function showLobby(msg) {
  role = null; world = freshWorld(); lastPhase = 'play'; lastAlert = 0; peerConnected = false;
  me.c = false; $('btnCrouch').classList.remove('on'); $('lobby').classList.remove('hidden'); $('hud').classList.add('hidden'); $('overlay').classList.add('hidden');
  $('lobbyMsg').textContent = msg || '';
}
function enterGame() {
  if (!$('lobby').classList.contains('hidden')) {
    $('lobby').classList.add('hidden'); $('hud').classList.remove('hidden');
    const s = SPAWNS[role === 'host' ? 0 : 1]; me.x = s.x; me.z = s.z;
    if (role === 'host' && !solo) toast('Room ' + roomCode + ' - share the link', 2500, '#7fff9f');
  }
  $('roomCode').textContent = solo ? 'SOLO' : roomCode;
  history.replaceState(null, '', role === 'guest' ? joinLink() : location.pathname + (qs.get('server') ? '?server=' + encodeURIComponent(qs.get('server')) : ''));
}
$('btnHost').onclick = () => {
  unlockAudio(); role = 'host'; solo = $('soloBox').checked; roomCode = '';
  $('lobbyMsg').textContent = 'Connecting...'; net.connect();
};
$('btnJoin').onclick = () => {
  unlockAudio(); const c = $('codeInput').value.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(c)) { $('lobbyMsg').textContent = 'Enter the 4-letter room code.'; return; }
  role = 'guest'; roomCode = c; $('lobbyMsg').textContent = 'Joining ' + c + '...'; net.connect();
};
$('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });
$('btnShare').onclick = async () => {
  const url = joinLink();
  try {
    if (navigator.share) await navigator.share({ title: 'Project Deadsignal', text: 'Join my mission - code ' + roomCode, url });
    else { await navigator.clipboard.writeText(url); toast('Link copied', 1200, '#7fff9f'); }
  } catch { prompt('Send this link to your partner:', url); }
};
if (qs.get('room')) {
  $('codeInput').value = qs.get('room').toUpperCase().slice(0, 4);
  $('btnJoin').textContent = 'JOIN ' + $('codeInput').value;
  $('lobbyMsg').textContent = 'Tap JOIN to enter your partner\'s mission.';
}
let toastTimer = 0;
function toast(msg, ms = 1500, color = '#fff') {
  const t = $('toast'); t.textContent = msg; t.style.color = color; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}
function rank() {
  const t = world.finalT, a = world.alerts, c = world.caught;
  if (a === 0 && c === 0 && t < 240) return 'PHANTOM';
  if (a <= 1 && c === 0) return 'SHADOW';
  if (a <= 3 && c <= 2) return 'OPERATIVE';
  return 'ROOKIE';
}
const myIdx = () => (role === 'host' ? 0 : 1);
function fmtTime(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; }
function updateOverlay() {
  if (world.phase !== lastPhase && world.phase !== 'play') {
    const btn = $('ovBtn');
    if (world.phase === 'win') {
      beep(523, 0.15, 'triangle', 0.1); setTimeout(() => beep(784, 0.3, 'triangle', 0.1), 160);
      $('overlay').classList.remove('over');
      $('ovTitle').textContent = 'MISSION COMPLETE';
      $('ovBody').innerHTML = `Time ${fmtTime(world.finalT)}<br>Alerts ${world.alerts}<br>Rank: <b>${rank()}</b>`;
      btn.textContent = 'RUN IT AGAIN';
    } else if (world.phase === 'over') {
      beep(220, 0.25, 'sawtooth', 0.1); setTimeout(() => beep(110, 0.6, 'sawtooth', 0.1), 220);
      if (navigator.vibrate) navigator.vibrate([300, 100, 500]);
      input.jx = input.jz = 0; input.keys.clear();
      $('overlay').classList.add('over');
      const who = solo ? 'You were caught.' : world.dead === myIdx() ? 'You were caught.' : 'Your partner was caught.';
      $('ovTitle').textContent = 'GAME OVER';
      $('ovBody').innerHTML = `${who}<br>Mission failed at ${fmtTime(world.finalT)} &middot; Alerts ${world.alerts}`;
      btn.textContent = 'RETRY';
    }
    btn.disabled = false;
    $('ovHint').textContent = role === 'host' || solo ? '' : 'Either player can tap RETRY to restart for both.';
    $('overlay').classList.remove('hidden');
  }
  if (world.phase === 'play' && lastPhase !== 'play') $('overlay').classList.add('hidden');
  lastPhase = world.phase;
}
$('ovBtn').onclick = () => {
  unlockAudio();
  if (role === 'host') { hostRestart(); $('overlay').classList.add('hidden'); }
  else if (role === 'guest') {
    if (!peerConnected) { $('ovHint').textContent = 'Host is offline - wait for them or go to Main Menu.'; return; }
    net.relay({ t: 'r' }); $('ovBtn').disabled = true; $('ovBtn').textContent = 'RESTARTING...';
  }
};
$('ovMenu').onclick = () => { // leave the room and go back to Host/Join
  net.fatal = true; if (net.ws) net.ws.close();
  roomCode = ''; showLobby(role === 'host' && !solo ? 'Room closed. Host a new mission or join one.' : '');
  history.replaceState(null, '', location.pathname + (qs.get('server') ? '?server=' + encodeURIComponent(qs.get('server')) : ''));
};

// ---------------------------------------------------------------- radar (top-right, Soliton-style)
const radar = $('radar'), rc = radar.getContext('2d');
function drawRadar() {
  const W = radar.width, H = radar.height, sx = W / 42, sz = H / 32;
  const X = (x) => (x + 21) * sx, Z = (z) => (z + 16) * sz;
  rc.fillStyle = world.alert === 2 ? 'rgba(90,10,10,0.9)' : 'rgba(0,30,18,0.9)'; rc.fillRect(0, 0, W, H);
  rc.fillStyle = '#3c7a55';
  for (const b of solids()) rc.fillRect(X(b.x1), Z(b.z1), (b.x2 - b.x1) * sx, (b.z2 - b.z1) * sz);
  rc.strokeStyle = '#7fff9f'; rc.beginPath(); rc.arc(X(EXTRACT.x), Z(EXTRACT.z), EXTRACT.r * sx, 0, 7); rc.stroke();
  for (const g of world.guards) {
    rc.fillStyle = 'rgba(255,224,102,0.35)'; rc.beginPath(); rc.moveTo(X(g.rx), Z(g.rz));
    rc.arc(X(g.rx), Z(g.rz), SIGHT.stand * sx, g.ra - SIGHT.fovHalf, g.ra + SIGHT.fovHalf); rc.fill();
    rc.fillStyle = '#ff5050'; rc.fillRect(X(g.rx) - 2, Z(g.rz) - 2, 4, 4);
  }
  if (peerConnected) { rc.fillStyle = '#7fff8f'; rc.fillRect(X(other.rx) - 3, Z(other.rz) - 3, 6, 6); }
  rc.fillStyle = '#ffffff'; rc.fillRect(X(me.x) - 3, Z(me.z) - 3, 6, 6);
}

// ---------------------------------------------------------------- render
const lerpA = (a, b, t) => a + angDiff(b, a) * t;
function render(dt) {
  const k = Math.min(1, dt * 12);
  // remote player smoothing
  other.rx += (other.x - other.rx) * k; other.rz += (other.z - other.rz) * k; other.ra = lerpA(other.ra, other.a, k);
  meMesh.g.position.set(me.x, 0, me.z); meMesh.g.rotation.y = -me.a; meMesh.inner.scale.y = me.c ? 0.6 : 1;
  const deadMe = world.phase === 'over' && world.dead === myIdx(), deadOther = world.phase === 'over' && world.dead === 1 - myIdx();
  meMesh.inner.rotation.z = deadMe ? -Math.PI / 2 : 0; meMesh.inner.position.y = deadMe ? 0.3 : 0;
  otherMesh.g.visible = peerConnected;
  otherMesh.g.position.set(other.rx, 0, other.rz); otherMesh.g.rotation.y = -other.ra; otherMesh.inner.scale.y = other.c ? 0.6 : 1;
  otherMesh.inner.rotation.z = deadOther ? -Math.PI / 2 : 0; otherMesh.inner.position.y = deadOther ? 0.3 : 0;
  world.guards.forEach((g, i) => {
    if (role === 'host') { g.rx = g.x; g.rz = g.z; g.ra = g.a; }
    else { g.rx += (g.x - g.rx) * k; g.rz += (g.z - g.rz) * k; g.ra = lerpA(g.ra, g.a, k); }
    const m = guardMeshes[i];
    m.g.position.set(g.rx, 0, g.rz); m.g.rotation.y = -g.ra;
    const range = SIGHT.stand + (world.alert > 0 ? 2 : 0);
    m.cone.scale.set(range, range, 1);
    m.coneMat.color.setHex(world.alert === 2 ? 0xff3030 : g.meter > 0.3 ? 0xffa030 : 0xffe066);
    m.coneMat.opacity = 0.18 + g.meter * 0.25;
    m.q.visible = g.st === 'investigate'; m.ex.visible = g.st === 'chase' || g.st === 'search';
  });
  // door + switches + extract
  doorMesh.position.y = THREE.MathUtils.lerp(doorMesh.position.y, world.door ? -1.2 : 1.25, Math.min(1, dt * 3));
  doorMesh.material.color.setHex(world.door ? 0x2a8a4a : 0x9a2a2a);
  switchMeshes.forEach((s, i) => {
    const armed = world.sw[i] > 0;
    s.pad.material.color.setHex(world.door ? 0x30c060 : armed ? 0xffd040 : 0x557766);
    s.light.material.color.setHex(world.door ? 0x40ff80 : armed ? 0xffd040 : 0x660000);
  });
  extractMesh.material.opacity = world.door ? 0.5 + 0.4 * Math.sin(performance.now() / 200) : 0.25;
  // camera: angled top-down follow, zoomed out a bit more in portrait
  const zoom = (camera.aspect < 1 ? 1.35 + (1 - camera.aspect) * 0.7 : 1) * 1.25;
  const camDist = Math.hypot(15, 9) * zoom; scene.fog.near = camDist + 4; scene.fog.far = camDist + 30;
  const tx = me.x, tz = me.z;
  camera.position.x += (tx - camera.position.x) * Math.min(1, dt * 6);
  camera.position.z += (tz + 9 * zoom - camera.position.z) * Math.min(1, dt * 6);
  camera.position.y = 15 * zoom;
  camera.lookAt(camera.position.x, 0, camera.position.z - 9 * zoom - 0.5);
  renderer.render(scene, camera);
}

function updateHud() {
  const b = $('alertBanner');
  if (world.alert === 2) { b.className = 'alert'; b.textContent = 'ALERT ' + Math.max(0, world.alertT).toFixed(1); }
  else if (world.alert === 1) { b.className = 'caution'; b.textContent = 'CAUTION'; }
  else b.className = 'hidden';
  if (world.alert === 2 && lastAlert < 2) { alertSound(); if (navigator.vibrate) navigator.vibrate(200); }
  lastAlert = world.alert;
  let obj;
  if (world.phase === 'over') obj = 'GAME OVER';
  else if (!world.door) {
    const armed = world.sw.filter((v) => v > 0).length;
    obj = solo ? 'Stand on a switch pad and press ACT' :
      armed ? `Switch armed! Partner: press the OTHER switch now (${Math.max(...world.sw).toFixed(1)}s)` :
      'Both stand on the two switch pads by the red door, then ACT within 2s of each other';
  } else {
    const n = world.ext.filter(Boolean).length;
    obj = solo ? 'Door open - reach EXTRACT' : `Door open - both get to EXTRACT (${n}/2 there)`;
  }
  $('objective').textContent = obj;
}

// ---------------------------------------------------------------- main loop
let last = performance.now(), sendAcc = 0, stateAcc = 0, pingAcc = 0;
camera.position.set(me.x, 15, me.z + 9);
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (role) {
    updateLocal(dt);
    if (role === 'host') hostUpdate(dt);
    sendAcc += dt; stateAcc += dt; pingAcc += dt;
    if (sendAcc > 0.05) { sendAcc = 0; if (role === 'guest') sendPlayer(); }
    if (stateAcc > 1 / 15) { stateAcc = 0; if (role === 'host' && peerConnected) sendState(); }
    if (pingAcc > 2) { pingAcc = 0; if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify({ t: 'ping', ts: performance.now() })); }
    updateHud(); updateOverlay(); drawRadar();
  }
  render(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// debug hook for automated tests
window.__ds = { me, other, get world() { return world; }, get role() { return role; }, get peer() { return peerConnected; }, armSwitch, net };
