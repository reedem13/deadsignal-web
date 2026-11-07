// Turn a map document (leveldata.js / the editor) into the arrays the game already uses.
// The default Relay Yard compiles back to the same boxes, climbs, guards and water as the old hardcoded level.
import { DEFAULT_MAP } from './leveldata.js';

export const RAIL_H = 0.9;
export const TUNNEL_H = 1.25;
export const TUNNEL_WALL = 0.3;
// Must match traverse.js GRAPPLE.hangDrop — the rope's "hands on the lip" height.
export const HANG_DROP = 1.55;

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function bakeLink(L) {
  L.y0 = num(L.y0);
  L.wall = num(L.wall, 0.38);
  L.land = num(L.land, 0.6);
  L.lip = num(L.lip, num(L.top) + 0.06);
  L.dx = Math.cos(L.a || 0);
  L.dz = Math.sin(L.a || 0);
  L.face = { x: L.x + L.dx * L.wall, z: L.z + L.dz * L.wall };
  L.anchor = { x: L.face.x + L.dx * 0.03, y: L.lip, z: L.face.z + L.dz * 0.03 };
  L.rope = { x: L.face.x - L.dx * 0.07, z: L.face.z - L.dz * 0.07 };
  L.foot = { x: L.x, y: L.y0, z: L.z };
  L.landP = { x: L.face.x + L.dx * L.land, y: L.top, z: L.face.z + L.dz * L.land };
  L.hang = Math.max(L.y0 + 0.4, L.lip - HANG_DROP);
  return L;
}

