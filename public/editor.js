// Deadsignal map editor. Edits the same JSON the game compiles (mapcompile.js).
// Desktop first: orbit / top camera, grid snap, inspector. The phone game does not load this file.
import * as THREE from 'three';
import { DEFAULT_MAP } from './leveldata.js';
import { YARD_MAP } from './yarddata.js';
import { ITEMS } from './gear.js';

const $ = (id) => document.getElementById(id);
const FLOORS = [0, 3.2, 6.4, 9.6];
const FACE = [
  ['North', -Math.PI / 2], ['East', 0], ['South', Math.PI / 2], ['West', Math.PI],
];
const TOOLS = [
  { id: 'hull', type: 'block', kind: 'building', label: 'Hull', color: '#6e382e', style: 'hull' },
  { id: 'boat', type: 'block', kind: 'building', label: 'Boat deck', color: '#5c564c', style: 'boat' },
  { id: 'wall', type: 'block', kind: 'wall', label: 'Wall', color: '#56636b' },
  { id: 'building', type: 'block', kind: 'building', label: 'Building', color: '#4a5866' },
  { id: 'crate', type: 'block', kind: 'crate', label: 'Crate', color: '#7a6440' },
  { id: 'door', type: 'block', kind: 'door', label: 'Door', color: '#9a2a2a' },
  { id: 'deck', type: 'deck', label: 'Deck', color: '#7d8a92' },
  { id: 'water', type: 'water', label: 'Water', color: '#1a90b0' },
  { id: 'dry', type: 'dry', label: 'Dry pad', color: '#4c585c' },
  { id: 'ladder', type: 'climb', kind: 'ladder', label: 'Ladder', color: '#c8a030' },
  { id: 'pipe', type: 'climb', kind: 'pipe', label: 'Drainpipe', color: '#6a8f72' },
  { id: 'net', type: 'climb', kind: 'net', label: 'Cargo net', color: '#8d6b3a' },
  { id: 'coop', type: 'coop', label: 'Climb wall', color: '#e0b060' },
  { id: 'grapple', type: 'grapple', label: 'Grapple', color: '#ff8a2a' },
  { id: 'crawl', type: 'crawl', label: 'Crawlspace', color: '#d8b028' },
  { id: 'spawn', type: 'spawn', label: 'Spawn', color: '#7fff9f' },
  { id: 'patrol', type: 'patrol', label: 'Guard route', color: '#ff5050' },
  { id: 'locker', type: 'pickup', locker: 1, label: 'Locker', color: '#9fd6ff' },
  { id: 'item', type: 'pickup', locker: 0, label: 'Item crate', color: '#b7d48a' },
  { id: 'switch', type: 'switch', label: 'Switch', color: '#ffd040' },
  { id: 'extract', type: 'extract', label: 'Extract', color: '#40ff80' },
  { id: 'pad', type: 'pad', label: 'Ground', color: '#3d6b52' },
];
const KIND_COLOR = { wall: 0x56636b, building: 0x4a5866, crate: 0x7a6440, door: 0x9a2a2a, post: 0x6a4a30 };
const AMMO_N = { p9: 12, fr5: 30, mkt: 6, stun: 2, c4: 1, ration: 1, stim: 1, supp: 1, box: 1, scope: 1 };

let doc = structuredClone(DEFAULT_MAP);
let selected = null;
let tool = null;
let dirty = false;
let seq = 1;
const undoStack = [];
const redoStack = [];
const keys = {};

const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2) * 0.5);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1418);
scene.fog = new THREE.Fog(0x0a1418, 50, 130);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
scene.add(new THREE.HemisphereLight(0x9fc3d9, 0x1a2a20, 1.15));
const sun = new THREE.DirectionalLight(0xbfd8ff, 0.85);
sun.position.set(-12, 24, 10); scene.add(sun);
const world = new THREE.Group(); scene.add(world);
const raycaster = new THREE.Raycaster();
raycaster.params.Line = { threshold: 0.6 };
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const pointer = new THREE.Vector2();
const target = new THREE.Vector3(1, 0, 1);
let yaw = 0, pitch = 1.03, dist = 52;
let drag = null;

function snap(v) {
  const s = +$('snap').value;
  if (!s) return Math.round(v * 1000) / 1000;
  return Math.round(v / s) * s;
}
function piece(id) { return doc.pieces.find((p) => p && p.id === id); }
const ofType = (t) => doc.pieces.filter((p) => p && p.type === t);
function centerOf(p) {
  if (p.x1 != null) return { x: (p.x1 + p.x2) / 2, z: (p.z1 + p.z2) / 2, w: Math.abs(p.x2 - p.x1), d: Math.abs(p.z2 - p.z1) };
  if (p.path) {
    const xs = p.path.map((w) => w[0]), zs = p.path.map((w) => w[1]);
    return { x: xs.reduce((a, b) => a + b, 0) / xs.length, z: zs.reduce((a, b) => a + b, 0) / zs.length };
  }
  return { x: p.x || 0, z: p.z || 0 };
}
function titleOf(p) {
  if (!p) return 'Map';
  if (p.name) return p.name;
  if (p.type === 'block') return p.kind || 'block';
  if (p.type === 'pickup') return (p.locker ? 'Locker ' : 'Crate ') + (ITEMS[p.item] ? ITEMS[p.item].name : p.item || '');
  if (p.type === 'spawn') return 'Spawn P' + (ofType('spawn').indexOf(p) + 1);
  if (p.type === 'switch') return 'Switch ' + (ofType('switch').indexOf(p) + 1);
  return p.type;
}
function nextId(type) {
  let id;
  do { id = (type || 'p').slice(0, 3) + (seq++).toString(36); } while (doc.pieces.some((p) => p && p.id === id));
  return id;
}
function setStatus(t) { $('status').textContent = t; }
function mark() { dirty = true; }

function pushUndo() {
  undoStack.push(JSON.stringify(doc));
  if (undoStack.length > 80) undoStack.shift();
  redoStack.length = 0;
  dirty = true;
}
function restore(raw) {
  doc = JSON.parse(raw);
  if (selected && !piece(selected)) selected = null;
  rebuild();
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(doc));
  restore(undoStack.pop());
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(doc));
  restore(redoStack.pop());
}

