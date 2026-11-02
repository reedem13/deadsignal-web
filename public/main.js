// Project Deadsignal - browser co-op stealth prototype.
// Camera choice: fixed angled top-down follow cam (north is always up) - easiest to read & control on phones.
// Tunnels: roofed crawlspaces (TUNNELS below) link map sections. Inside one the LOCAL camera switches to first person;
// each client decides that for its own player only. Guards can't enter, see or catch you inside a tunnel.
// Netcode: listen-server style. Host simulates guards, alert, door, extract & win. Each client owns its own
// movement (sent 20x/s); host broadcasts world state 15x/s. Messages go through server.js (WebSocket relay).
// Combat: ACT behind a guard = TAKEDOWN (choke + knife, guard stays down). Otherwise ACT = switch if on a pad, else fire
// the handgun - but ONLY while the pistol is drawn. G / GUN button draws or holsters it (missions start holstered); while
// holstered neither ACT nor F can fire. Limited ammo + cooldown, auto-aims at the nearest guard in front, gunshots are loud.
// The host is authoritative for guard deaths: guests send 'td' / 'sh' requests, the host applies them and broadcasts.
// Climbing (Splinter Cell style, see traverse.js for the map data): players have a feet height me.y. Crates + roofs are
// walkable; ACT near a lip / ladder / drainpipe / grapple ring / co-op wall climbs, mantles, grapples or boosts.
// Solo moves start right away and the host can veto them ('trx'); co-op boost / pull-up exist only when the host creates
// world.co and broadcasts it - both clients then play their half (booster vs climber) on the host's clock.
import * as THREE from 'three';
import { makeSneaker, makeEnemy } from './sneaker.js';
import { TRAV, WALKS, RAILS, GANTRY_POSTS, CLIMBS, COOPS, LINKS, coopGeom, linkPos, buildTraversal } from './traverse.js';

// ---------------------------------------------------------------- level data (greybox yard)
const B = (cx, cz, w, d, h, kind = 'crate') => ({ x1: cx - w / 2, x2: cx + w / 2, z1: cz - d / 2, z2: cz + d / 2, h, kind });
const WALLS = [
  // outer fence
  B(0, -15.5, 42, 1, 2.5, 'wall'), B(0, 15.5, 42, 1, 2.5, 'wall'), B(-20.5, 0, 1, 32, 2.5, 'wall'), B(20.5, 0, 1, 32, 2.5, 'wall'),
  // extraction compound (north-east), door between the two switches
  B(7, -8.25, 6, 0.5, 2.5, 'wall'), B(16.5, -8.25, 7, 0.5, 2.5, 'wall'), B(4.25, -13.925, 0.5, 2.65, 2.5, 'wall'), B(4.25, -9.325, 0.5, 2.15, 2.5, 'wall'), // gap = T3 drain
  B(11.5, -8.25, 3, 0.5, 2.5, 'door'),
  // cover: building (tall) and crates (low: crouch behind them to break line of sight)
  // barracks (tall), split by the T2 crawlspace that runs through it east-west
  B(-8, -7.8, 6, 1.4, 3, 'building'), B(-8, -4.2, 6, 1.4, 3, 'building'),
  B(0, 1, 2, 2, 1), B(-4, 8, 1.5, 1.5, 1), B(7, 6, 3, 1.5, 1), B(12, 2, 2, 4, 2.2, 'building'), B(-14, 0, 2, 2, 1),
  B(-2, -4, 1.5, 3, 1), B(16, 8, 2, 2, 1), B(-11, 12, 1.2, 2.5, 1), B(9, -3, 1.5, 1.5, 1),
  // SIGNAL SHED: too tall to climb solo - co-op boost wall on its south face; its roof joins the gantry (traverse.js)
  B(3, -2.9, 2.4, 1.6, 3.4, 'building'),
];
for (const [x, z] of GANTRY_POSTS) WALLS.push(B(x, z, 0.16, 0.16, 3.4, 'post')); // catwalk legs over the switch lane
// ---- TUNNELS: interior volumes (x1..x2, z1..z2) are the FPS trigger + guard no-go zones. axis = direction of travel.
// Side walls (kind 'tunnel', tall enough to block sight) are generated into WALLS; both ends are open mouths.
const TUNNEL_H = 1.25, TUNNEL_WALL = 0.3;
const TUNNELS = [
  { name: 'WEST CULVERT', x1: -19.8, x2: -18.2, z1: -3, z2: 9.5, axis: 'z', roof: 0.2 },      // spawn yard <-> north-west yard
  { name: 'BARRACKS CRAWLSPACE', x1: -11.6, x2: -4.4, z1: -6.8, z2: -5.2, axis: 'x', roof: 1.75 }, // under/through the barracks
  { name: 'COMPOUND DRAIN', x1: 0.6, x2: 7.6, z1: -12.3, z2: -10.7, axis: 'x', roof: 0.2 },  // west yard <-> inside the extraction compound
];
for (const t of TUNNELS) {
  const W = TUNNEL_WALL, h = TUNNEL_H + 0.2;
  if (t.axis === 'z') WALLS.push({ x1: t.x1 - W, x2: t.x1, z1: t.z1, z2: t.z2, h, kind: 'tunnel' }, { x1: t.x2, x2: t.x2 + W, z1: t.z1, z2: t.z2, h, kind: 'tunnel' });
  else WALLS.push({ x1: t.x1, x2: t.x2, z1: t.z1 - W, z2: t.z1, h, kind: 'tunnel' }, { x1: t.x1, x2: t.x2, z1: t.z2, z2: t.z2 + W, h, kind: 'tunnel' });
}
// index of the tunnel containing (x,z), or -1. inset shrinks the volume at the open ends (hysteresis for the camera switch).
function tunnelAt(x, z, inset = 0) {
  for (let i = 0; i < TUNNELS.length; i++) {
    const t = TUNNELS[i], ix = t.axis === 'x' ? inset : 0, iz = t.axis === 'z' ? inset : 0;
    if (x > t.x1 + ix && x < t.x2 - ix && z > t.z1 + iz && z < t.z2 - iz) return i;
  }
  return -1;
}
// guards treat tunnel interiors (+ a lip at each mouth) as solid so they never crawl in after you
const GUARD_BLOCKS = TUNNELS.map((t) => ({ x1: t.x1 - (t.axis === 'x' ? 0.3 : 0), x2: t.x2 + (t.axis === 'x' ? 0.3 : 0),
  z1: t.z1 - (t.axis === 'z' ? 0.3 : 0), z2: t.z2 + (t.axis === 'z' ? 0.3 : 0), h: 0, kind: 'block' }));
const SWITCHES = [{ x: 6.5, z: -6.6 }, { x: 16.5, z: -6.6 }]; // 10 units apart -> one person can't hit both in time
const EXTRACT = { x: 16, z: -12, r: 2.2 };
const SPAWNS = [{ x: -17, z: 13 }, { x: -15.5, z: 13.2 }];
const GUARD_PATHS = [
  [[-7, 4], [5, 4], [5, 10], [-7, 10]],
  [[2, -5.2], [19, -5.2]],
  [[-17, -1], [-17, -12], [-2, -12], [-2, -7], [-2, -12], [-17, -12]],
];
const SWITCH_WINDOW = 2.0; // seconds both switches must overlap
// guards: patrol 1.8 -> 1.4, investigate 2.6 -> 2.2, chase 4.6 -> 4.1 (still slower than a running player)
const SPEED = { prone: 1.1, crouch: 1.8, walk: 3.2, run: 5.2, patrol: 1.4, investigate: 2.2, chase: 4.1 };
// patrol pauses: at every waypoint a guard stops for min..min+rand seconds and slowly looks around (+-sweep rad)
const PAUSE = { min: 2.2, rand: 1.4, sweep: 0.45, rate: 1.1 };
// laser sight on the drawn P-9 (tight red beam + dot), locks onto the auto-aim target when there is one
const LASER = { color: 0xff1a1a, width: 0.035, dot: 0.07 };
const NOISE = { run: 6, walk: 2.2 };
// Momentum (players only): velocity ramps toward the stick/keys target instead of snapping. Kept light for stealth:
// walk reaches full speed in ~0.2s, run in ~0.33s; stops coast for ~0.15s (walk) / ~0.25s (run).
const MOVE = { accel: 16, decel: 21, turnAccel: 26, turnRate: 10, proneTurnRate: 4.5 };
const SIGHT = { stand: 9, crouch: 6, prone: 3.5, fovHalf: 0.62 };
const ALERT_TIME = 15, CAUTION_TIME = 10;
// takedown: must be within range and inside the guard's rear arc (|angle off his facing| > behind -> ~+-64deg behind him).
// Host re-checks guest requests with the looser 'lenient' numbers to absorb lag.
const TD = { range: 1.45, behind: 1.95, time: 2.2, gap: 0.42, lenRange: 2.3, lenBehind: 1.55 };
// handgun: 12 rounds per mission, slow-ish fire, auto-aim cone in front, gunshot noise pulls guards in this radius
const GUN = { ammo: 12, cooldown: 0.5, range: 13, cone: 0.35, fpsCone: 0.14, noise: 12, drawTime: 2.0 };

// ---------------------------------------------------------------- params / state
const qs = new URLSearchParams(location.search);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (!isTouch) document.body.classList.add('desktop');
const $ = (id) => document.getElementById(id);

let role = null;          // 'host' | 'guest'
let solo = false;
let roomCode = '';
let peerConnected = false;
// c = low (crouched OR prone; this is what older clients read as "crouch"), p = prone, tun = tunnel index or -1
// combat: td = active takedown { g, t } or null, eq = pistol drawn (in hand) vs holstered, ammo, cd = fire cooldown,
// gunT = seconds the aim pose is held after a shot, shot = shot counter (recoil)
// climbing: y = feet height, vy = fall speed, tr = active traversal move (see updateTrav), thud = hard-landing noise timer
const me = { x: SPAWNS[0].x, z: SPAWNS[0].z, a: -Math.PI / 2, c: false, p: false, run: false, moving: false, tun: -1, vx: 0, vz: 0,
  td: null, eq: false, ammo: GUN.ammo, cd: 0, gunT: 0, shot: 0, y: 0, vy: 0, tr: null, thud: 0, fallFrom: 0, grabT: 0 };
// remote traversal: y, tk = move code ('' none), ti = spot / link index, tp = progress 0..1; ry = smoothed on-screen y
const other = { x: SPAWNS[1].x, z: SPAWNS[1].z, a: -Math.PI / 2, c: false, p: false, tun: -1, noise: 0, inv: 0, rx: SPAWNS[1].x, rz: SPAWNS[1].z, ra: 0, nvx: 0, nvz: 0, pt: 0,
  td: -1, gd: 0, eq: 0, shot: 0, y: 0, ry: 0, tk: '', ti: -1, tp: 0 };
function resetLoadout() { me.td = null; me.eq = false; me.ammo = GUN.ammo; me.cd = 0; me.gunT = 0; other.td = -1; other.gd = 0; other.eq = 0;
  me.tr = null; me.y = 0; me.vy = 0; me.thud = 0; other.tk = ''; other.y = other.ry = 0; syncGunButton(); }
const stopMe = () => { me.vx = me.vz = 0; me.moving = false; };
let world = freshWorld();
let lastAlert = 0, lastPhase = 'play';

function freshWorld() {
  return {
    // st: patrol | investigate | chase | search | held (being taken down, tdT = seconds into it) | dead
    guards: GUARD_PATHS.map((p) => ({ x: p[0][0], z: p[0][1], a: 0, path: p, wp: 1, st: 'patrol', meter: 0, tx: 0, tz: 0, wait: 0, give: 0, pause: 0, look0: 0, pauseT: 0,
      rx: p[0][0], rz: p[0][1], ra: 0, tdT: 0, by: -1 })),
    alert: 0, alertT: 0, cautionT: 0, sw: [0, 0], swBy: [-1, -1], door: false, phase: 'play', t: 0, caught: 0, alerts: 0,
    ext: [false, false], inv: [0, 0], finalT: 0, dead: -1, kills: 0, // dead: index of the player who died (-1 = nobody)
    co: null, coId: (Math.random() * 1e6) | 0, // co-op climb in progress (host-created): { id, k: boost|pull, i, c: climber, h: helper, t, dur }
  };
}