/** @param {object} doc map document { version, name, bounds, pieces } */
export function compileMap(doc) {
  const src = doc && Array.isArray(doc.pieces) ? doc : DEFAULT_MAP;
  const pieces = src.pieces;
  const bounds = src.bounds || DEFAULT_MAP.bounds;
  const MAP = {
    x1: num(bounds.x1, -38), x2: num(bounds.x2, 40),
    z1: num(bounds.z1, -30), z2: num(bounds.z2, 32),
  };

  const WALLS = [];
  for (const p of pieces) if (p && p.type === 'block') {
    WALLS.push({ x1: num(p.x1), x2: num(p.x2), z1: num(p.z1), z2: num(p.z2), h: num(p.h, 1), kind: p.kind || 'crate' });
  }
  const DECK_POSTS = [];
  for (const p of pieces) if (p && p.type === 'post') {
    const x = num(p.x), z = num(p.z), h = num(p.h, 3.2);
    DECK_POSTS.push([x, z, h]);
    WALLS.push({ x1: x - 0.08, x2: x + 0.08, z1: z - 0.08, z2: z + 0.08, h, kind: 'post' });
  }
  const TUNNELS = [];
  for (const p of pieces) if (p && p.type === 'crawl') {
    TUNNELS.push({ name: p.name || 'CRAWL', x1: num(p.x1), x2: num(p.x2), z1: num(p.z1), z2: num(p.z2), axis: p.axis === 'z' ? 'z' : 'x', roof: num(p.roof, 0.2) });
  }
  for (const t of TUNNELS) {
    const W = TUNNEL_WALL, h = TUNNEL_H + 0.2;
    if (t.axis === 'z') {
      WALLS.push({ x1: t.x1 - W, x2: t.x1, z1: t.z1, z2: t.z2, h, kind: 'tunnel' }, { x1: t.x2, x2: t.x2 + W, z1: t.z1, z2: t.z2, h, kind: 'tunnel' });
    } else {
      WALLS.push({ x1: t.x1, x2: t.x2, z1: t.z1 - W, z2: t.z1, h, kind: 'tunnel' }, { x1: t.x1, x2: t.x2, z1: t.z2, z2: t.z2 + W, h, kind: 'tunnel' });
    }
  }

  const WALKS = [];
  for (const p of pieces) if (p && p.type === 'deck') {
    const w = { x1: num(p.x1), x2: num(p.x2), z1: num(p.z1), z2: num(p.z2), h: num(p.h, 3.2), name: p.name || 'DECK' };
    if (p.noDeck) w.noDeck = 1;
    WALKS.push(w);
  }
  const RAILS = [];
  for (const p of pieces) if (p && p.type === 'rail') {
    const y0 = num(p.y0);
    RAILS.push({ x1: num(p.x1), x2: num(p.x2), z1: num(p.z1), z2: num(p.z2), y0, h: y0 + RAIL_H });
  }
  const WATERS = [];
  for (const p of pieces) if (p && p.type === 'water') {
    WATERS.push({ name: p.name || 'WATER', x1: num(p.x1), x2: num(p.x2), z1: num(p.z1), z2: num(p.z2) });
  }
  const CLIMBS = [];
  for (const p of pieces) if (p && p.type === 'climb') {
    const c = { name: p.name || (p.kind === 'net' ? 'CARGO NET' : p.kind === 'pipe' ? 'PIPE' : 'LADDER'), kind: p.kind === 'pipe' || p.kind === 'net' ? p.kind : 'ladder', x: num(p.x), z: num(p.z), a: num(p.a), y0: num(p.y0), top: num(p.top, 3.2), lx: num(p.lx, num(p.x)), lz: num(p.lz, num(p.z)) };
    if (p.span) c.span = num(p.span, 1.6);
    CLIMBS.push(c);
  }
  const COOPS = [];
  for (const p of pieces) if (p && p.type === 'coop') {
    const c = { name: p.name || 'CLIMB WALL', x: num(p.x), z: num(p.z), a: num(p.a), top: num(p.top, 3.2) };
    if (p.y0) c.y0 = num(p.y0); // 0 is filled in by main.js, same as the old COOPS rows
    COOPS.push(c);
  }
  const LINKS = [];
  for (const p of pieces) if (p && p.type === 'grapple') {
    const L = { name: p.name || 'GRAPPLE', x: num(p.x), z: num(p.z), a: num(p.a), y0: num(p.y0), top: num(p.top, 3.2), lip: num(p.lip), wall: num(p.wall, 0.38), land: num(p.land, 0.6) };
    if (p.rail) L.rail = 1;
    bakeLink(L);
    LINKS.push(L);
  }
  const SPAWNS = [];
  for (const p of pieces) if (p && p.type === 'spawn') SPAWNS.push({ x: num(p.x), z: num(p.z) });
  while (SPAWNS.length < 5) {
    const last = SPAWNS[SPAWNS.length - 1] || { x: 0, z: 0 };
    SPAWNS.push({ x: last.x + 1.2, z: last.z });
  }
  if (SPAWNS.length > 5) SPAWNS.length = 5;

  const GUARDS = [];
  for (const p of pieces) if (p && p.type === 'patrol' && Array.isArray(p.path) && p.path.length) {
    const g = { y: num(p.y), path: p.path.map((w) => [num(w[0]), num(w[1])]) };
    if (Array.isArray(p.home) && p.home.length >= 4) g.home = [num(p.home[0]), num(p.home[1]), num(p.home[2]), num(p.home[3])];
    if (Array.isArray(p.area) && p.area.length) g.area = p.area.map((a) => ({ x1: num(a.x1), x2: num(a.x2), z1: num(a.z1), z2: num(a.z2) }));
    GUARDS.push(g);
  }
  const PICKUPS = [];
  for (const p of pieces) if (p && p.type === 'pickup' && p.item) {
    const k = { id: String(p.item), n: num(p.n, 1), x: num(p.x), z: num(p.z), lv: num(p.y) };
    if (p.respawn) k.re = num(p.respawn);
    if (p.ammo) k.ammo = 1;
    if (p.locker) k.locker = 1;
    PICKUPS.push(k);
  }
  const SWITCHES = [];
  for (const p of pieces) if (p && p.type === 'switch') SWITCHES.push({ x: num(p.x), z: num(p.z), y: num(p.y) });
  while (SWITCHES.length < 2) SWITCHES.push({ x: 0, z: 0, y: 0 });
  if (SWITCHES.length > 2) SWITCHES.length = 2;

  const ex = pieces.find((p) => p && p.type === 'extract');
  const EXTRACT = ex ? { x: num(ex.x), z: num(ex.z), y: num(ex.y), r: num(ex.r, 1.8) } : { x: 0, z: 0, y: 0, r: 1.8 };

  const PADS = [];
  for (const p of pieces) if (p && p.type === 'pad') {
    PADS.push({ name: p.name || 'PAD', x1: num(p.x1), x2: num(p.x2), z1: num(p.z1), z2: num(p.z2), y: num(p.y, 0.012), color: num(p.color, 0x243028) });
  }

  return {
    name: src.name || 'Relay Yard',
    id: src.id || 'yard',
    MAP, WALLS, WALKS, RAILS, DECK_POSTS, CLIMBS, COOPS, LINKS, TUNNELS, SWITCHES, EXTRACT, SPAWNS, GUARDS, WATERS, PICKUPS, PADS,
  };
}

function sourceMap() {
  const custom = typeof globalThis !== 'undefined' ? globalThis.__DS_MAP : null;
  if (custom && Array.isArray(custom.pieces) && custom.pieces.length) {
    try { return compileMap(custom); } catch (e) { console.warn('custom map failed, using Relay Yard', e); }
  }
  return compileMap(DEFAULT_MAP);
}

export const LEVEL = sourceMap();
export const MAP_NAME = LEVEL.name;
export const MAP_ID = LEVEL.id;
export const MAP = LEVEL.MAP;
export const WALLS = LEVEL.WALLS;
export const WALKS = LEVEL.WALKS;
export const RAILS = LEVEL.RAILS;
export const DECK_POSTS = LEVEL.DECK_POSTS;
export const CLIMBS = LEVEL.CLIMBS;
export const COOPS = LEVEL.COOPS;
export const LINKS = LEVEL.LINKS;
export const TUNNELS = LEVEL.TUNNELS;
export const SWITCHES = LEVEL.SWITCHES;
export const EXTRACT = LEVEL.EXTRACT;
export const SPAWNS = LEVEL.SPAWNS;
export const GUARDS = LEVEL.GUARDS;
export const WATERS = LEVEL.WATERS;
export const PICKUPS = LEVEL.PICKUPS;
export const PADS = LEVEL.PADS;
