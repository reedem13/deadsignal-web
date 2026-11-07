// The compiled Relay Yard must match the level that used to be hardcoded.
import fs from 'fs';
import { compileMap } from '../public/mapcompile.js';
import { DEFAULT_MAP } from '../public/leveldata.js';

const snap = JSON.parse(fs.readFileSync(new URL('./yard.snapshot.json', import.meta.url), 'utf8'));
const level = compileMap(DEFAULT_MAP);

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
  COOPS: level.COOPS,
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
  const a = JSON.stringify(snap[k]);
  const b = JSON.stringify(got[k]);
  if (a !== b) {
    bad++;
    console.log('MISMATCH', k, 'snap', snap[k].length ?? '', 'got', got[k].length ?? '');
    // find first difference for arrays
    if (Array.isArray(snap[k])) {
      const n = Math.max(snap[k].length, got[k].length);
      for (let i = 0; i < n; i++) {
        const sa = JSON.stringify(snap[k][i]), sb = JSON.stringify(got[k][i]);
        if (sa !== sb) { console.log('  at', i); console.log('  snap', sa); console.log('  got ', sb); break; }
      }
    } else {
      console.log(' snap', a);
      console.log(' got ', b);
    }
  } else console.log('ok', k);
}
if (bad) { console.error(bad + ' mismatched'); process.exit(1); }
console.log('Relay Yard compiles identical to the hardcoded level');