// ---------------------------------------------------------------- math / collision helpers
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const solids = () => WALLS.filter((w) => !(w.kind === 'door' && world.door));

function collide(p, r, guard = false) { collideBoxes(p, r, guard ? solids().concat(GUARD_BLOCKS) : solids()); }
// players: anything whose top is under your feet doesn't block (you're on / above it) - except fences + the door, which
// always do (no walking out of the map along a roof). Catwalk railings only exist up at their height.
function collidePlayer(p, r) {
  const y = p.y || 0;
  const boxes = solids().filter((b) => b.kind === 'wall' || b.kind === 'door' || b.h > y + 0.05);
  for (const b of RAILS) if (y > b.y0 - 0.6 && y < b.h) boxes.push(b);
  collideBoxes(p, r, boxes);
}
// walkable tops: crates, buildings (barracks / pump house / shed) + the extra decks in traverse.js
const WALK_TOPS = WALLS.filter((b) => b.kind === 'crate' || b.kind === 'building').concat(WALKS);
const STEP_UP = 0.3;
function groundAt(x, z, y) { let s = 0; for (const b of WALK_TOPS) if (b.h > s && b.h <= y + STEP_UP && x >= b.x1 && x <= b.x2 && z >= b.z1 && z <= b.z2) s = b.h; return s; }
const tunAt = (x, z, y, inset = 0) => ((y || 0) < 0.4 ? tunnelAt(x, z, inset) : -1); // up on the barracks roof != in the crawlspace
function collideBoxes(p, r, boxes) {
  for (let it = 0; it < 2; it++) for (const b of boxes) {
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
// entry fraction t (0..1) where segment a->b first touches box b, or null
function segT(ax, az, bx, bz, b) {
  let t0 = 0, t1 = 1; const dx = bx - ax, dz = bz - az;
  for (const [p, d, lo, hi] of [[ax, dx, b.x1, b.x2], [az, dz, b.z1, b.z2]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return null; }
    else { let ta = (lo - p) / d, tb = (hi - p) / d; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return null; }
  }
  return t0;
}
// bullets fly at chest height: only tall stuff (walls, buildings, tunnel walls, closed door) stops them, not crates
// (from up high, anything lower than the shooter's chest no longer blocks)
const bulletBlockers = (y = 0) => solids().filter((b) => b.h >= 1.3 && b.h > y + 0.6);
function clearShot(ax, az, bx, bz, y = 0) { for (const b of bulletBlockers(y)) { const t = segT(ax, az, bx, bz, b); if (t !== null && t > 0.02) return false; } return true; }
function rayEnd(x, z, a, len) {
  const bx = x + Math.cos(a) * len, bz = z + Math.sin(a) * len; let tm = 1;
  for (const b of bulletBlockers()) { const t = segT(x, z, bx, bz, b); if (t !== null && t > 0.01 && t < tm) tm = t; }
  return { x: x + (bx - x) * tm, z: z + (bz - z) * tm };
}
const alive = (g) => g.st !== 'dead' && g.st !== 'held';
// low crates (h < 1.3) only hide a crouching target
function lineOfSight(g, p) {
  for (const b of solids()) { if (b.h < 1.3 && !p.c) continue; if (b.h <= (p.y || 0) + 0.3) continue; if (segHitsBox(g.x, g.z, p.x, p.z, b)) return false; }
  return true;
}
function moveToward(o, tx, tz, speed, dt, r = 0.45) {
  const dx = tx - o.x, dz = tz - o.z, d = Math.hypot(dx, dz);
  if (d < 0.15) return true;
  const s = Math.min(d, speed * dt);
  const px = o.x, pz = o.z;
  o.x += (dx / d) * s; o.z += (dz / d) * s; collide(o, r, true);
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

const COLORS = { wall: 0x56636b, building: 0x4a5866, crate: 0x7a6440, door: 0x9a2a2a, tunnel: 0x3a4246, post: 0x6a4a30 };
// crunchy 32px textures for the tunnels (same PS1 vibe as the characters)
function pixTex(size, draw, rep = [1, 1]) {
  const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d'); draw(x, size);
  const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep); t.colorSpace = THREE.SRGBColorSpace; return t;
}
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const concreteTex = pixTex(32, (x, S) => {
  x.fillStyle = '#4a5054'; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) { const v = 60 + rnd() * 40 | 0; x.fillStyle = `rgb(${v},${v + 4},${v + 6})`; x.fillRect(rnd() * S | 0, rnd() * S | 0, 1, 1); }
  x.fillStyle = '#2c3134'; x.fillRect(0, 15, S, 1); x.fillRect(15, 0, 1, 15); x.fillRect(5, 16, 1, 16); // panel seams
  x.fillStyle = 'rgba(30,45,30,.5)'; x.fillRect(20, 20, 6, 12); // damp stain
});
const hazardTex = pixTex(16, (x, S) => { for (let i = -S; i < S * 2; i += 8) { x.fillStyle = '#d8b028'; x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 4, 0); x.lineTo(i + 4 - S, S); x.lineTo(i - S, S); x.fill(); } }, [3, 1]);
// tiled copy of the concrete so long tunnel pieces keep 1 texel ~ 5cm instead of stretching one 32px tile
const tiled = (u, v) => { const t = concreteTex.clone(); t.repeat.set(Math.max(1, Math.round(u)), Math.max(1, Math.round(v))); t.needsUpdate = true; return t; };
const concreteMat = (color, u, v) => new THREE.MeshLambertMaterial({ map: tiled(u, v), color, flatShading: true });
let doorMesh = null;
for (const w of WALLS) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w.x2 - w.x1, w.h, w.z2 - w.z1), w.kind === 'tunnel' ? concreteMat(0x9aa4a8, Math.max(w.x2 - w.x1, w.z2 - w.z1) / 1.6, 1) : mat(COLORS[w.kind]));
  m.position.set((w.x1 + w.x2) / 2, w.h / 2, (w.z1 + w.z2) / 2); scene.add(m);
  if (w.kind === 'door') doorMesh = m;
}
// tunnel dressing: dark floor, roof slab, hazard-striped mouth frames, dim ceiling lamps with fake light pools
const hazardMat = new THREE.MeshLambertMaterial({ map: hazardTex, color: 0xffffff, flatShading: true });
const mouthMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false });
const lampMat = new THREE.MeshBasicMaterial({ color: 0xffc860 });
const poolMat = new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending });
for (const t of TUNNELS) {
  const W = TUNNEL_WALL, cx = (t.x1 + t.x2) / 2, cz = (t.z1 + t.z2) / 2, lx = t.x2 - t.x1, lz = t.z2 - t.z1, along = t.axis === 'x';
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(lx, lz), concreteMat(0x3a4246, lx / 1.6, lz / 1.6)); fl.rotation.x = -Math.PI / 2; fl.position.set(cx, 0.03, cz); scene.add(fl);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(lx + (along ? 0 : 2 * W), t.roof, lz + (along ? 2 * W : 0)), t.roof > 1 ? mat(COLORS.building) : concreteMat(0x8a9296, (along ? lx : lz) / 1.6, 1));
  roof.position.set(cx, TUNNEL_H + t.roof / 2, cz); scene.add(roof);
  for (const end of [-1, 1]) { // mouth frame at each open end + dark "throat" decal on the ground outside
    const ex = along ? (end < 0 ? t.x1 : t.x2) : cx, ez = along ? cz : (end < 0 ? t.z1 : t.z2);
    const span = (along ? lz : lx) + 2 * W + 0.2;
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(along ? 0.18 : span, 0.22, along ? span : 0.18), hazardMat);
    lintel.position.set(ex + (along ? end * 0.05 : 0), TUNNEL_H + 0.05, ez + (along ? 0 : end * 0.05)); scene.add(lintel);
    for (const sd of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(along ? 0.2 : 0.22, TUNNEL_H + 0.2, along ? 0.22 : 0.2), hazardMat);
      post.position.set(ex + (along ? end * 0.05 : sd * (lx / 2 + W / 2)), (TUNNEL_H + 0.2) / 2, ez + (along ? sd * (lz / 2 + W / 2) : end * 0.05)); scene.add(post);
    }
    const throat = new THREE.Mesh(new THREE.PlaneGeometry(along ? 0.9 : lx, along ? lz : 0.9), mouthMat); throat.rotation.x = -Math.PI / 2;
    throat.position.set(ex + (along ? end * 0.45 : 0), 0.035, ez + (along ? 0 : end * 0.45)); scene.add(throat);
  }
  const len = along ? lx : lz;
  for (let d = 1.5; d < len - 0.5; d += 3) {
    const lx0 = along ? t.x1 + d : cx, lz0 = along ? cz : t.z1 + d;
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.06, 0.25), lampMat); lamp.position.set(lx0, TUNNEL_H - 0.04, lz0); scene.add(lamp);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(0.75, 8), poolMat); pool.rotation.x = -Math.PI / 2; pool.position.set(lx0, 0.04, lz0); scene.add(pool);
  }
}
// ladders, drainpipe, gantry, grapple hooks + launch rings, co-op wall markers, crate lip trims (traverse.js)
const travFx = buildTraversal(scene, { walls: WALLS, hazardMat });
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

function marker(color) { // little floating triangle so you can find each other
  const m = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.4, 3), new THREE.MeshBasicMaterial({ color }));
  m.rotation.x = Math.PI; return m;
}
// Players: olive "sneaker" (see sneaker.js). P1 = host (blue accents), P2 = guest (green accents + slightly warmer suit).
// Guards use the enemy kit of the same rig (sneaker.js makeEnemy): slate fatigues, helmet, balaclava, goggles, respirator.
const PLAYER_LOOK = [{ accent: 0x6fb0ff, tint: 0xffffff }, { accent: 0x7fff8f, tint: 0xf0e6cf }];
const meMesh = makeSneaker(scene, PLAYER_LOOK[0]);
const otherMesh = makeSneaker(scene, PLAYER_LOOK[1]);
const markers = [meMesh, otherMesh].map((ch, i) => { const m = marker(PLAYER_LOOK[i].accent); m.position.y = 2.1; ch.g.add(m); return m; });
function applyPlayerLooks() { // my character always uses my slot's look (host = P1, guest = P2)
  const mine = role === 'guest' ? 1 : 0;
  [[meMesh, mine], [otherMesh, 1 - mine]].forEach(([ch, i], k) => {
    ch.materials.accent.color.setHex(PLAYER_LOOK[i].accent);
    ch.materials.patch.color.setHex(PLAYER_LOOK[i].accent).multiplyScalar(0.55);
    ch.materials.suit.color.setHex(PLAYER_LOOK[i].tint);
    markers[k].material.color.setHex(PLAYER_LOOK[i].accent);
  });
}
let otherSpeed = 0, otherPX = other.rx, otherPZ = other.rz;

function textSprite(txt, color) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  x.font = 'bold 56px monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 8; x.strokeStyle = '#000'; x.strokeText(txt, 32, 34); x.fillStyle = color; x.fillText(txt, 32, 34);
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false })); s.scale.set(1.1, 1.1, 1); s.position.y = 2.4; return s;
}
const guardMeshes = GUARD_PATHS.map(() => {
  const ch = makeEnemy(scene);
  const coneMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  const cone = new THREE.Mesh(new THREE.CircleGeometry(1, 18, -SIGHT.fovHalf, SIGHT.fovHalf * 2), coneMat);
  cone.rotation.x = -Math.PI / 2; cone.position.y = 0.06;
  const coneHolder = new THREE.Group(); coneHolder.add(cone); ch.g.add(coneHolder);
  const q = textSprite('?', '#ffe066'), ex = textSprite('!', '#ff4040'); ch.g.add(q, ex);
  // dark blood pool under the body (fades in after a kill). Body topples forward along local +x.
  const pool = new THREE.Mesh(new THREE.CircleGeometry(0.5, 7), new THREE.MeshBasicMaterial({ color: 0x4a0808, transparent: true, opacity: 0.85, depthWrite: false }));
  pool.rotation.x = -Math.PI / 2; pool.position.set(0.9, 0.035, 0); pool.visible = false; ch.g.add(pool);
  return { ...ch, cone, coneMat, coneHolder, q, ex, pool, poolK: 0, spd: 0, px: 0, pz: 0 };
});