function facingOf(a) {
  let best = FACE[0], bd = 99;
  for (const f of FACE) {
    let d = Math.abs(a - f[1]);
    while (d > Math.PI) d -= Math.PI * 2;
    if (Math.abs(d) < bd) { bd = Math.abs(d); best = f; }
  }
  return best;
}
function setFacing(p, a) {
  const old = p.a || 0, da = a - old;
  const c = Math.cos(da), s = Math.sin(da);
  if (p.lx != null) {
    const dx = p.lx - p.x, dz = p.lz - p.z;
    p.lx = p.x + dx * c - dz * s;
    p.lz = p.z + dx * s + dz * c;
  }
  p.a = a;
}
function movePiece(p, dx, dz) {
  if (!dx && !dz) return;
  if (p.x1 != null) { p.x1 += dx; p.x2 += dx; p.z1 += dz; p.z2 += dz; }
  else {
    if (p.x != null) p.x += dx;
    if (p.z != null) p.z += dz;
  }
  if (p.lx != null) { p.lx += dx; p.lz += dz; }
  if (p.path) for (const w of p.path) { w[0] += dx; w[1] += dz; }
  if (Array.isArray(p.home)) { p.home[0] += dx; p.home[1] += dx; p.home[2] += dz; p.home[3] += dz; }
  if (p.area) for (const a of p.area) { a.x1 += dx; a.x2 += dx; a.z1 += dz; a.z2 += dz; }
}
function rotatePiece(p) {
  if (p.a != null && p.type !== 'block' && p.type !== 'pad' && p.type !== 'deck' && p.type !== 'water' && p.type !== 'crawl') {
    setFacing(p, (p.a || 0) + Math.PI / 2);
    return;
  }
  if (p.x1 == null) return;
  const c = centerOf(p), w = p.x2 - p.x1, d = p.z2 - p.z1;
  p.x1 = c.x - d / 2; p.x2 = c.x + d / 2; p.z1 = c.z - w / 2; p.z2 = c.z + w / 2;
  if (p.type === 'crawl') p.axis = Math.abs(p.x2 - p.x1) >= Math.abs(p.z2 - p.z1) ? 'x' : 'z';
}
function deleteReason(p) {
  if (!p) return 'Select a piece first.';
  if (p.type === 'spawn') return 'The mission always has 5 spawns. Drag this one instead.';
  if (p.type === 'switch') return 'The door needs both switches. Drag this one instead.';
  if (p.type === 'extract') return 'Drag the extract pad to move it.';
  return '';
}

function fresh(toolId, x, z) {
  const t = TOOLS.find((n) => n.id === toolId);
  x = snap(x); z = snap(z);
  const rect = (type, w, d, extra) => ({ id: nextId(type), type, x1: x - w / 2, x2: x + w / 2, z1: z - d / 2, z2: z + d / 2, ...extra });
  if (t.id === 'hull') return rect('block', 16, 12, { kind: 'building', h: 3.2, name: 'HULL', paint: 0x6e382e, draft: 1.7, noCoop: 1 });
  if (t.id === 'boat') return rect('block', 6, 3.4, { kind: 'building', h: 1.2, name: 'BOAT', paint: 0x5c564c, draft: 0.85, boot: 0.3, noCoop: 1 });
  if (t.type === 'block') {
    const sz = { wall: [6, 1, 2.5], building: [6, 5, 3.2], crate: [1.5, 1.5, 1], door: [3, 0.5, 2.5] }[t.kind];
    return rect('block', sz[0], sz[1], { kind: t.kind, h: sz[2], name: t.label });
  }
  if (t.type === 'dry') return rect('dry', 6, 4, { name: 'Dry pad' });
  if (t.type === 'deck') return rect('deck', 6, 1.4, { h: 3.2, name: 'DECK' });
  if (t.type === 'water') return rect('water', 8, 6, { name: 'WATER' });
  if (t.type === 'pad') return rect('pad', 8, 8, { y: 0.012, color: 0x243028, name: 'PAD' });
  if (t.type === 'crawl') return rect('crawl', 8, 1.6, { axis: 'x', roof: 0.2, name: 'CRAWL' });
  if (t.type === 'climb') {
    const a = -Math.PI / 2, top = t.kind === 'pipe' ? 6.4 : 3.2, reach = 1.1;
    const p = { id: nextId('climb'), type: 'climb', kind: t.kind, name: t.label.toUpperCase(), x, z, a, y0: 0, top, lx: x + Math.cos(a) * reach, lz: z + Math.sin(a) * reach };
    if (t.kind === 'net') p.span = 1.6;
    return p;
  }
  if (t.type === 'coop') return { id: nextId('coop'), type: 'coop', name: 'CLIMB WALL', x, z, a: -Math.PI / 2, top: 3.2, y0: 0 };
  if (t.type === 'grapple') return { id: nextId('grapple'), type: 'grapple', name: 'GRAPPLE', x, z, a: -Math.PI / 2, y0: 0, top: 3.2, lip: 3.26, wall: 0.38, land: 0.6 };
  if (t.type === 'spawn') return { id: nextId('spawn'), type: 'spawn', x, z };
  if (t.type === 'switch') return { id: nextId('switch'), type: 'switch', x, z, y: 0 };
  if (t.type === 'extract') return { id: nextId('extract'), type: 'extract', x, z, y: 0, r: 1.8 };
  if (t.type === 'patrol') {
    const path = [[x - 2, z - 2], [x + 2, z - 2], [x + 2, z + 2], [x - 2, z + 2]];
    return { id: nextId('patrol'), type: 'patrol', name: 'GUARD', y: 0, path, home: [x - 4, x + 4, z - 4, z + 4] };
  }
  if (t.type === 'pickup') {
    const item = t.locker ? 'p9' : 'ration';
    const p = { id: nextId('pickup'), type: 'pickup', item, n: AMMO_N[item] || 1, x, z, y: 0 };
    if (t.locker) p.locker = 1;
    return p;
  }
  return null;
}
function placeAt(x, z) {
  if (tool === 'spawn') {
    const list = ofType('spawn');
    if (list.length >= 5) { setStatus('Five spawns already — drag one to move it.'); selected = nearest(list, x, z).id; tool = null; syncTools(); rebuild(); return; }
  }
  if (tool === 'switch') {
    const list = ofType('switch');
    if (list.length >= 2) { setStatus('Two switches already — drag one to move it.'); selected = nearest(list, x, z).id; tool = null; syncTools(); rebuild(); return; }
  }
  if (tool === 'extract') {
    const ex = ofType('extract')[0];
    if (ex) { pushUndo(); ex.x = snap(x); ex.z = snap(z); selected = ex.id; setStatus('Extract pad moved.'); rebuild(); return; }
  }
  const p = fresh(tool, x, z);
  if (!p) { setStatus('That piece is already on the map. Drag it instead.'); return; }
  pushUndo();
  doc.pieces.push(p);
  selected = p.id;
  tool = null;
  syncTools();
  setStatus('Placed ' + titleOf(p) + '. Drag it, or set the numbers on the right.');
  rebuild();
}
function nearest(list, x, z) {
  return list.slice().sort((a, b) => (centerOf(a).x - x) ** 2 + (centerOf(a).z - z) ** 2 - ((centerOf(b).x - x) ** 2 + (centerOf(b).z - z) ** 2))[0];
}
function doDelete() {
  const p = piece(selected);
  const why = deleteReason(p);
  if (why) { setStatus(why); return; }
  pushUndo();
  doc.pieces = doc.pieces.filter((q) => q.id !== p.id);
  selected = null;
  setStatus('Deleted.');
  rebuild();
}
function doDuplicate() {
  const p = piece(selected);
  if (!p) return;
  if (p.type === 'spawn' || p.type === 'switch' || p.type === 'extract') { setStatus('Move that one instead of copying it.'); return; }
  pushUndo();
  const c = structuredClone(p);
  c.id = nextId(p.type);
  if (c.name) c.name = c.name + ' COPY';
  movePiece(c, 1, 1);
  doc.pieces.push(c);
  selected = c.id;
  setStatus('Copied. Drag the copy into place.');
  rebuild();
}
function doRotate() {
  const p = piece(selected);
  if (!p) return;
  pushUndo();
  rotatePiece(p);
  rebuild();
}

