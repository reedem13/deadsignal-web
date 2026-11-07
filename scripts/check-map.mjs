// The compiled Relay Yard must match the level that used to be hardcoded.
import fs from 'fs';
import { compileMap } from '../public/mapcompile.js';
import { DEFAULT_MAP } from '../public/leveldata.js';
import { YARD_MAP } from '../public/yarddata.js';

const stable = (v) => Array.isArray(v) ? '[' + v.map(stable).join(',') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
  : JSON.stringify(v);

const snap = JSON.parse(fs.readFileSync(new URL('./yard.snapshot.json', import.meta.url), 'utf8'));
const level = compileMap(YARD_MAP);

function normLink(L) {
  return {
    name: L.name, x: L.x, z: L.z, a: L.a, y0: L.y0, top: L.top, lip: L.lip, wall: L.wall, land: L.land, rail: L.rail || 0,
    dx: L.dx, dz: L.dz, face: L.face, anchor: L.anchor, rope: L.rope, foot: L.foot, landP: L.landP, hang: L.hang,
  };
}
function normGuard(g) {
  return { y: g.y, path: g.path, home: g.home || null, area: g.area || null };
}
const got = {
  MAP: level.MAP,
  WALLS: level.WALLS,
  WALKS: level.WALKS,
  RAILS: level.RAILS,
  DECK_POSTS: level.DECK_POSTS,
  CLIMBS: level.CLIMBS,
  COOPS: level.COOPS.map((c) => { const o = { ...c }; if (!o.y0) delete o.y0; return o; }),
  LINKS: level.LINKS.map(normLink),
  TUNNELS: level.TUNNELS,
  SWITCHES: level.SWITCHES,
  EXTRACT: level.EXTRACT,
  SPAWNS: level.SPAWNS,
  GUARDS: level.GUARDS.map(normGuard),
  WATERS: level.WATERS,
  PICKUPS: level.PICKUPS,
};

let bad = 0;
for (const k of Object.keys(snap)) {
  const a = stable(snap[k]);
  const b = stable(got[k]);
  if (a !== b) {
    bad++;
    console.log('MISMATCH', k, 'snap', snap[k].length ?? '', 'got', got[k].length ?? '');
    // find first difference for arrays
    if (Array.isArray(snap[k])) {
      const n = Math.max(snap[k].length, got[k].length);
      for (let i = 0; i < n; i++) {
        const sa = stable(snap[k][i]), sb = stable(got[k][i]);
        if (sa !== sb) { console.log('  at', i); console.log('  snap', sa); console.log('  got ', sb); break; }
      }
    } else {
      console.log(' snap', a);
      console.log(' got ', b);
    }
  } else console.log('ok', k);
}
if (bad) { console.error(bad + ' yard mismatched'); process.exit(1); }
console.log('Relay Yard still compiles');

const oceanSnap = JSON.parse(fs.readFileSync(new URL('./ocean.snapshot.json', import.meta.url), 'utf8'));
const ocean = compileMap(DEFAULT_MAP);
const oceanGot = {
  MAP: ocean.MAP,
  WALLS: ocean.WALLS,
  WALKS: ocean.WALKS,
  RAILS: ocean.RAILS,
  DECK_POSTS: ocean.DECK_POSTS,
  CLIMBS: ocean.CLIMBS,
  COOPS: ocean.COOPS,
  LINKS: ocean.LINKS.map(normLink),
  TUNNELS: ocean.TUNNELS,
  SWITCHES: ocean.SWITCHES,
  EXTRACT: ocean.EXTRACT,
  SPAWNS: ocean.SPAWNS,
  GUARDS: ocean.GUARDS.map(normGuard),
  DRY: ocean.DRY,
  WATERS: ocean.WATERS,
  PICKUPS: ocean.PICKUPS,
};
let oceanBad = 0;
for (const k of Object.keys(oceanSnap)) {
  const a = stable(oceanSnap[k]);
  const b = stable(oceanGot[k]);
  if (a !== b) {
    oceanBad++;
    console.log('OCEAN MISMATCH', k);
    if (Array.isArray(oceanSnap[k])) {
      const n = Math.max(oceanSnap[k].length, oceanGot[k].length);
      for (let i = 0; i < n; i++) {
        const sa = stable(oceanSnap[k][i]), sb = stable(oceanGot[k][i]);
        if (sa !== sb) { console.log('  at', i); console.log('  snap', sa); console.log('  got ', sb); break; }
      }
    } else { console.log(a); console.log(b); }
  } else console.log('ocean ok', k);
}
if (oceanBad) { console.error(oceanBad + ' ocean mismatched'); process.exit(1); }
console.log('Open ocean compiles identical to the shipped ships');