// gun fx: short-lived tracer lines + impact puffs (pooled)
const tracers = Array.from({ length: 6 }, () => {
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0 }));
  const puff = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), new THREE.MeshBasicMaterial({ color: 0xd8d0b0, transparent: true, opacity: 0 }));
  line.frustumCulled = false; scene.add(line, puff); return { line, puff, t: 0 };
});
let tracerI = 0;
const _mz = new THREE.Vector3();
function gunFx(mesh, ex, ez, hit) {
  const tr = tracers[tracerI++ % tracers.length];
  mesh.muzzleWorld(_mz);
  const a = tr.line.geometry.attributes.position; a.setXYZ(0, _mz.x, _mz.y, _mz.z); a.setXYZ(1, ex, hit ? 1.15 : _mz.y, ez); a.needsUpdate = true;
  tr.puff.position.set(ex, hit ? 1.15 : _mz.y, ez); tr.puff.material.color.setHex(hit ? 0x8a1010 : 0xd8d0b0); tr.t = 0.16;
}
function updateFx(dt) {
  for (const tr of tracers) {
    tr.t = Math.max(0, tr.t - dt); const k = tr.t / 0.16;
    tr.line.material.opacity = k; tr.puff.material.opacity = k; tr.puff.scale.setScalar(1 + (1 - k) * 2); tr.line.visible = tr.puff.visible = k > 0;
  }
}

// laser sight: one beam + dot per player rig. Beam is a thin unlit box stretched from the muzzle to the first thing it
// hits (tall wall / guard), so it reads at the chunky pixel scale where a 1px THREE.Line would vanish.
function makeLaser() {
  const mat = new THREE.MeshBasicMaterial({ color: LASER.color, transparent: true, opacity: 0.7, depthWrite: false, fog: false });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(1, LASER.width, LASER.width), mat);
  const dot = new THREE.Mesh(new THREE.OctahedronGeometry(LASER.dot, 0), new THREE.MeshBasicMaterial({ color: 0xff4040, transparent: true, opacity: 0.95, depthWrite: false, fog: false }));
  // core: a 1px line that never breaks up at low res; the box above is the soft glow around it
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
  const core = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.95, depthWrite: false, fog: false }));
  mat.opacity = 0.35;
  beam.frustumCulled = dot.frustumCulled = core.frustumCulled = false; beam.renderOrder = dot.renderOrder = core.renderOrder = 5;
  beam.visible = dot.visible = core.visible = false;
  scene.add(beam, dot, core); return { beam, dot, core, on: 0 };
}
const _lz = new THREE.Vector3(), _ld = new THREE.Vector3();
// first live guard the ray x,z,a crosses (body radius ~0.32) before maxD, as a distance, or maxD
function laserGuardHit(x, z, a, maxD) {
  const cx = Math.cos(a), cz = Math.sin(a); let best = maxD;
  for (const g of world.guards) {
    if (g.st === 'dead') continue;
    const gx = (g.rx ?? g.x) - x, gz = (g.rz ?? g.z) - z, t = gx * cx + gz * cz;
    if (t < 0.2 || t > best) continue;
    if (Math.abs(gx * -cz + gz * cx) < 0.32) best = t - 0.2;
  }
  return best;
}
// show a laser. It is rigidly attached to the pistol: starts at the muzzle and runs along the barrel (mesh.muzzleDir)
// to the first wall / guard / floor in that line. Auto-aim never steers the beam - it turns the arms at the shoulders
// (sneaker.js, s.aimAt) and the beam just follows the gun.
function updateLaser(L, mesh, show, dt) {
  L.on = show ? Math.min(1, L.on + dt * 6) : 0;
  L.beam.visible = L.dot.visible = L.core.visible = L.on > 0.05;
  if (!L.beam.visible) return;
  mesh.muzzleWorld(_lz); mesh.muzzleDir(_ld);
  const hl = Math.hypot(_ld.x, _ld.z);
  let dist = GUN.range; // along the beam (3D)
  if (_ld.y < -1e-3) dist = Math.min(dist, (_lz.y - 0.02) / -_ld.y); // floor
  if (hl > 0.05) {
    const a = Math.atan2(_ld.z, _ld.x), x = _lz.x, z = _lz.z, hr = dist * hl; // horizontal reach
    // anything taller than the beam stops it (so a crouched / prone laser lands on crates instead of passing through)
    const bx = x + Math.cos(a) * hr, bz = z + Math.sin(a) * hr; let tm = 1;
    for (const b of solids()) { if (b.h < _lz.y) continue; const t = segT(x, z, bx, bz, b); if (t !== null && t > 0.01 && t < tm) tm = t; }
    dist = laserGuardHit(x, z, a, hr * tm) / hl;
  }
  _ld.multiplyScalar(dist);
  const len = Math.max(0.05, _ld.length() * L.on); // beam "extends" over ~0.15s on draw
  L.beam.scale.set(len, 1, 1);
  L.beam.position.copy(_lz).addScaledVector(_ld.normalize(), len / 2);
  L.beam.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), _ld);
  L.beam.material.opacity = 0.3 + 0.08 * Math.sin(performance.now() * 0.03); // faint shimmer
  const cp = L.core.geometry.attributes.position; cp.setXYZ(0, _lz.x, _lz.y, _lz.z);
  cp.setXYZ(1, _lz.x + _ld.x * len, _lz.y + _ld.y * len, _lz.z + _ld.z * len); cp.needsUpdate = true;
  L.dot.position.copy(_lz).addScaledVector(_ld, len); L.dot.visible = L.on > 0.95;
  L.dot.rotation.y += dt * 8;
}
// auto-aim point for a player's arms: the lock target's chest, at about barrel height so the arms stay near level
const _am = new THREE.Vector3();
function aimPoint(p, mesh, on) {
  const i = on ? autoTarget(p) : -1; if (i < 0) return null;
  const g = world.guards[i]; mesh.muzzleWorld(_am);
  return { x: g.rx ?? g.x, y: Math.max(0.45, Math.min(1.15, _am.y)), z: g.rz ?? g.z };
}
const myLaser = makeLaser(), otherLaser = makeLaser();
// grapple rope: dark cord from the right hand to the hook (shoots out during the throw), small claw at the tip
function makeRope() {
  const cord = new THREE.Mesh(new THREE.BoxGeometry(1, 0.035, 0.035), new THREE.MeshLambertMaterial({ color: 0x2a2620 }));
  const claw = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), new THREE.MeshLambertMaterial({ color: 0x9aa0a4, flatShading: true }));
  cord.frustumCulled = claw.frustumCulled = false; cord.visible = claw.visible = false; scene.add(cord, claw); return { cord, claw };
}
const _rh = new THREE.Vector3(), _re = new THREE.Vector3(), _rd = new THREE.Vector3(), _X = new THREE.Vector3(1, 0, 0);
function updateRope(R, mesh, tk, ti, tp) {
  const on = tk === 'gp' && LINKS[ti];
  R.cord.visible = R.claw.visible = !!on; if (!on) return;
  const L = LINKS[ti], tt = tp * L.dur, k = Math.min(1, tt / TRAV.fireT);
  mesh.handWorld(_rh, 1); _re.set(L.hook.x, L.hook.y, L.hook.z);
  _re.sub(_rh).multiplyScalar(k).add(_rh); // hook flies out during the throw
  _rd.copy(_re).sub(_rh); const len = Math.max(0.01, _rd.length());
  R.cord.scale.set(len, 1, 1); R.cord.position.copy(_rh).addScaledVector(_rd, 0.5); R.cord.quaternion.setFromUnitVectors(_X, _rd.normalize());
  R.claw.position.copy(_re); R.claw.rotation.y += 0.3;
}
const myRope = makeRope(), otherRope = makeRope();

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
// gunshot: noise burst + low thump (quieter when it's your partner's gun)
function gunSound(vol = 1) {
  if (!actx) return;
  const n = actx.sampleRate * 0.18, buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
  const src = actx.createBufferSource(), g = actx.createGain(); src.buffer = buf; g.gain.value = 0.35 * vol;
  src.connect(g); g.connect(actx.destination); src.start(); beep(70, 0.15, 'sine', 0.25 * vol);
}
const stabSound = () => { beep(140, 0.06, 'triangle', 0.12); setTimeout(() => beep(95, 0.09, 'triangle', 0.12), 70); };

// ---------------------------------------------------------------- input
const input = { jx: 0, jz: 0, kRun: false, keys: new Set() };
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  input.keys.add(e.code);
  if (e.code === 'KeyC' || e.code === 'ControlLeft') toggleCrouch();
  if (e.code === 'KeyZ' || e.code === 'KeyX') toggleProne();
  if (e.code === 'KeyE' || e.code === 'Space') { e.preventDefault(); if (!e.repeat) doInteract(); }
  if (e.code === 'KeyF' && !e.repeat) { unlockAudio(); if (role && world.phase === 'play' && !me.td && !me.tr) { if (me.eq) fireGun(); else holsterHint(); } }
  if (e.code === 'KeyG' && !e.repeat) { unlockAudio(); toggleGun(); }
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
$('btnProne').addEventListener('pointerdown', (e) => { e.preventDefault(); unlockAudio(); toggleProne(); });
$('btnAct').addEventListener('pointerdown', (e) => { e.preventDefault(); unlockAudio(); doInteract(); });
$('btnGun').addEventListener('pointerdown', (e) => { e.preventDefault(); unlockAudio(); toggleGun(); });
document.addEventListener('touchmove', (e) => { if (!e.target.closest('.panel')) e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

// stance: stand <-> crouch (C), anything <-> prone (Z/X). Tunnels are too low to stand in.
function syncStanceButtons() { $('btnCrouch').classList.toggle('on', me.c && !me.p); $('btnProne').classList.toggle('on', me.p); }
function toggleCrouch() {
  if (me.td || me.tr) return;
  if (me.p) me.p = false; // prone -> crouch
  else if (me.c && me.tun >= 0) toast('Too low to stand', 800, '#ccc');
  else me.c = !me.c;
  syncStanceButtons();
}
function toggleProne() {
  if (me.td || me.tr) return;
  if (me.p) me.p = false; // prone -> crouch (stay low)
  else { me.p = true; me.c = true; }
  syncStanceButtons();
}
// pistol: G / GUN button draws or holsters it. Holstered = ACT can only take down / use, F does nothing (no accidental shots).
function syncGunButton() { const b = $('btnGun'); if (!b) return; b.classList.toggle('on', me.eq); b.textContent = me.eq ? 'HOLSTER' : 'GUN'; }
function toggleGun() {
  if (!role || world.phase !== 'play' || me.td) return;
  me.eq = !me.eq;
  if (me.eq) { me.cd = Math.max(me.cd, 0.25); beep(520, 0.03, 'square', 0.05); setTimeout(() => beep(780, 0.03, 'square', 0.05), 60); } // draw: slide click, brief settle
  else { me.gunT = 0; beep(300, 0.05, 'triangle', 0.06); }
  toast(me.eq ? 'P-9 DRAWN' : 'P-9 HOLSTERED', 600, me.eq ? '#ffd27f' : '#9fd9b0');
  syncGunButton();
  if (role === 'guest') sendPlayer(); else if (peerConnected) sendState();
}
let hintT = 0;
function holsterHint() { const now = performance.now(); if (now - hintT < 1500) return; hintT = now; toast(isTouch ? 'Holstered - tap GUN to draw' : 'Holstered - G to draw', 900, '#ccc'); }
function flash(el) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 180); }
// ACT priority: takedown (only from behind) > door switch > climb / co-op / grapple (traversal) > fire handgun (only if drawn)
// While mid-climb ACT = let go of a ladder / stand up from a boost kneel; F never fires while climbing.
const nearSwitch = () => me.y < 0.3 && SWITCHES.some((s) => Math.hypot(me.x - s.x, me.z - s.z) < 1.8);
let curTm = null; // traversal option ACT would use right now (refreshed every frame in updateHud)
function actMode() {
  if (me.tr) return me.tr.k === 'ld' ? 'letgo' : me.tr.k === 'kn' ? 'stand' : 'busy';
  if (takedownTarget(me) >= 0) return 'td';
  if (nearSwitch()) return 'use';
  curTm = travMode(); if (curTm) return curTm.m;
  return me.eq ? 'fire' : 'none';
}
function doInteract() {
  if (!role || world.phase !== 'play' || me.td) return;
  flash($('btnAct'));
  if (me.tr) { trAct(); return; }
  const gi = takedownTarget(me);
  if (gi >= 0) { startTakedown(gi); return; }
  if (nearSwitch()) { beep(660, 0.08); if (role === 'host') armSwitch(0); else net.relay({ t: 'i' }); return; }
  const tm = travMode();
  if (tm) { startTrav(tm); return; }
  if (me.eq) fireGun();
}