// ---------------------------------------------------------------- scene
function mat(color, opacity) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
}
function box(w, h, d, color, x, y, z, data, opacity = 1) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.04, w), Math.max(0.04, h), Math.max(0.04, d)), mat(color, opacity));
  m.position.set(x, y, z); m.userData = data || {}; world.add(m); return m;
}
function line(points, color, data) {
  const g = new THREE.BufferGeometry().setFromPoints(points);
  const m = new THREE.Line(g, new THREE.LineBasicMaterial({ color }));
  m.userData = data || {}; world.add(m); return m;
}
function disc(r, color, x, y, z, data) {
  const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.7, r, 16), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.userData = data || {}; world.add(m); return m;
}
function tag(text, x, y, z) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, 128, 32);
  g.font = 'bold 20px monospace'; g.fillStyle = '#e8ffe8'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 17);
  const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.position.set(x, y, z); s.scale.set(2.2, 0.55, 1); s.userData = { ignore: 1 }; world.add(s);
}
function rectLoop(x1, x2, z1, z2, y, color) {
  const y0 = y + 0.05;
  line([
    new THREE.Vector3(x1, y0, z1), new THREE.Vector3(x2, y0, z1), new THREE.Vector3(x2, y0, z2),
    new THREE.Vector3(x1, y0, z2), new THREE.Vector3(x1, y0, z1),
  ], color, { ignore: 1 });
}
function handlesFor(p) {
  if (!selected || p.id !== selected || p.x1 == null || p.type === 'rail' || p.type === 'post') return;
  const y = (p.h || p.y || 0) + 0.35, c = centerOf(p);
  const spots = [['x1', p.x1, c.z], ['x2', p.x2, c.z], ['z1', c.x, p.z1], ['z2', c.x, p.z2]];
  for (const [handle, x, z] of spots) box(0.45, 0.45, 0.45, 0xffe24a, x, y, z, { pid: p.id, handle });
}
function buildWorld() {
  while (world.children.length) world.remove(world.children[0]);
  const b = doc.bounds || { x1: -38, x2: 40, z1: -30, z2: 32 };
  const gw = b.x2 - b.x1, gd = b.z2 - b.z1;
  const sea = !!doc.sea;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(gw, gd), mat(sea ? 0x0c3a4a : 0x26352e, 1));
  ground.rotation.x = -Math.PI / 2; ground.position.set((b.x1 + b.x2) / 2, 0, (b.z1 + b.z2) / 2);
  ground.userData = { ground: 1 }; world.add(ground);
  const size = Math.max(gw, gd);
  const grid = new THREE.GridHelper(size, Math.max(2, Math.round(size)), 0x4fbf7a, 0x234038);
  grid.position.set((b.x1 + b.x2) / 2, 0.02, (b.z1 + b.z2) / 2); world.add(grid);
  // north marker (world north is -z)
  box(0.4, 0.15, 1.4, 0x7fff9f, (b.x1 + b.x2) / 2, 0.1, b.z1 + 0.8, { ignore: 1 });
  tag('N', (b.x1 + b.x2) / 2, 1.2, b.z1 + 1.2);

  const show = (p) => !!p;
  for (const p of doc.pieces) {
    if (!p || !show(p)) continue;
    const on = p.id === selected;
    const data = { pid: p.id };
    if (p.type === 'pad') {
      const c = centerOf(p);
      box(c.w, 0.05, c.d, p.color || 0x243028, c.x, p.y || 0.02, c.z, data, 1);
    } else     if (p.type === 'dry') {
      const c = centerOf(p);
      box(c.w, 0.12, c.d, 0x4c585c, c.x, 0.08, c.z, data);
    } else if (p.type === 'block' || p.type === 'post') {
      const c = p.type === 'post' ? { x: p.x, z: p.z, w: 0.16, d: 0.16 } : centerOf(p);
      const h = p.h || 1;
      const col = p.paint != null ? p.paint : (KIND_COLOR[p.kind] || KIND_COLOR.post);
      box(c.w, h, c.d, col, c.x, h / 2, c.z, data);
      if (p.draft) box(Math.max(0.2, c.w - 0.2), p.draft, Math.max(0.2, c.d - 0.2), 0x140e0c, c.x, -p.draft / 2, c.z, data);
    } else if (p.type === 'deck') {
      const c = centerOf(p);
      box(c.w, 0.14, c.d, p.h > 8 ? 0x9aa8b0 : p.h > 5 ? 0x7d8a92 : 0x5c666c, c.x, p.h, c.z, data, p.noDeck ? 0.35 : 0.9);
    } else if (p.type === 'rail') {
      const c = centerOf(p);
      box(Math.max(0.08, c.w), 0.9, Math.max(0.08, c.d), 0x8a5a32, c.x, (p.y0 || 0) + 0.45, c.z, data);
    } else if (p.type === 'water') {
      const c = centerOf(p);
      box(c.w, 0.08, c.d, 0x1a90b0, c.x, 0.06, c.z, data, 0.55);
    } else if (p.type === 'crawl') {
      const c = centerOf(p);
      box(c.w, 0.3, c.d, 0x2a3034, c.x, 0.2, c.z, data);
      rectLoop(p.x1, p.x2, p.z1, p.z2, 0.3, 0xd8b028);
    } else if (p.type === 'climb') {
      const dx = Math.cos(p.a || 0), dz = Math.sin(p.a || 0), tx = -dz, tz = dx;
      const span = p.kind === 'net' ? (p.span || 1.6) : p.kind === 'pipe' ? 0.16 : 0.55;
      const h = Math.max(0.4, (p.top || 3.2) - (p.y0 || 0));
      const col = p.kind === 'net' ? 0x8d6b3a : p.kind === 'pipe' ? 0x6a8f72 : 0xc8a030;
      box(Math.abs(tx) * span + 0.08, h, Math.abs(tz) * span + 0.08, col, p.x + dx * 0.3, (p.y0 || 0) + h / 2, p.z + dz * 0.3, data);
      disc(0.45, 0xf0e0a0, p.x, (p.y0 || 0) + 0.05, p.z, data);
    } else if (p.type === 'coop') {
      disc(0.7, 0xe0b060, p.x, (p.y0 || 0) + 0.06, p.z, data);
      tag('2P', p.x, (p.y0 || 0) + 1.1, p.z);
    } else if (p.type === 'grapple') {
      const dx = Math.cos(p.a || 0), dz = Math.sin(p.a || 0);
      const fx = p.x + dx * (p.wall || 0.38), fz = p.z + dz * (p.wall || 0.38);
      line([new THREE.Vector3(fx, p.y0 || 0, fz), new THREE.Vector3(fx, p.lip || p.top || 3, fz)], 0xff8a2a, data);
      disc(0.55, 0xff9a40, p.x, (p.y0 || 0) + 0.05, p.z, data);
      disc(0.45, 0xff9a40, p.x + dx * ((p.wall || 0.38) + (p.land || 0.6)), (p.top || 0) + 0.05, p.z + dz * ((p.wall || 0.38) + (p.land || 0.6)), data);
    } else if (p.type === 'spawn') {
      const i = ofType('spawn').indexOf(p);
      box(0.7, 0.15, 0.7, 0x1e6b3a, p.x, 0.1, p.z, data);
      tag('P' + (i + 1), p.x, 1.3, p.z);
    } else if (p.type === 'switch') {
      box(0.7, 0.9, 0.4, 0xffd040, p.x, (p.y || 0) + 0.45, p.z, data);
    } else if (p.type === 'extract') {
      disc(p.r || 1.8, 0x40ff80, p.x, (p.y || 0) + 0.08, p.z, data);
      tag('EXTRACT', p.x, (p.y || 0) + 1.4, p.z);
    } else if (p.type === 'pickup') {
      box(p.locker ? 0.5 : 0.45, p.locker ? 0.9 : 0.3, 0.4, p.locker ? 0x4a5560 : 0x5a6a3a, p.x, (p.y || 0) + (p.locker ? 0.45 : 0.2), p.z, data);
      if (on) tag(ITEMS[p.item] ? ITEMS[p.item].name : (p.item || '?'), p.x, (p.y || 0) + 1.3, p.z);
    } else if (p.type === 'patrol') {
      const y = (p.y || 0) + 0.2;
      const pts = (p.path || []).map((w) => new THREE.Vector3(w[0], y, w[1]));
      if (pts.length > 1) pts.push(pts[0].clone());
      if (pts.length) line(pts, 0xff5050, data);
      (p.path || []).forEach((w, i) => box(0.4, 0.4, 0.4, 0xff7070, w[0], y, w[1], { pid: p.id, wp: i }));
      const c = centerOf(p);
      box(0.7, 0.25, 0.7, 0xffd0d0, c.x, y + 0.3, c.z, { pid: p.id, all: 1 });
      if (on) tag(p.name || 'GUARD', c.x, y + 1.2, c.z);
      if ((p.y || 0) <= 0.3 && p.home) rectLoop(p.home[0], p.home[1], p.home[2], p.home[3], 0.04, 0xff8080);
      if (p.area) for (const a of p.area) rectLoop(a.x1, a.x2, a.z1, a.z2, p.y || 0, 0xffb080);
    }
    if (on && p.x1 != null && p.type !== 'patrol') {
      const c = centerOf(p);
      rectLoop(Math.min(p.x1, p.x2), Math.max(p.x1, p.x2), Math.min(p.z1, p.z2), Math.max(p.z1, p.z2), (p.h || p.y || 0), 0xffe24a);
    }
    handlesFor(p);
  }
}