// ---------------------------------------------------------------- combat: takedown + handgun
// Guard index p can take down from behind, or -1. Uses each client's latest guard state (host: authoritative, guest: net).
function takedownTarget(p, range = TD.range, behind = TD.behind) {
  if (p.tun >= 0 || p.td || p.tr || (p.y || 0) > 0.3) return -1;
  let best = -1, bd = 1e9;
  world.guards.forEach((g, i) => {
    if (!alive(g)) return;
    const dx = p.x - g.x, dz = p.z - g.z, d = Math.hypot(dx, dz);
    if (d > range || d >= bd) return;
    if (Math.abs(angDiff(Math.atan2(dz, dx), g.a)) < behind) return; // in front of / beside him -> no
    if (!lineOfSight(g, { x: p.x, z: p.z, c: true })) return; // nothing in between (crates count)
    best = i; bd = d;
  });
  return best;
}
function startTakedown(gi) {
  const g = world.guards[gi];
  me.td = { g: gi, t: 0 }; me.p = false; me.c = false; me.gunT = 0; syncStanceButtons(); stopMe();
  // snap in tight behind him, facing the same way
  me.a = g.a; me.x = g.x - Math.cos(g.a) * TD.gap; me.z = g.z - Math.sin(g.a) * TD.gap;
  beep(200, 0.05, 'triangle', 0.1);
  if (role === 'host') hostTakedown(gi, 0); else net.relay({ t: 'td', g: gi, x: r2(me.x), z: r2(me.z) });
}
// host: start the hold on a guard (returns false if he's already down / grabbed)
function hostTakedown(gi, pidx) {
  const g = world.guards[gi];
  if (!g || !alive(g) || world.phase !== 'play') return false;
  g.st = 'held'; g.by = pidx; g.tdT = 0; g.meter = 0;
  if (peerConnected) sendState();
  return true;
}
// auto-aim: best live guard inside the cone in front of you with a clear line of fire (FPS = narrow cone, straight ahead)
function autoTarget(p = me) {
  const cone = p.tun >= 0 ? GUN.fpsCone : GUN.cone;
  const px = p.x, pz = p.z, pa = p.a;
  let tgt = -1, best = 1e9;
  world.guards.forEach((g, i) => {
    if (g.st === 'dead') return;
    const gx = g.rx ?? g.x, gz = g.rz ?? g.z; // guest: use the smoothed on-screen guard
    const dx = gx - px, dz = gz - pz, d = Math.hypot(dx, dz);
    if (d > GUN.range) return;
    const off = Math.abs(angDiff(Math.atan2(dz, dx), pa));
    if (off > cone && d > 1.0) return;
    if (!clearShot(px, pz, gx, gz, p.y || 0)) return;
    const score = d + off * 8; if (score < best) { best = score; tgt = i; }
  });
  return tgt;
}
function fireGun() {
  if (!me.eq || me.cd > 0 || me.tr) return;
  if (me.ammo <= 0) { toast('NO AMMO', 700, '#ccc'); beep(150, 0.04, 'square', 0.05); me.cd = 0.3; return; }
  me.ammo--; me.cd = GUN.cooldown; me.gunT = GUN.drawTime; me.shot++;
  const tgt = autoTarget();
  let end;
  if (tgt >= 0) { const g = world.guards[tgt]; if (me.tun < 0) me.a = Math.atan2(g.z - me.z, g.x - me.x); end = { x: g.x, z: g.z }; }
  else end = rayEnd(me.x, me.z, me.a, GUN.range);
  meMesh.g.rotation.y = -me.a;
  gunFx(meMesh, end.x, end.z, tgt >= 0); gunSound(1);
  if (navigator.vibrate) navigator.vibrate(30);
  const msg = { t: 'sh', g: tgt, x: r2(me.x), z: r2(me.z), y: r2(me.y), ex: r2(end.x), ez: r2(end.z) };
  if (role === 'host') hostShot(msg, 0);
  net.relay(msg); // host: fx for the guest. guest: hit request + fx for the host
}
// host: apply a shot (from either player). A hit drops the guard; the bang pulls every live guard in earshot.
function hostShot(m, pidx) {
  if (world.phase !== 'play') return;
  const g = world.guards[m.g];
  if (g && g.st !== 'dead' && Math.hypot(g.x - m.x, g.z - m.z) < GUN.range + 2 && clearShot(m.x, m.z, g.x, g.z, m.y || 0)) {
    g.st = 'dead'; g.by = pidx; world.kills++;
  }
  for (const o of world.guards) {
    if (!alive(o) || Math.hypot(o.x - m.x, o.z - m.z) > GUN.noise) continue;
    o.meter = Math.max(o.meter, 0.5);
    if (world.alert === 2) { o.st = 'chase'; o.tx = m.x; o.tz = m.z; o.give = 8; }
    else { o.st = 'investigate'; o.tx = m.x; o.tz = m.z; o.wait = 3.5; o.give = 9; }
  }
  if (peerConnected) sendState();
}

// ---------------------------------------------------------------- local movement (both roles)
function updateLocal(dt) {
  me.cd = Math.max(0, me.cd - dt); me.gunT = Math.max(0, me.gunT - dt);
  if (me.td) { // locked into the takedown animation
    const before = me.td.t; me.td.t += dt; stopMe(); me.run = false;
    for (const hit of [0.4, 0.64]) if (before < hit * TD.time && me.td.t >= hit * TD.time) stabSound();
    if (me.td.t >= TD.time + 0.3 || world.phase !== 'play') { me.td = null; }
    $('stance').textContent = 'TAKEDOWN';
    return;
  }
  let jx = input.jx, jz = input.jz, kb = false;
  const k = input.keys;
  if (k.has('KeyA') || k.has('ArrowLeft')) { jx -= 1; kb = true; }
  if (k.has('KeyD') || k.has('ArrowRight')) { jx += 1; kb = true; }
  if (k.has('KeyW') || k.has('ArrowUp')) { jz -= 1; kb = true; }
  if (k.has('KeyS') || k.has('ArrowDown')) { jz += 1; kb = true; }
  let mag = Math.hypot(jx, jz);
  if (mag > 1) { jx /= mag; jz /= mag; mag = 1; }
  const play = world.phase === 'play';
  me.thud = Math.max(0, me.thud - dt);
  if (me.tr && !play) me.tr = null; // mission ended mid-climb: let go
  if (me.tr) { updateTrav(dt, jx, jz, mag); me.tun = -1; $('stance').textContent = me.tr ? travStance() : 'STILL'; return; }
  const baseSp = () => (me.p ? SPEED.prone : me.c ? SPEED.crouch : me.run ? SPEED.run : SPEED.walk * (kb ? 1 : clamp(mag / 0.9, 0.4, 1)));
  // desired velocity (tvx, tvz) from input; actual velocity me.vx/me.vz chases it with limited accel = momentum
  let tvx = 0, tvz = 0, wantDir = null;
  if (me.tun >= 0) {
    // FIRST PERSON (inside a tunnel): view-relative tank controls. up/W = crawl forward, down/S = back up, left/right = turn.
    // fpsLatch: whatever direction you were holding when you entered keeps meaning "forward" until you let go,
    // so walking in with D doesn't suddenly start spinning you.
    if (fpsLatch && mag < 0.15) fpsLatch = false;
    const fwd = fpsLatch ? mag : -jz, turn = fpsLatch ? 0 : jx;
    if (play) me.a += turn * 2.6 * dt;
    me.run = false;
    if (play && Math.abs(fwd) > 0.15) {
      const sp = baseSp() * (fwd < 0 ? 0.6 : 1) * Math.sign(fwd);
      tvx = Math.cos(me.a) * sp; tvz = Math.sin(me.a) * sp;
      const t = TUNNELS[me.tun], ax = t.axis === 'x' ? (Math.cos(me.a) >= 0 ? 0 : Math.PI) : (Math.sin(me.a) >= 0 ? Math.PI / 2 : -Math.PI / 2);
      if (Math.abs(turn) < 0.15 && Math.abs(angDiff(ax, me.a)) < 0.6) turnToward(me, ax, dt * 2.5); // gently line up with the tunnel
    }
  } else {
    const wants = mag > 0.15 && play;
    me.run = wants && !me.c && (kb ? (k.has('ShiftLeft') || k.has('ShiftRight')) : mag > 0.92);
    if (wants) { const sp = baseSp(); tvx = (jx / mag) * sp; tvz = (jz / mag) * sp; wantDir = Math.atan2(jz, jx); }
  }
  // accelerate toward the target velocity. Speeding up uses accel, slowing down uses (slightly stronger) decel;
  // changing direction at speed uses turnAccel so strafing/cornering stays tight rather than icy.
  const dvx = tvx - me.vx, dvz = tvz - me.vz, dv = Math.hypot(dvx, dvz);
  if (dv > 1e-6) {
    const cur = Math.hypot(me.vx, me.vz), tgt = Math.hypot(tvx, tvz);
    const align = cur > 0.05 && tgt > 0.05 ? (me.vx * tvx + me.vz * tvz) / (cur * tgt) : 1;
    const rate = tgt < 0.05 ? MOVE.decel : align < 0.7 ? MOVE.turnAccel : tgt >= cur ? MOVE.accel : MOVE.decel;
    const step = Math.min(dv, rate * dt);
    me.vx += (dvx / dv) * step; me.vz += (dvz / dv) * step;
  }
  if (Math.hypot(me.vx, me.vz) < 0.02 && tvx === 0 && tvz === 0) me.vx = me.vz = 0;
  if (me.vx || me.vz) {
    const px = me.x, pz = me.z;
    me.x += me.vx * dt; me.z += me.vz * dt; collidePlayer(me, 0.38);
    // walls eat momentum: keep only the velocity that actually turned into movement (no sticky slide after a bump)
    if (dt > 0) {
      const ax = (me.x - px) / dt, az = (me.z - pz) / dt, want = Math.hypot(me.vx, me.vz), got = Math.hypot(ax, az);
      if (got < want * 0.98) { const f = got > 1e-4 ? Math.min(1, want / got) : 0; me.vx = ax * f; me.vz = az * f; }
    }
  }
  const speed = Math.hypot(me.vx, me.vz);
  me.moving = speed > 0.25;
  if (me.tun < 0 && wantDir !== null) turnToward(me, wantDir, dt * (me.p ? MOVE.proneTurnRate : MOVE.turnRate));
  if (!me.moving) me.run = false;
  // vertical: stand on the highest walkable top under you (0.3 step-up), otherwise fall (keeps air control)
  const gnd = groundAt(me.x, me.z, me.y);
  if (me.y > gnd + 1e-3 || me.vy > 0) {
    if (me.vy === 0) me.fallFrom = me.y;
    me.vy -= GRAV * dt; me.y += me.vy * dt;
    if (me.y <= gnd) { me.y = gnd; me.vy = 0; landed(me.fallFrom - gnd); }
  } else { me.y = gnd; me.vy = 0; }
  // auto-grab: keep pushing into a ladder / drainpipe from its foot for a moment = climb on (ACT does it instantly)
  if (play && me.y < 0.05 && me.vy === 0 && wantDir !== null && me.tun < 0 && !me.p) {
    const ci = CLIMBS.findIndex((c) => hz(me, c) < 0.75 && Math.abs(angDiff(c.a, wantDir)) < 0.6);
    me.grabT = ci >= 0 ? me.grabT + dt : 0;
    if (me.grabT > 0.25) { me.grabT = 0; startTrav({ m: 'climb', i: ci }); return; }
  } else me.grabT = 0;
  // tunnel state (hysteresis: must be 0.35 inside a mouth to enter, leaves as soon as you're out)
  const was = me.tun;
  me.tun = tunAt(me.x, me.z, me.y, was >= 0 ? 0 : 0.35);
  if (me.tun >= 0 && was < 0) {
    fpsLatch = me.moving;
    if (!me.c) { me.c = true; syncStanceButtons(); }
    toast(TUNNELS[me.tun].name, 1100, '#ffd27f');
  }
  $('stance').textContent = (me.p ? (me.moving ? 'CRAWL (silent, low)' : 'PRONE (hard to see)') : me.c ? 'CROUCH (silent)' : me.run ? 'RUN (loud!)' : me.moving ? 'WALK' : 'STILL')
    + (me.tun >= 0 ? ' · TUNNEL' : '') + (me.y > 0.5 ? ' · HIGH' : '');
}
let fpsLatch = false;
// a standing drop from high up thuds (guards hear it); crouched you hang-drop silently
const noiseOf = (p) => (p.thud > 0 ? TRAV.landNoise : !p.moving ? 0 : p.run && Math.hypot(p.vx || 0, p.vz || 0) > SPEED.walk + 0.4 ? NOISE.run : p.c ? 0 : NOISE.walk);

// ---------------------------------------------------------------- vertical traversal (climb / mantle / grapple / co-op)
// me.tr = { k, i, t, ... }. k is sent on the wire:
//   ld ladder or drainpipe (manual up/down)   mt mantle / vault over a lip   md step off a roof onto a ladder
//   gp grapple or rappel along LINKS[i]   kn kneeling at co-op wall i (offering a boost)
//   bs boosted climber   lf booster lifting   hs climber being pulled up   pl puller at the roof edge
// Solo moves start optimistically; the guest tells the host ('tr') and the host can veto ('trx' -> snap back) if the
// partner already owns that rope / ladder. Co-op moves only ever start from the host's world.co (see hostCoop).
const GRAV = 20;
const hz = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const ss01 = (v) => { v = clamp(v, 0, 1); return v * v * (3 - 2 * v); };
const mixv = (a, b, k) => a + (b - a) * k;
const COOP_G = COOPS.map(coopGeom);
const TR_SOLO = { ld: 1, mt: 1, md: 1, gp: 1 };
const meNet = () => ({ x: me.x, z: me.z, y: me.y, tk: me.tr ? me.tr.k : '', ti: me.tr ? me.tr.i : -1 });
const otherNet = () => ({ x: other.x, z: other.z, y: other.y, tk: other.tk, ti: other.ti });
const partnerHere = () => peerConnected && !solo;
let lastCoId = -1;

function landed(drop) {
  if (drop > TRAV.landDrop && !me.c) { me.thud = 0.45; beep(70, 0.16, 'sine', 0.22); if (navigator.vibrate) navigator.vibrate(40); }
  else if (drop > 0.6) beep(110, 0.06, 'sine', 0.08);
}
// a crate / roof lip in front of you that you can pull yourself onto -> landing spot, or null
function mantleSpot(p) {
  const fx = Math.cos(p.a), fz = Math.sin(p.a); let best = null, bd = 0.8;
  for (const b of WALK_TOPS) {
    const dh = b.h - p.y; if (dh < 0.45 || dh > TRAV.mantleMax) continue;
    const cx = clamp(p.x, b.x1, b.x2), cz = clamp(p.z, b.z1, b.z2), dx = cx - p.x, dz = cz - p.z, d = Math.hypot(dx, dz);
    if (d > 0.78 || d < 1e-3 || (dx * fx + dz * fz) / d < 0.5) continue; // must be at the edge, facing it
    const lx = clamp(cx + (dx / d) * 0.45, b.x1 + 0.25, b.x2 - 0.25), lz = clamp(cz + (dz / d) * 0.45, b.z1 + 0.25, b.z2 - 0.25);
    if (groundAt(lx, lz, b.h) > b.h + 0.01) continue;
    if (d < bd) { bd = d; best = { x: lx, z: lz, y: b.h, a: Math.atan2(dz, dx) }; }
  }
  return best;
}
// what ACT would start right now (null = nothing climbable here). m: climb down mantle grapple rappel kneel boost hoist pull solo2p
function travMode() {
  if (!role || world.phase !== 'play' || me.td || me.tr || me.tun >= 0 || me.vy !== 0) return null;
  const o = otherNet(), pr = partnerHere();
  for (let i = 0; i < COOPS.length; i++) {
    const c = COOPS[i], g = COOP_G[i];
    if (me.y < 0.3 && hz(me, g.base) < 1.5) {
      if (!pr) return { m: 'solo2p', i };
      if (o.tk === 'kn' && o.ti === i) return { m: 'boost', i };                                   // partner kneels: climb on
      if (Math.abs(o.y - c.top) < 0.25 && hz(o, g.edge) < 1.6 && !o.tk) return { m: 'hoist', i }; // partner up top: get pulled
      if (hz(me, g.base) < 1.1) return { m: 'kneel', i };
    }
    if (pr && Math.abs(me.y - c.top) < 0.2 && hz(me, g.edge) < 1.3 && o.y < 0.3 && hz(o, g.base) < 2.4 && !o.tk) return { m: 'pull', i };
  }
  let down = null, downD = 1e9; // ladder top vs a grapple ring close by: the nearer one wins
  for (let i = 0; i < CLIMBS.length; i++) {
    const c = CLIMBS[i], dd = Math.hypot(me.x - c.lx, me.z - c.lz);
    if (me.y < 0.3 && hz(me, c) < 0.85) return { m: 'climb', i };
    if (Math.abs(me.y - c.top) < 0.2 && dd < 0.8 && dd < downD) { down = { m: 'down', i }; downD = dd; }
  }
  for (let i = 0; i < LINKS.length; i++) { const f = LINKS[i].from, d = hz(me, f); if (Math.abs(me.y - f.y) < 0.25 && d < f.r && d < downD) return { m: LINKS[i].up ? 'grapple' : 'rappel', i }; }
  if (down) return down;
  const ms = mantleSpot(me); if (ms) return { m: 'mantle', i: -1, s: ms };
  return null;
}
function startTrav(tm) {
  const o = otherNet(), keep = { ox: me.x, oy: me.y, oz: me.z };
  const solo1 = (k, i, extra) => {
    if (o.tk === k && o.ti === i && (k === 'ld' || k === 'gp')) { toast('Partner is on it - wait', 1000, '#ffb36b'); return; } // host-side rule (guest also re-checked by host)
    me.tr = Object.assign({ k, i, t: 0 }, keep, extra); stopMe(); me.c = me.p = false; syncStanceButtons();
    if (role === 'guest') net.relay({ t: 'tr', k, i });
  };
  const c = CLIMBS[tm.i];
  switch (tm.m) {
    case 'climb': me.x = c.x; me.z = c.z; me.a = c.a; solo1('ld', tm.i, {}); beep(300, 0.04, 'square', 0.04); break;
    case 'down': solo1('md', tm.i, { dur: TRAV.downT * 1.6, sx: me.x, sy: me.y, sz: me.z, tx: c.x, ty: c.top - TRAV.hangBelow, tz: c.z }); me.a = c.a; break;
    case 'mantle': { const m = tm.s; me.a = m.a; solo1('mt', -1, { dur: TRAV.mantleT, sx: me.x, sy: me.y, sz: me.z, tx: m.x, ty: m.y, tz: m.z }); break; }
    case 'grapple': case 'rappel': { const L = LINKS[tm.i]; solo1('gp', tm.i, { s: { x: me.x, y: me.y, z: me.z } });
      if (me.tr) { me.a = Math.atan2(L.hook.z - me.z, L.hook.x - me.x); beep(900, 0.05, 'sawtooth', 0.05); } break; }
    case 'kneel': { const g = COOP_G[tm.i]; me.x = g.base.x; me.z = g.base.z; me.a = COOPS[tm.i].a + Math.PI; stopMe(); me.c = me.p = false; syncStanceButtons();
      me.tr = { k: 'kn', i: tm.i, t: 0 }; toast('Kneeling - partner: ACT here to climb on', 1400, '#ffd27f'); break; }
    case 'boost': requestCoop('boost', tm.i, myIdx()); break;
    case 'hoist': requestCoop('pull', tm.i, myIdx()); break;
    case 'pull': requestCoop('pull', tm.i, 1 - myIdx()); break;
    case 'solo2p': toast('Too high to climb alone - needs a partner boost (2P)', 1600, '#ffb36b'); break;
  }
}
function trAct() {
  const T = me.tr;
  if (T.k === 'ld') { me.tr = null; me.fallFrom = me.y; const c = CLIMBS[T.i]; me.x -= Math.cos(c.a) * 0.3; me.z -= Math.sin(c.a) * 0.3; me.vy = -0.01; } // let go
  else if (T.k === 'kn') me.tr = null;
}
function requestCoop(k, i, climber) {
  if (role === 'host') { if (!hostCoop(k, i, climber)) toast('Can\'t - get in position', 900, '#ffb36b'); }
  else net.relay({ t: 'co', k, i, c: climber });
}
// host: validate + start a co-op climb. Both players' positions are the host's view (own me + last guest packet).
function hostCoop(kind, i, climber) {
  if (world.phase !== 'play' || world.co || !peerConnected || !COOPS[i]) return false;
  const c = COOPS[i], g = COOP_G[i], P = [meNet(), otherNet()], cl = P[climber], hp = P[1 - climber];
  if (!cl || !hp || cl.y > 0.3 || hz(cl, g.base) > 2.6 || (cl.tk && cl.tk !== 'kn')) return false;
  if (kind === 'boost' && !(hp.tk === 'kn' && hp.ti === i)) return false;
  if (kind === 'pull' && !(Math.abs(hp.y - c.top) < 0.3 && hz(hp, g.edge) < 1.8 && !hp.tk)) return false;
  world.co = { id: ++world.coId, k: kind, i, c: climber, h: 1 - climber, t: 0, dur: kind === 'boost' ? TRAV.boostT : TRAV.pullT };
  applyCo(world.co); sendState(); return true;
}
// both clients: take your half of a host co-op move (climber or helper), on the host's clock
function applyCo(co) {
  lastCoId = co.id;
  const mine = myIdx(), climb = co.c === mine;
  if (co.c !== mine && co.h !== mine) return;
  me.tr = { k: co.k === 'boost' ? (climb ? 'bs' : 'lf') : (climb ? 'hs' : 'pl'), i: co.i, t: co.t || 0, dur: co.dur, id: co.id, sx: me.x, sz: me.z };
  stopMe(); me.c = me.p = false; me.eq && (me.gunT = 0); syncStanceButtons(); beep(climb ? 420 : 300, 0.08, 'triangle', 0.08);
}
const _gp = { x: 0, y: 0, z: 0 };
function updateTrav(dt, jx, jz, mag) {
  const T = me.tr; T.t += dt; stopMe(); me.run = false; me.vy = 0; me.moving = false;
  switch (T.k) {
    case 'ld': {
      const c = CLIMBS[T.i], d = mag > 0.15 ? jx * Math.cos(c.a) + jz * Math.sin(c.a) : 0;
      const up = mag < 0.15 ? 0 : Math.abs(d) > 0.35 ? d : -jz; // push into the wall (or W / up) = climb, away = down
      const hang = c.top - TRAV.hangBelow, y0 = me.y;
      me.y = clamp(me.y + clamp(up * 1.3, -1, 1) * TRAV.climbSpeed[c.kind] * dt, 0, hang);
      me.x = c.x; me.z = c.z; me.a = c.a; me.moving = Math.abs(me.y - y0) > 1e-4;
      if (Math.floor(me.y / 0.32) !== Math.floor(y0 / 0.32)) beep(c.kind === 'pipe' ? 520 : 240, 0.025, 'square', 0.03);
      if (me.y >= hang - 1e-3 && up > 0.3) me.tr = { k: 'mt', i: T.i, t: 0, dur: TRAV.topVaultT, sx: me.x, sy: me.y, sz: me.z, tx: c.lx, ty: c.top, tz: c.lz };
      else if (me.y <= 1e-3 && up < -0.3) { me.tr = null; me.x -= Math.cos(c.a) * 0.35; me.z -= Math.sin(c.a) * 0.35; }
      break;
    }
    case 'mt': case 'md': {
      const u = Math.min(1, T.t / T.dur);
      // mantle: rise first then roll forward over the lip. Climb-down: step back over the lip first then lower.
      const vy = T.k === 'mt' ? ss01(u / 0.6) : ss01((u - 0.35) / 0.65), vh = T.k === 'mt' ? ss01((u - 0.35) / 0.65) : ss01(u / 0.6);
      me.y = mixv(T.sy, T.ty, vy); me.x = mixv(T.sx, T.tx, vh); me.z = mixv(T.sz, T.tz, vh);
      if (u >= 1) { me.x = T.tx; me.y = T.ty; me.z = T.tz; me.tr = T.k === 'md' ? { k: 'ld', i: T.i, t: 0 } : null; if (T.k === 'mt') beep(150, 0.05, 'sine', 0.06); }
      break;
    }
    case 'gp': {
      const L = LINKS[T.i];
      if (T.t >= TRAV.fireT) {
        if (!T.hit) { T.hit = 1; beep(1500, 0.04, 'square', 0.06); }
        const u = Math.min(1, (T.t - TRAV.fireT) / L.reelT);
        linkPos(L, T.s, ss01(u * 0.85 + 0.15) * (u < 1 ? 1 : 1), _gp); me.x = _gp.x; me.y = _gp.y; me.z = _gp.z;
        if (u >= 1) { me.x = L.to.x; me.y = L.to.y; me.z = L.to.z; me.tr = null; beep(120, 0.06, 'sine', 0.08); }
      }
      const hx = L.up ? L.hook.x - T.s.x : L.hook.x - L.to.x, hzz = L.up ? L.hook.z - T.s.z : L.hook.z - L.to.z;
      if (Math.hypot(hx, hzz) > 0.2) me.a = Math.atan2(hzz, hx); // face the hook (rappel: face the wall you drop down)
      break;
    }
    case 'kn': { const g = COOP_G[T.i]; me.x = g.base.x; me.z = g.base.z; me.a = COOPS[T.i].a + Math.PI; if (mag > 0.6) me.tr = null; break; }
    default: coopStep(T);
  }
}
// co-op choreography (both sides read the same host clock T.t, so the two bodies line up)
function coopStep(T) {
  const c = COOPS[T.i], g = COOP_G[T.i], u = Math.min(1, T.t / T.dur), hang = c.top - 1.9; // feet height with hands on the lip
  const mantle = (k, y0) => { me.y = mixv(y0, c.top, ss01(k / 0.6)); const h = ss01((k - 0.35) / 0.65); me.x = mixv(g.hang.x, g.land.x, h); me.z = mixv(g.hang.z, g.land.z, h); };
  if (T.k === 'bs') { // climber: step into the hands, get thrown up, catch the lip, mantle
    me.a = c.a;
    if (u < 0.22) { const k = ss01(u / 0.22); me.x = mixv(T.sx, g.step.x, k); me.z = mixv(T.sz, g.step.z, k); me.y = 0; me.moving = true; }
    else if (u < 0.5) { const k = ss01((u - 0.22) / 0.28); me.x = mixv(g.step.x, g.hang.x, k); me.z = mixv(g.step.z, g.hang.z, k); me.y = 1.0 * k; }
    else if (u < 0.75) { const k = ss01((u - 0.5) / 0.25); me.x = g.hang.x; me.z = g.hang.z; me.y = mixv(1.0, hang, k); }
    else mantle((u - 0.75) / 0.25, hang);
  } else if (T.k === 'hs') { // climber: grab the partner's hands, get hauled up, mantle
    me.a = c.a;
    if (u < 0.15) { const k = ss01(u / 0.15); me.x = mixv(T.sx, g.hang.x, k); me.z = mixv(T.sz, g.hang.z, k); me.y = 0; me.moving = true; }
    else if (u < 0.7) { me.x = g.hang.x; me.z = g.hang.z; me.y = mixv(0, hang, ss01((u - 0.15) / 0.55)); }
    else mantle((u - 0.7) / 0.3, hang);
  } else if (T.k === 'lf') { me.x = g.base.x; me.z = g.base.z; me.y = 0; me.a = c.a + Math.PI; }
  else if (T.k === 'pl') { const k = ss01(u / 0.12); me.x = mixv(T.sx, g.edge.x, k); me.z = mixv(T.sz, g.edge.z, k); me.y = c.top; me.a = c.a + Math.PI; }
  if (u >= 1) { if (T.k === 'bs' || T.k === 'hs') { me.x = g.land.x; me.z = g.land.z; me.y = c.top; } me.tr = null; }
}
const TR_STANCE = { ld: 'CLIMBING (push into it = up, away = down · ACT let go)', mt: 'MANTLE', md: 'CLIMBING DOWN', gp: 'GRAPPLE',
  kn: 'KNEELING - BOOST READY (move = stand)', bs: 'BOOSTED UP', lf: 'BOOSTING PARTNER', hs: 'BEING PULLED UP', pl: 'PULLING PARTNER UP' };