function buildList() {
  const q = $('find').value.trim().toLowerCase();
  const showRails = $('showRails').checked;
  const box = $('list');
  box.textContent = '';
  for (const p of doc.pieces) {
    if (!p) continue;
    if ((p.type === 'rail' || p.type === 'post') && !showRails && p.id !== selected) continue;
    const name = titleOf(p);
    if (q && !name.toLowerCase().includes(q)) continue;
    const b = document.createElement('button');
    b.className = 'rowbtn' + (p.id === selected ? ' on' : '');
    b.textContent = name;
    b.onclick = () => { selected = p.id; tool = null; syncTools(); const c = centerOf(p); target.set(c.x, 0, c.z); rebuild(); };
    box.appendChild(b);
  }
}

function numField(label, value, apply) {
  const row = document.createElement('label'); row.className = 'f'; row.textContent = label;
  const input = document.createElement('input'); input.type = 'number'; input.step = '0.1'; input.value = Math.round(value * 1000) / 1000;
  input.addEventListener('change', () => { pushUndo(); apply(+input.value); buildWorld(); buildList(); });
  row.appendChild(input); return row;
}
function textField(label, value, apply) {
  const row = document.createElement('label'); row.className = 'f'; row.textContent = label;
  const input = document.createElement('input'); input.value = value || '';
  input.addEventListener('change', () => { pushUndo(); apply(input.value); buildWorld(); buildList(); $('inspTitle').textContent = titleOf(piece(selected)); });
  row.appendChild(input); return row;
}
function choice(label, options, value, apply) {
  const row = document.createElement('label'); row.className = 'f'; row.textContent = label;
  const sel = document.createElement('select');
  for (const [v, name] of options) {
    const o = document.createElement('option'); o.value = v; o.textContent = name;
    if (String(v) === String(value)) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => { pushUndo(); apply(sel.value); rebuild(); });
  row.appendChild(sel); return row;
}
function buttons(pairs) {
  const row = document.createElement('div'); row.className = 'btns';
  for (const [name, fn] of pairs) {
    const b = document.createElement('button'); b.textContent = name;
    b.onclick = () => { pushUndo(); fn(); rebuild(); };
    row.appendChild(b);
  }
  return row;
}
function note(text) { const p = document.createElement('p'); p.className = 'note'; p.textContent = text; return p; }