const travStance = () => (me.tr.k === 'gp' && LINKS[me.tr.i] && !LINKS[me.tr.i].up ? 'RAPPEL' : TR_STANCE[me.tr.k] || '');
// progress 0..1 for the wire (remote pose / rope)
function trProg(T, y) {
  if (!T) return 0;
  if (T.k === 'ld') return r2(y);
  if (T.k === 'gp') return r2(Math.min(1, T.t / LINKS[T.i].dur));
  return T.dur ? r2(Math.min(1, T.t / T.dur)) : 0;
}
// traversal pose for sneaker.js from the (wire) state: shared by my body and the partner's
function poseFor(tk, ti, tp, y) {
  switch (tk) {
    case 'ld': return { k: 'climb', ph: y * 5.2 };
    case 'mt': return { k: 'mantle', p: tp };
    case 'md': return { k: 'mantle', p: 1 - tp };
    case 'kn': return { k: 'kneel' };
    case 'lf': return { k: 'lift', p: tp };
    case 'pl': return { k: 'pull', p: tp };
    case 'gp': { const L = LINKS[ti]; if (!L) return null; const tt = tp * L.dur;
      if (tt < TRAV.fireT) return { k: 'throw', p: tt / TRAV.fireT };
      const u = (tt - TRAV.fireT) / L.reelT;
      if (L.up && u > 0.82) return { k: 'mantle', p: 0.25 + ((u - 0.82) / 0.18) * 0.75 };
      return { k: 'hang', ph: tt * 6 }; }
    case 'bs': return tp < 0.22 ? null : tp < 0.5 ? { k: 'climb', ph: tp * 22 } : tp < 0.75 ? { k: 'hang', ph: tp * 9 } : { k: 'mantle', p: (tp - 0.75) / 0.25 };
    case 'hs': return tp < 0.15 ? null : tp < 0.7 ? { k: 'hang', ph: tp * 9 } : { k: 'mantle', p: (tp - 0.7) / 0.3 };
  }
  return null;
}