function buildInspector() {
  const host = $('insp'); host.textContent = '';
  const p = piece(selected);
  $('inspTitle').textContent = p ? titleOf(p) : 'Map';
  if (!p) {
    host.appendChild(note('Nothing selected. Click the map, or pick a type on the left and click to place it.'));
    const b = doc.bounds;
    host.appendChild(numField('West edge', b.x1, (v) => { doc.bounds.x1 = v; }));
    host.appendChild(numField('East edge', b.x2, (v) => { doc.bounds.x2 = v; }));
    host.appendChild(numField('North edge', b.z1, (v) => { doc.bounds.z1 = v; }));
    host.appendChild(numField('South edge', b.z2, (v) => { doc.bounds.z2 = v; }));
    host.appendChild(note('North is the -Z edge (the N marker). The radar and the ground use these edges.'));
    return;
  }
  if (p.name != null || p.type === 'block' || p.type === 'deck' || p.type === 'patrol' || p.type === 'crawl' || p.type === 'water') {
    host.appendChild(textField('Name', p.name || '', (v) => { p.name = v; }));
  }
  if (p.type === 'block') {
    const styles = [['hull', 'Ship hull'], ['boat', 'Boat deck'], ['hold', 'Cargo hold'], ['bridge', 'Bridge'], ['crane', 'Crane'], ['stack', 'Funnel'], ['wall', 'Wall'], ['door', 'Bulkhead'], ['crate', 'Crate'], ['building', 'Plain block']];
    const current = p.dress === 'bridge' || p.dress === 'crane' || p.dress === 'stack' ? p.dress
      : p.kind === 'door' ? 'door' : p.kind === 'wall' ? 'wall' : p.kind === 'crate' ? 'crate'
      : p.boot ? 'boat' : p.draft ? 'hull' : (p.paint === 0x241e1c ? 'hold' : 'building');
    host.appendChild(choice('Style', styles, current, (v) => {
      delete p.paint; delete p.draft; delete p.boot; delete p.dress; delete p.noCoop;
      const set = {
        hull: { kind: 'building', paint: 0x6e382e, draft: 1.7, noCoop: 1 },
        boat: { kind: 'building', paint: 0x5c564c, draft: 0.85, boot: 0.3, noCoop: 1 },
        hold: { kind: 'building', paint: 0x241e1c, noCoop: 1 },
        bridge: { kind: 'building', paint: 0xc5ccd1, dress: 'bridge', noCoop: 1 },
        crane: { kind: 'building', paint: 0xd1a43a, dress: 'crane' },
        stack: { kind: 'building', paint: 0x3e3834, dress: 'stack' },
        wall: { kind: 'wall' }, door: { kind: 'door' }, crate: { kind: 'crate', paint: 0x6e5a38 }, building: { kind: 'building' },
      }[v];
      Object.assign(p, set);
    }));
    host.appendChild(note(p.kind === 'door' ? 'The red bulkhead opens when both switches are pressed.' : p.draft ? 'A hull or boat sits in the water. Dry pads are where swimmers stand to climb aboard.' : 'Walk on top of a building or a crate.'));
  }
  if (p.type === 'dry') host.appendChild(note('A dry pad is a swim platform, the pier, or the bilge. Everything else on an ocean map is water. Guards do not swim.'));
  if (p.x1 != null && p.type !== 'rail') {
    const c = centerOf(p);
    host.appendChild(numField('Width', c.w, (v) => { const w = Math.max(0.2, v), cx = (p.x1 + p.x2) / 2; p.x1 = cx - w / 2; p.x2 = cx + w / 2; if (p.type === 'crawl') p.axis = w >= Math.abs(p.z2 - p.z1) ? 'x' : 'z'; }));
    host.appendChild(numField('Depth', c.d, (v) => { const d = Math.max(0.2, v), cz = (p.z1 + p.z2) / 2; p.z1 = cz - d / 2; p.z2 = cz + d / 2; if (p.type === 'crawl') p.axis = Math.abs(p.x2 - p.x1) >= d ? 'x' : 'z'; }));
  }
  if (p.h != null && p.type !== 'deck') host.appendChild(heightRow(p, 'h'));
  if (p.type === 'deck') {
    host.appendChild(heightRow(p, 'h'));
    host.appendChild(choice('Open underneath', [['0', 'Solid deck'], ['1', 'No floor mesh (roof is drawn by a crawlspace)']], p.noDeck ? '1' : '0', (v) => { if (v === '1') p.noDeck = 1; else delete p.noDeck; }));
    const add = document.createElement('button'); add.textContent = 'Add railings';
    add.onclick = () => {
      pushUndo();
      const edges = [
        [p.x1, p.x2, p.z1 - 0.08, p.z1], [p.x1, p.x2, p.z2, p.z2 + 0.08],
        [p.x1 - 0.08, p.x1, p.z1, p.z2], [p.x2, p.x2 + 0.08, p.z1, p.z2],
      ];
      for (const [x1, x2, z1, z2] of edges) doc.pieces.push({ id: nextId('rail'), type: 'rail', x1, x2, z1, z2, y0: p.h });
      $('showRails').checked = true;
      setStatus('Railings added. Delete one to leave a gap for a ladder.');
      rebuild();
    };
    host.appendChild(add);
  }
  if (p.type === 'crawl') {
    host.appendChild(numField('Roof thickness', p.roof || 0.2, (v) => { p.roof = Math.max(0.05, v); }));
    host.appendChild(choice('Crawl direction', [['x', 'Along X'], ['z', 'Along Z']], p.axis || 'x', (v) => { p.axis = v; }));
    host.appendChild(note('Guards cannot enter. The player crawls in first person. Both ends stay open.'));
  }
  if (p.type === 'pad') {
    host.appendChild(numField('Color (hex)', p.color || 0, (v) => { p.color = v; }));
    host.appendChild(note('Paint only. It does not block anyone. Water still cuts a hole.'));
  }
  if (p.a != null && (p.type === 'climb' || p.type === 'coop' || p.type === 'grapple')) {
    host.appendChild(buttons(FACE.map(([name, a]) => [name, () => setFacing(p, a)])));
    host.appendChild(note('Facing is the direction into the wall. North is up on the angled view.'));
  }
  if (p.type === 'climb') {
    host.appendChild(choice('Kind', [['ladder', 'Ladder'], ['pipe', 'Drainpipe'], ['net', 'Cargo net']], p.kind, (v) => { p.kind = v; if (v === 'net' && !p.span) p.span = 1.6; }));
    host.appendChild(heightRow(p, 'y0', 'Foot height'));
    host.appendChild(heightRow(p, 'top', 'Top height'));
    if (p.kind === 'net') host.appendChild(numField('Net width', p.span || 1.6, (v) => { p.span = Math.max(0.4, v); }));
    const reach = Math.hypot((p.lx || p.x) - p.x, (p.lz || p.z) - p.z);
    host.appendChild(numField('Landing distance', reach, (v) => { const d = Math.max(0.3, v); p.lx = p.x + Math.cos(p.a || 0) * d; p.lz = p.z + Math.sin(p.a || 0) * d; }));
  }
  if (p.type === 'coop') {
    host.appendChild(heightRow(p, 'top', 'Roof height'));
    host.appendChild(heightRow(p, 'y0', 'Foot height'));
    host.appendChild(note('Two players: one kneels, the other climbs on. Low crates do not need this.'));
  }
  if (p.type === 'grapple') {
    host.appendChild(heightRow(p, 'y0', 'Foot height'));
    host.appendChild(heightRow(p, 'top', 'Roof height'));
    host.appendChild(numField('Hook height', p.lip || 0, (v) => { p.lip = v; }));
    host.appendChild(numField('Land distance', p.land || 0.6, (v) => { p.land = Math.max(0.2, v); }));
    host.appendChild(choice('Hook sits on', [['0', 'A roof edge'], ['1', 'A railing']], p.rail ? '1' : '0', (v) => { if (v === '1') p.rail = 1; else delete p.rail; }));
    host.appendChild(note('Top only: rappel down from the roof ring, or haul a partner waiting at the foot.'));
  }
  if (p.type === 'spawn') host.appendChild(note('Player ' + (ofType('spawn').indexOf(p) + 1) + ' of 5. Drag to move. The host is P1.'));
  if (p.x != null && p.x1 == null && p.type !== 'patrol') {
    host.appendChild(numField('X', p.x, (v) => { const dx = v - p.x; movePiece(p, dx, 0); }));
    host.appendChild(numField('Z', p.z, (v) => { const dz = v - p.z; movePiece(p, 0, dz); }));
  }
  if (p.type === 'switch' || p.type === 'extract' || p.type === 'pickup' || p.type === 'pad') {
    if (p.y != null) host.appendChild(heightRow(p, 'y', p.type === 'pad' ? 'Paint height' : 'Floor height'));
  }
  if (p.type === 'extract') host.appendChild(numField('Radius', p.r || 1.8, (v) => { p.r = Math.max(0.5, v); }));
  if (p.type === 'pickup') {
    const opts = Object.entries(ITEMS).map(([id, it]) => [id, it.name]);
    host.appendChild(choice('Item', opts, p.item, (v) => { p.item = v; if (!p.n) p.n = AMMO_N[v] || 1; }));
    host.appendChild(numField('Amount', p.n || 1, (v) => { p.n = Math.max(1, v); }));
    host.appendChild(choice('Container', [['0', 'Crate'], ['1', 'Locker']], p.locker ? '1' : '0', (v) => { if (v === '1') p.locker = 1; else delete p.locker; }));
    host.appendChild(choice('Ammo crate', [['0', 'Gear (take once)'], ['1', 'Ammo (needs the gun)']], p.ammo ? '1' : '0', (v) => { if (v === '1') p.ammo = 1; else delete p.ammo; }));
    host.appendChild(numField('Respawn seconds (0 = once)', p.respawn || 0, (v) => { if (v > 0) p.respawn = v; else delete p.respawn; }));
  }
  if (p.type === 'patrol') {
    host.appendChild(heightRow(p, 'y', 'Floor'));
    host.appendChild(note('Drag the red cubes to move waypoints. Drag the pale cube to move the whole route.'));
    const list = document.createElement('div');
    (p.path || []).forEach((w, i) => {
      const row = document.createElement('div'); row.className = 'btns';
      const lab = document.createElement('span'); lab.textContent = (i + 1) + '.';
      const x = document.createElement('input'); x.type = 'number'; x.step = '0.1'; x.value = w[0]; x.style.width = '70px';
      const z = document.createElement('input'); z.type = 'number'; z.step = '0.1'; z.value = w[1]; z.style.width = '70px';
      const apply = () => { pushUndo(); w[0] = +x.value; w[1] = +z.value; buildWorld(); };
      x.addEventListener('change', apply); z.addEventListener('change', apply);
      row.append(lab, x, z);
      if (p.path.length > 2) {
        const rm = document.createElement('button'); rm.textContent = 'x';
        rm.onclick = () => { pushUndo(); p.path.splice(i, 1); rebuild(); };
        row.appendChild(rm);
      }
      list.appendChild(row);
    });
    host.appendChild(list);
    host.appendChild(buttons([
      ['Add waypoint', () => { const last = p.path[p.path.length - 1] || [0, 0]; p.path.push([last[0] + 2, last[1]]); }],
      ['Fit search box', () => {
        const xs = p.path.map((w) => w[0]), zs = p.path.map((w) => w[1]);
        p.home = [Math.min(...xs) - 2, Math.max(...xs) + 2, Math.min(...zs) - 2, Math.max(...zs) + 2];
      }],
    ]));
    if ((p.y || 0) > 0.3) {
      host.appendChild(note('On a deck, add a walk area for each catwalk this guard may stand on, or he will step off.'));
      host.appendChild(buttons([
        ['Add walk area', () => {
          const last = p.path[0] || [0, 0];
          p.area = p.area || [];
          p.area.push({ x1: last[0] - 2, x2: last[0] + 2, z1: last[1] - 1, z2: last[1] + 1 });
        }],
      ]));
      (p.area || []).forEach((a, i) => {
        host.appendChild(note('Area ' + (i + 1)));
        host.appendChild(numField('West', a.x1, (v) => { a.x1 = v; }));
        host.appendChild(numField('East', a.x2, (v) => { a.x2 = v; }));
        host.appendChild(numField('North', a.z1, (v) => { a.z1 = v; }));
        host.appendChild(numField('South', a.z2, (v) => { a.z2 = v; }));
      });
    } else if (p.home) {
      host.appendChild(note('Search box: he comes back inside this rectangle after a chase. West, east, north, south.'));
      host.appendChild(numField('West', p.home[0], (v) => { p.home[0] = v; }));
      host.appendChild(numField('East', p.home[1], (v) => { p.home[1] = v; }));
      host.appendChild(numField('North', p.home[2], (v) => { p.home[2] = v; }));
      host.appendChild(numField('South', p.home[3], (v) => { p.home[3] = v; }));
    }
  }
}
function heightRow(p, key, label) {
  const wrap = document.createElement('div');
  wrap.appendChild(buttons(FLOORS.map((y) => [y === 0 ? 'Ground' : String(y), () => { p[key] = y; }])));
  wrap.appendChild(numField(label || 'Height', p[key] || 0, (v) => { p[key] = v; }));
  return wrap;
}

function rebuild() {
  if (!doc.bounds) doc.bounds = { x1: -38, x2: 40, z1: -30, z2: 32 };
  $('mapName').value = doc.name || '';
  buildWorld();
  buildList();
  buildInspector();
  const extra = dirty ? ' · unsaved' : '';
  setStatus((doc.name || 'Map') + ' · ' + doc.pieces.length + ' pieces' + extra + ' · right-drag orbits, scroll zooms');
}
function syncTools() {
  $('toolSelect').classList.toggle('on', !tool);
  for (const b of document.querySelectorAll('.swatch')) b.classList.toggle('on', b.dataset.tool === tool);
}

// ---------------------------------------------------------------- camera / pointer
function updateCam() {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  camera.position.set(target.x + Math.sin(yaw) * dist * cp, target.y + dist * sp, target.z + Math.cos(yaw) * dist * cp);
  camera.lookAt(target);
}
function resize() {
  const w = canvas.clientWidth || 800, h = canvas.clientHeight || 600;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
  }
  camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
}
function ndc(ev) {
  const r = canvas.getBoundingClientRect();
  pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
}
function groundAt(ev) {
  ndc(ev); raycaster.setFromCamera(pointer, camera);
  const hit = new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlane, hit) ? hit : null;
}
function pick(ev) {
  ndc(ev); raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(world.children, false);
  return hits.find((h) => h.object.userData && (h.object.userData.pid || h.object.userData.handle != null || h.object.userData.wp != null || h.object.userData.all));
}
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (ev) => {
  canvas.setPointerCapture(ev.pointerId);
  const hit = pick(ev);
  const g = groundAt(ev);
  if (ev.button === 2 || ev.altKey) { drag = { mode: 'orbit', x: ev.clientX, y: ev.clientY, yaw, pitch }; return; }
  if (ev.button === 1) { drag = { mode: 'pan', x: ev.clientX, y: ev.clientY, tx: target.x, tz: target.z }; return; }
  if (ev.button !== 0) return;
  const wasDirty = dirty;
  if (tool && g) { drag = { mode: 'place', x: ev.clientX, y: ev.clientY, gx: g.x, gz: g.z, wasDirty }; return; }
  if (hit && hit.object.userData.handle) {
    const p = piece(hit.object.userData.pid);
    pushUndo();
    drag = { mode: 'scale', handle: hit.object.userData.handle, orig: structuredClone(p), id: p.id, wasDirty };
    selected = p.id; return;
  }
  if (hit && hit.object.userData.wp != null) {
    const p = piece(hit.object.userData.pid);
    pushUndo();
    drag = { mode: 'wp', id: p.id, wp: hit.object.userData.wp, wasDirty };
    selected = p.id; tool = null; syncTools(); buildInspector(); buildList(); return;
  }
  if (hit && hit.object.userData.pid && g) {
    const p = piece(hit.object.userData.pid);
    pushUndo();
    const c = centerOf(p);
    drag = { mode: 'move', id: p.id, orig: structuredClone(p), gx: g.x, gz: g.z, cx: c.x, cz: c.z, all: !!hit.object.userData.all, wasDirty };
    selected = p.id; tool = null; syncTools(); buildInspector(); buildList(); return;
  }
  drag = { mode: 'pan', x: ev.clientX, y: ev.clientY, tx: target.x, tz: target.z, clear: true };
});
canvas.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  const g = groundAt(ev);
  if (drag.mode === 'orbit') {
    yaw = drag.yaw - (ev.clientX - drag.x) * 0.008;
    pitch = Math.max(0.2, Math.min(1.45, drag.pitch - (ev.clientY - drag.y) * 0.006));
  } else if (drag.mode === 'pan') {
    if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 4) return;
    const dx = (ev.clientX - drag.x) * dist * 0.0018, dy = (ev.clientY - drag.y) * dist * 0.0018;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    target.x = drag.tx - rx * dx - fx * dy; target.z = drag.tz - rz * dx - fz * dy;
    drag.moved = true;
  } else if (drag.mode === 'move' && g) {
    const p = piece(drag.id); if (!p) return;
    const nx = snap(drag.cx + (g.x - drag.gx)), nz = snap(drag.cz + (g.z - drag.gz));
    const freshP = structuredClone(drag.orig);
    Object.keys(p).forEach((k) => delete p[k]); Object.assign(p, freshP);
    movePiece(p, nx - drag.cx, nz - drag.cz);
    drag.moved = Math.abs(nx - drag.cx) + Math.abs(nz - drag.cz) > 0;
    buildWorld();
  } else if (drag.mode === 'wp' && g) {
    const p = piece(drag.id); if (!p || !p.path[drag.wp]) return;
    p.path[drag.wp][0] = snap(g.x); p.path[drag.wp][1] = snap(g.z);
    drag.moved = true; buildWorld();
  } else if (drag.mode === 'scale' && g) {
    const p = piece(drag.id); if (!p) return;
    const o = drag.orig;
    p.x1 = o.x1; p.x2 = o.x2; p.z1 = o.z1; p.z2 = o.z2;
    const x = snap(g.x), z = snap(g.z);
    if (drag.handle === 'x1') p.x1 = Math.min(x, p.x2 - 0.2);
    if (drag.handle === 'x2') p.x2 = Math.max(x, p.x1 + 0.2);
    if (drag.handle === 'z1') p.z1 = Math.min(z, p.z2 - 0.2);
    if (drag.handle === 'z2') p.z2 = Math.max(z, p.z1 + 0.2);
    if (p.type === 'crawl') p.axis = Math.abs(p.x2 - p.x1) >= Math.abs(p.z2 - p.z1) ? 'x' : 'z';
    drag.moved = true; buildWorld();
  } else if (drag.mode === 'place') {
    drag.moved = Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 5;
  }
});
function endDrag(ev) {
  if (!drag) return;
  const mode = drag.mode, moved = drag.moved, g = groundAt(ev);
  if (mode === 'place' && !moved) placeAt(drag.gx, drag.gz);
  else if (mode === 'pan' && drag.clear && !moved) { selected = null; rebuild(); }
  else if ((mode === 'move' || mode === 'scale' || mode === 'wp') && !moved) { undoStack.pop(); dirty = drag.wasDirty; rebuild(); }
  else if (mode === 'move' || mode === 'scale' || mode === 'wp') rebuild();
  drag = null;
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); dist = Math.max(6, Math.min(160, dist * (ev.deltaY > 0 ? 1.08 : 0.92))); }, { passive: false });