// ---------------------------------------------------------------- host simulation (authoritative)
function players() {
  const low = (tk) => tk === 'kn' || tk === 'lf' || tk === 'pl';
  const list = [{ x: me.x, z: me.z, y: me.y, c: me.c || low(me.tr && me.tr.k), p: me.p, tun: me.tun, noise: noiseOf(me), idx: 0 }];
  if (peerConnected) list.push({ x: other.x, z: other.z, y: other.y, c: other.c || low(other.tk), p: other.p, tun: tunAt(other.x, other.z, other.y), noise: other.noise, idx: 1 });
  return list;
}
function armSwitch(pi) {
  const p = pi === 0 ? me : other;
  if ((p.y || 0) > 0.3) return;
  SWITCHES.forEach((s, i) => {
    if (Math.hypot(p.x - s.x, p.z - s.z) < 1.8) { world.sw[i] = SWITCH_WINDOW; world.swBy[i] = pi; }
  });
  if (!world.door && world.sw[0] > 0 && world.sw[1] > 0 && (solo || world.swBy[0] !== world.swBy[1])) world.door = true;
  if (solo && !world.door && (world.sw[0] > 0 || world.sw[1] > 0)) world.door = true;
}
function triggerAlert(p) {
  if (world.alert < 2) { world.alerts++; }
  world.alert = 2; world.alertT = ALERT_TIME;
  for (const g of world.guards) if (alive(g)) { g.st = 'chase'; g.tx = p.x; g.tz = p.z; g.give = 8; }
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
  if (world.co) { world.co.t += dt; if (world.co.t > world.co.dur + 0.4) world.co = null; } // co-op climb clock
  const ps = players();
  let anySeen = false;
  for (const g of world.guards) {
    if (g.st === 'dead') continue;
    if (g.st === 'held') { // being taken down: frozen, blind, deaf. Drops dead when the hold finishes.
      g.tdT += dt;
      if (g.tdT >= TD.time) { g.st = 'dead'; world.kills++; }
      continue;
    }
    // --- sight
    let seen = null, seenD = 1e9, seenRange = 1;
    for (const p of ps) {
      if (world.inv[p.idx] > 0 || p.tun >= 0) continue; // nobody sees into the crawlspaces
      const dx = p.x - g.x, dz = p.z - g.z, d = Math.hypot(dx, dz);
      let range = (p.p ? SIGHT.prone : p.c ? SIGHT.crouch : SIGHT.stand) + (world.alert > 0 ? 2 : 0);
      // up on a roof / gantry: guards look along the ground, so you're harder to pick out (and never straight overhead)
      if (p.y > 1.2) { range = p.c || p.p ? SIGHT.prone * 0.6 : SIGHT.stand * 0.75; if (d < 1.4 && p.y > 2) continue; }
      if (d > range) continue;
      if ((Math.abs(angDiff(Math.atan2(dz, dx), g.a)) < SIGHT.fovHalf || d < 1.1) && lineOfSight(g, p) && d < seenD) { seen = p; seenD = d; seenRange = range; }
    }
    if (seen) {
      anySeen = true;
      const rate = (world.alert === 2 ? 6 : world.alert === 1 ? 2.2 : 1.3) * (1 + 2 * (1 - seenD / seenRange)) * (seen.p ? 0.35 : seen.c ? 0.6 : 1);
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
    if (g.st !== 'patrol') g.pause = 0;
    if (g.st === 'patrol' && g.pause > 0) { // idle at a waypoint: stand still, slow look left/right around his heading
      g.pause -= dt; g.pauseT += dt;
      g.a = g.look0 + Math.sin(g.pauseT * PAUSE.rate) * PAUSE.sweep * Math.min(1, g.pauseT * 1.5);
    } else if (g.st === 'patrol') {
      const [tx, tz] = g.path[g.wp];
      if (moveToward(g, tx, tz, SPEED.patrol, dt)) {
        g.wp = (g.wp + 1) % g.path.length;
        g.pause = PAUSE.min + Math.random() * PAUSE.rand; g.pauseT = 0; g.look0 = g.a;
      }
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
    if (world.alert === 2 && world.phase === 'play') for (const p of ps) if (world.inv[p.idx] <= 0 && p.tun < 0 && p.y < 0.6 && Math.hypot(p.x - g.x, p.z - g.z) < 0.95) { catchPlayer(p.idx); break; }
    if (world.phase !== 'play') return;
  }
  // --- alert phases
  if (world.alert === 2 && !anySeen) { world.alertT -= dt; if (world.alertT <= 0) { world.alert = 1; world.cautionT = CAUTION_TIME; world.guards.forEach((g) => { if (alive(g)) { g.st = 'patrol'; g.meter = 0; } }); } }
  else if (world.alert === 1) { world.cautionT -= dt; if (world.cautionT <= 0) world.alert = 0; }
  // --- extract
  world.ext = [Math.hypot(me.x - EXTRACT.x, me.z - EXTRACT.z) < EXTRACT.r, peerConnected && Math.hypot(other.x - EXTRACT.x, other.z - EXTRACT.z) < EXTRACT.r];
  if (world.door && world.ext[0] && (solo || world.ext[1])) { world.phase = 'win'; world.finalT = world.t; }
}
function hostRestart() {
  world = freshWorld();
  me.x = SPAWNS[0].x; me.z = SPAWNS[0].z; me.tun = -1; stopMe(); resetLoadout(); lastCoId = -1; other.x = other.rx = SPAWNS[1].x; other.z = other.rz = SPAWNS[1].z; other.nvx = other.nvz = 0;
  net.relay({ t: 'tp', x: SPAWNS[1].x, z: SPAWNS[1].z, silent: true });
  sendState();
}

// ---------------------------------------------------------------- network
const r2 = (v) => Math.round(v * 100) / 100;
function sendState() {
  net.relay({ t: 's',
    g: world.guards.map((g) => [r2(g.x), r2(g.z), r2(g.a), g.st[0], r2(g.meter), r2(g.tdT || 0)]), // st[0]: p i c s h(eld) d(ead)
    al: world.alert, at: r2(world.alertT), sw: world.sw.map(r2), door: world.door, ph: world.phase, tm: r2(world.t), ft: r2(world.finalT), dd: world.dead,
    c: world.caught, n: world.alerts, ext: world.ext, solo, k: world.kills,
    // h[4] = prone, h[5..6] = velocity, h[7] = takedown progress (-1 none), h[8] = aiming (just fired), h[9] = pistol drawn
    // (older clients ignore the extras)
    // h[10] = feet height, h[11..13] = traversal move code / index / progress. co = host co-op climb [id, kind, spot, climber, helper, t, dur]
    h: [r2(me.x), r2(me.z), r2(me.a), me.c ? 1 : 0, me.p ? 1 : 0, r2(me.vx), r2(me.vz), tdProg(), me.gunT > 0 ? 1 : 0, me.eq ? 1 : 0,
      r2(me.y), me.tr ? me.tr.k : '', me.tr ? me.tr.i : -1, trProg(me.tr, me.y)],
    co: world.co ? [world.co.id, world.co.k[0], world.co.i, world.co.c, world.co.h, r2(world.co.t), world.co.dur] : 0 });
}
const tdProg = () => (me.td ? r2(Math.min(1, me.td.t / TD.time)) : -1);
function sendPlayer() { net.relay({ t: 'p', x: r2(me.x), z: r2(me.z), a: r2(me.a), c: me.c ? 1 : 0, p: me.p ? 1 : 0, n: noiseOf(me), vx: r2(me.vx), vz: r2(me.vz),
  td: tdProg(), gd: me.gunT > 0 ? 1 : 0, eq: me.eq ? 1 : 0, y: r2(me.y), tk: me.tr ? me.tr.k : '', ti: me.tr ? me.tr.i : -1, tp: trProg(me.tr, me.y) }); }
function netTrav(o, y, tk, ti, tp) { o.y = y || 0; o.tk = tk || ''; o.ti = ti ?? -1; o.tp = tp || 0; }
// partner fired: tracer + recoil on their model (host also applies the hit)
function remoteShot(d) { other.shot++; other.gd = 1; gunFx(otherMesh, d.ex, d.ez, d.g >= 0); gunSound(0.6); }
// remote motion sample: remember the net velocity (sent by the peer, or estimated from packet deltas for older
// clients / guards) so render() can extrapolate a little between 15-20Hz packets instead of stair-stepping.
function netSample(o, x, z, vx, vz) {
  const now = performance.now(), age = o.pt ? (now - o.pt) / 1000 : 1;
  if (vx != null && vz != null) { o.nvx = vx; o.nvz = vz; }
  else if (age > 0.02 && age < 0.5) { o.nvx += ((x - o.x) / age - o.nvx) * 0.5; o.nvz += ((z - o.z) / age - o.nvz) * 0.5; }
  else { o.nvx = 0; o.nvz = 0; }
  if (Math.hypot(x - o.x, z - o.z) > 3) { o.nvx = o.nvz = 0; o.snap = true; } // teleport (restart)
  o.pt = now; o.x = x; o.z = z;
}

function onGameMsg(d) {
  if (d.t === 'p' && role === 'host') { netSample(other, d.x, d.z, d.vx, d.vz); other.a = d.a; other.c = !!d.c; other.p = !!d.p; other.noise = d.n || 0; other.td = d.td ?? -1; other.gd = d.gd || 0; other.eq = d.eq ?? (other.gd ? 1 : 0); netTrav(other, d.y, d.tk, d.ti, d.tp); }
  else if (d.t === 'tr' && role === 'host') { // guest solo climb / grapple: veto if I'm already on that ladder / rope, or it's over
    const busy = me.tr && me.tr.k === d.k && me.tr.i === d.i && (d.k === 'ld' || d.k === 'gp');
    if (busy || world.phase !== 'play') net.relay({ t: 'trx' });
  }
  else if (d.t === 'trx' && role === 'guest') { const T = me.tr; if (T && TR_SOLO[T.k]) { me.x = T.ox ?? me.x; me.y = T.oy ?? 0; me.z = T.oz ?? me.z; me.tr = null; toast('Partner is on that line', 1000, '#ffb36b'); } }
  else if (d.t === 'co' && role === 'host') { if (!hostCoop(d.k, d.i, d.c)) net.relay({ t: 'cox' }); }
  else if (d.t === 'cox' && role === 'guest') toast('Can\'t - get in position', 900, '#ffb36b');
  else if (d.t === 'td' && role === 'host') { // guest takedown request: re-check (lenient) against the authoritative guard
    const g = world.guards[d.g], p = { x: d.x, z: d.z, tun: -1 };
    const ok = g && alive(g) && Math.hypot(p.x - g.x, p.z - g.z) < TD.lenRange && Math.abs(angDiff(Math.atan2(p.z - g.z, p.x - g.x), g.a)) > TD.lenBehind;
    if (!ok || !hostTakedown(d.g, 1)) net.relay({ t: 'tdx' });
    else { other.x = d.x; other.z = d.z; other.td = 0; }
  }
  else if (d.t === 'tdx' && role === 'guest') { if (me.td) { me.td = null; toast('Spotted - grab failed', 1000, '#ffb36b'); } }
  else if (d.t === 'sh') { remoteShot(d); if (role === 'host') hostShot(d, 1); }
  else if (d.t === 'i' && role === 'host') { if (world.phase === 'play') armSwitch(1); }
  else if (d.t === 'r' && role === 'host') { if (world.phase !== 'play') hostRestart(); }
  else if (d.t === 's' && role === 'guest') {
    d.g.forEach((a, i) => { const g = world.guards[i]; if (!g) return; netSample(g, a[0], a[1]); g.a = a[2]; g.st = { p: 'patrol', i: 'investigate', c: 'chase', s: 'search', h: 'held', d: 'dead' }[a[3]]; g.meter = a[4]; g.tdT = a[5] || 0; });
    Object.assign(world, { alert: d.al, alertT: d.at, sw: d.sw, door: d.door, phase: d.ph, t: d.tm, finalT: d.ft, caught: d.c, alerts: d.n, ext: d.ext, dead: d.dd ?? -1, kills: d.k || 0 });
    solo = d.solo;
    netSample(other, d.h[0], d.h[1], d.h[5], d.h[6]); other.a = d.h[2]; other.c = !!d.h[3]; other.p = !!d.h[4]; other.td = d.h[7] ?? -1; other.gd = d.h[8] || 0; other.eq = d.h[9] ?? (other.gd ? 1 : 0);
    netTrav(other, d.h[10], d.h[11], d.h[12], d.h[13]);
    if (d.co) {
      const [id, k, i, c, h, t, dur] = d.co; world.co = { id, k: k === 'b' ? 'boost' : 'pull', i, c, h, t, dur };
      if (id !== lastCoId) applyCo(world.co);
      else if (me.tr && me.tr.id === id && Math.abs(me.tr.t - t) > 0.25) me.tr.t = t; // drift: follow the host clock
    } else world.co = null;
  } else if (d.t === 'tp' && role === 'guest') {
    me.x = d.x; me.z = d.z; me.tun = -1; me.y = 0; me.vy = 0; me.tr = null; lastCoId = -1; stopMe(); if (!d.silent) toast('CAUGHT! Back to start', 1600);
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
  me.c = false; me.p = false; me.tun = -1; stopMe(); resetLoadout(); syncStanceButtons(); $('lobby').classList.remove('hidden'); $('hud').classList.add('hidden'); $('overlay').classList.add('hidden');
  $('lobbyMsg').textContent = msg || '';
}
function enterGame() {
  if (!$('lobby').classList.contains('hidden')) {
    $('lobby').classList.add('hidden'); $('hud').classList.remove('hidden');
    const s = SPAWNS[role === 'host' ? 0 : 1]; me.x = s.x; me.z = s.z; stopMe(); resetLoadout();
    if (role === 'host' && !solo) toast('Room ' + roomCode + ' - share the link', 2500, '#7fff9f');
  }
  applyPlayerLooks();
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
      $('ovBody').innerHTML = `Time ${fmtTime(world.finalT)}<br>Alerts ${world.alerts} &middot; Kills ${world.kills}<br>Rank: <b>${rank()}</b>`;
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
  if (world.phase === 'play' && lastPhase !== 'play') { $('overlay').classList.add('hidden'); resetLoadout(); }
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
  rc.fillStyle = 'rgba(216,176,40,0.35)'; // tunnels
  for (const t of TUNNELS) rc.fillRect(X(t.x1), Z(t.z1), (t.x2 - t.x1) * sx, (t.z2 - t.z1) * sz);
  rc.fillStyle = 'rgba(120,200,255,0.45)'; // gantry / roof decks
  for (const b of WALKS) rc.fillRect(X(b.x1), Z(b.z1), (b.x2 - b.x1) * sx, (b.z2 - b.z1) * sz);
  rc.fillStyle = '#ffd040'; for (const c of CLIMBS) rc.fillRect(X(c.x) - 1.5, Z(c.z) - 1.5, 3, 3); // ladders / pipe
  for (const c of COOPS) rc.fillRect(X(c.x) - 2.5, Z(c.z) - 1, 5, 2);
  rc.fillStyle = '#ff9a30'; const hk = new Set(); // grapple hooks
  for (const L of LINKS) { const key = L.hook.x + ',' + L.hook.z; if (hk.has(key)) continue; hk.add(key); rc.beginPath(); rc.arc(X(L.hook.x), Z(L.hook.z), 2.2, 0, 7); rc.fill(); }
  rc.strokeStyle = '#7fff9f'; rc.beginPath(); rc.arc(X(EXTRACT.x), Z(EXTRACT.z), EXTRACT.r * sx, 0, 7); rc.stroke();
  for (const g of world.guards) {
    if (!alive(g)) { rc.fillStyle = '#777'; rc.fillRect(X(g.rx) - 2, Z(g.rz) - 1, 5, 2); continue; }
    rc.fillStyle = 'rgba(255,224,102,0.35)'; rc.beginPath(); rc.moveTo(X(g.rx), Z(g.rz));
    rc.arc(X(g.rx), Z(g.rz), SIGHT.stand * sx, g.ra - SIGHT.fovHalf, g.ra + SIGHT.fovHalf); rc.fill();
    rc.fillStyle = '#ff5050'; rc.fillRect(X(g.rx) - 2, Z(g.rz) - 2, 4, 4);
  }
  if (peerConnected) { rc.fillStyle = '#7fff8f'; rc.fillRect(X(other.rx) - 3, Z(other.rz) - 3, 6, 6); }
  rc.fillStyle = '#ffffff'; rc.fillRect(X(me.x) - 3, Z(me.z) - 3, 6, 6);
}

// ---------------------------------------------------------------- render
const topCam = new THREE.Vector3(me.x, 15, me.z + 9), topLook = new THREE.Vector3(), fpsEye = new THREE.Vector3(), fpsLook = new THREE.Vector3(), camLook = new THREE.Vector3();
const SKY = new THREE.Color(0x0a1418), TUNNEL_FOG = new THREE.Color(0x06090a);
let fpsK = 0, camYaw = me.a, eyeH = 0.92, eyeF = 0.12, camY = 0;
// which climb spot / grapple ring to highlight (whatever ACT would use)
function travNear() {
  const m = curTm; if (!m || me.tr) return null;
  if (m.m === 'climb' || m.m === 'down') return { kind: 'climb', i: m.i };
  if (m.m === 'grapple' || m.m === 'rappel') return { kind: 'link', i: m.i };
  if (m.i >= 0 && m.m !== 'mantle') return { kind: 'coop', i: m.i };
  return null;
}
const lerpA = (a, b, t) => a + angDiff(b, a) * t;
function render(dt) {
  const k = Math.min(1, dt * 12);
  // remote player smoothing: chase a slightly extrapolated position (last packet + net velocity * packet age, capped)
  const now = performance.now();
  const ext = (o) => { const age = o.pt ? Math.min(0.12, (now - o.pt) / 1000) : 0; return [o.x + (o.nvx || 0) * age, o.z + (o.nvz || 0) * age]; };
  const kr = Math.min(1, dt * 10);
  { const [tx, tz] = ext(other); if (other.snap) { other.rx = tx; other.rz = tz; other.snap = false; } else { other.rx += (tx - other.rx) * kr; other.rz += (tz - other.rz) * kr; } }
  other.ra = lerpA(other.ra, other.a, k);
  const deadMe = world.phase === 'over' && world.dead === myIdx(), deadOther = world.phase === 'over' && world.dead === 1 - myIdx();
  meMesh.g.position.set(me.x, me.y, me.z); meMesh.g.rotation.y = -me.a;
  // auto-aim lock (pistol drawn, in play): the arms turn at the shoulders toward it; the laser rides the gun
  const play = world.phase === 'play';
  const myTr = me.tr ? poseFor(me.tr.k, me.tr.i, trProg(me.tr, me.y), me.y) : null, myBusy = !!me.tr; // climbing: hands busy, gun slung
  const myAim = aimPoint(me, meMesh, me.eq && !me.td && !myBusy && play && !deadMe);
  meMesh.update(dt, { aimAt: myAim, moving: me.moving && !myTr, run: me.run, speed: myBusy ? (myTr ? 0 : 1.6) : Math.hypot(me.vx, me.vz), crouch: me.c && !me.p && !myBusy, prone: me.p && !myBusy, dead: deadMe,
    takedown: me.td ? Math.min(1, me.td.t / TD.time) : null, aim: (me.eq || me.gunT > 0) && !myBusy, armed: me.eq && !myBusy, shot: me.shot, trav: myTr }); // drawn = always in the forward aim stance
  // remote player: walk/run animation from its smoothed on-screen speed (net packets don't carry a run flag)
  // remote anim speed: prefer the net velocity (smooth), fall back to on-screen motion
  if (dt > 0) { const vNet = Math.hypot(other.nvx, other.nvz), vScr = Math.hypot(other.rx - otherPX, other.rz - otherPZ) / dt;
    const v = other.pt && performance.now() - other.pt < 300 ? vNet : vScr; otherSpeed += (Math.min(v, 8) - otherSpeed) * Math.min(1, dt * 8); }
  otherPX = other.rx; otherPZ = other.rz;
  otherMesh.g.visible = peerConnected;
  other.ry = Math.abs(other.y - other.ry) > 4 ? other.y : other.ry + (other.y - other.ry) * kr;
  otherMesh.g.position.set(other.rx, other.ry, other.rz); otherMesh.g.rotation.y = -other.ra;
  const oBusy = !!other.tk, oTr = oBusy ? poseFor(other.tk, other.ti, other.tp, other.ry) : null;
  const otherAim = aimPoint({ x: other.rx, z: other.rz, y: other.ry, a: other.ra, tun: tunAt(other.rx, other.rz, other.ry) }, otherMesh, peerConnected && !!other.eq && other.td < 0 && !oBusy && play && !deadOther);
  otherMesh.update(dt, { aimAt: otherAim, moving: otherSpeed > 0.4 && world.phase === 'play' && other.td < 0 && !oTr, run: otherSpeed > 4.2 && !other.c, speed: world.phase === 'play' && other.td < 0 && !oTr ? otherSpeed : 0,
    crouch: other.c && !other.p && !oBusy, prone: other.p && !oBusy, dead: deadOther, takedown: other.td >= 0 ? other.td : null, aim: (!!other.gd || !!other.eq) && !oBusy, armed: !!other.eq && !oBusy, shot: other.shot, trav: oTr });
  updateRope(myRope, meMesh, me.tr ? me.tr.k : '', me.tr ? me.tr.i : -1, trProg(me.tr, me.y));
  updateRope(otherRope, otherMesh, peerConnected ? other.tk : '', other.ti, other.tp);
  travFx.tick(dt, travNear());
  // laser sights: only while the pistol is drawn, not mid-takedown / dead / between missions
  updateLaser(myLaser, meMesh, me.eq && !me.td && !myBusy && play && !deadMe, dt);
  updateLaser(otherLaser, otherMesh, peerConnected && !!other.eq && other.td < 0 && !oBusy && play && !deadOther, dt);
  world.guards.forEach((g, i) => {
    if (role === 'host') { g.rx = g.x; g.rz = g.z; g.ra = g.a; }
    else { const [tx, tz] = ext(g); if (g.snap) { g.rx = tx; g.rz = tz; g.snap = false; } else { g.rx += (tx - g.rx) * kr; g.rz += (tz - g.rz) * kr; } g.ra = lerpA(g.ra, g.a, k); }
    const m = guardMeshes[i];
    m.g.position.set(g.rx, 0, g.rz); m.g.rotation.y = -g.ra;
    if (dt > 0) { const v = Math.hypot(g.rx - m.px, g.rz - m.pz) / dt; m.spd += (Math.min(v, 8) - m.spd) * Math.min(1, dt * 8); }
    m.px = g.rx; m.pz = g.rz;
    const down = g.st === 'dead', held = g.st === 'held', live = !down && !held;
    m.update(dt, { moving: live && m.spd > 0.4 && world.phase === 'play', run: m.spd > 3.4, speed: live && world.phase === 'play' ? m.spd : 0,
      dead: down, held: held ? Math.min(1, g.tdT / TD.time) : null });
    m.coneHolder.visible = live;
    m.poolK = down ? Math.min(1, m.poolK + dt * 0.5) : 0; m.pool.visible = m.poolK > 0; m.pool.scale.setScalar(0.2 + m.poolK * 0.9);
    const range = SIGHT.stand + (world.alert > 0 ? 2 : 0);
    m.cone.scale.set(range, range, 1);
    m.coneMat.color.setHex(world.alert === 2 ? 0xff3030 : g.meter > 0.3 ? 0xffa030 : 0xffe066);
    m.coneMat.opacity = 0.18 + g.meter * 0.25;
    m.q.visible = g.st === 'investigate'; m.ex.visible = g.st === 'chase' || g.st === 'search';
    if (!live) m.q.visible = m.ex.visible = false;
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
  // camera: angled top-down follow (zoomed out a bit more in portrait), blended into FIRST PERSON while MY player is in a tunnel.
  // Purely local: each client only looks at its own me.tun, so the partner's camera is never affected.
  const zoom = (camera.aspect < 1 ? 1.35 + (1 - camera.aspect) * 0.7 : 1) * 1.25;
  const camDist = Math.hypot(15, 9) * zoom;
  topCam.x += (me.x - topCam.x) * Math.min(1, dt * 6);
  topCam.z += (me.z + 9 * zoom - topCam.z) * Math.min(1, dt * 6);
  camY += (me.y - camY) * Math.min(1, dt * 4); // follow the climber up (keeps the same framing on roofs)
  topCam.y = 15 * zoom + camY;
  topLook.set(topCam.x, camY, topCam.z - 9 * zoom - 0.5);
  fpsK += ((role && me.tun >= 0 ? 1 : 0) - fpsK) * Math.min(1, dt * 4.5);
  if (fpsK < 0.002) fpsK = 0; if (fpsK > 0.998) fpsK = 1;
  const f = fpsK * fpsK * (3 - 2 * fpsK); // smoothstep
  camYaw = lerpA(camYaw, me.a, Math.min(1, dt * 12));
  eyeH += ((me.p ? 0.3 : 0.92) - eyeH) * Math.min(1, dt * 6);
  eyeF += ((me.p ? 0.42 : 0.12) - eyeF) * Math.min(1, dt * 6);
  const cy = Math.cos(camYaw), sy = Math.sin(camYaw);
  fpsEye.set(me.x + cy * eyeF, eyeH, me.z + sy * eyeF);
  fpsLook.set(fpsEye.x + cy * 4, eyeH - 0.15, fpsEye.z + sy * 4);
  camera.position.lerpVectors(topCam, fpsEye, f);
  camLook.lerpVectors(topLook, fpsLook, f);
  camera.lookAt(camLook);
  const fov = 40 + 32 * f;
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.near = 0.1 - 0.06 * f; camera.updateProjectionMatrix(); }
  scene.fog.near = THREE.MathUtils.lerp(camDist + 4, 0.6, f); scene.fog.far = THREE.MathUtils.lerp(camDist + 30, 17, f);
  scene.fog.color.lerpColors(SKY, TUNNEL_FOG, f); scene.background.copy(scene.fog.color);
  meMesh.g.visible = f < 0.6; // don't render my own head in first person
  markers[0].visible = f < 0.5;
  if (f > 0 !== document.body.classList.contains('fps')) document.body.classList.toggle('fps', f > 0);
  $('fpsVignette').style.opacity = f.toFixed(2);
  updateFx(dt);
  renderer.render(scene, camera);
}

// ACT button label + prompt for each traversal option (prompt '' = button label only)
const TRAV_LABEL = { climb: ['CLIMB', 'CLIMB'], down: ['CLIMB DOWN', 'CLIMB DOWN'], mantle: ['MANTLE', 'MANTLE'], grapple: ['GRAPPLE', 'GRAPPLE'],
  rappel: ['RAPPEL', 'RAPPEL DOWN'], kneel: ['BOOST', 'KNEEL - BOOST PARTNER'], boost: ['CLIMB ON', 'CLIMB ON PARTNER'], hoist: ['GRAB HAND', 'GET PULLED UP'],
  pull: ['PULL UP', 'PULL PARTNER UP'], solo2p: ['2P', 'TOO HIGH - CO-OP BOOST'], letgo: ['LET GO', ''], stand: ['STAND', ''], busy: ['...', ''] };
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
  // combat HUD: ammo counter, context label on the ACT button, keyboard prompt when a takedown is possible
  const ammoTxt = 'P-9 ' + (me.eq ? '|'.repeat(me.ammo) + (me.ammo ? '' : 'EMPTY') + ' ' + me.ammo + '/' + GUN.ammo
    : 'HOLSTERED ' + me.ammo + '/' + GUN.ammo + (isTouch ? '' : '  [G] draw')) + (world.kills ? '  KILLS ' + world.kills : '');
  const ammoEl = $('ammo'); if (ammoEl.textContent !== ammoTxt) ammoEl.textContent = ammoTxt;
  ammoEl.classList.toggle('holstered', !me.eq);
  const mode = world.phase === 'play' && !me.td ? actMode() : 'none';
  if (mode === 'none' || mode === 'td' || mode === 'use' || mode === 'fire') curTm = null;
  const tl = TRAV_LABEL[mode];
  const act = $('btnAct'), label = mode === 'td' ? 'TAKE DOWN' : mode === 'use' ? 'USE' : mode === 'fire' ? 'FIRE' : tl ? tl[0] : 'ACT';
  if (act.textContent !== label) act.textContent = label;
  act.classList.toggle('kill', mode === 'td');
  act.classList.toggle('climb', !!tl);
  const pr = $('prompt'), ptxt = mode === 'td' ? (isTouch ? 'TAKE DOWN' : 'E  TAKE DOWN') : tl && tl[1] ? (isTouch ? tl[1] : 'E  ' + tl[1]) : '';
  if (pr.textContent !== ptxt) { pr.textContent = ptxt; pr.classList.toggle('hidden', !ptxt); }
}

// ---------------------------------------------------------------- main loop
let last = performance.now(), sendAcc = 0, stateAcc = 0, pingAcc = 0;
camera.position.copy(topCam);
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
window.__ds = { me, other, get world() { return world; }, get role() { return role; }, get peer() { return peerConnected; }, armSwitch, net,
  TUNNELS, tunnelAt, get fpsK() { return fpsK; }, camera, toggleProne, toggleCrouch,
  doInteract, fireGun, toggleGun, takedownTarget, actMode, TD, GUN, meMesh, myLaser, autoTarget,
  travMode, startTrav, groundAt, CLIMBS, COOPS, LINKS, WALKS, hostCoop, otherMesh, input };