window.addEventListener('keydown', (e) => {
  const typing = e.target && (e.target.matches('input, textarea, select'));
  if (typing) { if (e.key === 'Escape') e.target.blur(); return; }
  keys[e.key.toLowerCase()] = true;
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  else if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); doDuplicate(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); doDelete(); }
  else if (e.key.toLowerCase() === 'r') doRotate();
  else if (e.key === 'Escape') { tool = null; selected = null; syncTools(); rebuild(); }
  else if (e.key.toLowerCase() === 'f') frame();
  else if (e.key === '1') { pitch = 1.45; yaw = 0; }
  else if (e.key === '2') { pitch = 1.03; yaw = 0; }
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

function frame() {
  const b = doc.bounds || { x1: -38, x2: 40, z1: -30, z2: 32 };
  target.set((b.x1 + b.x2) / 2, 0, (b.z1 + b.z2) / 2);
  dist = Math.max(b.x2 - b.x1, b.z2 - b.z1) * 0.72;
  pitch = 1.03; yaw = 0;
}
function tick() {
  const step = dist * 0.012;
  if (keys.w || keys.arrowup) { target.x -= Math.sin(yaw) * step; target.z -= Math.cos(yaw) * step; }
  if (keys.s || keys.arrowdown) { target.x += Math.sin(yaw) * step; target.z += Math.cos(yaw) * step; }
  if (keys.a || keys.arrowleft) { target.x -= Math.cos(yaw) * step; target.z += Math.sin(yaw) * step; }
  if (keys.d || keys.arrowright) { target.x += Math.cos(yaw) * step; target.z -= Math.sin(yaw) * step; }
  if (keys.q) yaw += 0.02;
  if (keys.e) yaw -= 0.02;
  resize(); updateCam(); renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- files / server
function adopt(next) {
  if (!next || typeof next !== 'object' || !Array.isArray(next.pieces)) throw new Error('not a map');
  next.version = next.version || 1;
  next.name = next.name || 'Untitled';
  next.bounds = next.bounds || { x1: -38, x2: 40, z1: -30, z2: 32 };
  for (const p of next.pieces) if (p && !p.id) p.id = nextId(p.type || 'piece');
  return next;
}
function download() {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (doc.id && doc.id !== 'yard' ? doc.id : (doc.name || 'map')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.json';
  a.click();
  dirty = false;
  setStatus('Downloaded ' + a.download + '. Open brings it back.');
}
async function refreshSaved() {
  const sel = $('saved');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Saved maps…</option>';
  try {
    const r = await fetch('/api/maps');
    if (!r.ok) return;
    const j = await r.json();
    for (const m of j.maps || []) {
      const o = document.createElement('option'); o.value = m.id; o.textContent = m.name || m.id; sel.appendChild(o);
    }
    if (cur) sel.value = cur;
  } catch { /* server list is optional */ }
}
async function saveServer(makeActive) {
  const r = await fetch('/api/maps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Save failed');
  doc.id = j.id;
  if (makeActive) {
    const r2 = await fetch('/api/maps/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: j.id }) });
    const k = await r2.json().catch(() => ({}));
    if (!r2.ok) throw new Error(k.error || 'Could not switch the game to this map');
  }
  dirty = false;
  await refreshSaved();
  setStatus(makeActive ? 'The game now loads “' + (doc.name || j.id) + '”. Host a mission to play it.' : 'Saved on the server as ' + j.id + '. The live mission is unchanged.');
}
function playtest() {
  localStorage.setItem('ds-playtest-map', JSON.stringify(doc));
  window.open('/?map=playtest&solo=1', '_blank');
  setStatus('Playtest opened. Solo is on. Use in the game if a partner should see this map.');
}

function bind() {
  const pal = $('palette');
  for (const t of TOOLS) {
    const b = document.createElement('button');
    b.className = 'swatch'; b.dataset.tool = t.id;
    b.innerHTML = '<i style="background:' + t.color + '"></i>' + t.label;
    b.onclick = () => { tool = tool === t.id ? null : t.id; selected = null; syncTools(); buildInspector(); setStatus('Click the map to place a ' + t.label.toLowerCase() + '.'); };
    pal.appendChild(b);
  }
  $('toolSelect').onclick = () => { tool = null; syncTools(); };
  $('undo').onclick = undo; $('redo').onclick = redo;
  $('rotate').onclick = doRotate; $('dup').onclick = doDuplicate; $('del').onclick = doDelete;
  $('viewTop').onclick = () => { pitch = 1.45; yaw = 0; };
  $('viewAngle').onclick = () => { pitch = 1.03; yaw = 0; };
  $('frame').onclick = frame;
  $('helpBtn').onclick = () => $('help').classList.remove('hidden');
  $('helpClose').onclick = () => $('help').classList.add('hidden');
  $('showRails').onchange = () => rebuild();
  $('find').oninput = () => buildList();
  $('mapName').addEventListener('change', () => { pushUndo(); doc.name = $('mapName').value.trim() || 'Untitled'; dirty = true; setStatus('Renamed to ' + doc.name); });
  $('download').onclick = download;
  $('openBtn').onclick = () => $('file').click();
  $('file').onchange = () => {
    const f = $('file').files && $('file').files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { pushUndo(); doc = adopt(JSON.parse(reader.result)); selected = null; tool = null; dirty = false; frame(); rebuild(); setStatus('Opened ' + (doc.name || f.name) + '.'); }
      catch { setStatus('That file is not a Deadsignal map.'); }
    };
    reader.readAsText(f); $('file').value = '';
  };
  $('saved').onchange = async () => {
    const id = $('saved').value; if (!id) return;
    try {
      const r = await fetch('/api/map?id=' + encodeURIComponent(id));
      const j = await r.json();
      if (!r.ok || !j.map) throw new Error(j.error || 'missing');
      pushUndo(); doc = adopt(j.map); doc.id = j.id || id; selected = null; dirty = false; frame(); rebuild();
      setStatus('Opened ' + (doc.name || id) + '.');
    } catch (e) { setStatus(e.message || 'Could not open that map.'); }
  };
  $('save').onclick = () => saveServer(false).catch((e) => setStatus(e.message));
  $('use').onclick = () => saveServer(true).catch((e) => setStatus(e.message));
  $('revert').onclick = async () => {
    if (!confirm('Put the open ocean back for everyone? This map stays saved on the server.')) return;
    try {
      const r = await fetch('/api/maps/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: '' }) });
      if (!r.ok) throw new Error('Could not switch back');
      setStatus('The game loads the open ocean again. This editor still has the map you were editing.');
    } catch (e) { setStatus(e.message); }
  };
  $('play').onclick = playtest;
  $('loadYard').onclick = () => {
    if (dirty && !confirm('Leave this map and open the Relay Yard?')) return;
    pushUndo();
    doc = structuredClone(YARD_MAP);
    selected = null; tool = null; dirty = false;
    frame(); syncTools(); rebuild();
    setStatus('Relay Yard. It is not the mission everyone plays unless you press Use in the game.');
  };
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
}

async function boot() {
  bind();
  try {
    const r = await fetch('/api/map');
    if (r.ok) {
      const j = await r.json();
      if (j && j.map && j.map.pieces) {
        doc = adopt(j.map); doc.id = j.id || doc.id;
        setStatus('Opened the map the game is using.');
      }
    }
  } catch { /* fall through to the built-in yard */ }
  for (const p of doc.pieces) if (p && p.id) seq += 1;
  frame();
  syncTools();
  rebuild();
  refreshSaved();
  tick();
}
boot();
