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
// Grapples are TOP-ONLY: from a roof / catwalk top ring you set the claw on the lip and RAPPEL down (then drive the rope:
// hold up = climb back, hold down = descend, release = hang still - traverse.js LINKS / GRAPPLE; ACT on the rope = let go),
// or HAUL a partner standing at the foot ring up the rope. Nothing fires a hook upward from the ground any more.
// Co-op boost / pull-up works on almost every building face, tall crate and catwalk lip (generated COOP_ALL spots).
// Up to 5 players (slot 0 = host, 1..4 = guests). Puzzles (door switches, extract) still only need 2 agents.
// V / the 1ST button toggles a first-person view for the local player (tunnels still force it).
// GEAR (gear.js): MGS1-style equipment menu (GEAR button / I / Tab): 3x4 grid of weapons + items. Weapons: P-9 (+SUPP.),
// FR-5 rifle (bursts), MK-T tranq (sleep), STUN.G (thrown flash, stuns), C4 (plant + DET). Items: RATION (+LIFE), C.BOX
// (hide), SCOPE (zoom), STIM (steady aim). On-site procurement: you spawn with empty hands. Lockers / crates are per
// player; a guard drops one bundle the moment he goes down (kill = loud kit, takedown = quiet kit) and never again.
// Anything that changes guards / LIFE / who is dead (and therefore which bodies have loot) goes through the host.
// Solo moves start right away and the host can veto them ('trx'); co-op boost / pull-up exist only when the host creates
// world.co and broadcasts it - both clients then play their half (booster vs climber) on the host's clock.
// Water: the whole map is open ocean. Swim platforms, holds and the pier are dry (DRY). Surface-swim is slower
// than a walk and quiet. C / CROUCH / PRONE takes a short dive and you come back up. Step onto a hull platform to
// board. Guards stay on the ships. Swim state is on the player packet (0 dry, 1 surface, 2 dive) so every client shows it.
import * as THREE from 'three';
import { ITEMS, GRID, GUN_IDS, drawSlot, pixText, textW, iconCanvas, SLOT_W, SLOT_H } from './gear.js';
import { makeSneaker, makeEnemy } from './sneaker.js';
import { TRAV, L1, L2, L3 as H3, HOLD, BOAT, WALKS, RAILS, DECK_POSTS, CLIMBS, COOPS, LINKS, GRAPPLE, LINE_ENTRY, coopGeom, lineDur, lineAutoPos, lineEncode, lineDecode, strokeAt, kickAt, buildTraversal, occludes } from './traverse.js';

// ---------------------------------------------------------------- level data — open ocean, three ships (see traverse.js)
// Waterline is y = 0. L1 main decks, L2 bridges, L3 crane and funnel. Players spawn in the channel.
// MERIDIAN (north) holds the switches, the red door and the extract pad. CINDER (southwest) has the
// first pistol. ASH HOLD (southeast) is the freighter: hold, deckhouse, crane. A pier and tug sit far south.
const MAP = { x1: -42, x2: 44, z1: -36, z2: 42 };
const COL = {
  hull: 0x6e382e, bridge: 0xc5ccd1, stack: 0x3e3834, hold: 0x241e1c, crane: 0xd1a43a,
  boat: 0x5c564c, tug: 0x2c3338, cabin: 0xd8d2c6, crate: 0x6e5a38, box: 0xb56a32,
};
const B = (cx, cz, w, d, h, kind = 'crate', extra = {}) => ({ x1: cx - w / 2, x2: cx + w / 2, z1: cz - d / 2, z2: cz + d / 2, h, kind, ...extra });
const hull = (cx, cz, w, d, extra = {}) => B(cx, cz, w, d, L1, 'building', { paint: COL.hull, draft: 1.7, noCoop: 1, ...extra });
const WALLS = [
  // MERIDIAN — VLCC, east-west. Stern x -24..-8, bow x 6..24, beam z -26..-10.
  hull(-16, -18, 16, 16),
  hull(15, -18, 18, 16),
  hull(26, -18, 4, 10),
  hull(-1, -24.7, 14, 2.6, { noCoop: 0 }),
  hull(-4.7, -11.3, 6.6, 2.6, { noCoop: 0 }),
  hull(3.7, -11.3, 4.6, 2.6, { noCoop: 0 }),
  B(-4.575, -18, 6.85, 10.8, HOLD, 'building', { paint: COL.hold, noCoop: 1 }),
  B(3.575, -18, 4.85, 10.8, HOLD, 'building', { paint: COL.hold, noCoop: 1 }),
  B(-17, -18, 10, 8, L2, 'building', { paint: COL.bridge, dress: 'bridge', noCoop: 1 }),
  B(-15.4, -16.5, 1.6, 2.2, H3, 'building', { paint: COL.stack, dress: 'stack' }),
  B(-16.5, -18, 0.4, 8.1, 10, 'wall'),
  B(-23.4, -12, 0.5, 4.1, 5.7, 'wall'),
  B(-16.8, -12, 0.5, 4.1, 5.7, 'door'),
  B(-26.15, -23.2, 5.1, 3.4, BOAT, 'building', { paint: COL.boat, draft: 0.85, boot: 0.3, noCoop: 1 }),
  B(16.2, -16.4, 1.3, 1.1, L1 + 1.05, 'crate', { paint: COL.crate }),
  B(11.2, -21.2, 1.2, 1.2, L1 + 1.0, 'crate', { paint: COL.crate }),
  B(-4.1, -17.8, 1.15, 1.05, HOLD + 1.0, 'crate', { paint: COL.crate }),
  // CINDER — product tanker, north-south. x -32..-20, z 2..24.
  hull(-26, 13, 12, 22),
  B(-26, 20, 8, 8, L2, 'building', { paint: COL.bridge, dress: 'bridge' }),
  B(-26, 0.725, 6, 3.25, BOAT, 'building', { paint: COL.boat, draft: 0.85, boot: 0.3, noCoop: 1 }),
  B(-28.4, 11.5, 1.3, 1.15, L1 + 1.05, 'crate', { paint: COL.crate }),
  // ASH HOLD — freighter. Aft x 10..20, fore x 26..36, beam z 8..20.
  hull(15, 14, 10, 12),
  hull(31, 14, 10, 12),
  hull(23, 9.4, 6, 2.8, { noCoop: 0 }),
  hull(23, 18.8, 6, 2.4, { noCoop: 0 }),
  B(23, 14.2, 5.2, 6.8, HOLD, 'building', { paint: COL.hold, noCoop: 1 }),
  B(13, 11.8, 3.6, 3.2, L2, 'building', { paint: COL.bridge, dress: 'bridge' }),
  B(18.5, 17.4, 2.6, 3.6, H3, 'building', { paint: COL.crane, dress: 'crane' }),
  B(8.325, 15.4, 4.05, 4.4, BOAT, 'building', { paint: COL.boat, draft: 0.85, boot: 0.3, noCoop: 1 }),
  B(28.2, 14, 1.8, 1.3, L1 + 1.15, 'crate', { paint: COL.box }),
  B(32.4, 14.4, 2.0, 1.25, L1 + 1.15, 'crate', { paint: COL.box }),
  // Tug alongside the south pier. Flavor, not an objective.
  B(2.6, 31.15, 7.2, 3.1, 1.3, 'building', { paint: COL.tug, draft: 0.75, boot: 0.28, noCoop: 1, dress: 'tug' }),
  B(3.6, 31.15, 2.4, 2.2, 2.35, 'building', { paint: COL.cabin, noCoop: 1 }),
];
for (const [x, z, h] of DECK_POSTS) WALLS.push(B(x, z, 0.16, 0.16, h, 'post'));
// MERIDIAN BILGE: a crawl from a mouth on the south hull into a well under the north gunwale.
const TUNNEL_H = 1.25, TUNNEL_WALL = 0.3;
const TUNNELS = [
  { name: 'MERIDIAN BILGE', x1: -0.85, x2: 0.85, z1: -22.25, z2: -10.15, axis: 'z', roof: 0.22 },
];
for (const t of TUNNELS) {
  const W = TUNNEL_WALL, h = TUNNEL_H + 0.2;
  if (t.axis === 'z') WALLS.push({ x1: t.x1 - W, x2: t.x1, z1: t.z1, z2: t.z2, h, kind: 'tunnel' }, { x1: t.x2, x2: t.x2 + W, z1: t.z1, z2: t.z2, h, kind: 'tunnel' });
  else WALLS.push({ x1: t.x1, x2: t.x2, z1: t.z1 - W, z2: t.z1, h, kind: 'tunnel' }, { x1: t.x1, x2: t.x2, z1: t.z2, z2: t.z2 + W, h, kind: 'tunnel' });
}
function tunnelAt(x, z, inset = 0) {
  for (let i = 0; i < TUNNELS.length; i++) {
    const t = TUNNELS[i], ix = t.axis === 'x' ? inset : 0, iz = t.axis === 'z' ? inset : 0;
    if (x > t.x1 + ix && x < t.x2 - ix && z > t.z1 + iz && z < t.z2 - iz) return i;
  }
  return -1;
}
const GUARD_BLOCKS = TUNNELS.map((t) => ({ x1: t.x1 - (t.axis === 'x' ? 0.3 : 0), x2: t.x2 + (t.axis === 'x' ? 0.3 : 0),
  z1: t.z1 - (t.axis === 'z' ? 0.3 : 0), z2: t.z2 + (t.axis === 'z' ? 0.3 : 0), h: 0, kind: 'block' }));
// Switches are far enough apart, and one floor apart, that one player cannot arm both inside the window.
const SWITCHES = [{ x: 16, z: -18, y: L1 }, { x: -15.2, z: -20.8, y: L2 }];
const EXTRACT = { x: -19.4, z: -18.2, y: L2, r: 1.4 }; // west bridge roof, behind the red door
// Five swim slots in the channel, empty-handed, none of them on a hull.
const SPAWNS = [
  { x: -1.6, z: 1.0 }, { x: 1.1, z: 2.5 }, { x: -3.8, z: 2.6 }, { x: 3.2, z: 0.5 }, { x: -0.2, z: 4.3 },
];
const NP = SPAWNS.length;
// Guards live on decks (y > 0). `area` clamps them so they never walk off into the sea. They do not swim.
const MER_BOW = [{ x1: 6.4, x2: 23.6, z1: -25.6, z2: -10.4 }, { x1: 23.6, x2: 27.6, z1: -22.6, z2: -13.4 }];
const MER_NORTH = [{ x1: -23.5, x2: -8.4, z1: -25.6, z2: -22.35 }];
const MER_HOLD = [{ x1: -7.15, x2: -1.45, z1: -23.0, z2: -13.05 }];
const MER_ROOF = [{ x1: -16.15, x2: -12.35, z1: -21.6, z2: -14.45 }];
const CIN_DECK = [{ x1: -31.5, x2: -20.5, z1: 2.5, z2: 15.5 }];
const CIN_BRIDGE = [{ x1: -29.6, x2: -22.4, z1: 16.5, z2: 23.5 }];
const ASH_AFT = [
  { x1: 10.4, x2: 16.6, z1: 13.7, z2: 19.5 },
  { x1: 10.4, x2: 19.5, z1: 8.3, z2: 9.85 },
  { x1: 15.0, x2: 16.9, z1: 9.5, z2: 15.5 },
  { x1: 15.2, x2: 19.5, z1: 8.3, z2: 15.2 },
];
const ASH_FORE = [{ x1: 26.4, x2: 35.6, z1: 8.4, z2: 19.6 }];
const ASH_CRANE = [{ x1: 17.45, x2: 19.55, z1: 15.95, z2: 18.9 }];
const GUARDS = [
  { y: L1, area: MER_BOW, home: [6, 28, -26, -10], path: [[20, -13.2], [20, -23.2], [9.2, -23.2], [9.2, -13.2]] },
  { y: L1, area: MER_NORTH, home: [-24, -8, -26, -22], path: [[-21, -24.1], [-10.2, -24.1], [-10.2, -23.1], [-21, -23.1]] },
  { y: HOLD, area: MER_HOLD, home: [-8, -1, -23.4, -12.6], path: [[-5.5, -14.8], [-2.6, -14.8], [-2.6, -21.4], [-5.5, -21.4]] },
  { y: L2, area: MER_ROOF, home: [-16.5, -12, -22, -14], path: [[-13.15, -20.5], [-13.15, -15.5]] },
  { y: L1, area: CIN_DECK, home: [-32, -20, 2, 16], path: [[-22.4, 4.2], [-22.4, 14.2], [-29.6, 14.2], [-29.6, 4.2]] },
  { y: L2, area: CIN_BRIDGE, home: [-30, -22, 16, 24], path: [[-24.2, 18.2], [-28.2, 18.2], [-28.2, 22.2], [-24.2, 22.2]] },
  { y: L1, area: ASH_AFT, home: [10, 20, 8, 20], path: [[12.2, 16.6], [12.2, 18.5], [15.5, 18.5], [15.5, 9.1], [18.5, 9.1], [18.5, 14.2], [15.6, 14.2], [15.6, 16.6]] },
  { y: L1, area: ASH_FORE, home: [26, 36, 8, 20], path: [[30.4, 9.3], [30.4, 18.2], [34.6, 18.2], [34.6, 9.3]] },
  { y: H3, area: ASH_CRANE, home: [17, 20, 15.5, 19.5], path: [[18.1, 16.5], [18.7, 18.2], [17.7, 18.2]] },
];
const GUARD_PATHS = GUARDS.map((g) => g.path);
// Dry pads: swim platforms, the bilge, the pier. Anything else inside the map is ocean.
// Pads overlap the hull or boat they serve so there is no wet crack at the joint.
const DRY = [
  { x1: 8.8, x2: 17.4, z1: -10.4, z2: -7.15 },   // MERIDIAN south ladder + 2P
  { x1: 16.1, x2: 21.2, z1: -29.5, z2: -25.6 },  // MERIDIAN north net
  { x1: -32.3, x2: -28.3, z1: -25.2, z2: -21.15 }, // MERIDIAN boat step
  { x1: 27.6, x2: 31.1, z1: -20.4, z2: -15.6 },  // MERIDIAN bow grapple
  { x1: -1.75, x2: 1.75, z1: -23.6, z2: -7.9 },  // bilge well, crawl and mouth
  { x1: -20.4, x2: -16.2, z1: 5.6, z2: 13.6 },   // CINDER east ladder + 2P
  { x1: -35.7, x2: -31.6, z1: 5.5, z2: 11.1 },   // CINDER west net
  { x1: -29.5, x2: -22.5, z1: -4.4, z2: -0.5 },  // CINDER bow step
  { x1: -28.7, x2: -23.3, z1: 23.6, z2: 27.3 },  // CINDER stern grapple
  { x1: 11.5, x2: 20.0, z1: 4.4, z2: 8.4 },      // ASH north ladder + 2P
  { x1: 24.8, x2: 30.0, z1: 19.6, z2: 23.4 },    // ASH south net
  { x1: 3.0, x2: 6.7, z1: 12.7, z2: 18.1 },      // ASH boat step
  { x1: 35.6, x2: 39.4, z1: 11.7, z2: 17.3 },    // ASH east grapple
  { x1: -8.4, x2: 9.4, z1: 32.1, z2: 37.3 },     // pier
];
const OCEAN = { name: 'OPEN OCEAN', x1: MAP.x1, x2: MAP.x2, z1: MAP.z1, z2: MAP.z2 };
function onDry(x, z, inset = 0) {
  return DRY.some((d) => x >= d.x1 + inset && x <= d.x2 - inset && z >= d.z1 + inset && z <= d.z2 - inset);
}
const waterVolume = (x, z, pad = 0) => {
  if (x <= MAP.x1 + 0.5 || x >= MAP.x2 - 0.5 || z <= MAP.z1 + 0.5 || z >= MAP.z2 - 0.5) return null;
  if (onDry(x, z, pad > 0 ? 0.42 : -0.18)) return null;
  return OCEAN;
};
// Split the ocean sheet around dry pads so platforms and the bilge are not under the water plane.
function carveRects(ocean, holes) {
  let rects = [{ x1: ocean.x1, x2: ocean.x2, z1: ocean.z1, z2: ocean.z2 }];
  const keep = (r) => r.x2 - r.x1 > 0.45 && r.z2 - r.z1 > 0.45;
  for (const h of holes) {
    const next = [];
    for (const r of rects) {
      if (h.x2 <= r.x1 + 0.02 || h.x1 >= r.x2 - 0.02 || h.z2 <= r.z1 + 0.02 || h.z1 >= r.z2 - 0.02) { next.push(r); continue; }
      const L = Math.max(r.x1, h.x1), R = Math.min(r.x2, h.x2);
      if (h.x1 > r.x1 + 0.2) next.push({ x1: r.x1, x2: h.x1, z1: r.z1, z2: r.z2 });
      if (h.x2 < r.x2 - 0.2) next.push({ x1: h.x2, x2: r.x2, z1: r.z1, z2: r.z2 });
      if (h.z1 > r.z1 + 0.2) next.push({ x1: L, x2: R, z1: r.z1, z2: h.z1 });
      if (h.z2 < r.z2 - 0.2) next.push({ x1: L, x2: R, z1: h.z2, z2: r.z2 });
    }
    rects = next.filter(keep);
  }
  return rects;
}
const WATERS = carveRects(OCEAN, DRY).map((r) => ({ ...r, name: OCEAN.name, open: 1 }));
const SWITCH_WINDOW = 2.0;
const SPEED = { prone: 1.1, crouch: 1.8, walk: 3.2, run: 5.2, patrol: 1.4, investigate: 2.2, chase: 4.1 };
const PAUSE = { min: 2.2, rand: 1.4, sweep: 0.45, rate: 1.1 };
const LASER = { color: 0xff1a1a, width: 0.035, dot: 0.07 };
const NOISE = { run: 6, walk: 2.2, splash: 2.6 };
const SWIM = { speed: 1.9, dive: 1.25, accel: 7.5, decel: 5.2, turn: 4.6, diveT: 0.82, gap: 0.38 };
const MOVE = { accel: 16, decel: 21, turnAccel: 26, turnRate: 10, proneTurnRate: 4.5 };
const SIGHT = { stand: 9, crouch: 6, prone: 3.5, fovHalf: 0.62 };
const SIGHT_V = { eye: 1.6, downFov: 1.0, downK: 0.5, upFov: 0.85, upFovAlert: 1.05, high: 0.85, rope: 0.95, steep: 0.35, slowUp: 0.45, calmUp: 0.8,
  chest: { stand: 1.2, crouch: 0.75, prone: 0.25 } };
const ALERT_TIME = 15, CAUTION_TIME = 10;
const TD = { range: 1.45, behind: 1.95, time: 2.2, gap: 0.42, lenRange: 2.3, lenBehind: 1.55 };
const GUN = { ammo: 12, cooldown: 0.5, range: 13, cone: 0.35, fpsCone: 0.14, noise: 12, drawTime: 2.0,
  spread0: 0.02, bloom: 0.085, bloomMax: 0.28, bloomDecay: 0.1, bloomRest: 0.35, moveSpread: 0.03, bodyW: 0.34,
  kickShake: 0.14, wobble: 1 };
const HP_MAX = 100;
const FAMAS = { range: 12, minR: 1.4, aim: 0.5, burst: 3, rof: 0.085, cool: 0.85, coolRand: 0.7, dmg: 9, spread: 0.05,
  climbYaw: 0.035, climb: 0.05, moveSpread: 0.06, noise: 14, hitInv: 0, melee: 20, meleeR: 0.95, meleeInv: 1.1, turn: 9 };
const WPN = {
  p9:  { ammo: 'p9', cd: GUN.cooldown, range: GUN.range, spread0: GUN.spread0, bloom: GUN.bloom, bloomMax: GUN.bloomMax, noise: GUN.noise, kick: GUN.kickShake, wob: 1 },
  sd:  { ammo: 'p9', cd: GUN.cooldown, range: GUN.range, spread0: GUN.spread0, bloom: GUN.bloom, bloomMax: GUN.bloomMax, noise: 3, kick: 0.08, wob: 0.8, quiet: true },
  fr5: { ammo: 'fr5', cd: 0.4, burst: 3, rof: 0.09, range: 15, spread0: 0.03, bloom: 0.05, bloomMax: 0.32, noise: 16, kick: 0.12, wob: 0.6, rifle: true },
  mkt: { ammo: 'mkt', cd: 1.1, range: 11, spread0: 0.012, bloom: 0.04, bloomMax: 0.18, noise: 2.5, kick: 0.05, wob: 0.5, quiet: true, tranq: true },
};
const TRANQ = { sleep: 30 };
const STUN = { range: 7, r: 5, fuse: 1.2, ko: 7, flight: 0.6 };
const C4 = { kill: 3.2, pr: 3, pdmg: 50, noise: 18, max: 12 };
const RATION_HP = 40, STIM_T = 30;
// Gear stays off the spawn. The pistol is the first thing you can reach, on CINDER. The better kit is up a crane,
// on a bridge, or down in a hold.
const PICKUPS = [
  { id: 'p9', n: 12, x: -25.4, z: 7.6, lv: L1, locker: 1 },
  { id: 'p9', n: 12, x: -29.4, z: 5.4, lv: L1, re: 40, ammo: 1 },
  { id: 'ration', n: 1, x: -24.4, z: 12.6, lv: L1 },
  { id: 'stun', n: 2, x: -26.1, z: 20.2, lv: L2 },
  { id: 'box', n: 1, x: 23.4, z: 13.6, lv: HOLD, locker: 1 },
  { id: 'stim', n: 1, x: 33.4, z: 11.4, lv: L1 },
  { id: 'mkt', n: 6, x: 13.1, z: 11.7, lv: L2 },
  { id: 'fr5', n: 30, x: 19.15, z: 16.35, lv: H3 },
  { id: 'fr5', n: 30, x: 29.2, z: 16.8, lv: L1, re: 45, ammo: 1 },
  { id: 'c4', n: 2, x: 3.3, z: -19.4, lv: HOLD },
  { id: 'ration', n: 1, x: 12.6, z: -14.6, lv: L1, re: 55 },
  { id: 'supp', n: 1, x: -14.35, z: -19.3, lv: L2 },
  { id: 'scope', n: 1, x: -15.4, z: -16.5, lv: H3 },
  { id: 'stun', n: 1, x: -16.4, z: -24.8, lv: L1 },
  { id: 'ration', n: 1, x: -3.2, z: 34.4, lv: 0, re: 50 },
];
// One bundle per guard, rolled on the host the moment he goes down for good (not on a stun / tranq nap) and synced
// as g.loot. Loud kills favour the FAMAS mag (FR-5). Takedowns still hand you the rifle sometimes, but bias toward
// the quiet kit (suppressor, darts, sidearm, ration, box). Index 0 is "no drop yet".
const LOOT = [
  null,
  { fr5: 24 },
  { fr5: 30, ration: 1 },
  { fr5: 18, stun: 1 },
  { fr5: 20, supp: 1 },
  { fr5: 12, mkt: 4 },
  { fr5: 18, stim: 1 },
  { p9: 10, ration: 1 },
  { fr5: 24, c4: 1 },
  { fr5: 16, box: 1 },
  { stun: 2, ration: 1 },
  { mkt: 5, supp: 1 },
  { fr5: 28, p9: 8 },
  { scope: 1, fr5: 12 },
  { fr5: 22, stun: 2 },
];
const LOOT_LOUD = [1, 1, 2, 3, 12, 14, 8, 6];
const LOOT_QUIET = [4, 5, 7, 9, 10, 11, 3, 2, 13];
const LOOT_ICON = LOOT.map((b) => (b ? ['fr5', 'p9', 'mkt', 'stun', 'c4', 'supp', 'ration', 'stim', 'box', 'scope'].find((id) => b[id]) : null));

// ---------------------------------------------------------------- params / state
const qs = new URLSearchParams(location.search);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (!isTouch) document.body.classList.add('desktop');
const $ = (id) => document.getElementById(id);

let role = null;          // 'host' | 'guest'
let mySlot = 0;           // 0 = host, 1..4 = guests (server assigns)
let fpsOn = false;        // first-person toggle (button / V) - tunnels force first person regardless
let solo = false;
let roomCode = '';
let peerConnected = false;
// c = low (crouched OR prone; this is what older clients read as "crouch"), p = prone, tun = tunnel index or -1
// combat: td = active takedown { g, t } or null, eq = pistol drawn (in hand) vs holstered, ammo, cd = fire cooldown,
// gunT = seconds the aim pose is held after a shot, shot = shot counter (recoil)
// climbing: y = feet height, vy = fall speed, tr = active traversal move (see updateTrav), thud = hard-landing noise timer
const me = { x: SPAWNS[0].x, z: SPAWNS[0].z, a: -Math.PI / 2, c: false, p: false, run: false, moving: false, tun: -1, vx: 0, vz: 0,
  td: null, eq: false, ammo: GUN.ammo, cd: 0, gunT: 0, shot: 0, y: 0, vy: 0, tr: null, thud: 0, fallFrom: 0, grabT: 0, bloom: 0, wob: 0, wobA: 0,
  // gear: inv[id] = count (-1 = not carried; toggles 1), wpn = weapon in the weapon slot (null = bare hands),
  // itm = item in the item slot (null = empty). sd / box / scope = suppressor fitted / hiding in the box / binoculars up,
  // stimT = steady-hands timer, burst = FR-5 rounds left. A mission starts with every count at -1.
  inv: Object.fromEntries(Object.keys(ITEMS).map((k) => [k, -1])), wpn: null, itm: null, sd: false, box: false, scope: false, stimT: 0, burst: 0, burstT: 0,
  sw: false, dive: 0, diveCd: 0, splash: 0 };
// remote traversal: y, tk = move code ('' none), ti = spot / link index, tp = progress 0..1; ry = smoothed on-screen y
// one remote record per slot (others[mySlot] is unused - that's `me`). on = connected (server roster).
const others = SPAWNS.map((sp, s) => ({ s, on: false, x: sp.x, z: sp.z, a: -Math.PI / 2, c: false, p: false, tun: -1, noise: 0, inv: 0, rx: sp.x, rz: sp.z, ra: 0, nvx: 0, nvz: 0, pt: 0,
  td: -1, gd: 0, eq: 0, shot: 0, y: 0, ry: 0, box: 0, w: '', bxK: 0, tk: '', ti: -1, tp: 0, spd: 0, px: sp.x, pz: sp.z, sw: 0 }));
const peers = () => others.filter((o) => o.on && o.s !== mySlot);
const pOf = (s) => (s === mySlot ? me : others[s]);
function resetLoadout() { me.td = null; me.eq = false; me.ammo = 0; me.cd = 0; me.gunT = 0; me.bloom = 0; me.wob = 0;
  for (const o of others) { o.td = -1; o.gd = 0; o.eq = 0; o.tk = ''; o.y = o.ry = 0; o.w = ''; o.sw = 0; }
  me.tr = null; me.y = 0; me.vy = 0; me.thud = 0; me.sw = false; me.dive = 0; me.diveCd = 0; me.splash = 0; resetInv(); syncGunButton(); }
function resetInv() {
  for (const id of Object.keys(ITEMS)) me.inv[id] = -1;
  me.wpn = null; me.itm = null; me.sd = me.box = me.scope = false; me.stimT = 0; me.burst = 0;
  if (typeof resetPickups === 'function') resetPickups();
  if (typeof resetDrops === 'function') resetDrops();
  if (typeof closeInv === 'function') closeInv(true);
}
const stopMe = () => { me.vx = me.vz = 0; me.moving = false; };
let world = freshWorld();
let lastAlert = 0, lastPhase = 'play', lastHp = HP_MAX, shake = 0, hurtT = 0;

function freshWorld() {
  return {
    // st: patrol | investigate | chase | search | held (being taken down, tdT = seconds into it) | dead
    guards: GUARDS.map(({ path: p, y, area, home }) => ({ x: p[0][0], z: p[0][1], y, area, home, a: 0, path: p, wp: 1, st: 'patrol', meter: 0, tx: 0, tz: 0, wait: 0, give: 0, pause: 0, look0: 0, pauseT: 0,
      rx: p[0][0], rz: p[0][1], ra: 0, tdT: 0, by: -1, fcd: 0, aimT: 0, bl: 0, bk: 0, ftT: 0, shooting: false, stun: 0, ko: 0, loot: 0 })), // stun = seconds out, ko: 1 stunned (grenade) / 2 asleep (tranq); loot = bundle code once down
    alert: 0, alertT: 0, cautionT: 0, sw: [0, 0], swBy: [-1, -1], door: false, phase: 'play', t: 0, caught: 0, alerts: 0,
    ext: Array(NP).fill(false), inv: Array(NP).fill(0), finalT: 0, dead: -1, kills: 0, // dead: slot of the player who died (-1 = nobody)
    hp: Array(NP).fill(HP_MAX), hitInv: Array(NP).fill(0), dmg: Array(NP).fill(0), kb: '', // per slot: LIFE (host-authoritative), post-hit i-frames, damage taken
    nades: [], c4: [], c4Id: 0, // host: live stun grenades { x, y, z, t, by }; planted C4 { id, x, y, z, by } (synced)
    co: null, coId: (Math.random() * 1e6) | 0, // co-op climb in progress (host-created): { id, k: boost|pull|rope, i, c: climber slot, h: helper slot, t, dur }
  };
}

// ---------------------------------------------------------------- math / collision helpers
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const solids = () => WALLS.filter((w) => !(w.kind === 'door' && world.door));

function collide(p, r, guard = false) {
  if (guard && p.y > 0.3) return collideHigh(p, r);
  // The ocean is not a collision box (one map-sized rect would shove every guard). Deck guards are
  // clamped to their area. Water stays a route for players; the bilge blocks guards via GUARD_BLOCKS.
  collideBoxes(p, r, guard ? solids().concat(GUARD_BLOCKS) : solids());
}
// elevated guards: only what sticks up above their deck blocks them (walls, door, tall buildings, rails), then they are
// clamped onto the nearest of their deck rects so they never walk off a catwalk.
function collideHigh(g, r) {
  const y = g.y, boxes = solids().filter((b) => b.kind === 'wall' || b.kind === 'door' || b.h > y + 0.05);
  for (const b of RAILS) if (Math.abs(b.y0 - y) < 0.3) boxes.push(b);
  collideBoxes(g, r, boxes);
  if (g.area) clampArea(g, g.area, 0.18);
}
function clampArea(p, area, m) {
  let best = null, bd = Infinity;
  for (const a of area) {
    const x = clamp(p.x, a.x1 + m, a.x2 - m), z = clamp(p.z, a.z1 + m, a.z2 - m), d = (x - p.x) ** 2 + (z - p.z) ** 2;
    if (d < bd) { bd = d; best = [x, z]; }
  }
  if (best) { p.x = best[0]; p.z = best[1]; }
}
const onArea = (area, x, z) => !area || area.some((a) => x >= a.x1 && x <= a.x2 && z >= a.z1 && z <= a.z2);
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
// ty = target's floor: the roof a target stands ON doesn't hide him (shooting up at a guard on a tower)
function clearShot(ax, az, bx, bz, y = 0, ty = 0) {
  for (const b of bulletBlockers(y)) {
    if (ty >= b.h - 0.1 && bx >= b.x1 && bx <= b.x2 && bz >= b.z1 && bz <= b.z2) continue;
    const t = segT(ax, az, bx, bz, b); if (t !== null && t > 0.02) return false;
  }
  return true;
}
function rayEnd(x, z, a, len) {
  const bx = x + Math.cos(a) * len, bz = z + Math.sin(a) * len; let tm = 1;
  for (const b of bulletBlockers()) { const t = segT(x, z, bx, bz, b); if (t !== null && t > 0.01 && t < tm) tm = t; }
  return { x: x + (bx - x) * tm, z: z + (bz - z) * tm };
}
const alive = (g) => g.st !== 'dead' && g.st !== 'held';
// low crates (h < 1.3) only hide a crouching target
const gEye = (g) => (g.y || 0) + SIGHT_V.eye;
function lineOfSight(g, p) {
  if (Math.abs((p.y || 0) - (g.y || 0)) > 0.3) return lineOfSight3(g, p);
  if ((g.y || 0) > 0.3) return lineOfSight3(g, p); // same deck up high: 3D, so lower roofs / ground stuff don't block
  for (const b of solids()) { if (b.h < 1.3 && !p.c) continue; if (b.h <= (p.y || 0) + 0.3) continue; if (segHitsBox(g.x, g.z, p.x, p.z, b)) return false; }
  return true;
}
// 3D segment (a -> b) vs axis-aligned box b {x1..x2, y0..h, z1..z2}: hit strictly before the end (so the roof you stand on doesn't count)
function seg3HitsBox(ax, ay, az, bx, by, bz, B, y0 = 0) {
  let t0 = 0, t1 = 0.97;
  for (const [p, d, lo, hi] of [[ax, bx - ax, B.x1, B.x2], [ay, by - ay, y0, B.h], [az, bz - az, B.z1, B.z2]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; }
    else { let ta = (lo - p) / d, tb = (hi - p) / d; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return false; }
  }
  return true;
}
// eye (1.6 m) -> target's chest. Buildings / walls / crates / posts block in full 3D; walk decks (gantry, barracks roof slab) are thin slabs.
function lineOfSight3(g, p) {
  const ty = targetY(p), ey = gEye(g);
  for (const b of solids()) if (seg3HitsBox(g.x, ey, g.z, p.x, ty, p.z, b)) return false;
  for (const w of WALKS) if (seg3HitsBox(g.x, ey, g.z, p.x, ty, p.z, w, w.h - 0.2)) return false;
  return true;
}
const targetY = (p) => (p.y || 0) + (p.p ? SIGHT_V.chest.prone : p.c ? SIGHT_V.chest.crouch : SIGHT_V.chest.stand);
/**
 * can guard g see player p right now (cone + range + occlusion)? -> { d (effective distance), range, up (0..1 how hard he
 * looks up) } or null. Ground targets: the original flat cone. Elevated targets: horizontal cone + vertical cone + 3D range.
 */
function guardSees(g, p) {
  const dx = p.x - g.x, dz = p.z - g.z, d = Math.hypot(dx, dz), alert = world.alert > 0;
  let range = (p.p ? SIGHT.prone : p.c ? SIGHT.crouch : SIGHT.stand) + (alert ? 2 : 0);
  const inCone = Math.abs(angDiff(Math.atan2(dz, dx), g.a)) < SIGHT.fovHalf;
  if (Math.abs((p.y || 0) - (g.y || 0)) <= 0.3) { // same floor (ground or the same deck): the original flat cone
    if (d > range || !(inCone || d < 1.1) || !lineOfSight(g, p)) return null;
    return { d, range, up: 0 };
  }
  const dh = targetY(p) - gEye(g), elev = Math.atan2(dh, Math.max(d, 1e-3)), vmax = world.alert === 2 ? SIGHT_V.upFovAlert : SIGHT_V.upFov;
  if (elev > vmax || elev < -SIGHT_V.downFov) return null;        // straight over / under him: outside his vertical cone
  const up = clamp(elev / vmax, 0, 1), d3 = Math.hypot(d, dh < 0 ? dh * SIGHT_V.downK : dh); // looking down off a deck: height costs less range
  range *= (p.rope ? SIGHT_V.rope : SIGHT_V.high) * (1 - SIGHT_V.steep * up);
  if (d3 > range || !(inCone || d3 < 1.3) || !lineOfSight3(g, p)) return null;
  return { d: d3, range, up };
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
scene.background = new THREE.Color(0x07141c);
scene.fog = new THREE.Fog(0x07141c, 32, 88);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 180);
scene.add(new THREE.HemisphereLight(0x9fc3d9, 0x0c1e28, 1.05));
const sun = new THREE.DirectionalLight(0xbfd8ff, 0.9); sun.position.set(-8, 20, 6); scene.add(sun);

const mat = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...extra });
// Ground slabs with the swim basins cut out, so a sunk swimmer isn't hidden under the yard plane.
function xzSlab(x1, z1, x2, z2, holes) {
  const s = new THREE.Shape();
  s.moveTo(x1, -z1); s.lineTo(x2, -z1); s.lineTo(x2, -z2); s.lineTo(x1, -z2); s.closePath();
  for (const h of holes) {
    if (h.x2 <= x1 || h.x1 >= x2 || h.z2 <= z1 || h.z1 >= z2) continue;
    const a = Math.max(h.x1, x1), b = Math.min(h.x2, x2), c = Math.max(h.z1, z1), d = Math.min(h.z2, z2);
    const p = new THREE.Path();
    p.moveTo(a, -c); p.lineTo(b, -c); p.lineTo(b, -d); p.lineTo(a, -d); p.closePath();
    s.holes.push(p);
  }
  const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); return g;
}
// ---- open ocean: basin tiles plus a PS1 sheet. Dry pads are cut out so platforms sit on the waterline.
const BASIN = -1.88, SURFACE = 0.055;
const waterTex = pixTex(32, (x, S) => {
  x.fillStyle = '#1a7898'; x.fillRect(0, 0, S, S);
  x.strokeStyle = '#d6f4ff'; x.lineWidth = 1; x.globalAlpha = 0.9;
  for (let row = 0; row < 4; row++) {
    const y0 = 3 + row * 8; x.beginPath(); x.moveTo(0, y0);
    for (let i = 0; i <= 8; i++) x.lineTo(i * 4, y0 + (i % 2 ? -2 : 2));
    x.stroke();
  }
  x.globalAlpha = 0.45; x.fillStyle = '#e9fbff';
  x.fillRect(2, 6, 3, 1); x.fillRect(18, 14, 5, 1); x.fillRect(9, 22, 3, 1); x.fillRect(24, 5, 2, 1);
}, [1, 1]);
const waterMat = new THREE.MeshLambertMaterial({ map: waterTex, color: 0xb7e6f6, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide });
const basinMat = mat(0x071c28), wetWall = mat(0x1a4550), lipMat = mat(0x7d8c86);
const waterSheets = [];
const spanOverlap = (a1, a2, b1, b2) => Math.min(a2, b2) - Math.max(a1, b1);
function cutSpans(lo, hi, cuts) {
  let segs = [[lo, hi]];
  for (const [a, b] of cuts) {
    const next = [];
    for (const [s, e] of segs) {
      if (b <= s + 0.05 || a >= e - 0.05) { next.push([s, e]); continue; }
      if (a > s + 0.08) next.push([s, a]);
      if (b < e - 0.08) next.push([b, e]);
    }
    segs = next.filter(([s, e]) => e - s > 0.4);
  }
  return segs;
}
function shoreCuts(w, axis, at) {
  const cuts = [];
  for (const o of WATERS) if (o !== w) {
    const touch = axis === 'z' ? (Math.abs(o.z1 - at) < 0.35 || Math.abs(o.z2 - at) < 0.35) : (Math.abs(o.x1 - at) < 0.35 || Math.abs(o.x2 - at) < 0.35);
    if (!touch) continue;
    const a = axis === 'z' ? spanOverlap(w.x1, w.x2, o.x1, o.x2) : spanOverlap(w.z1, w.z2, o.z1, o.z2);
    if (a < 0.25) continue;
    cuts.push(axis === 'z' ? [Math.max(w.x1, o.x1), Math.min(w.x2, o.x2)] : [Math.max(w.z1, o.z1), Math.min(w.z2, o.z2)]);
  }
  return cuts;
}
function addShore(x1, x2, z1, z2) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.08, x2 - x1), -BASIN, Math.max(0.08, z2 - z1)), wetWall);
  wall.position.set((x1 + x2) / 2, BASIN / 2, (z1 + z2) / 2); scene.add(wall);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.08, x2 - x1), 0.07, Math.max(0.08, z2 - z1)), lipMat);
  lip.position.set((x1 + x2) / 2, 0.04, (z1 + z2) / 2); scene.add(lip);
}
for (const w of WATERS) {
  const lx = w.x2 - w.x1, lz = w.z2 - w.z1, cx = (w.x1 + w.x2) / 2, cz = (w.z1 + w.z2) / 2;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(lx, lz), basinMat);
  floor.rotation.x = -Math.PI / 2; floor.position.set(cx, BASIN + 0.02, cz); scene.add(floor);
  const geo = new THREE.PlaneGeometry(lx, lz), uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * lx * 0.42, uv.getY(i) * lz * 0.42);
  const sheet = new THREE.Mesh(geo, waterMat); sheet.rotation.x = -Math.PI / 2; sheet.position.set(cx, SURFACE, cz); scene.add(sheet); waterSheets.push(sheet);
  if (w.open) continue; // open sea has no pool rim; hulls and pads are the shoreline
  const T = 0.2;
  for (const [a, b] of cutSpans(w.x1, w.x2, shoreCuts(w, 'z', w.z1))) addShore(a, b, w.z1 - T * 0.5, w.z1 + T * 0.5);
  for (const [a, b] of cutSpans(w.x1, w.x2, shoreCuts(w, 'z', w.z2))) addShore(a, b, w.z2 - T * 0.5, w.z2 + T * 0.5);
  for (const [a, b] of cutSpans(w.z1, w.z2, shoreCuts(w, 'x', w.x1))) addShore(w.x1 - T * 0.5, w.x1 + T * 0.5, a, b);
  for (const [a, b] of cutSpans(w.z1, w.z2, shoreCuts(w, 'x', w.x2))) addShore(w.x2 - T * 0.5, w.x2 + T * 0.5, a, b);
}
const padMat = mat(0x4c585c);
for (const d of DRY) {
  const slab = new THREE.Mesh(new THREE.BoxGeometry(d.x2 - d.x1, 0.1, d.z2 - d.z1), padMat);
  slab.position.set((d.x1 + d.x2) / 2, 0.03, (d.z1 + d.z2) / 2); scene.add(slab);
}
function updateWater() {
  const t = performance.now() / 1000;
  waterTex.offset.x = t * 0.04; waterTex.offset.y = Math.sin(t * 0.65) * 0.025;
  const bob = Math.sin(t * 1.35) * 0.012;
  for (const m of waterSheets) m.position.y = SURFACE + bob;
}
// Rig drop under the shoreline. Surface leaves the head and the stroke above the sheet; a dive puts the head under it.
function waterSink(mesh, code, moving, dt) {
  // Waist-deep on the surface so the stroke reads from the top-down cam; a dive ducks the head to the sheet.
  const target = code > 1 ? 1.28 : code === 1 ? 0.58 : 0;
  mesh.sink = (mesh.sink || 0) + (target - (mesh.sink || 0)) * Math.min(1, Math.max(0, dt) * (target < (mesh.sink || 0) ? 8 : 3.2));
  if (mesh.sink < 0.02) return 0;
  const t = performance.now() / 1000;
  const bob = (code === 1 ? Math.sin(t * (moving ? 6.2 : 2.3)) * (moving ? 0.045 : 0.028) : Math.sin(t * 2.6) * 0.018) * Math.min(1, mesh.sink);
  return mesh.sink - bob;
}
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
// CUTAWAY: tall buildings fade to a ghost while they hide a player from the top-down camera (see updateCutaway)
const cutaway = [];
for (const w of WALLS) {
  const color = w.paint ?? COLORS[w.kind] ?? 0x777777;
  const m = new THREE.Mesh(new THREE.BoxGeometry(w.x2 - w.x1, w.h, w.z2 - w.z1), w.kind === 'tunnel' ? concreteMat(0x9aa4a8, Math.max(w.x2 - w.x1, w.z2 - w.z1) / 1.6, 1) : mat(color));
  m.position.set((w.x1 + w.x2) / 2, w.h / 2, (w.z1 + w.z2) / 2); scene.add(m);
  if (w.kind === 'door') doorMesh = m;
  if (w.kind === 'building' && w.h > 2) cutaway.push({ b: w, m, k: 1 });
  if (w.draft) {
    const cx = (w.x1 + w.x2) / 2, cz = (w.z1 + w.z2) / 2, lw = w.x2 - w.x1, ld = w.z2 - w.z1;
    const under = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.2, lw - 0.18), w.draft, Math.max(0.2, ld - 0.18)), mat(0x140e0c));
    under.position.set(cx, -w.draft / 2 + 0.02, cz); scene.add(under);
    if (w.boot !== 0) {
      const bh = w.boot || 0.55;
      const boot = new THREE.Mesh(new THREE.BoxGeometry(lw + 0.12, bh, ld + 0.12), mat(0x141618));
      boot.position.set(cx, 0.06 + bh / 2, cz); scene.add(boot);
    }
  }
}
// Bridge windows, funnel band, buoys, lifeboats. Visual only.
{
  const win = mat(0x1c3040), band = mat(0xc4483a), life = mat(0xe07a28), buoyR = mat(0xd0453a), buoyW = mat(0xe8e4dc);
  for (const w of WALLS) {
    if (w.dress === 'bridge') {
      const y = Math.max(w.h - 1.15, L1 + 0.9);
      for (const side of [-1, 1]) {
        const z = side < 0 ? w.z1 - 0.05 : w.z2 + 0.05;
        const n = Math.max(2, Math.round((w.x2 - w.x1) / 2.2));
        for (let i = 0; i < n; i++) {
          const x = w.x1 + (w.x2 - w.x1) * ((i + 0.5) / n);
          const pane = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.38, 0.08), win);
          pane.position.set(x, y, z); scene.add(pane);
        }
      }
    }
    if (w.dress === 'stack') {
      const bandM = new THREE.Mesh(new THREE.BoxGeometry(w.x2 - w.x1 + 0.1, 0.42, w.z2 - w.z1 + 0.1), band);
      bandM.position.set((w.x1 + w.x2) / 2, w.h - 1.15, (w.z1 + w.z2) / 2); scene.add(bandM);
    }
  }
  for (const [x, z] of [[-26.8, -23.2], [-27.2, 1.1], [7.4, 15.2]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.42, 0.62), life);
    b.position.set(x, BOAT + 0.28, z); scene.add(b);
  }
  for (const [x, z] of [[-10.5, -3.2], [8.2, 4.6], [-14, 18], [6.5, -5.5], [22, 3.2]]) {
    const g = new THREE.Group();
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.46, 6), buoyR); a.position.y = 0.32;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.26, 6), buoyW); b.position.y = 0.66;
    g.add(a, b); g.position.set(x, 0, z); scene.add(g);
  }
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
  if (t.roof > 1) cutaway.push({ b: { x1: t.x1, x2: t.x2, z1: t.z1, z2: t.z2, h: TUNNEL_H + t.roof }, m: roof, k: 1, tun: 1 });
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
  g.position.set(s.x, s.y || 0, s.z); scene.add(g);
  return { pad, light };
});
const extractMesh = new THREE.Mesh(new THREE.RingGeometry(EXTRACT.r - 0.3, EXTRACT.r, 24), new THREE.MeshBasicMaterial({ color: 0x40ff80, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
extractMesh.rotation.x = -Math.PI / 2; extractMesh.position.set(EXTRACT.x, EXTRACT.y + 0.05, EXTRACT.z); scene.add(extractMesh);

function marker(color) { // little floating triangle so you can find each other
  const m = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.4, 3), new THREE.MeshBasicMaterial({ color }));
  m.rotation.x = Math.PI; return m;
}
// Players (see sneaker.js kits): P1 = host = NIGHT OPS (charcoal suit, olive webbing + gaiter, dark spiky hair, olive accents),
// P2 = ASH FOX (slate blue-grey suit, vivid blue straps, ash-blonde swept undercut, blue accents).
// P3-P5 reuse the three rig kits with their own accent / suit tint + a cheap hat (2-4 boxes / cylinders on the head pivot)
// so five sneakers read apart from the top-down camera: P3 DUST VIPER (olive kit, wide boonie hat, orange),
// P4 RED HERON (Night Ops kit tinted red-brown, crimson beret over the NVG, red), P5 SAND OWL (Ash Fox kit in sand,
// black ball cap + whip antenna, yellow).
// Guards use the enemy kit of the same rig (sneaker.js makeEnemy): slate fatigues, helmet, balaclava, goggles, respirator.
const PLAYER_LOOK = [
  { kit: 'night', accent: 0x9fd060, tint: 0xffffff, name: 'NIGHT OPS', hat: null },
  { kit: 'ash', accent: 0x2f8cff, tint: 0xffffff, name: 'ASH FOX', hat: null },
  { kit: 'player', accent: 0xff8a20, tint: 0xffffff, name: 'DUST VIPER', hat: 'boonie' },
  { kit: 'night', accent: 0xff3a4a, tint: 0xc89a92, name: 'RED HERON', hat: 'beret' },
  { kit: 'ash', accent: 0xffe040, tint: 0xe0cfa0, name: 'SAND OWL', hat: 'cap' },
];
const hexCss = (c) => '#' + c.toString(16).padStart(6, '0');
// my rig + 4 remote rigs. Slot s -> rig: mine, or remoteMeshes[s < mySlot ? s : s - 1] (rk).
const meMesh = makeSneaker(scene, PLAYER_LOOK[0]);
const remoteMeshes = [1, 2, 3, 4].map((i) => makeSneaker(scene, PLAYER_LOOK[i]));
const rk = (s) => (s < mySlot ? s : s - 1);
const meshOf = (s) => (s === mySlot ? meMesh : remoteMeshes[rk(s)]);
const otherMesh = remoteMeshes[0]; // (debug hook name)
const markers = [meMesh, ...remoteMeshes].map((ch) => { const m = marker(0xffffff); m.position.y = 2.1; ch.g.add(m); ch.marker = m; return m; });
// head-pivot local: +x = forward (face), +y = up, crown of the head ~0.34
function makeHat(kind, accent) {
  const g = new THREE.Group(), L = (c) => mat(c), add = (geo, m, x, y, z, rx = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, 0, rz); g.add(o); return o; };
  if (kind === 'boonie') { // wide floppy brim = big disc from above
    const cloth = L(0x7a6a40);
    add(new THREE.CylinderGeometry(0.14, 0.16, 0.1, 8), cloth, 0, 0.375, 0);
    add(new THREE.CylinderGeometry(0.29, 0.27, 0.02, 10), cloth, 0, 0.335, 0, 0, -0.06);
    add(new THREE.CylinderGeometry(0.163, 0.163, 0.03, 8), L(accent), 0, 0.345, 0);
  } else if (kind === 'beret') { // crimson beret slouched to the left, badge over the right eye
    add(new THREE.CylinderGeometry(0.19, 0.15, 0.06, 10), L(0x8a1420), -0.01, 0.385, -0.03, -0.22, 0.12);
    add(new THREE.BoxGeometry(0.03, 0.04, 0.03), L(accent), 0.13, 0.37, 0.05);
  } else if (kind === 'cap') { // black ball cap (long forward bill) + whip antenna off the back
    add(new THREE.CylinderGeometry(0.14, 0.155, 0.08, 8), L(0x1e1f22), 0, 0.37, 0);
    add(new THREE.BoxGeometry(0.17, 0.016, 0.2), L(accent), 0.16, 0.34, 0);
    add(new THREE.BoxGeometry(0.012, 0.42, 0.012), L(0x2a2a2a), -0.11, 0.58, -0.06);
    add(new THREE.BoxGeometry(0.03, 0.03, 0.03), L(accent), -0.11, 0.8, -0.06);
  }
  g.traverse((o) => { o.frustumCulled = false; });
  return g;
}
const hats = PLAYER_LOOK.map((L) => (L.hat ? makeHat(L.hat, L.accent) : null));
function applyPlayerLooks() { // every rig wears its slot's look (host = P1 Night Ops, P2 Ash Fox, P3-P5 variants)
  for (let s = 0; s < NP; s++) {
    const ch = meshOf(s), L = PLAYER_LOOK[s];
    ch.setKit(L.kit);
    ch.materials.accent.color.setHex(L.accent);
    ch.materials.patch.color.setHex(L.accent).multiplyScalar(0.55);
    ch.materials.suit.color.setHex(L.tint);
    ch.marker.material.color.setHex(L.accent);
    if (ch.hat && ch.hat !== hats[s]) ch.head.remove(ch.hat);
    ch.hat = hats[s]; if (ch.hat) ch.head.add(ch.hat);
  }
}

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
const tracers = Array.from({ length: 32 }, () => { // room for several guards' FAMAS bursts at once on the bigger yard
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0 }));
  const puff = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), new THREE.MeshBasicMaterial({ color: 0xd8d0b0, transparent: true, opacity: 0 }));
  line.frustumCulled = false; scene.add(line, puff); return { line, puff, t: 0 };
});
let tracerI = 0;
const _mz = new THREE.Vector3();
// ey = impact height (default: chest on a hit, muzzle height on a miss); rifle = guard FAMAS round (hotter orange tracer)
function gunFx(mesh, ex, ez, hit, ey = null, rifle = false, col = null) {
  const tr = tracers[tracerI++ % tracers.length];
  mesh.muzzleWorld(_mz);
  const y = ey ?? (hit ? 1.15 : _mz.y);
  const a = tr.line.geometry.attributes.position; a.setXYZ(0, _mz.x, _mz.y, _mz.z); a.setXYZ(1, ex, y, ez); a.needsUpdate = true;
  tr.line.material.color.setHex(col ?? (rifle ? 0xffb040 : 0xfff0a0));
  tr.puff.position.set(ex, y, ez); tr.puff.material.color.setHex(hit ? 0x8a1010 : 0xd8d0b0); tr.t = 0.16;
}
function updateFx(dt) {
  for (const tr of tracers) {
    tr.t = Math.max(0, tr.t - dt); const k = tr.t / 0.16;
    tr.line.material.opacity = k; tr.puff.material.opacity = k; tr.puff.scale.setScalar(1 + (1 - k) * 2); tr.line.visible = tr.puff.visible = k > 0;
  }
}

// BLOOD (PS1-style): one InstancedMesh of chunky red octahedron droplets (single draw call) sprayed out of the hit
// side, falling under gravity and flattening into dots when they land, plus a small pool of pixel-splat floor decals
// (32px CanvasTexture, NearestFilter) that fade after a few seconds. Fixed pools, nothing allocated per hit.
const BLOOD = { drops: 72, splats: 14, life: 0.75, splatLife: 4.5, grav: 9 };
const bloodDrops = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.045, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), BLOOD.drops);
bloodDrops.instanceMatrix.setUsage(THREE.DynamicDrawUsage); bloodDrops.frustumCulled = false; bloodDrops.count = 0; scene.add(bloodDrops);
const dropState = Array.from({ length: BLOOD.drops }, () => ({ t: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fy: 0, s: 1, land: false }));
{ const c = new THREE.Color(); for (let i = 0; i < BLOOD.drops; i++) bloodDrops.setColorAt(i, c.setHex([0x9a0e0e, 0x7a0808, 0xb81a14, 0x5e0606][i % 4])); }
let dropI = 0;
const splatTex = (() => { // irregular pixel splat: dark core blob + a few satellite drips
  const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d');
  const r = (n) => Math.floor(Math.random() * n);
  for (const [cx, cy, rad, col] of [[16, 16, 7, '#6a0707'], [12, 18, 5, '#7e0a0a'], [20, 13, 5, '#7e0a0a'], [16, 16, 4, '#9a1010'], [24, 22, 2, '#6a0707'], [7, 10, 2, '#6a0707'], [26, 9, 1.5, '#7e0a0a'], [9, 25, 1.5, '#7e0a0a']]) {
    x.fillStyle = col; for (let yy = -rad; yy <= rad; yy++) for (let xx = -rad; xx <= rad; xx++) if (xx * xx + yy * yy <= rad * rad + r(3)) x.fillRect(cx + xx, cy + yy, 1, 1);
  }
  const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; return t;
})();
const splats = Array.from({ length: BLOOD.splats }, () => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: splatTex, transparent: true, opacity: 0, depthWrite: false, alphaTest: 0.05 }));
  m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 1; scene.add(m); return { m, t: 0 };
});
let splatI = 0;
const _bm = new THREE.Matrix4(), _bq = new THREE.Quaternion(), _bs = new THREE.Vector3(), _bp = new THREE.Vector3(), _bh = new THREE.Vector3(), _bE = new THREE.Euler();
// spray blood at world point (x, y, z), mostly along (dx, dz) = away from the shooter (exit side). amt ~ damage.
// fy = floor height under the victim (roofs / gantries). floor = drop a decal under them.
function bloodBurst(x, y, z, dx, dz, amt = 10, fy = 0, floor = true) {
  const dl = Math.hypot(dx, dz) || 1, ux = dx / dl, uz = dz / dl, n = Math.round(clamp(5 + amt * 0.45, 6, 16));
  for (let k = 0; k < n; k++) {
    const d = dropState[dropI]; dropI = (dropI + 1) % BLOOD.drops;
    const sp = 1.2 + Math.random() * 2.4, side = (Math.random() - 0.5) * 1.6, back = Math.random() < 0.25 ? -0.5 : 1; // a few spatter back at the shooter
    d.t = BLOOD.life * (0.6 + Math.random() * 0.6); d.x = x; d.y = y; d.z = z; d.fy = fy; d.land = false;
    d.vx = (ux * back - uz * side) * sp; d.vz = (uz * back + ux * side) * sp; d.vy = 0.6 + Math.random() * 1.8; d.s = 0.6 + Math.random() * 0.9;
  }
  bloodDrops.count = BLOOD.drops;
  if (floor) {
    const sp = splats[splatI++ % splats.length], off = 0.25 + Math.random() * 0.35;
    sp.m.position.set(x + ux * off, fy + 0.03 + (splatI % 5) * 0.002, z + uz * off); sp.m.rotation.z = Math.random() * 6.28;
    sp.m.scale.setScalar(0.45 + amt * 0.02 + Math.random() * 0.2); sp.t = BLOOD.splatLife; sp.m.visible = true;
  }
}
// blood at a character's chest: hit from world angle `from` (attacker -> victim spray goes the other way)
function bloodOn(mesh, fromX, fromZ, amt, fy = 0) {
  mesh.head.getWorldPosition(_bh); const gx = mesh.g.position.x, gz = mesh.g.position.z;
  const y = Math.max(fy + 0.15, _bh.y - 0.2);
  bloodBurst(gx + (_bh.x - gx) * 0.6, y, gz + (_bh.z - gz) * 0.6, gx - fromX, gz - fromZ, amt, fy);
}
function updateBlood(dt) {
  let live = 0;
  for (let i = 0; i < BLOOD.drops; i++) {
    const d = dropState[i];
    if (d.t <= 0) { _bm.makeScale(0, 0, 0); bloodDrops.setMatrixAt(i, _bm); continue; }
    d.t -= dt; live++;
    if (!d.land) {
      d.vy -= BLOOD.grav * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      if (d.y <= d.fy + 0.02) { d.y = d.fy + 0.02; d.land = true; d.t = Math.min(d.t + 0.6, 1.2); } // landed: lingers a beat as a dot
    }
    const k = clamp(d.t / 0.25, 0, 1) * d.s; // shrink out at the end
    if (d.land) _bs.set(k * 1.6, 0.15 * k, k * 1.6); else _bs.set(k * 0.8, k * 1.4, k * 0.8); // flat dot / stretched drop in flight
    _bq.setFromEuler(_bE.set(0, 0, d.land ? 0 : Math.atan2(d.vx, d.vy) * 0.6));
    _bm.compose(_bp.set(d.x, d.y, d.z), _bq, _bs); bloodDrops.setMatrixAt(i, _bm);
  }
  bloodDrops.instanceMatrix.needsUpdate = true; if (!live) bloodDrops.count = 0;
  for (const sp of splats) {
    if (sp.t <= 0) continue;
    sp.t -= dt; sp.m.material.opacity = clamp(sp.t / 1.2, 0, 0.9); if (sp.t <= 0) sp.m.visible = false;
  }
}
// clear all blood (mission restart)
function clearBlood() { for (const d of dropState) d.t = 0; for (const sp of splats) { sp.t = 0; sp.m.visible = false; } bloodDrops.count = 0; }

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
  const py = p.y || 0, gy = g.y || 0; // same floor: keep the arms near level; other floor: aim at his chest
  return { x: g.rx ?? g.x, y: Math.abs(py - gy) < 0.3 ? py + Math.max(0.45, Math.min(1.15, _am.y - py)) : gy + 1.1, z: g.rz ?? g.z };
}
const myLaser = makeLaser(), remoteLasers = [0, 1, 2, 3].map(makeLaser);
// grapple rope: dark cord hanging straight down the wall face from the claw, plus a short grip segment to the hands.
// Before it bites, the claw spins under the right hand (wind-up), then flies up in a lob and drops onto the lip.
function makeRope() {
  const cordMat = new THREE.MeshLambertMaterial({ color: 0x2a2620 });
  const seg = () => { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 0.03), cordMat); m.frustumCulled = false; m.visible = false; scene.add(m); return m; };
  const steel = new THREE.MeshLambertMaterial({ color: 0x9aa0a4, flatShading: true });
  const claw = new THREE.Group(); // local +x = into the wall; three tines curl over the lip and bite down
  const sh = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.16, 0.035), steel); sh.position.y = -0.07; claw.add(sh);
  for (const yo of [-0.75, 0, 0.75]) {
    const t = new THREE.Group(); t.rotation.y = yo; claw.add(t);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.03, 0.03), steel); arm.position.set(0.06, 0.01, 0); t.add(arm);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.03), steel); tip.position.set(0.12, -0.03, 0); t.add(tip);
  }
  claw.traverse((o) => { o.frustumCulled = false; }); claw.visible = false; scene.add(claw);
  return { main: seg(), grip: seg(), claw };
}
const _rh = new THREE.Vector3(), _re = new THREE.Vector3(), _rd = new THREE.Vector3(), _ra = new THREE.Vector3(), _rb = new THREE.Vector3(), _X = new THREE.Vector3(1, 0, 0);
function cordBetween(m, a, b) {
  _rd.copy(b).sub(a); const len = _rd.length(); m.visible = len > 0.02; if (!m.visible) return;
  m.scale.set(len, 1, 1); m.position.copy(a).addScaledVector(_rd, 0.5); m.quaternion.setFromUnitVectors(_X, _rd.multiplyScalar(1 / len));
}
function updateRope(R, mesh, tk, ti, tp) {
  if ((tk === 'hp' || tk === 'hr') && LINKS[ti]) { // rope haul: claw on the lip, line straight down the face to the foot
    const L = LINKS[ti], A = L.anchor; mesh.handWorld(_rh, 1);
    R.claw.visible = true; R.claw.position.set(A.x, A.y, A.z); R.claw.rotation.set(0, -L.a, 0);
    _ra.set(L.rope.x, A.y - 0.06, L.rope.z); _rb.set(L.rope.x, L.y0 + 0.02, L.rope.z); cordBetween(R.main, _ra, _rb);
    if (tk === 'hp') cordBetween(R.grip, _rh, _ra); // puller: hands on the line just over the lip
    else { _re.set(L.rope.x, clamp(_rh.y, L.y0, A.y - 0.06), L.rope.z); if (_re.distanceTo(_rh) < 0.7) cordBetween(R.grip, _rh, _re); else R.grip.visible = false; }
    return;
  }
  const on = (tk === 'gp' || tk === 'rp') && LINKS[ti];
  if (!on) { R.main.visible = R.grip.visible = R.claw.visible = false; return; }
  const L = LINKS[ti], up = tk === 'gp', P = lineDecode(tp), A = L.anchor, now = performance.now() / 1000;
  mesh.handWorld(_rh, 1); R.claw.visible = true; R.grip.visible = R.main.visible = false;
  let bit = true, bottom = L.y0 + 0.02; // claw on the lip? where the hanging rope ends
  if (up && (P.ph === 'sq' || P.ph === 'throw')) {
    const f = P.ph === 'sq' ? 0 : P.u, w = GRAPPLE.flyFrom;
    if (f < w) { // wind-up: claw circles under the hand on ~0.4 m of line
      const ang = (f / w) * Math.PI * 5 + now * 2, r = 0.12 + 0.2 * (f / w);
      _re.set(_rh.x + Math.cos(-mesh.g.rotation.y + Math.PI) * 0.1 + Math.cos(ang) * r * 0.4, _rh.y - 0.32 + Math.sin(ang) * r, _rh.z + Math.sin(-mesh.g.rotation.y + Math.PI) * 0.1 + Math.sin(ang) * r * 0.4);
      R.claw.rotation.set(ang, -L.a, 0); cordBetween(R.grip, _rh, _re);
    } else { // flight: lob up past the lip, drop onto it
      const k = (f - w) / (1 - w), e = 1 - (1 - k) * (1 - k);
      _re.copy(_rh).lerp(_ra.set(A.x, A.y, A.z), e); _re.y += Math.sin(Math.PI * k) * 0.55; _re.x -= L.dx * Math.sin(Math.PI * k) * 0.25; _re.z -= L.dz * Math.sin(Math.PI * k) * 0.25;
      R.claw.rotation.set(now * 14, -L.a, 0); cordBetween(R.grip, _rh, _re);
    }
    bit = false;
  } else if (!up && (P.ph === 'sq' || (P.ph === 'set' && P.u < 0.45))) { // carrying it, then reaching to set it on the lip
    const k = P.ph === 'sq' ? 0 : ss01((P.u - 0.15) / 0.3);
    _re.copy(_rh).lerp(_ra.set(A.x, A.y, A.z), k); R.claw.rotation.set(0, -L.a, 0); bit = false;
  } else if (!up && P.ph === 'set') { bottom = L.lip - (L.lip - L.y0 - 0.02) * ss01((P.u - 0.55) / 0.3); if (P.u < 0.55) bottom = L.lip - 0.3; } // feed the line down the face
  if (bit) {
    R.claw.position.set(A.x, A.y, A.z); R.claw.rotation.set(0, -L.a, 0);
    _ra.set(L.rope.x, A.y - 0.06, L.rope.z); _rb.set(L.rope.x, bottom, L.rope.z); cordBetween(R.main, _ra, _rb);
    if (P.ph === 'line' || P.ph === 'over' || (up && P.ph === 'set')) { // hands on the line
      _re.set(L.rope.x, clamp(_rh.y, bottom, A.y - 0.06), L.rope.z); if (_re.distanceTo(_rh) < 0.7) cordBetween(R.grip, _rh, _re);
    }
  } else R.claw.position.copy(_re);
}
const myRope = makeRope(), remoteRopes = [0, 1, 2, 3].map(makeRope);

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
// FAMAS round: sharper, shorter crack + a higher thump; vol falls off with distance (caller)
function rifleSound(vol = 1) {
  if (!actx || vol < 0.03) return;
  const n = actx.sampleRate * 0.11, buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 4);
  const src = actx.createBufferSource(), g = actx.createGain(); src.buffer = buf; g.gain.value = 0.3 * vol;
  src.connect(g); g.connect(actx.destination); src.start(); beep(110, 0.09, 'sine', 0.2 * vol);
}
// suppressed / tranq "pfft": tiny filtered puff + click
function suppSound(vol = 1) {
  if (!actx || vol < 0.03) return;
  const n = actx.sampleRate * 0.07, buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 5);
  const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain(); f.type = 'lowpass'; f.frequency.value = 900;
  src.buffer = buf; g.gain.value = 0.22 * vol; src.connect(f); f.connect(g); g.connect(actx.destination); src.start(); beep(1800, 0.02, 'square', 0.03 * vol);
}
// explosion: long rumbling noise + sub thump (C4 = big, stun = sharp crack + ringing)
function boomSound(k, vol = 1) {
  if (!actx || vol < 0.03) return;
  const len = k === 'c4' ? 0.9 : 0.35, n = actx.sampleRate * len, buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, k === 'c4' ? 2 : 4);
  const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain(); f.type = 'lowpass'; f.frequency.value = k === 'c4' ? 700 : 3500;
  src.buffer = buf; g.gain.value = (k === 'c4' ? 0.6 : 0.4) * vol; src.connect(f); f.connect(g); g.connect(actx.destination); src.start();
  if (k === 'c4') beep(45, 0.6, 'sine', 0.35 * vol); else beep(3200, 0.5, 'sine', 0.025 * vol); // stun: ears ring
}
const pickupSound = () => { beep(660, 0.06, 'square', 0.06); setTimeout(() => beep(880, 0.06, 'square', 0.06), 70); setTimeout(() => beep(1320, 0.12, 'square', 0.06), 140); };
const menuSound = (f = 980) => beep(f, 0.04, 'square', 0.05);
const hurtSound = () => { beep(220, 0.08, 'sawtooth', 0.12); setTimeout(() => beep(150, 0.14, 'sawtooth', 0.1), 60); };
const stabSound = () => { beep(140, 0.06, 'triangle', 0.12); setTimeout(() => beep(95, 0.09, 'triangle', 0.12), 70); };

// ---------------------------------------------------------------- input
const input = { jx: 0, jz: 0, kRun: false, keys: new Set() };
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (role && (e.code === 'KeyI' || e.code === 'Tab')) { e.preventDefault(); if (!e.repeat) { unlockAudio(); invOpen ? closeInv() : openInv(); } return; }
  if (invOpen) { e.preventDefault(); if (!e.repeat || /Arrow|Key[WASD]/.test(e.code)) invKey(e.code); return; } // menu eats the keys (no walking while it's up)
  input.keys.add(e.code);
  if (/^Digit[1-5]$/.test(e.code) && !e.repeat) { const id = HOTKEYS[+e.code.slice(5) - 1]; unlockAudio(); if ((me.inv[id] ?? -1) >= 0) equipWeapon(id); else if (role && world.phase === 'play') toast('NO ' + ITEMS[id].name + ' YET', 700, '#ccc'); }
  if (e.code === 'KeyQ' && !e.repeat) { unlockAudio(); useItem(me.itm); }
  if (e.code === 'KeyT' && !e.repeat) { unlockAudio(); detonate(); }
  if (e.code === 'KeyC' || e.code === 'ControlLeft') toggleCrouch();
  if (e.code === 'KeyZ' || e.code === 'KeyX') toggleProne();
  if (e.code === 'KeyE' || e.code === 'Space') { e.preventDefault(); if (!e.repeat) doInteract(); }
  if (e.code === 'KeyF' && !e.repeat) { unlockAudio(); if (role && world.phase === 'play' && !me.td && !me.tr) { if (me.eq) fireGun(); else holsterHint(); } }
  if (e.code === 'KeyG' && !e.repeat) { unlockAudio(); toggleGun(); }
  if (e.code === 'KeyV' && !e.repeat) toggleView();
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
$('btnView').addEventListener('pointerdown', (e) => { e.preventDefault(); unlockAudio(); toggleView(); });
$('btnInv').addEventListener('pointerdown', (e) => { e.preventDefault(); unlockAudio(); invOpen ? closeInv() : openInv(); });
$('btnDet').addEventListener('pointerdown', (e) => { e.preventDefault(); unlockAudio(); detonate(); });
$('wpnBox').addEventListener('pointerdown', (e) => { e.preventDefault(); unlockAudio(); openInv('wpn'); });
$('itemBox').addEventListener('pointerdown', (e) => { e.preventDefault(); unlockAudio(); if (me.inv[me.itm] > 0) useItem(me.itm); else openInv('item'); });
// first-person toggle (local only): top-down <-> eye view. Tunnels still switch to first person on their own.
function toggleView() {
  if (!role) return;
  fpsOn = !fpsOn; fpsLatch = fpsOn && me.moving; syncViewButton();
  toast(fpsOn ? 'FIRST PERSON' : 'TOP-DOWN VIEW', 700, '#9fd9b0');
}
function syncViewButton() { const b = $('btnView'); b.classList.toggle('on', fpsOn); b.textContent = fpsOn ? 'TOP' : '1ST'; b.title = fpsOn ? 'Back to top-down (V)' : 'First-person view (V)'; }
document.addEventListener('touchmove', (e) => { if (!e.target.closest('.panel')) e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

// stance: stand <-> crouch (C), anything <-> prone (Z/X). Tunnels are too low to stand in.
// In the water both buttons (and Z/X) take a short dive instead of changing stance.
function syncStanceButtons() {
  $('btnCrouch').classList.toggle('on', me.dive > 0 || (me.c && !me.p));
  $('btnProne').classList.toggle('on', me.p && !me.sw);
  const c = $('btnCrouch'), p = $('btnProne');
  const cl = me.sw ? 'DIVE' : 'CROUCH', pl = me.sw ? 'DIVE' : 'PRONE';
  if (c.textContent !== cl) c.textContent = cl;
  if (p.textContent !== pl) p.textContent = pl;
}
function startDive() {
  if (!me.sw || me.dive > 0 || me.diveCd > 0 || me.td || me.tr) return;
  me.dive = SWIM.diveT; beep(140, 0.07, 'sine', 0.05);
  syncStanceButtons();
}
function toggleCrouch() {
  if (me.td || me.tr) return;
  if (me.sw) { startDive(); return; }
  if (me.p) me.p = false; // prone -> crouch
  else if (me.c && me.tun >= 0) toast('Too low to stand', 800, '#ccc');
  else me.c = !me.c;
  syncStanceButtons();
}
function toggleProne() {
  if (me.td || me.tr) return;
  if (me.sw) { startDive(); return; }
  if (me.p) me.p = false; // prone -> crouch (stay low)
  else { me.p = true; me.c = true; }
  syncStanceButtons();
}
// pistol: G / GUN button draws or holsters it. Holstered = ACT can only take down / use, F does nothing (no accidental shots).
function syncGunButton() { const b = $('btnGun'); if (!b) return; b.classList.toggle('on', me.eq && !!me.wpn); const t = !me.wpn ? 'FISTS' : me.eq ? 'HOLSTER' : ITEMS[me.wpn].name; if (b.textContent !== t) b.textContent = t; }
function toggleGun() {
  if (!role || world.phase !== 'play' || me.td) return;
  if (!me.wpn || (me.inv[me.wpn] ?? -1) < 0) { toast('NO WEAPON — find one', 900, '#ccc'); beep(150, 0.04, 'square', 0.05); return; }
  if (me.box) toggleBox(false);
  me.eq = !me.eq; me.burst = 0;
  if (me.eq) { me.cd = Math.max(me.cd, 0.25); beep(520, 0.03, 'square', 0.05); setTimeout(() => beep(780, 0.03, 'square', 0.05), 60); } // draw: slide click, brief settle
  else { me.gunT = 0; beep(300, 0.05, 'triangle', 0.06); }
  const nm = ITEMS[me.wpn].name + (me.wpn === 'p9' && me.sd ? ' SD' : '');
  toast(me.eq ? (isGun(me.wpn) ? nm + ' DRAWN' : nm + ' READY') : nm + ' HOLSTERED', 600, me.eq ? '#ffd27f' : '#9fd9b0');
  syncGunButton();
  if (role === 'guest') sendPlayer(); else if (peerConnected) sendState();
}
let hintT = 0;
function holsterHint() { const now = performance.now(); if (now - hintT < 1500) return; hintT = now; const nm = me.wpn ? ITEMS[me.wpn].name : 'a weapon'; toast(isTouch ? 'Holstered - tap ' + nm + ' to draw' : 'Holstered - G to draw', 900, '#ccc'); }
function flash(el) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 180); }
// ACT priority: takedown (only from behind) > door switch > climb / co-op / grapple (traversal) > fire handgun (only if drawn)
// While mid-climb ACT = let go of a ladder / stand up from a boost kneel; F never fires while climbing.
const nearSwitch = () => SWITCHES.some((s) => Math.abs(me.y - s.y) < 0.3 && Math.hypot(me.x - s.x, me.z - s.z) < 1.8);
let curTm = null; // traversal option ACT would use right now (refreshed every frame in updateHud)
function actMode() {
  if (me.sw) return 'none'; // hands are busy swimming — no fire, no takedown, no climb
  if (me.tr) return me.tr.k === 'ld' || (ON_LINE(me.tr.k) && me.tr.ph === 'line') ? 'letgo' : me.tr.k === 'kn' ? 'stand' : 'busy';
  if (takedownTarget(me) >= 0) return 'td';
  if (nearSwitch()) return 'use';
  curTm = travMode(); if (curTm) return curTm.m;
  return me.box ? 'unbox' : me.eq ? 'fire' : 'none';
}
function doInteract() {
  if (!role || world.phase !== 'play' || me.td) return;
  flash($('btnAct'));
  if (me.tr) { trAct(); return; }
  if (me.box) { toggleBox(false); return; } // ACT = climb out of the box first
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
  if (p.tun >= 0 || p.td || p.tr || p.sw) return -1;
  let best = -1, bd = 1e9;
  world.guards.forEach((g, i) => {
    if (!alive(g) || Math.abs((p.y || 0) - (g.y || 0)) > 0.3) return; // same floor only (ground or his deck)
    const dx = p.x - g.x, dz = p.z - g.z, d = Math.hypot(dx, dz);
    if (d > range || d >= bd) return;
    if (!g.ko && Math.abs(angDiff(Math.atan2(dz, dx), g.a)) < behind) return; // in front of / beside him -> no (KO'd guard: any side)
    if (!lineOfSight(g, { x: p.x, z: p.z, y: p.y || 0, c: true })) return; // nothing in between (crates count)
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
  if (role === 'host') hostTakedown(gi, mySlot); else net.relay({ t: 'td', g: gi, x: r2(me.x), z: r2(me.z) });
}
// host: start the hold on a guard (returns false if he's already down / grabbed)
function hostTakedown(gi, pidx) {
  const g = world.guards[gi];
  if (!g || !alive(g) || world.phase !== 'play') return false;
  g.st = 'held'; g.by = pidx; g.tdT = 0; g.meter = 0; g.stun = 0; g.ko = 0;
  if (peerConnected) sendState();
  return true;
}
// auto-aim: best live guard inside the cone in front of you with a clear line of fire (FPS = narrow cone, straight ahead)
function autoTarget(p = me, tranq = false) {
  const cone = p.tun >= 0 || (p === me && fpsOn) ? GUN.fpsCone : GUN.cone;
  const px = p.x, pz = p.z, pa = p.a;
  let tgt = -1, best = 1e9;
  world.guards.forEach((g, i) => {
    if (g.st === 'dead' || (tranq && g.ko === 2)) return; // darts skip guards already asleep
    const gx = g.rx ?? g.x, gz = g.rz ?? g.z; // guest: use the smoothed on-screen guard
    const dx = gx - px, dz = gz - pz, d = Math.hypot(dx, dz);
    if (d > GUN.range + 2) return;
    const off = Math.abs(angDiff(Math.atan2(dz, dx), pa));
    if (off > cone && d > 1.0) return;
    if (!clearShot(px, pz, gx, gz, p.y || 0, g.y || 0)) return;
    const score = d + off * 8 + (g.ko ? 4 : 0); if (score < best) { best = score; tgt = i; }
  });
  return tgt;
}
// ---------------------------------------------------------------- GEAR: weapons + items (see gear.js for the table / art)
const isGun = (id) => GUN_IDS.includes(id);
const wkey = () => (!me.wpn ? '' : me.wpn === 'p9' && me.sd ? 'sd' : me.wpn); // what the current gun is on the wire ('' = fists, sd = suppressed P-9)
const HOTKEYS = ['p9', 'fr5', 'mkt', 'stun', 'c4']; // 1-5
const ownedWeapons = () => GRID.filter((id) => id && ITEMS[id].kind === 'wpn' && me.inv[id] >= 0);
const myCharges = () => (world.c4 || []).filter((c) => c.by === mySlot).length;
const canAct = () => role && world.phase === 'play' && !me.td;
// put a weapon in the weapon slot and draw it (from the menu / 1-5 / pickup)
function equipWeapon(id, draw = true) {
  if (!canAct() || !ITEMS[id] || ITEMS[id].kind !== 'wpn' || me.inv[id] < 0) return;
  const was = me.wpn; me.wpn = id; me.burst = 0;
  if (draw) { if (me.box) toggleBox(false); me.eq = true; me.cd = Math.max(me.cd, 0.3); }
  beep(520, 0.03, 'square', 0.05); setTimeout(() => beep(780, 0.03, 'square', 0.05), 60);
  const nm = ITEMS[id].name + (id === 'p9' && me.sd ? ' SD' : '');
  if (was !== id || draw) toast(isGun(id) ? nm + ' EQUIPPED' : nm + ' READY - ' + (isTouch ? 'FIRE' : 'F') + (id === 'c4' ? ' plants' : ' throws'), 900, '#ffd27f');
  syncGunButton(); netNow();
}
const netNow = () => { if (role === 'guest') sendPlayer(); else if (peerConnected) sendState(); };
// use / toggle an item (menu USE, Q, tap the item box)
function useItem(id) {
  if (!canAct() || !id || !ITEMS[id] || ITEMS[id].kind !== 'item') return;
  if (me.inv[id] <= 0) { toast('NO ' + ITEMS[id].name, 800, '#ccc'); beep(150, 0.04, 'square', 0.05); return; }
  me.itm = id;
  if (id === 'ration') {
    const hp = world.hp[mySlot] ?? HP_MAX;
    if (hp >= HP_MAX) { toast('LIFE IS FULL', 800, '#9fd9b0'); return; }
    if (hp <= 0) return;
    me.inv.ration--; healFx();
    toast('RATION  +' + Math.min(RATION_HP, HP_MAX - hp) + ' LIFE', 1100, '#7fff9f');
    if (role === 'host') hostHeal(mySlot); else net.relay({ t: 'heal' });
  } else if (id === 'stim') {
    me.inv.stim--; me.stimT = STIM_T; me.bloom = 0; me.wob = 0;
    beep(440, 0.08, 'triangle', 0.08); setTimeout(() => beep(660, 0.12, 'triangle', 0.08), 90);
    toast('STIM - steady hands ' + STIM_T + 's', 1100, '#ff9a9a');
  } else if (id === 'box') toggleBox();
  else if (id === 'supp') {
    me.sd = !me.sd; menuSound(me.sd ? 700 : 420);
    toast(me.sd ? 'SUPP. ON - P-9 is quiet' : 'SUPP. OFF', 900, '#ffd27f');
  } else if (id === 'scope') {
    me.scope = !me.scope; menuSound(me.scope ? 1200 : 600);
    toast(me.scope ? 'SCOPE ON' : 'SCOPE OFF', 700, '#9fd9b0');
  }
  netNow();
}
// cardboard box: hide inside. Still = invisible to guards (unless ALERT and nose-to-box), moving = very low profile.
function toggleBox(on = !me.box) {
  if (on) {
    if (me.inv.box <= 0) return;
    if (me.tr || me.td || me.tun >= 0 || me.sw) { toast(me.sw ? 'Can\'t use the box in the water' : 'Can\'t use the box here', 800, '#ccc'); return; }
    me.box = true; me.eq = false; me.burst = 0; me.p = false; me.c = false; me.gunT = 0; me.itm = 'box';
    beep(200, 0.08, 'triangle', 0.08); toast('C.BOX - stay still and they walk past', 1200, '#d8b080');
  } else { if (!me.box) return; me.box = false; beep(260, 0.06, 'triangle', 0.07); toast('OUT OF THE BOX', 700, '#d8b080'); }
  syncStanceButtons(); syncGunButton(); netNow();
}
// FIRE: guns shoot, STUN.G throws, C4 plants. Only while the weapon is drawn (G / weapon button).
function fireGun() {
  if (me.sw) { if (me.cd <= 0) { toast('Can\'t fire in the water', 700, '#9fd4ee'); me.cd = 0.45; } return; }
  if (!me.eq || !me.wpn || me.cd > 0 || me.tr || me.box || me.burst > 0) return;
  const id = me.wpn;
  if (id === 'stun') return throwNade();
  if (id === 'c4') return plantC4();
  const W = WPN[wkey()];
  if ((me.inv[W.ammo] || 0) <= 0) { toast('NO AMMO', 700, '#ccc'); beep(150, 0.04, 'square', 0.05); me.cd = 0.3; return; }
  if (W.burst) { me.burst = W.burst; me.burstT = 0; me.cd = W.cd + W.rof * W.burst; stepBurst(0); return; }
  me.cd = W.cd; shootRound(wkey());
}
function stepBurst(dt) { // FR-5: the rest of a 3-round burst comes out rof apart (stops if you holster / swap / run dry)
  if (me.burst <= 0) return;
  me.burstT -= dt;
  while (me.burst > 0 && me.burstT <= 0) {
    if (me.wpn !== 'fr5' || !me.eq || me.tr || me.td || me.box || me.sw || me.inv.fr5 <= 0 || world.phase !== 'play') { me.burst = 0; break; }
    shootRound('fr5'); me.burst--; me.burstT += WPN.fr5.rof;
  }
}
function shootRound(w) {
  const W = WPN[w];
  me.inv[W.ammo]--; me.gunT = GUN.drawTime; me.shot++;
  let tgt = autoTarget(me, !!W.tranq);
  const steady = me.stimT > 0;
  // recoil bloom: the round leaves at aim + random throw; it only hits if that line still crosses the guard
  const spread = W.spread0 + me.bloom + (me.moving ? GUN.moveSpread : 0) * (steady ? 0.5 : 1), err = (Math.random() * 2 - 1) * spread;
  let end, shotA = me.a;
  if (tgt >= 0) {
    const g = world.guards[tgt], gx = g.rx ?? g.x, gz = g.rz ?? g.z, d = Math.hypot(gx - me.x, gz - me.z);
    if (d > W.range) tgt = -1;
    else {
      if (me.tun < 0 && !fpsOn) me.a = Math.atan2(gz - me.z, gx - me.x);
      shotA = Math.atan2(gz - me.z, gx - me.x) + err;
      if (Math.abs(err) < Math.atan2(GUN.bodyW, Math.max(0.3, d))) end = { x: g.x, z: g.z };
      else tgt = -1; // recoil threw it wide
    }
  }
  if (!end) { if (tgt < 0 && shotA === me.a) shotA = me.a + err; end = rayEnd(me.x, me.z, shotA, W.range); }
  me.bloom = Math.min(W.bloomMax, me.bloom + W.bloom * (steady ? 0.35 : 1));
  me.wob = steady ? 0 : W.wob; me.wobA = Math.random() * 6.28; shake = Math.max(shake, W.kick);
  meMesh.g.rotation.y = -me.a;
  gunFx(meMesh, end.x, end.z, tgt >= 0, tgt >= 0 ? GUARDS[tgt].y + 1.15 : null, !!W.rifle, W.tranq ? 0x9fe0ff : null);
  W.rifle ? rifleSound(1) : W.quiet ? suppSound(1) : gunSound(1);
  if (navigator.vibrate) navigator.vibrate(W.quiet ? 15 : 30);
  const msg = { t: 'sh', g: tgt, x: r2(me.x), z: r2(me.z), y: r2(me.y), ex: r2(end.x), ez: r2(end.z), by: mySlot, w };
  if (role === 'host') hostShot(msg, 0);
  net.relay(msg); // host: fx for every guest. guest: hit request + fx for the host (host re-broadcasts it to the others)
}
// host: apply a shot (from any player). Bullets drop the guard; an MK-T dart puts him to sleep. The bang (if any) pulls
// every live guard inside that weapon's noise radius.
// host: a guard is down for good. One loot bundle, ever (loud clear vs a searched takedown).
function killGuard(g, by, quiet) {
  if (!g || g.st === 'dead') return;
  g.st = 'dead'; g.by = by; g.stun = 0; g.ko = 0;
  if (!g.loot) { const tab = quiet ? LOOT_QUIET : LOOT_LOUD; g.loot = tab[(Math.random() * tab.length) | 0]; }
  world.kills++;
  if (peerConnected) sendState();
}
function hostShot(m, pidx) {
  if (world.phase !== 'play') return;
  const W = WPN[m.w] || WPN.p9, g = world.guards[m.g];
  if (g && g.st !== 'dead' && Math.hypot(g.x - m.x, g.z - m.z) < W.range + 2 && clearShot(m.x, m.z, g.x, g.z, m.y || 0, g.y || 0)) {
    if (W.tranq) { if (g.st !== 'held') koGuard(g, TRANQ.sleep, 2); }
    else killGuard(g, pidx, false);
  }
  hearBang(m.x, m.z, W.noise);
  if (peerConnected) sendState();
}
function hearBang(x, z, r) {
  for (const o of world.guards) {
    if (!alive(o) || o.stun > 0 || Math.hypot(o.x - x, o.z - z) > r) continue;
    o.meter = Math.max(o.meter, 0.5);
    if (world.alert === 2) { o.st = 'chase'; o.tx = x; o.tz = z; o.give = 8; }
    else { o.st = 'investigate'; o.tx = x; o.tz = z; o.wait = 3.5; o.give = 9; }
  }
}
// knock a guard out (host): ko 1 = stunned (grenade), 2 = asleep (dart). Blind, deaf, frozen until stun runs out.
function koGuard(g, t, ko) {
  if (!alive(g)) return;
  g.stun = Math.max(g.stun || 0, t); g.ko = Math.max(g.ko || 0, ko); g.meter = 0; g.shooting = false; g.bl = 0; g.aimT = 0;
  if (g.st === 'chase' || g.st === 'search') { g.st = 'investigate'; g.tx = g.x; g.tz = g.z; g.wait = 3; g.give = 4; }
}
// STUN.G: lands ~7 m ahead (short of walls), host runs the fuse, everyone sees the arc + flash
function throwNade() {
  if ((me.inv.stun || 0) <= 0) { toast('NO STUN.G', 700, '#ccc'); beep(150, 0.04, 'square', 0.05); me.cd = 0.3; return; }
  me.inv.stun--; me.cd = 0.9; me.shot++; me.gunT = 0.6;
  const e = rayEnd(me.x, me.z, me.a, STUN.range), back = 0.4, d = Math.max(0.5, Math.hypot(e.x - me.x, e.z - me.z) - back);
  const tx = me.x + Math.cos(me.a) * d, tz = me.z + Math.sin(me.a) * d, ty = groundAt(tx, tz, me.y + 0.3);
  const m = { t: 'ng', x: r2(me.x), y: r2(me.y + 1.4), z: r2(me.z), tx: r2(tx), ty: r2(ty), tz: r2(tz) };
  beep(300, 0.12, 'triangle', 0.05); toast('STUN.G OUT', 600, '#fff');
  if (role === 'host') hostNade(m, mySlot); else { net.relay(m); nadeFx(Object.assign({}, m, { by: mySlot })); }
  if (me.inv.stun <= 0) { me.eq = false; syncGunButton(); }
}
function hostNade(m, by) {
  if (world.phase !== 'play') return;
  world.nades.push({ x: m.tx, y: m.ty, z: m.tz, t: STUN.fuse, by });
  const fx = Object.assign({}, m, { t: 'ngx', by, from: undefined }); nadeFx(fx);
  if (peerConnected) net.relay(fx);
}
function nadeBlast(n) { // host
  for (const g of world.guards) {
    if (!alive(g)) continue;
    const gy = g.y || 0, d = Math.hypot(g.x - n.x, g.z - n.z, (gy - n.y) * 0.8);
    if (d < STUN.r && clearShot(n.x, n.z, g.x, g.z, n.y, gy)) { koGuard(g, STUN.ko, 1); g.tx = n.x; g.tz = n.z; }
  }
  const fx = { t: 'bx', k: 'stun', x: r2(n.x), y: r2(n.y), z: r2(n.z) }; blastFx(fx);
  if (peerConnected) { net.relay(fx); sendState(); }
}
// C4: FIRE plants one at your feet; DET (T / DET button / menu) sets off every charge you planted
function plantC4() {
  if ((me.inv.c4 || 0) <= 0) { toast('NO C4', 700, '#ccc'); beep(150, 0.04, 'square', 0.05); me.cd = 0.3; return; }
  if (me.tun >= 0) { toast('No room to plant here', 800, '#ccc'); me.cd = 0.3; return; }
  me.inv.c4--; me.cd = 0.7; me.gunT = 0;
  beep(1400, 0.03, 'square', 0.05); setTimeout(() => beep(1400, 0.03, 'square', 0.05), 120);
  toast('C4 PLANTED - ' + (isTouch ? 'DET' : 'T') + ' to detonate', 1300, '#ffb36b');
  const m = { t: 'c4p', x: r2(me.x + Math.cos(me.a) * 0.3), y: r2(me.y), z: r2(me.z + Math.sin(me.a) * 0.3) };
  if (role === 'host') hostC4(m, mySlot); else { net.relay(m); world.c4 = (world.c4 || []).concat([{ id: -1, x: m.x, y: m.y, z: m.z, by: mySlot }]); } // show it right away
  if (me.inv.c4 <= 0) { me.eq = false; syncGunButton(); }
}
function hostC4(m, by) {
  if (world.phase !== 'play') return;
  world.c4.push({ id: ++world.c4Id, x: m.x, y: m.y, z: m.z, by });
  if (world.c4.length > C4.max) world.c4.shift();
  if (peerConnected) sendState();
}
function detonate() {
  if (!canAct()) return;
  if (!myCharges()) { if (me.wpn === 'c4' || (me.inv.c4 ?? -1) >= 0) toast('No C4 planted', 700, '#ccc'); return; }
  beep(1800, 0.05, 'square', 0.05);
  if (role === 'host') hostDet(mySlot); else net.relay({ t: 'c4d' });
}
function hostDet(by) {
  if (world.phase !== 'play') return;
  const mine = world.c4.filter((c) => c.by === by); world.c4 = world.c4.filter((c) => c.by !== by);
  for (const c of mine) {
    for (const g of world.guards) {
      if (g.st === 'dead') continue;
      const gy = g.y || 0; if (Math.abs(gy - c.y) > 1.8) continue;
      if (Math.hypot(g.x - c.x, g.z - c.z) < C4.kill && clearShot(c.x, c.z, g.x, g.z, c.y, gy)) killGuard(g, by, false);
    }
    hearBang(c.x, c.z, C4.noise);
    for (const p of players()) {
      if (Math.abs((p.y || 0) - c.y) > 1.8 || p.tun >= 0) continue;
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < C4.pr && clearShot(c.x, c.z, p.x, p.z, c.y, p.y || 0)) { world.hitInv[p.idx] = 0; damagePlayer(p.idx, Math.round(C4.pdmg * (1 - d / C4.pr)) + 5, 'c4'); }
    }
    const fx = { t: 'bx', k: 'c4', x: r2(c.x), y: r2(c.y), z: r2(c.z) }; blastFx(fx); if (peerConnected) net.relay(fx);
  }
  if (peerConnected) sendState();
}
function hostHeal(idx) {
  if (world.phase !== 'play' || world.hp[idx] <= 0) return;
  world.hp[idx] = Math.min(HP_MAX, world.hp[idx] + RATION_HP);
  if (peerConnected) sendState();
}

// ---------------------------------------------------------------- local movement (both roles)
// Over a basin, on the ground (not a deck): surface swim. pad keeps you in until you're actually on the bank.
function swimSpot(x, z, y) {
  if ((y || 0) > 1.2) return null;
  if (groundAt(x, z, Math.max(y || 0, 0)) > 0.4) return null;
  return waterVolume(x, z, me.sw ? 0.22 : -0.02);
}
function beginSwim(w) {
  const loud = me.run || me.y > 0.55;
  me.sw = true; me.run = false; me.p = false; me.c = false; me.burst = 0;
  if (me.box) { me.box = false; syncGunButton(); }
  me.splash = loud ? 0.55 : 0;
  syncStanceButtons();
  toast((w.name || 'WATER') + ' — swim  ·  C dives', 1400, '#8fd8f0');
  if (loud) { beep(170, 0.08, 'sine', 0.05); beep(90, 0.12, 'triangle', 0.04); }
}
function settleSpawn() {
  me.y = 0; me.vy = 0; me.tun = -1; me.dive = 0;
  const w = swimSpot(me.x, me.z, 0);
  if (w) beginSwim(w);
  else if (me.sw) endSwim();
}
function endSwim() {
  if (!me.sw) return;
  me.sw = false; me.dive = 0; me.splash = 0;
  const sp = Math.hypot(me.vx, me.vz);
  if (sp > 0.15) {
    const ox = me.x, oz = me.z;
    me.x += (me.vx / sp) * 0.18; me.z += (me.vz / sp) * 0.18; collidePlayer(me, 0.38);
    if (waterVolume(me.x, me.z, -0.02)) { me.x = ox; me.z = oz; }
  }
  syncStanceButtons();
}
function updateLocal(dt) {
  me.cd = Math.max(0, me.cd - dt); me.gunT = Math.max(0, me.gunT - dt); me.stimT = Math.max(0, me.stimT - dt);
  me.bloom = Math.max(0, me.bloom - dt * (me.gunT > GUN.drawTime - 1.2 ? GUN.bloomDecay : GUN.bloomRest) * (me.stimT > 0 ? 2 : 1)); me.wob = Math.max(0, me.wob - dt * 1.8);
  stepBurst(dt);
  if (world.phase === 'play') updatePickups(dt);
  if (me.td) { // locked into the takedown animation
    const before = me.td.t; me.td.t += dt; stopMe(); me.run = false;
    for (const hit of [0.4, 0.64]) if (before < hit * TD.time && me.td.t >= hit * TD.time) stabSound();
    if (me.td.t >= TD.time + 0.3 || world.phase !== 'play') { me.td = null; }
    $('stance').textContent = 'TAKEDOWN';
    return;
  }
  let jx = invOpen ? 0 : input.jx, jz = invOpen ? 0 : input.jz, kb = false;
  const k = invOpen ? new Set() : input.keys; // gear menu up: hands off the stick
  if (k.has('KeyA') || k.has('ArrowLeft')) { jx -= 1; kb = true; }
  if (k.has('KeyD') || k.has('ArrowRight')) { jx += 1; kb = true; }
  if (k.has('KeyW') || k.has('ArrowUp')) { jz -= 1; kb = true; }
  if (k.has('KeyS') || k.has('ArrowDown')) { jz += 1; kb = true; }
  let mag = Math.hypot(jx, jz);
  if (mag > 1) { jx /= mag; jz /= mag; mag = 1; }
  const play = world.phase === 'play';
  me.thud = Math.max(0, me.thud - dt);
  me.splash = Math.max(0, me.splash - dt);
  if (me.tr && !play) me.tr = null; // mission ended mid-climb: let go
  if (me.tr) { updateTrav(dt, jx, jz, mag); me.tun = -1; if (me.sw) endSwim(); $('stance').textContent = me.tr ? travStance() : 'STILL'; return; }
  if (me.box) me.run = false;
  const baseSp = () => (me.sw ? (me.dive > 0 ? SWIM.dive : SWIM.speed) * (kb ? 1 : clamp(mag / 0.85, 0.42, 1))
    : me.box ? SPEED.crouch * 0.9 : me.p ? SPEED.prone : me.c ? SPEED.crouch : me.run ? SPEED.run : SPEED.walk * (kb ? 1 : clamp(mag / 0.9, 0.4, 1)));
  // desired velocity (tvx, tvz) from input; actual velocity me.vx/me.vz chases it with limited accel = momentum
  let tvx = 0, tvz = 0, wantDir = null;
  if (me.tun >= 0 || fpsOn) {
    // FIRST PERSON (inside a tunnel, or the 1ST toggle): view-relative tank controls. up/W = crawl forward, down/S = back up, left/right = turn.
    // fpsLatch: whatever direction you were holding when you entered keeps meaning "forward" until you let go,
    // so walking in with D doesn't suddenly start spinning you.
    if (fpsLatch && mag < 0.15) fpsLatch = false;
    const fwd = fpsLatch ? mag : -jz, turn = fpsLatch ? 0 : jx;
    if (play) me.a += turn * (me.sw ? 1.45 : 2.6) * dt;
    me.run = !me.sw && me.tun < 0 && fwd > 0.15 && !me.c && !me.box && (kb ? (k.has('ShiftLeft') || k.has('ShiftRight')) : fwd > 0.92); // can run outside tunnels / water
    if (play && Math.abs(fwd) > 0.15) {
      const sp = baseSp() * (fwd < 0 ? 0.6 : 1) * Math.sign(fwd);
      tvx = Math.cos(me.a) * sp; tvz = Math.sin(me.a) * sp;
      const t = TUNNELS[me.tun];
      if (t) { const ax = t.axis === 'x' ? (Math.cos(me.a) >= 0 ? 0 : Math.PI) : (Math.sin(me.a) >= 0 ? Math.PI / 2 : -Math.PI / 2);
      if (Math.abs(turn) < 0.15 && Math.abs(angDiff(ax, me.a)) < 0.6) turnToward(me, ax, dt * 2.5); } // gently line up with the tunnel
    }
  } else {
    const wants = mag > 0.15 && play;
    me.run = wants && !me.sw && !me.c && !me.box && (kb ? (k.has('ShiftLeft') || k.has('ShiftRight')) : mag > 0.92);
    if (wants) { const sp = baseSp(); tvx = (jx / mag) * sp; tvz = (jz / mag) * sp; wantDir = Math.atan2(jz, jx); }
  }
  // accelerate toward the target velocity. Speeding up uses accel, slowing down uses (slightly stronger) decel;
  // changing direction at speed uses turnAccel so strafing/cornering stays tight rather than icy.
  const dvx = tvx - me.vx, dvz = tvz - me.vz, dv = Math.hypot(dvx, dvz);
  if (dv > 1e-6) {
    const cur = Math.hypot(me.vx, me.vz), tgt = Math.hypot(tvx, tvz);
    const align = cur > 0.05 && tgt > 0.05 ? (me.vx * tvx + me.vz * tvz) / (cur * tgt) : 1;
    const rate = me.sw ? (tgt < 0.05 ? SWIM.decel : SWIM.accel) : tgt < 0.05 ? MOVE.decel : align < 0.7 ? MOVE.turnAccel : tgt >= cur ? MOVE.accel : MOVE.decel;
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
  if (me.tun < 0 && wantDir !== null) turnToward(me, wantDir, dt * (me.sw ? SWIM.turn : me.p ? MOVE.proneTurnRate : MOVE.turnRate));
  if (!me.moving) me.run = false;
  // vertical: basins catch you into a surface swim; otherwise stand on the highest walkable top (0.3 step-up) or fall
  const wet = play && me.tun < 0 ? swimSpot(me.x, me.z, me.y) : null;
  if (wet) {
    if (!me.sw) beginSwim(wet);
    if (me.dive > 0) { me.dive -= dt; if (me.dive <= 0) { me.dive = 0; me.diveCd = SWIM.gap; syncStanceButtons(); } }
    else me.diveCd = Math.max(0, me.diveCd - dt);
    me.vy = 0;
    if (me.y > 0.02) me.y = Math.max(0, me.y - Math.max(5, me.y * 4) * dt);
    else me.y = 0;
  } else {
    if (me.sw) endSwim();
    const gnd = groundAt(me.x, me.z, me.y);
    if (me.y > gnd + 1e-3 || me.vy > 0) {
      if (me.vy === 0) me.fallFrom = me.y;
      me.vy -= GRAV * dt; me.y += me.vy * dt;
      if (me.y <= gnd) { me.y = gnd; me.vy = 0; landed(me.fallFrom - gnd); }
    } else { me.y = gnd; me.vy = 0; }
  }
  // auto-grab: keep pushing into a ladder / drainpipe from its foot for a moment = climb on (ACT does it instantly)
  if (play && me.vy === 0 && wantDir !== null && me.tun < 0 && !me.p && !me.box && !me.sw) {
    const ci = CLIMBS.findIndex((c) => Math.abs(me.y - c.y0) < 0.05 && hz(me, c) < 0.75 && Math.abs(angDiff(c.a, wantDir)) < 0.6);
    me.grabT = ci >= 0 ? me.grabT + dt : 0;
    if (me.grabT > 0.25) { me.grabT = 0; startTrav({ m: 'climb', i: ci }); return; }
  } else me.grabT = 0;
  // tunnel state (hysteresis: must be 0.35 inside a mouth to enter, leaves as soon as you're out)
  const was = me.tun;
  me.tun = tunAt(me.x, me.z, me.y, was >= 0 ? 0 : 0.35);
  if (me.tun >= 0 && was < 0) {
    fpsLatch = me.moving; if (me.box) toggleBox(false);
    if (!me.c) { me.c = true; syncStanceButtons(); }
    toast(TUNNELS[me.tun].name, 1100, '#ffd27f');
  }
  const swimTxt = me.sw ? (me.dive > 0 ? 'DIVE' : me.moving ? 'SWIM (quiet)' : 'TREADING WATER') + ' · C dive' : '';
  $('stance').textContent = swimTxt || (me.box ? (me.moving ? 'C.BOX (moving - suspicious)' : 'C.BOX (still - hidden)') + (me.y > 0.5 ? ' · HIGH' : '') : (me.p ? (me.moving ? 'CRAWL (silent, low)' : 'PRONE (hard to see)') : me.c ? 'CROUCH (silent)' : me.run ? 'RUN (loud!)' : me.moving ? 'WALK' : 'STILL')
    + (me.tun >= 0 ? ' · TUNNEL' : fpsOn ? ' · 1ST PERSON' : '') + (me.y > 0.5 ? ' · HIGH' : ''));
}
let fpsLatch = false;
// a standing drop from high up thuds (guards hear it); crouched you hang-drop silently. Swimming is quiet;
// running or falling in makes one short splash.
const noiseOf = (p) => (p.splash > 0 ? NOISE.splash : p.sw ? 0 : p.thud > 0 ? TRAV.landNoise : !p.moving || p.box ? 0 : p.run && Math.hypot(p.vx || 0, p.vz || 0) > SPEED.walk + 0.4 ? NOISE.run : p.c ? 0 : NOISE.walk);
const swimCode = (sw, dive) => (sw ? (dive > 0 ? 2 : 1) : 0);

// ---------------------------------------------------------------- vertical traversal (climb / mantle / grapple / co-op)
// me.tr = { k, i, t, ... }. k is sent on the wire:
//   ld ladder or drainpipe (manual up/down)   mt mantle / vault over a lip   md step off a roof onto a ladder
//   gp grapple up LINKS[i]   rp rappel down LINKS[i]   kn kneeling at co-op wall i (offering a boost)
//   bs boosted climber   lf booster lifting   hs climber being pulled up   pl puller at the roof edge
// Solo moves start optimistically; the guest tells the host ('tr') and the host can veto ('trx' -> snap back) if the
// partner already owns that rope / ladder. Co-op moves only ever start from the host's world.co (see hostCoop).
const GRAV = 20;
const hz = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const ss01 = (v) => { v = clamp(v, 0, 1); return v * v * (3 - 2 * v); };
const mixv = (a, b, k) => a + (b - a) * k;
// CO-OP CLIMB SPOTS. COOPS (traverse.js) = the hand-placed 2P walls (decal, solo hint). COOP_ALL adds generated spots
// along almost every face you could sensibly boost / pull a partner up: building walls, tall crates, catwalk / bridge /
// roof-deck lips, from the ground or from a lower deck. A spot = { x, z (point on the face), a (facing into the wall),
// top, y0 (floor the climber starts on), gen }. Built from static level data, so every client gets the same indices
// (spot index i rides the wire exactly like before). Skipped: fences / compound walls / the red door (not walkable -
// would also skip the 2-agent door puzzle), anything under a deck or ceiling, tunnel mouths + interiors, map edge,
// drops under mantle height (MANTLE does those) or over 3.45 m (one L1 storey - ground -> L2 towers need a ladder),
// and spots right next to a ladder / grapple ring / hand-placed 2P wall.
function genCoops() {
  const out = [], STEP = 1.1, IN = 0.45;
  const railsAt = (y) => RAILS.filter((r) => Math.abs(r.y0 - y) < 0.3);
  const blocked = (x, z, y, r = 0.3) => WALLS.some((b) => b.h > y + 0.05 && x > b.x1 - r && x < b.x2 + r && z > b.z1 - r && z < b.z2 + r)
    || railsAt(y).some((b) => x > b.x1 - r && x < b.x2 + r && z > b.z1 - r && z < b.z2 + r);
  const ceiling = (x, z, y, top) => WALK_TOPS.some((b) => b.h > y + 0.3 && b.h < top + 0.5 && x >= b.x1 - 0.05 && x <= b.x2 + 0.05 && z >= b.z1 - 0.05 && z <= b.z2 + 0.05);
  const inMap = (p) => p.x > MAP.x1 + 1.2 && p.x < MAP.x2 - 1.2 && p.z > MAP.z1 + 1.2 && p.z < MAP.z2 - 1.2;
  const crowded = (x, z) => COOPS.some((c) => Math.hypot(c.x - x, c.z - z) < 1.8) || CLIMBS.some((c) => Math.hypot(c.x - x, c.z - z) < 1.2)
    || LINKS.some((L) => Math.hypot(L.face.x - x, L.face.z - z) < 1.1);
  const tops = WALLS.filter((b) => (b.kind === 'building' || b.kind === 'crate') && b.h > TRAV.mantleMax && !b.noCoop).concat(WALKS);
  for (const b of tops) {
    const top = b.h;
    for (const [nx, nz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const alongX = nz !== 0, lo = alongX ? b.x1 : b.z1, hi = alongX ? b.x2 : b.z2, len = hi - lo - 2 * IN;
      if (len < -0.2) continue;
      const n = Math.max(1, Math.floor(Math.max(0, len) / STEP) + 1), pad = (hi - lo - (n - 1) * STEP) / 2;
      const tryAt = (t) => { // one candidate spot on this face at tangent position t, or null
        if (t < lo + 0.2 || t > hi - 0.2) return null;
        const F = alongX ? { x: t, z: nz < 0 ? b.z1 : b.z2 } : { x: nx < 0 ? b.x1 : b.x2, z: t };
        const P = (d) => ({ x: F.x + nx * d, z: F.z + nz * d }), base = P(0.45), step = P(1.15), hang = P(0.4), land = P(-0.65), edge = P(-0.35);
        if (!inMap(base) || !inMap(step)) return null;
        const y0 = groundAt(base.x, base.z, top - TRAV.mantleMax - STEP_UP - 0.05); // floor you boost from (ground, or a lower deck)
        if (Math.abs(groundAt(step.x, step.z, y0) - y0) > 0.05 || Math.abs(groundAt(hang.x, hang.z, y0) - y0) > 0.05) return null;
        const dh = top - y0; if (dh <= TRAV.mantleMax + 0.05 || dh > 3.45) return null;
        if (blocked(base.x, base.z, y0, 0.25) || blocked(step.x, step.z, y0, 0.12) || ceiling(base.x, base.z, y0, top) || ceiling(hang.x, hang.z, y0, top) || ceiling(step.x, step.z, y0, top)) return null;
        if (y0 < 0.4 && (tunnelAt(base.x, base.z) >= 0 || tunnelAt(step.x, step.z) >= 0 || tunnelAt(F.x - nx * 0.2, F.z - nz * 0.2) >= 0)) return null;
        if (Math.abs(groundAt(land.x, land.z, top) - top) > 0.02 || Math.abs(groundAt(edge.x, edge.z, top) - top) > 0.02 || blocked(land.x, land.z, top, 0.22)) return null;
        if (crowded(F.x, F.z) || out.some((c) => Math.hypot(c.x - F.x, c.z - F.z) < 0.8 && Math.abs(c.top - top) < 0.1)) return null;
        return { name: 'WALL', x: F.x, z: F.z, a: Math.atan2(-nz, -nx), top, y0, gen: 1 };
      };
      for (let k = 0; k < n; k++) { // regular samples; a blocked one slides along the face a little (narrow railed decks)
        const t = lo + pad + k * STEP;
        for (const o of [0, 0.3, -0.3, 0.55, -0.55]) { const c = tryAt(t + o); if (c) { out.push(c); break; } }
      }
    }
  }
  return out;
}
for (const c of COOPS) c.y0 = c.y0 || 0;
const COOP_ALL = COOPS.concat(genCoops());
const COOP_G = COOP_ALL.map(coopGeom);
const TR_SOLO = { ld: 1, mt: 1, md: 1, gp: 1, rp: 1 };
const ON_LINE = (k) => k === 'gp' || k === 'rp';
const meNet = () => ({ s: mySlot, x: me.x, z: me.z, y: me.y, tk: me.tr ? me.tr.k : '', ti: me.tr ? me.tr.i : -1 });
const netOf = (s) => (s === mySlot ? meNet() : others[s] && others[s].on ? others[s] : null);
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
// co-op options at spots i0..i1-1 (nearest wins). strict = hand-placed 2P wall (bigger zones, solo hint, kneel any time).
// Generated spots stay out of the way: no solo hint, kneel only while facing the wall with the pistol holstered and a
// partner within 12 m, never while the gun is drawn (ACT = fire) - except climbing onto a partner who's already kneeling.
function coopMode(i0, i1, ps) {
  let best = null, bd = 1e9;
  const pick = (m, i, d, o) => { if (d < bd) { bd = d; best = { m, i, o: o ? o.s : -1 }; } };
  for (let i = i0; i < i1; i++) {
    const c = COOP_ALL[i], g = COOP_G[i], strict = !c.gen;
    if (Math.abs(me.y - c.y0) < 0.3) {
      const dB = hz(me, g.base); if (dB > (strict ? 1.5 : 1.15)) continue;
      if (!ps.length) { if (strict) pick('solo2p', i, dB); continue; }
      const kn = ps.find((o) => o.tk === 'kn' && o.ti === i);
      if (kn) { pick('boost', i, dB - 1, kn); continue; }                                                     // partner kneels: climb on
      if (strict || !me.eq) {
        const up = ps.find((o) => Math.abs(o.y - c.top) < 0.25 && hz(o, g.edge) < (strict ? 1.6 : 1.2) && !o.tk);
        if (up) { pick('hoist', i, dB - 0.5, up); continue; }                                                 // partner up top: get pulled
      }
      const facing = Math.abs(angDiff(c.a, me.a)) < 0.9, nearby = ps.some((o) => hz(o, me) < 12);
      if (strict ? dB < 1.1 : !me.eq && facing && nearby && dB < 0.95) pick('kneel', i, dB);
    } else if (Math.abs(me.y - c.top) < 0.2 && (strict || !me.eq)) {
      const dE = hz(me, g.edge); if (dE > (strict ? 1.3 : 1.0)) continue;
      const lo = ps.find((o) => Math.abs(o.y - c.y0) < 0.3 && hz(o, g.base) < (strict ? 2.4 : 1.6) && !o.tk);
      if (lo) pick('pull', i, dE, lo);
    }
  }
  return best;
}
// what ACT would start right now (null = nothing climbable here).
// m: climb down mantle rappel haul ropeup ropewait kneel boost hoist pull solo2p   (o = partner slot for co-op moves)
function travMode() {
  if (!role || world.phase !== 'play' || me.td || me.tr || me.tun >= 0 || me.sw || me.vy !== 0) return null;
  const ps = partnerHere() ? peers() : [];
  let down = null, downD = 1e9; // ladder top vs a grapple ring close by: the nearer one wins
  for (let i = 0; i < CLIMBS.length; i++) {
    const c = CLIMBS[i], dd = Math.hypot(me.x - c.lx, me.z - c.lz);
    if (Math.abs(me.y - c.y0) < 0.3 && hz(me, c) < 0.85) return { m: 'climb', i };
    if (Math.abs(me.y - c.top) < 0.2 && dd < 0.8 && dd < downD) { down = { m: 'down', i }; downD = dd; }
  }
  // grapple lines are TOP-ONLY: top ring = rappel down, or haul a partner who waits at the foot ring up the rope.
  // Foot ring = only a pickup point: a partner on the top ring can haul you (ROPE UP); alone it just explains the rule.
  for (let i = 0; i < LINKS.length; i++) {
    const L = LINKS[i], fb = { x: L.foot.x - L.dx * 0.12, z: L.foot.z - L.dz * 0.12 }, db = hz(me, fb), dt = hz(me, L.landP);
    const busy = ps.some((o) => (ON_LINE(o.tk) || o.tk === 'hr' || o.tk === 'hp') && o.ti === i);
    if (Math.abs(me.y - L.top) < 0.25 && dt < 0.7 && dt < downD) {
      const lo = !busy && ps.find((o) => Math.abs(o.y - L.y0) < 0.3 && hz(o, L.foot) < 1.6 && !o.tk);
      if (lo) return { m: 'haul', i, o: lo.s };
      if (dt < 0.55) return { m: 'rappel', i };
    }
    if (Math.abs(me.y - L.y0) < 0.25 && db < 0.75 && db < downD) {
      const up = !busy && ps.find((o) => Math.abs(o.y - L.top) < 0.3 && hz(o, L.landP) < 1.3 && !o.tk);
      if (up) return { m: 'ropeup', i, o: up.s };
      if (!me.eq) return { m: 'ropewait', i };
    }
  }
  if (down) return down;
  const hand = coopMode(0, COOPS.length, ps); if (hand) return hand; // marked 2P wall (after ladders / rope rings: those zones are tight)
  const ms = mantleSpot(me); if (ms) return { m: 'mantle', i: -1, s: ms };
  return coopMode(COOPS.length, COOP_ALL.length, ps);
}
function startTrav(tm) {
  if (me.sw) return;
  const keep = { ox: me.x, oy: me.y, oz: me.z };
  const solo1 = (k, i, extra) => {
    if (peers().some((o) => o.ti === i && ((o.tk === k && k === 'ld') || (ON_LINE(o.tk) && ON_LINE(k))))) { toast('Partner is on it - wait', 1000, '#ffb36b'); return; } // host-side rule (guest also re-checked by host)
    me.tr = Object.assign({ k, i, t: 0 }, keep, extra); stopMe(); me.c = me.p = false; syncStanceButtons();
    if (role === 'guest') net.relay({ t: 'tr', k, i });
  };
  const c = CLIMBS[tm.i];
  switch (tm.m) {
    case 'climb': me.x = c.x; me.z = c.z; me.a = c.a; solo1('ld', tm.i, {}); beep(300, 0.04, 'square', 0.04); break;
    case 'down': solo1('md', tm.i, { dur: TRAV.downT * 1.6, sx: me.x, sy: me.y, sz: me.z, tx: c.x, ty: c.top - TRAV.hangBelow, tz: c.z }); me.a = c.a; break;
    case 'mantle': { const m = tm.s; me.a = m.a; solo1('mt', -1, { dur: TRAV.mantleT, sx: me.x, sy: me.y, sz: me.z, tx: m.x, ty: m.y, tz: m.z }); break; }
    case 'rappel': { const L = LINKS[tm.i];
      solo1('rp', tm.i, { s: { x: me.x, y: me.y, z: me.z }, a0: me.a, ph: 'sq', pt: 0, u: 0, ly: L.hang, dir: 0, last: -1, sf: 0, my: 0 });
      if (me.tr) beep(200, 0.06, 'triangle', 0.05); break; }
    case 'haul': requestCoop('rope', tm.i, tm.o, mySlot); break;
    case 'ropeup': requestCoop('rope', tm.i, mySlot, tm.o); break;
    case 'ropewait': toast('Grapple is top-only - a partner on the roof ring can haul you up', 1700, '#ffb36b'); break;
    case 'kneel': { const g = COOP_G[tm.i]; me.x = g.base.x; me.z = g.base.z; me.a = COOP_ALL[tm.i].a + Math.PI; stopMe(); me.c = me.p = false; syncStanceButtons();
      me.tr = { k: 'kn', i: tm.i, t: 0 }; toast('Kneeling - partner: ACT here to climb on', 1400, '#ffd27f'); break; }
    case 'boost': requestCoop('boost', tm.i, mySlot, tm.o); break;
    case 'hoist': requestCoop('pull', tm.i, mySlot, tm.o); break;
    case 'pull': requestCoop('pull', tm.i, tm.o, mySlot); break;
    case 'solo2p': toast('Too high to climb alone - needs a partner boost (2P)', 1600, '#ffb36b'); break;
  }
}
function trAct() {
  const T = me.tr;
  if (T.k === 'ld') { me.tr = null; me.fallFrom = me.y; const c = CLIMBS[T.i]; me.x -= Math.cos(c.a) * 0.3; me.z -= Math.sin(c.a) * 0.3; me.vy = -0.01; } // let go
  else if (T.k === 'kn') me.tr = null;
  else if (ON_LINE(T.k) && T.ph === 'line') { // let go of the rope: near the bottom = step off, higher = drop (a standing drop thuds)
    const L = LINKS[T.i];
    if (T.ly - L.y0 < 0.45) lineEnter(T, 'land');
    else { me.tr = null; me.x = L.foot.x - L.dx * 0.28; me.z = L.foot.z - L.dz * 0.28; me.a = L.a + Math.PI; me.fallFrom = me.y; me.vy = -0.01; beep(220, 0.05, 'triangle', 0.05); }
  }
}
function requestCoop(k, i, climber, helper) {
  if (role === 'host') { if (!hostCoop(k, i, climber, helper)) toast('Can\'t - get in position', 900, '#ffb36b'); }
  else net.relay({ t: 'co', k, i, c: climber, h: helper });
}
const ROPE_DUR = (L) => 1.4 + (L.lip - L.y0) * 0.5; // haul time grows with the height
// host: validate + start a co-op climb between two slots (host's view: own me + last guest packets).
function hostCoop(kind, i, climber, helper) {
  if (world.phase !== 'play' || world.co || !peerConnected || climber === helper) return false;
  const cl = netOf(climber), hp = netOf(helper); if (!cl || !hp) return false;
  if (kind === 'rope') { // haul up a grapple line: helper on the top ring, climber at the foot, nobody else on that rope
    const L = LINKS[i]; if (!L) return false;
    if (Math.abs(cl.y - L.y0) > 0.35 || hz(cl, L.foot) > 2.0 || cl.tk || Math.abs(hp.y - L.top) > 0.35 || hz(hp, L.landP) > 1.6 || hp.tk) return false;
    if ([0, 1, 2, 3, 4].some((s) => { const o = netOf(s); return o && (ON_LINE(o.tk) || o.tk === 'hr' || o.tk === 'hp') && o.ti === i; })) return false;
    world.co = { id: ++world.coId, k: 'rope', i, c: climber, h: helper, t: 0, dur: ROPE_DUR(L) };
  } else {
    const c = COOP_ALL[i], g = COOP_G[i]; if (!c) return false;
    if (Math.abs(cl.y - c.y0) > 0.3 || hz(cl, g.base) > 2.6 || (cl.tk && cl.tk !== 'kn')) return false;
    if (kind === 'boost' && !(hp.tk === 'kn' && hp.ti === i)) return false;
    if (kind === 'pull' && !(Math.abs(hp.y - c.top) < 0.3 && hz(hp, g.edge) < 1.8 && !hp.tk)) return false;
    world.co = { id: ++world.coId, k: kind, i, c: climber, h: helper, t: 0, dur: kind === 'boost' ? TRAV.boostT : TRAV.pullT };
  }
  applyCo(world.co); sendState(); return true;
}
// both sides: take your half of a host co-op move (climber or helper), on the host's clock
const CO_K = { boost: ['bs', 'lf'], pull: ['hs', 'pl'], rope: ['hr', 'hp'] };
function applyCo(co) {
  lastCoId = co.id;
  const mine = mySlot, climb = co.c === mine;
  if (co.c !== mine && co.h !== mine) return;
  const K = CO_K[co.k] || CO_K.pull;
  me.tr = { k: climb ? K[0] : K[1], i: co.i, t: co.t || 0, dur: co.dur, id: co.id, sx: me.x, sz: me.z };
  if (co.k === 'rope' && climb) { // hauled climber lands beside the puller (along the lip), not on top of him
    const L = LINKS[co.i], tx = -L.dz, tz = L.dx; let lp = null;
    for (const sd of [0.6, -0.6]) { const x = L.landP.x + tx * sd, z = L.landP.z + tz * sd; if (!lp && Math.abs(groundAt(x, z, L.top) - L.top) < 0.02) lp = { x, z }; }
    me.tr.lx = lp ? lp.x : L.landP.x - L.dx * 0.35; me.tr.lz = lp ? lp.z : L.landP.z - L.dz * 0.35;
  }
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
      me.y = clamp(me.y + clamp(up * 1.3, -1, 1) * TRAV.climbSpeed[c.kind] * dt, c.y0, hang); // y0: ladders can start on a deck
      me.x = c.x; me.z = c.z; me.a = c.a; me.moving = Math.abs(me.y - y0) > 1e-4;
      if (Math.floor(me.y / 0.32) !== Math.floor(y0 / 0.32)) beep(c.kind === 'pipe' ? 520 : 240, 0.025, 'square', 0.03);
      if (me.y >= hang - 1e-3 && up > 0.3) me.tr = { k: 'mt', i: T.i, t: 0, dur: TRAV.topVaultT, sx: me.x, sy: me.y, sz: me.z, tx: c.lx, ty: c.top, tz: c.lz };
      else if (me.y <= c.y0 + 1e-3 && up < -0.3) { me.tr = null; me.x -= Math.cos(c.a) * 0.35; me.z -= Math.sin(c.a) * 0.35; }
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
    case 'gp': case 'rp': lineStep(T, dt, jx, jz, mag); break;
    case 'kn': { const g = COOP_G[T.i]; me.x = g.base.x; me.z = g.base.z; me.a = COOP_ALL[T.i].a + Math.PI; if (mag > 0.6) me.tr = null; break; }
    case 'hr': case 'hp': ropeStep(T); break;
    default: coopStep(T);
  }
}
// vertical grapple line. Entry (throw / tug, or hook-set / over the edge) is a short automated sequence; then the
// player drives it: up (W / stick up, or push into the wall) climbs, down descends, nothing = hang still. Up at the top
// mantles over the lip, down at the bottom lands. ACT on the line = let go (trAct).
function lineEnter(T, ph) {
  const up = T.k === 'gp';
  T.ph = ph; T.pt = 0; T.u = 0;
  if (ph === 'throw') beep(320, 0.12, 'sawtooth', 0.025);                       // whoosh
  if (ph === 'set' && up) { beep(1500, 0.04, 'square', 0.06); beep(700, 0.05, 'square', 0.04); } // claw bites
  if (ph === 'over') beep(1300, 0.04, 'square', 0.05);
  if (ph === 'line') { T.dir = 0; T.sf = 0; T.last = up ? 1 : -1; beep(420, 0.04, 'triangle', 0.04); }
  if (ph === 'mantle') { T.my = T.ly; beep(160, 0.05, 'sine', 0.06); }
  if (ph === 'land') { T.my = T.ly; beep(110, 0.08, 'sine', 0.1); }
}
// rope stick axis: screen up / down (W / S) is up / down the rope; sideways input counts only if it pushes into / away from the wall
function lineAxis(L, jx, jz, mag) {
  if (mag < 0.15) return 0;
  if (Math.abs(jz) >= 0.35) return -jz;
  const d = jx * L.dx + jz * L.dz; return Math.abs(d) > 0.35 ? d : 0;
}
function lineStep(T, dt, jx, jz, mag) {
  const L = LINKS[T.i], up = T.k === 'gp';
  T.pt += dt;
  if (T.ph !== 'line') {
    const D = lineDur(T.k, T.ph), u = Math.min(1, T.pt / D); T.u = u;
    lineAutoPos(L, T.k, T.ph, u, T.s, T.my, _gp); me.x = _gp.x; me.y = _gp.y; me.z = _gp.z;
    const face = up ? L.a : L.a + Math.PI; // up: square up to the wall. down: face the drop to set the hook, then turn your back to it
    me.a = T.ph === 'sq' ? T.a0 + angDiff(face, T.a0) * ss01(u * 1.4) : !up && T.ph === 'set' ? face : !up && T.ph === 'over' ? face + angDiff(L.a, face) * ss01(u / 0.3) : L.a;
    if (up && T.ph === 'set' && T.tug !== Math.floor(u * 2)) { T.tug = Math.floor(u * 2); beep(500, 0.03, 'square', 0.03); } // two tug tests
    if (u < 1) return;
    if (T.ph === 'mantle') { me.x = L.landP.x; me.y = L.top; me.z = L.landP.z; me.a = L.a; me.tr = null; return; }
    if (T.ph === 'land') { me.x = L.foot.x; me.y = L.y0; me.z = L.foot.z; me.a = L.a + Math.PI; me.tr = null; return; }
    const E = LINE_ENTRY[T.k], nx = E[E.indexOf(T.ph) + 1];
    T.ly = up ? L.y0 : L.hang; lineEnter(T, nx || 'line');
    return;
  }
  // ---- on the line: player-driven
  const ax = lineAxis(L, jx, jz, mag), want = Math.abs(ax) > 0.3 ? Math.sign(ax) : 0;
  if (want > 0 && T.ly >= L.hang - 1e-3) { lineEnter(T, 'mantle'); return lineStep(T, 0, 0, 0, 0); }
  if (want < 0 && T.ly <= L.y0 + 1e-3) { lineEnter(T, 'land'); return lineStep(T, 0, 0, 0, 0); }
  if (want) {
    if (want !== T.last) { T.sf = 0; T.last = want; } // switched direction: start a fresh pull / bound
    const rate = want > 0 ? GRAPPLE.upRate : GRAPPLE.dnRate, step = want > 0 ? GRAPPLE.upStep : GRAPPLE.dnStep, hold = want > 0 ? GRAPPLE.upHold : GRAPPLE.dnHold;
    const f0 = T.sf; let f1 = f0 + dt * rate / step, dist;
    if (f1 >= 1) { dist = step * (1 - strokeAt(f0, hold)); f1 -= 1; dist += step * strokeAt(f1, hold); beep(want > 0 ? 240 + (T.ly - L.y0) * 30 : 180, 0.03, 'triangle', 0.03); } // a pull / a bound lands
    else dist = step * (strokeAt(f1, hold) - strokeAt(f0, hold));
    T.sf = f1; T.dir = want;
    T.ly = clamp(T.ly + want * dist, L.y0, L.hang);
  } else { // hang still. Mid-bound: swing back in and plant the boots
    T.dir = 0;
    if (T.last < 0) T.sf = T.sf >= 0.7 ? 0 : Math.max(0, T.sf - dt * 2.2);
  }
  const off = T.last < 0 ? kickAt(T.sf) : 0;
  me.x = L.foot.x - L.dx * off; me.z = L.foot.z - L.dz * off; me.y = T.ly; me.a = L.a;
}
// co-op choreography (both sides read the same host clock T.t, so the two bodies line up)
function coopStep(T) {
  const c = COOP_ALL[T.i], g = COOP_G[T.i], u = Math.min(1, T.t / T.dur), y0 = c.y0 || 0;
  const hang = Math.max(y0 + 0.4, c.top - 1.9), lift = y0 + Math.min(1.0, (hang - y0) * 0.6); // feet height with hands on the lip / in the boost
  const mantle = (k, y0) => { me.y = mixv(y0, c.top, ss01(k / 0.6)); const h = ss01((k - 0.35) / 0.65); me.x = mixv(g.hang.x, g.land.x, h); me.z = mixv(g.hang.z, g.land.z, h); };
  if (T.k === 'bs') { // climber: step into the hands, get thrown up, catch the lip, mantle
    me.a = c.a;
    if (u < 0.22) { const k = ss01(u / 0.22); me.x = mixv(T.sx, g.step.x, k); me.z = mixv(T.sz, g.step.z, k); me.y = y0; me.moving = true; }
    else if (u < 0.5) { const k = ss01((u - 0.22) / 0.28); me.x = mixv(g.step.x, g.hang.x, k); me.z = mixv(g.step.z, g.hang.z, k); me.y = mixv(y0, lift, k); }
    else if (u < 0.75) { const k = ss01((u - 0.5) / 0.25); me.x = g.hang.x; me.z = g.hang.z; me.y = mixv(lift, hang, k); }
    else mantle((u - 0.75) / 0.25, hang);
  } else if (T.k === 'hs') { // climber: grab the partner's hands, get hauled up, mantle
    me.a = c.a;
    if (u < 0.15) { const k = ss01(u / 0.15); me.x = mixv(T.sx, g.hang.x, k); me.z = mixv(T.sz, g.hang.z, k); me.y = y0; me.moving = true; }
    else if (u < 0.7) { me.x = g.hang.x; me.z = g.hang.z; me.y = mixv(y0, hang, ss01((u - 0.15) / 0.55)); }
    else mantle((u - 0.7) / 0.3, hang);
  } else if (T.k === 'lf') { me.x = g.base.x; me.z = g.base.z; me.y = y0; me.a = c.a + Math.PI; }
  else if (T.k === 'pl') { const k = ss01(u / 0.12); me.x = mixv(T.sx, g.edge.x, k); me.z = mixv(T.sz, g.edge.z, k); me.y = c.top; me.a = c.a + Math.PI; }
  if (u >= 1) { if (T.k === 'bs' || T.k === 'hs') { me.x = g.land.x; me.z = g.land.z; me.y = c.top; } me.tr = null; }
}
// ROPE HAUL (top-only grapple, co-op): hp = puller - squares up on the top ring facing the drop, claw on the lip, hauls
// hand over hand. hr = partner at the foot: steps to the rope, rises with it (y0 -> hang), then mantles over beside the puller.
function ropeStep(T) {
  const L = LINKS[T.i], u = Math.min(1, T.t / T.dur);
  if (T.k === 'hp') { const k = ss01(u / 0.12); me.x = mixv(T.sx, L.landP.x, k); me.z = mixv(T.sz, L.landP.z, k); me.y = L.top; me.a = L.a + Math.PI; }
  else {
    me.a = L.a;
    if (u < 0.12) { const k = ss01(u / 0.12); me.x = mixv(T.sx, L.foot.x, k); me.z = mixv(T.sz, L.foot.z, k); me.y = L.y0; me.moving = true; }
    else if (u < 0.82) { me.x = L.foot.x; me.z = L.foot.z; me.y = mixv(L.y0, L.hang, ss01((u - 0.12) / 0.7)); }
    else { const k = (u - 0.82) / 0.18; me.y = mixv(L.hang, L.top, ss01(k / 0.6)); const h = ss01((k - 0.35) / 0.65); me.x = mixv(L.foot.x, T.lx, h); me.z = mixv(L.foot.z, T.lz, h); }
  }
  if (u >= 1) { if (T.k === 'hr') { me.x = T.lx; me.z = T.lz; me.y = L.top; beep(150, 0.05, 'sine', 0.06); } me.tr = null; }
}
const TR_STANCE = { ld: 'CLIMBING (push into it = up, away = down · ACT let go)', mt: 'MANTLE', md: 'CLIMBING DOWN', gp: 'GRAPPLE', rp: 'RAPPEL',
  kn: 'KNEELING - BOOST READY (move = stand)', bs: 'BOOSTED UP', lf: 'BOOSTING PARTNER', hs: 'BEING PULLED UP', pl: 'PULLING PARTNER UP',
  hr: 'BEING HAULED UP THE ROPE', hp: 'HAULING PARTNER UP THE ROPE' };
const GP_STANCE = { gp: { sq: 'GRAPPLE - SQUARING UP', throw: 'GRAPPLE - THROWING HOOK', set: 'GRAPPLE - HOOK SET, TESTING' },
  rp: { sq: 'RAPPEL - SQUARING UP', set: 'RAPPEL - SETTING HOOK', over: 'RAPPEL - OVER THE EDGE' },
  any: { mantle: 'ROPE - OVER THE LIP', land: 'ROPE - BOOTS DOWN' } };
const ROPE_KEYS = () => (isTouch ? 'stick up / down' : 'W / S');
function lineStance(T) {
  if (T.ph !== 'line') return GP_STANCE[T.k][T.ph] || GP_STANCE.any[T.ph] || TR_STANCE[T.k];
  const L = LINKS[T.i], h = (T.ly - L.y0).toFixed(1) + 'm';
  return (T.dir > 0 ? 'ROPE - CLIMBING ' : T.dir < 0 ? 'ROPE - DESCENDING ' : 'ROPE - HANGING ') + h + ' (' + ROPE_KEYS() + ' · ACT let go)';
}
const travStance = () => (ON_LINE(me.tr.k) ? lineStance(me.tr) : TR_STANCE[me.tr.k] || '');
// progress 0..1 for the wire (remote pose / rope)
function trProg(T, y, raw) {
  if (!T) return 0;
  if (T.k === 'ld') return r2(y);
  if (ON_LINE(T.k)) { const v = lineEncode(T); return raw ? v : Math.round(v * 1000) / 1000; } // phase + motion slot + stroke, fine steps
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
    case 'pl': case 'hp': return { k: 'pull', p: tp };
    case 'hr': return tp < 0.12 ? null : tp < 0.82 ? { k: 'rope', ph: tp * 40, up: 1 } : { k: 'mantle', p: (tp - 0.82) / 0.18 };
    case 'gp': case 'rp': { if (!LINKS[ti]) return null; const up = tk === 'gp', P = lineDecode(tp);
      switch (P.ph) {
        case 'sq': return up ? { k: 'throw', p: 0 } : null;
        case 'throw': return { k: 'throw', p: P.u };
        case 'set': return up ? { k: 'tug', p: P.u } : { k: 'hookset', p: P.u };
        case 'over': return { k: 'mantle', p: 1 - clamp((P.u - 0.3) / 0.7, 0, 1) };
        case 'line': return P.last > 0 ? { k: 'rope', ph: P.sf * Math.PI, up: 1 } : { k: 'rope', ph: P.sf * Math.PI * 2, up: 0 }; // still = frozen mid-stroke
        case 'mantle': return { k: 'mantle', p: 0.2 + P.u * 0.8 };
        case 'land': return { k: 'kneel' };
      }
      return null; }
    case 'bs': return tp < 0.22 ? null : tp < 0.5 ? { k: 'climb', ph: tp * 22 } : tp < 0.75 ? { k: 'hang', ph: tp * 9 } : { k: 'mantle', p: (tp - 0.75) / 0.25 };
    case 'hs': return tp < 0.15 ? null : tp < 0.7 ? { k: 'hang', ph: tp * 9 } : { k: 'mantle', p: (tp - 0.7) / 0.3 };
  }
  return null;
}

// ---------------------------------------------------------------- host simulation (authoritative)
function players() {
  const low = (tk) => tk === 'kn' || tk === 'lf' || tk === 'pl';
  const mine = swimCode(me.sw, me.dive);
  // surface swim reads as a crouch (lower, quieter); a dive reads as prone. Same floor, so cones stay flat.
  const list = [{ x: me.x, z: me.z, y: me.y, box: me.box && !me.sw, c: me.c || me.box || low(me.tr && me.tr.k) || mine === 1, p: me.p || mine === 2, tun: me.tun, noise: noiseOf(me), idx: mySlot, rope: ON_LINE(me.tr && me.tr.k), v: Math.hypot(me.vx, me.vz) }];
  for (const o of peers()) list.push({ x: o.x, z: o.z, y: o.y, box: !!o.box && !o.sw, c: o.c || !!o.box || low(o.tk) || o.sw === 1, p: o.p || o.sw === 2, tun: tunAt(o.x, o.z, o.y), noise: o.noise, idx: o.s, rope: ON_LINE(o.tk), v: Math.hypot(o.nvx, o.nvz) });
  return list;
}
function armSwitch(pi) {
  const p = pOf(pi); if (!p) return;
  SWITCHES.forEach((s, i) => {
    if (Math.abs((p.y || 0) - s.y) < 0.3 && Math.hypot(p.x - s.x, p.z - s.z) < 1.8) { world.sw[i] = SWITCH_WINDOW; world.swBy[i] = pi; }
  });
  if (!world.door && world.sw[0] > 0 && world.sw[1] > 0 && (solo || world.swBy[0] !== world.swBy[1])) world.door = true;
  if (solo && !world.door && (world.sw[0] > 0 || world.sw[1] > 0)) world.door = true;
}
function triggerAlert(p) {
  if (world.alert < 2) { world.alerts++; }
  world.alert = 2; world.alertT = ALERT_TIME;
  for (const g of world.guards) if (alive(g) && !(g.stun > 0)) { g.st = 'chase'; g.tx = p.x; g.tz = p.z; g.give = 8; }
}
// DAMAGE (host-authoritative). Being spotted no longer ends anything: LIFE reaching 0 = KIA = GAME OVER for both
// players (co-op). Host decides; hp + phase 'over' ride every state packet, and a hit pushes one immediately.
function damagePlayer(idx, dmg, kind) {
  if (world.phase !== 'play' || world.hp[idx] <= 0 || world.hitInv[idx] > 0) return false;
  world.hp[idx] = Math.max(0, world.hp[idx] - dmg); world.dmg[idx] += dmg;
  world.hitInv[idx] = kind === 'melee' ? FAMAS.meleeInv : FAMAS.hitInv;
  if (world.hp[idx] <= 0) { world.caught++; world.dead = idx; world.kb = kind; world.phase = 'over'; world.finalT = world.t; }
  if (peerConnected) sendState(); // push immediately so both screens update together
  return true;
}
// guard FAMAS: pick the nearest live player in range with line of sight (chase + ALERT only), turn + shoulder the
// rifle (g.shooting = feet planted), wait FAMAS.aim, then a burst of FAMAS.burst rounds FAMAS.rof apart, cooldown.
// A burst that started keeps going down the last line even if you duck out of sight.
function guardGun(g, gi, ps, dt) {
  const F = FAMAS;
  g.fcd = Math.max(0, (g.fcd || 0) - dt);
  let tgt = null, td = 1e9;
  if (g.st === 'chase' && world.alert === 2) for (const p of ps) {
    if (world.inv[p.idx] > 0 || p.tun >= 0 || world.hp[p.idx] <= 0) continue;
    const d = Math.hypot(p.x - g.x, p.z - g.z);
    if (p.box && p.v < 0.35 && d > 1.6) continue; // a still box is just a box
    if (d > F.range || d < F.minR || d >= td || !lineOfSight(g, p)) continue;
    tgt = p; td = d;
  }
  if (g.bl > 0) { // mid-burst
    if (tgt) turnToward(g, Math.atan2(tgt.z - g.z, tgt.x - g.x), dt * 3);
    g.ftT -= dt;
    while (g.bl > 0 && g.ftT <= 0 && world.phase === 'play') { guardFire(g, gi, tgt, td); g.bl--; g.bk++; g.ftT += F.rof; }
    if (g.bl <= 0) { g.bl = 0; g.fcd = F.cool + Math.random() * F.coolRand; }
    g.shooting = true; return;
  }
  if (!tgt || g.st !== 'chase') { g.aimT = 0; g.shooting = false; return; }
  g.shooting = true; g.tx = tgt.x; g.tz = tgt.z; g.give = 8;
  turnToward(g, Math.atan2(tgt.z - g.z, tgt.x - g.x), dt * F.turn);
  g.aimT += dt;
  if (g.aimT >= F.aim && g.fcd <= 0 && Math.abs(angDiff(Math.atan2(tgt.z - g.z, tgt.x - g.x), g.a)) < 0.25) { g.bl = F.burst; g.bk = 0; g.ftT = 0; }
}
function guardFire(g, gi, tgt, d) {
  const F = FAMAS, k = g.bk, mv = tgt ? Math.min(1, (tgt.v || 0) / 4) : 0;
  const spread = F.spread + F.climbYaw * k + F.moveSpread * mv, err = (Math.random() * 2 - 1) * spread;
  const a = (tgt ? Math.atan2(tgt.z - g.z, tgt.x - g.x) : g.a) + err;
  let hit = false, ex, ez, ey;
  if (tgt) {
    const hw = tgt.p ? 0.22 : tgt.c ? 0.28 : 0.32, vt = tgt.p ? 0.25 : tgt.c ? 0.4 : 0.55; // body half-width / half-height
    hit = Math.abs(err) < Math.atan2(hw, Math.max(0.3, d)) && F.climb * k * d < vt; // muzzle climb: later rounds sail high
    if (hit) { ex = tgt.x; ez = tgt.z; ey = targetY(tgt) + (Math.random() - 0.5) * 0.2; damagePlayer(tgt.idx, F.dmg, 'gun'); }
  }
  if (!hit) { const e = rayEnd(g.x, g.z, a, F.range + 4); ex = e.x; ez = e.z; ey = (g.y || 0) + Math.min(3.2, 1.1 + F.climb * k * Math.hypot(ex - g.x, ez - g.z) * 1.4); }
  // loud: keeps ALERT topped up and drags nearby guards in
  world.alertT = ALERT_TIME;
  for (const o of world.guards) if (o !== g && alive(o) && o.st !== 'chase' && Math.hypot(o.x - g.x, o.z - g.z) < F.noise) { o.st = 'chase'; o.tx = tgt ? tgt.x : g.tx; o.tz = tgt ? tgt.z : g.tz; o.give = 8; }
  const msg = { t: 'gs', g: gi, ex: r2(ex), ez: r2(ez), ey: r2(ey), h: hit ? 1 : 0 };
  guardShotFx(msg); if (peerConnected) net.relay(msg);
}
// both roles: tracer from the guard's FAMAS muzzle, recoil on his model, distance-scaled crack
function guardShotFx(d) {
  const m = guardMeshes[d.g], g = world.guards[d.g]; if (!m || !g) return;
  m.shot = (m.shot || 0) + 1; m.g.updateMatrixWorld(true);
  gunFx(m, d.ex, d.ez, !!d.h, d.ey, true);
  const dist = Math.hypot((g.rx ?? g.x) - me.x, (g.rz ?? g.z) - me.z);
  rifleSound(clamp(1.1 - dist / 22, 0.15, 1));
  if (dist < 9) shake = Math.max(shake, 0.05);
}
function hostUpdate(dt) {
  if (world.phase !== 'play') return;
  world.t += dt;
  world.inv = world.inv.map((v) => Math.max(0, v - dt));
  world.hitInv = world.hitInv.map((v) => Math.max(0, v - dt));
  world.sw = world.sw.map((v) => Math.max(0, v - dt));
  if (world.co) { world.co.t += dt; if (world.co.t > world.co.dur + 0.4) world.co = null; } // co-op climb clock
  for (const n of world.nades) { n.t -= dt; if (n.t <= 0) nadeBlast(n); }
  world.nades = world.nades.filter((n) => n.t > 0);
  const ps = players();
  let anySeen = false;
  for (const g of world.guards) {
    if (g.st === 'dead') continue;
    if (g.st === 'held') { // being taken down: frozen, blind, deaf. Drops dead when the hold finishes.
      g.tdT += dt; g.shooting = false; g.bl = 0;
      if (g.tdT >= TD.time) killGuard(g, g.by, true);
      continue;
    }
    if (g.stun > 0) { // knocked out (stun flash / tranq dart): blind, deaf, frozen. Wakes up confused -> investigates
      g.stun -= dt; g.shooting = false; g.bl = 0; g.aimT = 0; g.meter = 0;
      if (g.stun <= 0) { g.stun = 0; g.ko = 0; g.st = 'investigate'; g.wait = 4; g.give = 6; g.tx = g.tx || g.x; g.tz = g.tz || g.z; }
      continue;
    }
    // --- sight
    // (3D for anyone off the ground: roofs / gantry / ladders / ropes are in view if inside his vertical cone + not occluded)
    let seen = null, seenD = 1e9, seenRange = 1, seenUp = 0;
    for (const p of ps) {
      if (world.inv[p.idx] > 0 || p.tun >= 0) continue; // nobody sees into the crawlspaces
      const v = guardSees(g, p);
      if (v && p.box && p.v < 0.35 && !(world.alert === 2 && v.d < 1.6)) continue; // a still cardboard box is just a box
      if (v && v.d < seenD) { seen = p; seenD = v.d; seenRange = v.range; seenUp = v.up; }
    }
    const offLvl = seen && Math.abs((seen.y || 0) - (g.y || 0)) > 0.3;
    g.seeUp = offLvl ? 1 : 0;
    if (seen) {
      anySeen = true;
      // looking up = slower to be sure of what he saw (and calm guards aren't scanning rooftops)
      const upK = offLvl ? (1 - SIGHT_V.slowUp * seenUp) * (world.alert === 0 ? SIGHT_V.calmUp : 1) : 1;
      const rate = (world.alert === 2 ? 6 : world.alert === 1 ? 2.2 : 1.3) * (1 + 2 * (1 - seenD / seenRange)) * (seen.box ? 0.5 : seen.p ? 0.35 : seen.c ? 0.6 : 1) * upK;
      g.meter = Math.min(1, g.meter + rate * dt);
      if (g.meter >= 1) { triggerAlert(seen); }
      if (world.alert === 2) { g.st = 'chase'; g.tx = seen.x; g.tz = seen.z; g.give = 8; world.alertT = ALERT_TIME; }
      else if (g.meter > 0.3 && g.st !== 'chase') { g.st = 'investigate'; g.tx = seen.x; g.tz = seen.z; g.wait = 3; g.give = 7; }
    } else g.meter = Math.max(0, g.meter - 0.3 * dt);
    // --- hearing
    if (g.st === 'patrol' || g.st === 'investigate' || g.st === 'search') {
      for (const p of ps) if (p.noise > 0 && g.stun <= 0 && Math.hypot(p.x - g.x, p.z - g.z, (p.y || 0) - (g.y || 0)) < p.noise) {
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
      if (g.shooting) { /* feet planted, FAMAS up (guardGun turns him) */ }
      else if (moveToward(g, g.tx, g.tz, SPEED.chase, dt) || g.give <= 0 || g.stuck > 1) { g.st = 'search'; g.wait = 2.5; }
    } else if (g.st === 'search') {
      g.a += dt * 2.4; g.wait -= dt;
      if (g.wait <= 0) {
        const h = g.home, x1 = h ? h[0] : MAP.x1 + 2, x2 = h ? h[1] : MAP.x2 - 2, z1 = h ? h[2] : MAP.z1 + 2, z2 = h ? h[3] : MAP.z2 - 2;
        g.st = 'chase'; g.tx = clamp(g.x + (Math.random() - 0.5) * 10, x1, x2); g.tz = clamp(g.z + (Math.random() - 0.5) * 10, z1, z2); g.give = 4;
      }
    }
    // --- FAMAS (ALERT chase with line of sight)
    guardGun(g, world.guards.indexOf(g), ps, dt);
    // --- melee: a chasing guard that reaches you clubs you with the rifle (damage + i-frames; no more instant "caught")
    if (world.alert === 2 && world.phase === 'play') for (const p of ps) if (!(p.box && p.v < 0.35) && world.inv[p.idx] <= 0 && p.tun < 0 && Math.abs((p.y || 0) - (g.y || 0)) < 0.6 && Math.hypot(p.x - g.x, p.z - g.z) < FAMAS.meleeR) {
      if (damagePlayer(p.idx, FAMAS.melee, 'melee')) { const gm = guardMeshes[world.guards.indexOf(g)]; if (gm) gm.shot = (gm.shot || 0) + 1; }
    }
    if (world.phase !== 'play') return;
  }
  // --- alert phases
  if (world.alert === 2 && !anySeen) { world.alertT -= dt; if (world.alertT <= 0) { world.alert = 1; world.cautionT = CAUTION_TIME; world.guards.forEach((g) => { if (alive(g) && !(g.stun > 0)) { g.st = 'patrol'; g.meter = 0; } }); } }
  else if (world.alert === 1) { world.cautionT -= dt; if (world.cautionT <= 0) world.alert = 0; }
  // --- extract
  const atExt = (p) => Math.abs((p.y || 0) - EXTRACT.y) < 0.4 && Math.hypot(p.x - EXTRACT.x, p.z - EXTRACT.z) < EXTRACT.r;
  // puzzles stay 2-agent: the door + any TWO players on the pad wins (solo: 1). Extra players are free agents.
  world.ext = others.map((o, s) => (s === mySlot ? atExt(me) : o.on && atExt(o)));
  if (world.door && world.ext.filter(Boolean).length >= extNeed()) { world.phase = 'win'; world.finalT = world.t; }
}
function hostRestart() {
  clearBlood(); clearGearFx();
  world = freshWorld();
  me.x = SPAWNS[0].x; me.z = SPAWNS[0].z; me.tun = -1; stopMe(); resetLoadout(); settleSpawn(); lastCoId = -1;
  for (const o of peers()) { const sp = SPAWNS[o.s]; o.x = o.rx = sp.x; o.z = o.rz = sp.z; o.nvx = o.nvz = 0; net.relay({ t: 'tp', x: sp.x, z: sp.z, silent: true }, o.s); }
  sendState();
}

// ---------------------------------------------------------------- network
const r2 = (v) => Math.round(v * 100) / 100;
const extNeed = () => (solo ? 1 : Math.min(2, 1 + peers().length)); // players needed on the extract pad
// per-slot player array (same layout the old 2-player `h` used): [x, z, a, crouch, prone, vx, vz, takedown, aiming, drawn, y, tk, ti, tp]
const plMe = () => [r2(me.x), r2(me.z), r2(me.a), me.c ? 1 : 0, me.p ? 1 : 0, r2(me.vx), r2(me.vz), tdProg(), me.gunT > 0 ? 1 : 0, me.eq ? 1 : 0,
  r2(me.y), me.tr ? me.tr.k : '', me.tr ? me.tr.i : -1, trProg(me.tr, me.y), me.box ? 1 : 0, wkey(), swimCode(me.sw, me.dive)];
const plOf = (o) => [r2(o.x), r2(o.z), r2(o.a), o.c ? 1 : 0, o.p ? 1 : 0, r2(o.nvx), r2(o.nvz), o.td ?? -1, o.gd ? 1 : 0, o.eq ? 1 : 0, r2(o.y || 0), o.tk || '', o.ti ?? -1, o.tp || 0, o.box ? 1 : 0, o.w || '', o.sw || 0];
function sendState() {
  net.relay({ t: 's',
    g: world.guards.map((g) => [r2(g.x), r2(g.z), r2(g.a), g.st[0], r2(g.meter), r2(g.tdT || 0), g.shooting ? 1 : 0, g.ko || 0, g.loot || 0]), // [7] = ko (1 stunned, 2 asleep); [8] = loot bundle once down; st[0]: p i c s h(eld) d(ead); [6] = FAMAS shouldered
    al: world.alert, at: r2(world.alertT), sw: world.sw.map(r2), door: world.door, ph: world.phase, tm: r2(world.t), ft: r2(world.finalT), dd: world.dead,
    c: world.caught, n: world.alerts, ext: world.ext, solo, k: world.kills, hp: world.hp, dm: world.dmg, kb: world.kb,
    // h[4] = prone, h[5..6] = velocity, h[7] = takedown progress (-1 none), h[8] = aiming (just fired), h[9] = pistol drawn
    // (older clients ignore the extras)
    // h[10] = feet height, h[11..13] = traversal move code / index / progress. co = host co-op climb [id, kind, spot, climber, helper, t, dur]
    h: plMe(), // host (P1) - kept for old clients
    pl: others.map((o, s) => (s === mySlot ? 0 : o.on ? plOf(o) : 0)), // every guest slot (0 = empty); a guest skips its own
    c4: world.c4.map((c) => [c.id, r2(c.x), r2(c.y), r2(c.z), c.by]),
    co: world.co ? [world.co.id, world.co.k[0], world.co.i, world.co.c, world.co.h, r2(world.co.t), world.co.dur] : 0 });
}
const tdProg = () => (me.td ? r2(Math.min(1, me.td.t / TD.time)) : -1);
function sendPlayer() { net.relay({ t: 'p', x: r2(me.x), z: r2(me.z), a: r2(me.a), c: me.c ? 1 : 0, p: me.p ? 1 : 0, n: noiseOf(me), vx: r2(me.vx), vz: r2(me.vz),
  td: tdProg(), gd: me.gunT > 0 ? 1 : 0, eq: me.eq ? 1 : 0, y: r2(me.y), tk: me.tr ? me.tr.k : '', ti: me.tr ? me.tr.i : -1, tp: trProg(me.tr, me.y), bx: me.box ? 1 : 0, w: wkey(), sw: swimCode(me.sw, me.dive) }); }
function netTrav(o, y, tk, ti, tp) { o.y = y || 0; o.tk = tk || ''; o.ti = ti ?? -1; o.tp = tp || 0; }
// a teammate fired: tracer + recoil on their model (host also applies the hit)
function remoteShot(d, by) {
  const o = others[by]; if (!o || by === mySlot) return; o.shot++; o.gd = 1; if (d.w) o.w = d.w;
  const W = WPN[d.w] || WPN.p9;
  gunFx(meshOf(by), d.ex, d.ez, d.g >= 0, d.g >= 0 && GUARDS[d.g] ? GUARDS[d.g].y + 1.15 : null, !!W.rifle, W.tranq ? 0x9fe0ff : null);
  const vol = clamp(1 - Math.hypot(d.x - me.x, d.z - me.z) / 26, 0.15, 0.6); W.rifle ? rifleSound(vol) : W.quiet ? suppSound(vol) : gunSound(vol);
}
function readPl(o, h) { netSample(o, h[0], h[1], h[5], h[6]); o.a = h[2]; o.c = !!h[3]; o.p = !!h[4]; o.td = h[7] ?? -1; o.gd = h[8] || 0; o.eq = h[9] ?? (o.gd ? 1 : 0); netTrav(o, h[10], h[11], h[12], h[13]); o.box = h[14] || 0; o.w = h[15] == null ? '' : h[15]; o.sw = h[16] || 0; }
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
  const from = d.from ?? 1, fo = others[from]; // guest -> host packets are tagged with the sender's slot by server.js
  if (role === 'host' && d.t !== 's' && (!fo || from === 0)) return;
  if (d.t === 'p' && role === 'host') { netSample(fo, d.x, d.z, d.vx, d.vz); fo.a = d.a; fo.c = !!d.c; fo.p = !!d.p; fo.noise = d.n || 0; fo.td = d.td ?? -1; fo.gd = d.gd || 0; fo.eq = d.eq ?? (fo.gd ? 1 : 0); netTrav(fo, d.y, d.tk, d.ti, d.tp); fo.box = d.bx || 0; fo.w = d.w || ''; fo.sw = d.sw || 0; }
  else if (d.t === 'tr' && role === 'host') { // guest solo climb / rope: veto if someone's already on that ladder / rope, it's over, or a ground grapple (top-only)
    const on = (k, i) => i === d.i && ((k === d.k && d.k === 'ld') || ((ON_LINE(k) || k === 'hr' || k === 'hp') && ON_LINE(d.k)));
    const busy = (me.tr && on(me.tr.k, me.tr.i)) || peers().some((o) => o.s !== from && on(o.tk, o.ti));
    if (busy || d.k === 'gp' || world.phase !== 'play') net.relay({ t: 'trx', gp: d.k === 'gp' ? 1 : 0 }, from);
  }
  else if (d.t === 'trx' && role === 'guest') { const T = me.tr; if (T && TR_SOLO[T.k]) { me.x = T.ox ?? me.x; me.y = T.oy ?? 0; me.z = T.oz ?? me.z; me.tr = null; toast(d.gp ? 'Grapple is top-only' : 'Someone is on that line', 1000, '#ffb36b'); } }
  else if (d.t === 'co' && role === 'host') { if (!hostCoop(d.k, d.i, d.c ?? from, d.h ?? 0)) net.relay({ t: 'cox' }, from); }
  else if (d.t === 'cox' && role === 'guest') toast('Can\'t - get in position', 900, '#ffb36b');
  else if (d.t === 'td' && role === 'host') { // guest takedown request: re-check (lenient) against the authoritative guard
    const g = world.guards[d.g], p = { x: d.x, z: d.z, tun: -1 };
    const ok = g && alive(g) && !fo.sw && !waterVolume(d.x, d.z, 0) && Math.abs((fo.y || 0) - (g.y || 0)) < 0.6 && Math.hypot(p.x - g.x, p.z - g.z) < TD.lenRange && (g.ko || Math.abs(angDiff(Math.atan2(p.z - g.z, p.x - g.x), g.a)) > TD.lenBehind);
    if (!ok || !hostTakedown(d.g, from)) net.relay({ t: 'tdx' }, from);
    else { fo.x = d.x; fo.z = d.z; fo.td = 0; }
  }
  else if (d.t === 'tdx' && role === 'guest') { if (me.td) { me.td = null; toast('Spotted - grab failed', 1000, '#ffb36b'); } }
  else if (d.t === 'sh') {
    if (role === 'host') { remoteShot(d, from); hostShot(d, from); net.relay(Object.assign({}, d, { by: from, from: undefined })); } // echo to the other guests
    else remoteShot(d, d.by ?? 0);
  }
  else if (d.t === 'gs' && role === 'guest') guardShotFx(d);
  else if (d.t === 'ng' && role === 'host') hostNade(d, from);         // guest threw a stun grenade
  else if (d.t === 'ngx' && role === 'guest') { if (d.by !== mySlot) nadeFx(d); }
  else if (d.t === 'bx' && role === 'guest') blastFx(d);               // grenade flash / C4 blast fx
  else if (d.t === 'c4p' && role === 'host') hostC4(d, from);
  else if (d.t === 'c4d' && role === 'host') hostDet(from);
  else if (d.t === 'heal' && role === 'host') hostHeal(from);
  else if (d.t === 'i' && role === 'host') { if (world.phase === 'play') armSwitch(from); }
  else if (d.t === 'r' && role === 'host') { if (world.phase !== 'play') hostRestart(); }
  else if (d.t === 's' && role === 'guest') {
    d.g.forEach((a, i) => { const g = world.guards[i]; if (!g) return; netSample(g, a[0], a[1]); g.a = a[2]; g.st = { p: 'patrol', i: 'investigate', c: 'chase', s: 'search', h: 'held', d: 'dead' }[a[3]]; g.meter = a[4]; g.tdT = a[5] || 0; g.shooting = !!a[6]; g.ko = a[7] || 0; if (a.length > 8) g.loot = a[8] || 0; });
    world.c4 = (d.c4 || []).map(([id, x, y, z, by]) => ({ id, x, y, z, by }));
    const pad = (v, f) => { const r = Array(NP).fill(f); (v || []).forEach((x, i) => { if (i < NP) r[i] = x; }); return r; };
    Object.assign(world, { alert: d.al, alertT: d.at, sw: d.sw, door: d.door, phase: d.ph, t: d.tm, finalT: d.ft, caught: d.c, alerts: d.n, ext: pad(d.ext, false), dead: d.dd ?? -1, kills: d.k || 0,
      hp: pad(d.hp, HP_MAX), dmg: pad(d.dm, 0), kb: d.kb || '' });
    solo = d.solo;
    readPl(others[0], d.h);
    if (d.pl) d.pl.forEach((h, s) => { if (s && s !== mySlot && h && others[s]) readPl(others[s], h); });
    if (d.co) {
      const [id, k, i, c, h, t, dur] = d.co; world.co = { id, k: { b: 'boost', p: 'pull', r: 'rope' }[k] || 'pull', i, c, h, t, dur };
      if (id !== lastCoId) applyCo(world.co);
      else if (me.tr && me.tr.id === id && Math.abs(me.tr.t - t) > 0.25) me.tr.t = t; // drift: follow the host clock
    } else world.co = null;
  } else if (d.t === 'tp' && role === 'guest') {
    me.x = d.x; me.z = d.z; me.tun = -1; me.y = 0; me.vy = 0; me.tr = null; me.sw = false; me.dive = 0; me.splash = 0; lastCoId = -1; stopMe(); settleSpawn(); if (!d.silent) toast('CAUGHT! Back to start', 1600);
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
      else ws.send(JSON.stringify({ t: 'join', code: roomCode, slot: mySlot || undefined })); // reconnect: ask for my old slot back
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === 'msg') onGameMsg(m.d);
      else if (m.t === 'created' || m.t === 'joined') { roomCode = m.code; mySlot = m.slot ?? (m.t === 'created' ? 0 : 1); setRoster(m.slots || [true, !!m.peer]); enterGame(); }
      else if (m.t === 'roster') setRoster(m.slots);
      else if (m.t === 'peer-joined') { if (others[m.slot ?? 1]) others[m.slot ?? 1].on = true; setRoster(null); if (role === 'host') sendState(); }
      else if (m.t === 'peer-left') { const o = others[m.slot ?? (role === 'host' ? 1 : 0)]; if (o) { o.on = false; o.tk = ''; } setRoster(null); }
      else if (m.t === 'pong') { this.rtt = performance.now() - m.ts; $('ping').textContent = Math.round(this.rtt) + 'ms'; }
      else if (m.t === 'error') { this.fatal = true; ws.close(); showLobby(m.msg); }
    };
    ws.onclose = () => {
      if (this.fatal || !role) { this.fatal = false; return; }
      setRoster([]); $('peerStatus').textContent = 'reconnecting...';
      this.retry++; setTimeout(() => this.connect(), Math.min(5000, 400 * this.retry));
    };
    ws.onerror = () => { if (!roomCode && role) { /* first connect failed */ } };
  },
  relay(d, to) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(to != null ? { t: 'relay', d, to } : { t: 'relay', d })); }, // host: to = one guest slot
};
// iOS freezes background tabs; when we come back make sure the socket is alive.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && role && net.ws && net.ws.readyState > 1) net.connect();
});

// roster from server.js: slots[s] = connected (slot 0 = host). null = just refresh from others[].on
function setRoster(slots) {
  if (slots) others.forEach((o, s) => { const on = !!slots[s] && s !== mySlot; if (o.on && !on) o.tk = ''; if (!o.on && on) o.snap = true; o.on = on; });
  const n = peers().length, hostIn = mySlot === 0 || others[0].on;
  peerConnected = n > 0;
  const el = $('peerStatus');
  el.textContent = solo ? 'solo test' : role === 'host' ? (n + 1) + '/' + NP + ' in' : !hostIn ? 'host offline' : (n + 1) + '/' + NP + ' in';
  el.className = (role === 'host' ? n > 0 : hostIn) || solo ? 'good' : 'bad';
  $('btnShare').classList.toggle('hidden', role !== 'host' || n >= NP - 1 || solo);
  $('slotTag').textContent = role ? 'P' + (mySlot + 1) : '';
  $('slotTag').style.color = hexCss(PLAYER_LOOK[mySlot].accent);
}

// ---------------------------------------------------------------- lobby / UI
function joinLink() { return location.origin + location.pathname + '?room=' + roomCode + (qs.get('server') ? '&server=' + encodeURIComponent(qs.get('server')) : ''); }
function showLobby(msg) {
  role = null; world = freshWorld(); lastPhase = 'play'; lastAlert = 0; peerConnected = false; mySlot = 0; fpsOn = false; syncViewButton();
  for (const o of others) { o.on = false; o.tk = ''; }
  me.c = false; me.p = false; me.tun = -1; stopMe(); resetLoadout(); syncStanceButtons(); clearGearFx(); $('lobby').classList.remove('hidden'); $('hud').classList.add('hidden'); $('overlay').classList.add('hidden');
  $('lobbyMsg').textContent = msg || '';
}
function enterGame() {
  if (!$('lobby').classList.contains('hidden')) {
    $('lobby').classList.add('hidden'); $('hud').classList.remove('hidden');
    const s = SPAWNS[mySlot] || SPAWNS[1]; me.x = s.x; me.z = s.z; stopMe(); resetLoadout(); settleSpawn();
    if (role === 'host' && !solo) toast('Room ' + roomCode + ' - share the link', 2500, '#7fff9f');
    setTimeout(() => { if (role && world.phase === 'play' && !me.wpn) toast('UNARMED — swim to CINDER. P-9 locker is on her deck', 2800, '#ffd27f'); }, role === 'host' && !solo ? 1800 : 500);
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
  role = 'guest'; roomCode = c; mySlot = 0; $('lobbyMsg').textContent = 'Joining ' + c + '...'; net.connect();
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
  const t = world.finalT, a = world.alerts, c = world.caught, dm = world.dmg.reduce((x, y) => x + (y || 0), 0);
  if (a === 0 && c === 0 && dm === 0 && t < 240) return 'PHANTOM';
  if (a <= 1 && c === 0 && dm < 40) return 'SHADOW';
  if (a <= 3 && c <= 2) return 'OPERATIVE';
  return 'ROOKIE';
}
const myIdx = () => mySlot;
function fmtTime(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; }
function updateOverlay() {
  if (world.phase !== lastPhase && world.phase !== 'play') {
    const btn = $('ovBtn'); closeInv(true); me.box = false; me.burst = 0;
    if (world.phase === 'win') {
      beep(523, 0.15, 'triangle', 0.1); setTimeout(() => beep(784, 0.3, 'triangle', 0.1), 160);
      $('overlay').classList.remove('over');
      $('ovTitle').textContent = 'MISSION COMPLETE';
      const dmg = world.dmg.reduce((x, y) => x + (y || 0), 0);
      $('ovBody').innerHTML = `Time ${fmtTime(world.finalT)}<br>Alerts ${world.alerts} &middot; Kills ${world.kills} &middot; Damage taken ${dmg}<br>Rank: <b>${rank()}</b>`;
      btn.textContent = 'RUN IT AGAIN';
    } else if (world.phase === 'over') {
      beep(220, 0.25, 'sawtooth', 0.1); setTimeout(() => beep(110, 0.6, 'sawtooth', 0.1), 220);
      if (navigator.vibrate) navigator.vibrate([300, 100, 500]);
      input.jx = input.jz = 0; input.keys.clear();
      $('overlay').classList.add('over');
      const how = world.kb === 'melee' ? 'beaten down by a guard' : world.kb === 'c4' ? 'caught in a C4 blast' : 'cut down by FAMAS fire';
      const who = solo || world.dead === myIdx() ? `You were killed in action &mdash; ${how}.` : `P${world.dead + 1} ${PLAYER_LOOK[world.dead] ? PLAYER_LOOK[world.dead].name : ''} is KIA &mdash; ${how}.`;
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
  const W = radar.width, H = radar.height, sx = W / (MAP.x2 - MAP.x1), sz = H / (MAP.z2 - MAP.z1);
  const X = (x) => (x - MAP.x1) * sx, Z = (z) => (z - MAP.z1) * sz;
  rc.fillStyle = world.alert === 2 ? 'rgba(70,12,12,0.94)' : 'rgba(4, 20, 32, 0.94)'; rc.fillRect(0, 0, W, H);
  rc.fillStyle = world.alert === 2 ? 'rgba(130, 36, 36, 0.45)' : 'rgba(14, 72, 98, 0.92)';
  for (const w of WATERS) rc.fillRect(X(w.x1), Z(w.z1), (w.x2 - w.x1) * sx, (w.z2 - w.z1) * sz);
  rc.fillStyle = '#3c7a55';
  for (const b of solids()) rc.fillRect(X(b.x1), Z(b.z1), (b.x2 - b.x1) * sx, (b.z2 - b.z1) * sz);
  rc.fillStyle = 'rgba(216,176,40,0.35)'; // tunnels
  for (const t of TUNNELS) rc.fillRect(X(t.x1), Z(t.z1), (t.x2 - t.x1) * sx, (t.z2 - t.z1) * sz);
  for (const b of WALKS) { // catwalks / bridges: L1 pale blue, L2 brighter, L3 almost white
    rc.fillStyle = b.h > 8 ? 'rgba(230,245,255,0.85)' : b.h > 5 ? 'rgba(190,235,255,0.7)' : 'rgba(120,200,255,0.45)';
    rc.fillRect(X(b.x1), Z(b.z1), (b.x2 - b.x1) * sx, (b.z2 - b.z1) * sz);
  }
  rc.fillStyle = 'rgba(190,235,255,0.35)'; // tower roofs (L2 / L3)
  for (const b of WALLS) if (b.kind === 'building' && b.h > 5) rc.fillRect(X(b.x1), Z(b.z1), (b.x2 - b.x1) * sx, (b.z2 - b.z1) * sz);
  rc.fillStyle = '#ffd040'; for (const c of CLIMBS) rc.fillRect(X(c.x) - 1.5, Z(c.z) - 1.5, 3, 3); // ladders / pipe
  for (const c of COOPS) rc.fillRect(X(c.x) - 2.5, Z(c.z) - 1, 5, 2);
  rc.fillStyle = '#ff9a30'; // grapple anchors (vertical lines up a wall face)
  for (const L of LINKS) { rc.beginPath(); rc.arc(X(L.anchor.x), Z(L.anchor.z), 2.2, 0, 7); rc.fill(); }
  rc.strokeStyle = '#7fff9f'; rc.beginPath(); rc.arc(X(EXTRACT.x), Z(EXTRACT.z), EXTRACT.r * sx, 0, 7); rc.stroke();
  for (const g of world.guards) {
    if (!alive(g)) { rc.fillStyle = '#777'; rc.fillRect(X(g.rx) - 2, Z(g.rz) - 1, 5, 2); continue; }
    rc.fillStyle = 'rgba(255,224,102,0.35)'; rc.beginPath(); rc.moveTo(X(g.rx), Z(g.rz));
    rc.arc(X(g.rx), Z(g.rz), SIGHT.stand * sx, g.ra - SIGHT.fovHalf, g.ra + SIGHT.fovHalf); rc.fill();
    rc.fillStyle = '#ff5050'; rc.fillRect(X(g.rx) - 2, Z(g.rz) - 2, 4, 4);
    if (g.y > 0.3) { rc.strokeStyle = g.y > 8 ? '#ffffff' : g.y > 5 ? '#ffe0c0' : '#ffb0b0'; rc.strokeRect(X(g.rx) - 3.5, Z(g.rz) - 3.5, 7, 7); } // up on a deck / roof
    if (g.loot && g.st === 'dead' && dropMeshes[i] && !dropMeshes[i].taken) { rc.fillStyle = '#ffb060'; rc.fillRect(X(dropMeshes[i].x) - 1.5, Z(dropMeshes[i].z) - 1.5, 3, 3); }
  }
  for (const pk of pickups) if (pk.on) { rc.fillStyle = Math.abs(pk.y - me.y) < 1 ? '#7fd6ff' : 'rgba(127,214,255,0.5)'; rc.fillRect(X(pk.x) - 1.5, Z(pk.z) - 1.5, 3, 3); }
  for (const c of world.c4 || []) if (c.by === mySlot) { rc.fillStyle = (performance.now() / 250 | 0) % 2 ? '#ff3030' : '#601010'; rc.fillRect(X(c.x) - 2, Z(c.z) - 2, 4, 4); }
  for (const o of peers()) { rc.fillStyle = hexCss(PLAYER_LOOK[o.s].accent); rc.fillRect(X(o.rx) - 3, Z(o.rz) - 3, 6, 6); }
  rc.fillStyle = '#ffffff'; rc.fillRect(X(me.x) - 3, Z(me.z) - 3, 6, 6);
}

// ---------------------------------------------------------------- GEAR: map pickups, box / grenade / C4 visuals, gear menu
// PICKUPS (per player, local): a floating icon card over a small olive crate (or a grey locker) + ring. Walk over it
// to take it. Ammo-type spots respawn (re seconds); unique gear is there once per mission per player. Both teammates
// can take each spot. Guard drops (below) use the same grant, but the host decides when the body has loot.
const crateMat = mat(0x5a6a3a), lockerMat = mat(0x4a5560), pickRingMat = new THREE.MeshBasicMaterial({ color: 0x7fd6ff, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
const iconTex = {};
function gearTex(id) {
  if (!iconTex[id]) {
    const t = new THREE.CanvasTexture(iconCanvas(id)); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
    iconTex[id] = t;
  }
  return iconTex[id];
}
const pickups = PICKUPS.map((d) => {
  const y = groundAt(d.x, d.z, d.lv + 0.05), g = new THREE.Group(); g.position.set(d.x, y, d.z);
  const crate = d.locker
    ? new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.92, 0.34), lockerMat)
    : new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.3), crateMat);
  crate.position.y = d.locker ? 0.46 : 0.13; g.add(crate);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 16), pickRingMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring);
  const card = new THREE.Sprite(new THREE.SpriteMaterial({ map: gearTex(d.id), depthTest: true })); card.scale.set(0.95, 0.6, 1); card.position.y = d.locker ? 1.25 : 0.85; g.add(card);
  scene.add(g); return { ...d, y, g, card, baseY: card.position.y, on: true, t: 0 };
});
function resetPickups() { for (const p of pickups) { p.on = true; p.t = 0; p.g.visible = true; } }
// what `n` of id adds right now (0 = full / already carrying a toggle)
function itemGain(id, n) {
  const it = ITEMS[id]; if (!it || n <= 0) return 0;
  const have = me.inv[id] ?? -1;
  if (it.tog || !it.max) return have >= 1 ? 0 : 1;
  return Math.max(0, Math.min(n, it.max - Math.max(0, have)));
}
function pickupGain(p) {
  if (p.ammo && (me.inv[p.id] ?? -1) < 0) return 0; // ammo for a gun you don't carry yet
  return itemGain(p.id, p.n);
}
// add whatever fits. The first weapon / item you find fills the empty slot but stays holstered.
function grantItems(entries) {
  const got = [];
  for (const [id, n] of entries) {
    const g = itemGain(id, n); if (g <= 0) continue;
    const fresh = (me.inv[id] ?? -1) < 0;
    me.inv[id] = Math.max(0, me.inv[id]) + g;
    const it = ITEMS[id];
    if (fresh && it.kind === 'wpn' && !me.wpn) { me.wpn = id; me.eq = false; }
    if (fresh && it.kind === 'item' && !me.itm) me.itm = id;
    got.push(it.tog ? it.name : it.name + ' +' + g);
  }
  if (got.length) syncGunButton();
  return got;
}
function updatePickups(dt) {
  const now = performance.now() / 1000;
  for (const p of pickups) {
    if (!p.on) { if (p.re && (p.t -= dt) <= 0) { p.on = true; p.g.visible = true; } continue; }
    p.card.position.y = p.baseY + Math.sin(now * 3 + p.x) * 0.08;
    if (me.tr || me.tun >= 0 || Math.abs(me.y - p.y) > 0.7 || Math.hypot(me.x - p.x, me.z - p.z) > 0.8) continue;
    const n = pickupGain(p), it = ITEMS[p.id];
    if (n <= 0) { if (!p.full || now - p.full > 3) { p.full = now; toast(it.name + ' FULL', 700, '#ccc'); } continue; }
    const fresh = (me.inv[p.id] ?? -1) < 0;
    grantItems([[p.id, n]]);
    p.on = false; p.g.visible = false; p.t = p.re || 0;
    pickupSound();
    toast((p.locker ? 'LOCKER  ' : 'GOT ') + (it.tog ? it.name : it.name + (p.ammo ? ' AMMO' : '') + '  +' + n), 1200, '#7fd6ff');
    if (fresh && isTouch) setTimeout(() => toast('GEAR menu: equip ' + it.name, 1200, '#9fd9b0'), 1250);
  }
  updateDrops(dt);
}
// BODY LOOT. One mesh per guard. The host rolls g.loot when the guard dies; every client shows it until THAT player
// has searched the body (per player, same as crates — a partner still gets their own search). Nothing respawns.
const dropRingMat = new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide });
const dropMeshes = GUARDS.map(() => {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.48, 14), dropRingMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; g.add(ring);
  const card = new THREE.Sprite(new THREE.SpriteMaterial({ map: gearTex('fr5'), depthTest: true })); card.scale.set(0.85, 0.54, 1); card.position.y = 0.7; g.add(card);
  g.visible = false; scene.add(g);
  return { g, card, x: 0, z: 0, y: 0, code: 0, taken: false };
});
function resetDrops() { for (const d of dropMeshes) { d.taken = false; d.code = 0; d.g.visible = false; } }
function updateDrops(dt) {
  const now = performance.now() / 1000;
  for (let i = 0; i < world.guards.length; i++) {
    const g = world.guards[i], d = dropMeshes[i]; if (!d) continue;
    const show = g.st === 'dead' && g.loot && !d.taken;
    if (show && d.code !== g.loot) {
      d.code = g.loot; d.x = g.x; d.z = g.z; d.y = g.y || 0;
      d.g.position.set(d.x, d.y, d.z);
      const icon = LOOT_ICON[g.loot]; if (icon) d.card.material.map = gearTex(icon);
    }
    d.g.visible = !!show; if (!show) continue;
    d.card.position.y = 0.7 + Math.sin(now * 3 + i) * 0.06;
    if (me.tr || me.tun >= 0 || world.phase !== 'play' || Math.abs(me.y - d.y) > 0.8 || Math.hypot(me.x - d.x, me.z - d.z) > 0.95) continue;
    const bundle = LOOT[g.loot]; if (!bundle) continue;
    const got = grantItems(Object.entries(bundle));
    if (!got.length) { if (!d.full || now - d.full > 3) { d.full = now; toast('NOTHING YOU CAN CARRY', 700, '#ccc'); } continue; }
    d.taken = true; d.g.visible = false;
    pickupSound();
    toast('BODY  ' + got.join('  '), 1400, '#ffb060');
  }
}
// CARDBOARD BOX: one per slot, worn over the rig (sneaker hidden while it's on)
const boxTex = pixTex(32, (x, S) => {
  x.fillStyle = '#9c7a45'; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) { x.fillStyle = rnd() < 0.5 ? '#8a6a3a' : '#ab8a52'; x.fillRect(rnd() * S | 0, rnd() * S | 0, 2, 1); }
  x.fillStyle = '#c8b07a'; x.fillRect(13, 0, 6, S); // tape
  x.fillStyle = '#6a2a18'; x.fillRect(3, 6, 7, 2); x.fillRect(3, 10, 5, 2); x.fillRect(22, 22, 7, 2); // stencil marks
  x.fillStyle = '#5a4020'; x.fillRect(0, 0, S, 1); x.fillRect(0, S - 1, S, 1);
});
const boxMat = new THREE.MeshLambertMaterial({ map: boxTex, flatShading: true });
const cboxes = Array.from({ length: NP }, () => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.68, 0.62), boxMat); m.visible = false; scene.add(m); return m; });
function placeBox(m, on, x, y, z, a, moving, k) {
  m.visible = on; if (!on) return;
  const t = performance.now() / 1000, w = moving ? Math.sin(t * 14) : 0;
  m.position.set(x, y + 0.34 + Math.abs(w) * 0.03, z); m.rotation.set(0, -a, w * 0.05);
  m.scale.setScalar(0.6 + 0.4 * k);
}
// STUN GRENADES in flight (fx only; the host owns the fuse) + BLASTS (flash / fireball spheres) + planted C4 bricks
const nadeMeshes = Array.from({ length: 6 }, () => {
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), mat(0x2f4a2a)); m.visible = false; scene.add(m); return { m, t: 0, d: null };
});
function nadeFx(d) {
  const n = nadeMeshes.find((q) => !q.d) || nadeMeshes[0]; n.d = d; n.t = 0; n.m.visible = true;
  if (d.by !== mySlot) beep(300, 0.1, 'triangle', 0.03);
}
const blasts = Array.from({ length: 8 }, () => {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.visible = false; scene.add(m); return { m, t: 0, dur: 1, r: 1, add: true };
});
let blastI = 0, flashT = 0;
function blastAt(x, y, z, r, dur, col, additive = true) {
  const b = blasts[blastI++ % blasts.length]; b.t = dur; b.dur = dur; b.r = r; b.m.visible = true; b.m.position.set(x, y, z);
  b.m.material.color.setHex(col); b.m.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending; b.m.material.needsUpdate = true;
}
function blastFx(d) {
  const dist = Math.hypot(d.x - me.x, d.z - me.z, (d.y - me.y) * 0.8);
  for (const n of nadeMeshes) if (n.d && Math.hypot(n.d.tx - d.x, n.d.tz - d.z) < 0.6) { n.d = null; n.m.visible = false; }
  if (d.k === 'stun') {
    blastAt(d.x, d.y + 0.5, d.z, STUN.r * 0.75, 0.45, 0xffffff); boomSound('stun', clamp(1.2 - dist / 25, 0.2, 1));
    if (dist < STUN.r + 1.5 && me.tun < 0) flashT = Math.max(flashT, 1.2 * (1 - dist / (STUN.r + 1.5)) + 0.3); // you looked at it too
    shake = Math.max(shake, clamp(0.25 - dist * 0.02, 0, 0.25));
  } else {
    blastAt(d.x, d.y + 0.6, d.z, 2.8, 0.7, 0xff8a20); blastAt(d.x, d.y + 0.9, d.z, 2.2, 1.5, 0x3a3430, false);
    boomSound('c4', clamp(1.3 - dist / 30, 0.25, 1)); shake = Math.max(shake, clamp(0.6 - dist * 0.03, 0.08, 0.6));
    if (navigator.vibrate && dist < 12) navigator.vibrate(160);
  }
}
const c4Meshes = Array.from({ length: C4.max }, () => {
  const g = new THREE.Group(); const brick = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.15), mat(0x8a7a52)); brick.position.y = 0.04; g.add(brick);
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.04), new THREE.MeshBasicMaterial({ color: 0xff2020 })); led.position.set(0.06, 0.095, 0); g.add(led);
  g.visible = false; scene.add(g); return { g, led };
});
let healT = 0;
function healFx() { healT = 0.6; beep(523, 0.08, 'triangle', 0.08); setTimeout(() => beep(659, 0.08, 'triangle', 0.08), 90); setTimeout(() => beep(784, 0.16, 'triangle', 0.08), 180); }
function clearGearFx() { for (const n of nadeMeshes) { n.d = null; n.m.visible = false; } for (const b of blasts) { b.t = 0; b.m.visible = false; } flashT = 0; }
function updateGearFx(dt) {
  for (const n of nadeMeshes) {
    if (!n.d) continue; n.t += dt; const d = n.d, k = Math.min(1, n.t / STUN.flight);
    n.m.position.set(mixv(d.x, d.tx, k), mixv(d.y, d.ty + 0.09, k) + Math.sin(k * Math.PI) * 1.6, mixv(d.z, d.tz, k));
    n.m.rotation.x += dt * 14; n.m.rotation.z += dt * 9;
    if (n.t > STUN.flight + STUN.fuse + 1.5) { n.d = null; n.m.visible = false; } // lost the 'bx' packet
  }
  for (const b of blasts) {
    if (b.t <= 0) continue; b.t -= dt; const k = Math.max(0, b.t / b.dur);
    b.m.scale.setScalar(b.r * (0.25 + 0.75 * ss01(1 - k * k))); b.m.material.opacity = k * (b.m.material.blending === THREE.AdditiveBlending ? 0.9 : 0.55);
    if (b.t <= 0) b.m.visible = false;
  }
  const cs = world.c4 || [], blink = (performance.now() / 300 | 0) % 2 === 0;
  c4Meshes.forEach((c, i) => { const d = cs[i]; c.g.visible = !!d; if (d) { c.g.position.set(d.x, d.y, d.z); c.led.visible = blink || d.by !== mySlot; } });
  flashT = Math.max(0, flashT - dt); $('flashOv').style.opacity = Math.min(1, flashT).toFixed(2);
  healT = Math.max(0, healT - dt); $('healOv').style.opacity = (healT / 0.6 * 0.5).toFixed(2);
}
// KO sprites over stunned (*) / sleeping (Z) guards
for (const m of guardMeshes) { m.zz = textSprite('Z', '#9fd0ff'); m.stz = textSprite('*', '#ffffff'); m.zz.visible = m.stz.visible = false; m.g.add(m.zz, m.stz); }

// ---- GEAR MENU (MGS1 equipment screen): GEAR button / I / Tab. Arrows / WASD move, E / Space / Enter = equip or use,
// tap a slot = select, tap it again = equip / use. Solo pauses the world; in co-op the world keeps running (you just stop).
let invOpen = false, invSel = 6, invT = 0, invHash = '';
const invGrid = $('invGrid');
const slotCv = GRID.map((id, i) => {
  const c = document.createElement('canvas'); c.width = SLOT_W; c.height = SLOT_H; c.className = 'slot'; invGrid.appendChild(c);
  c.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); unlockAudio(); if (invSel === i) invAct(); else { invSel = i; menuSound(); invHash = ''; } });
  return c;
});
const invInfo = $('invInfo'), invHead = $('invHead');
function slotState(id) {
  const it = id && ITEMS[id]; if (!it) return {};
  const have = me.inv[id] ?? -1, owned = have >= 0 && !(it.tog && have <= 0);
  const o = { owned, hint: true };
  if (it.max) { o.qty = Math.max(0, have) + '/' + it.max; o.empty = have <= 0; }
  if (it.kind === 'wpn' && me.wpn === id) { o.tag = me.eq ? 'EQ' : 'SET'; o.tagCol = me.eq ? '#c41a1a' : '#5a6068'; }
  if (id === 'p9' && me.sd) o.tag = (o.tag ? o.tag + ' ' : '') + 'SD';
  if ((id === 'box' && me.box) || (id === 'supp' && me.sd) || (id === 'scope' && me.scope) || (id === 'stim' && me.stimT > 0)) { o.tag = 'ON'; o.tagCol = '#2f8f5a'; }
  if (id === 'c4' && myCharges()) { o.tag = myCharges() + ' SET'; o.tagCol = '#b8661a'; }
  if (it.kind === 'item' && me.itm === id && !o.tag) { o.tag = 'SET'; o.tagCol = '#5a6068'; }
  if (it.tog) o.dim = false;
  return o;
}
function wrapText(s, n) { const out = []; let line = ''; for (const w of s.split(' ')) { if ((line + ' ' + w).trim().length > n) { out.push(line); line = w; } else line = (line + ' ' + w).trim(); } if (line) out.push(line); return out; }
function drawInv(force) {
  const blink = (performance.now() / 250 | 0) % 2 === 0;
  const h = JSON.stringify([invSel, blink, me.inv, me.wpn, me.eq, me.itm, me.sd, me.box, me.scope, me.stimT > 0, myCharges()]);
  if (!force && h === invHash) return; invHash = h;
  GRID.forEach((id, i) => drawSlot(slotCv[i].getContext('2d'), id, { ...slotState(id), sel: i === invSel, blink }));
  const id = GRID[invSel], it = id && ITEMS[id], owned = it && slotState(id).owned;
  const x = invInfo.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, invInfo.width, invInfo.height);
  if (it && owned) {
    pixText(x, it.name + (it.kind === 'wpn' ? '  - WEAPON' : '  - ITEM'), 6, 5, '#ffe24a');
    wrapText(it.desc.toUpperCase(), 58).slice(0, 3).forEach((l, i) => pixText(x, l, 6, 17 + i * 10, '#e8ecef'));
  } else pixText(x, it ? 'NOT FOUND YET - SEARCH THE MAP' : '- EMPTY -', 6, 5, '#6a7176');
  const hx = invHead.getContext('2d'); hx.clearRect(0, 0, invHead.width, invHead.height);
  pixText(hx, 'EQUIP', 2, 3, '#fff', 2, '#000');
  const hint = isTouch ? 'TAP AGAIN = USE' : 'ARROWS  E = USE  I = CLOSE'; pixText(hx, hint, invHead.width - textW(hint) - 4, 9, '#9fb0b8');
  const act = $('invAct'), lbl = !it || !owned ? '---' : it.kind === 'wpn' ? (me.wpn === id && me.eq ? 'HOLSTER' : 'EQUIP') : it.tog ? (slotState(id).tag === 'ON' ? 'TURN OFF' : 'USE') : 'USE';
  if (act.textContent !== lbl) act.textContent = lbl; act.disabled = !owned;
  $('invDet').classList.toggle('hidden', !myCharges());
}
function openInv(focus) {
  if (!role || world.phase !== 'play' || invOpen) return;
  invOpen = true; input.keys.clear(); input.jx = input.jz = 0; stickId = null; base.classList.add('hidden'); stopMe();
  const want = focus === 'item' ? me.itm : me.wpn; const i = want ? GRID.indexOf(want) : GRID.indexOf(focus === 'item' ? 'ration' : 'p9'); if (i >= 0) invSel = i;
  $('inv').classList.remove('hidden'); document.body.classList.add('invOpen'); menuSound(1320); drawInv(true);
  $('invPause').textContent = solo ? 'PAUSED' : 'CO-OP: WORLD STILL MOVING';
}
function closeInv(quiet) { if (!invOpen) return; invOpen = false; $('inv').classList.add('hidden'); document.body.classList.remove('invOpen'); if (!quiet) menuSound(660); }
function invAct() {
  const id = GRID[invSel], it = id && ITEMS[id]; if (!it || !slotState(id).owned) { beep(150, 0.04, 'square', 0.05); return; }
  if (it.kind === 'wpn') { if (me.wpn === id && me.eq) toggleGun(); else equipWeapon(id); closeInv(true); }
  else { const stay = it.tog && id !== 'box'; useItem(id); if (!stay) closeInv(true); }
  invHash = '';
}
function invKey(code) {
  if (code === 'Escape' || code === 'KeyI' || code === 'Tab') return closeInv();
  const c = 4, r = GRID.length / c, x = invSel % c, y = (invSel / c) | 0;
  if (code === 'ArrowLeft' || code === 'KeyA') invSel = y * c + (x + c - 1) % c;
  else if (code === 'ArrowRight' || code === 'KeyD') invSel = y * c + (x + 1) % c;
  else if (code === 'ArrowUp' || code === 'KeyW') invSel = ((y + r - 1) % r) * c + x;
  else if (code === 'ArrowDown' || code === 'KeyS') invSel = ((y + 1) % r) * c + x;
  else if (code === 'KeyE' || code === 'Space' || code === 'Enter' || code === 'KeyF') return invAct();
  else if (code === 'KeyT') return detonate();
  else return;
  menuSound(); invHash = '';
}
$('invAct').addEventListener('pointerdown', (e) => { e.preventDefault(); unlockAudio(); invAct(); });
$('invClose').addEventListener('pointerdown', (e) => { e.preventDefault(); closeInv(); });
$('invDet').addEventListener('pointerdown', (e) => { e.preventDefault(); detonate(); invHash = ''; });
$('inv').addEventListener('pointerdown', (e) => { if (e.target.id === 'inv') closeInv(); }); // tap outside the frame
// HUD weapon / item boxes (MGS: weapon bottom-right, item bottom-left)
const wpnCtx = $('wpnBox').getContext('2d'), itemCtx = $('itemBox').getContext('2d');
let hudHash = '';
function drawGearHud() {
  const blink = (performance.now() / 400 | 0) % 2 === 0;
  const h = JSON.stringify([me.inv, me.wpn, me.eq, me.itm, me.sd, me.box, me.scope, me.stimT > 0, myCharges(), me.box && blink]);
  if (h === hudHash) return; hudHash = h;
  const hasW = !!(me.wpn && (me.inv[me.wpn] ?? -1) >= 0);
  const ws = hasW ? slotState(me.wpn) : {};
  drawSlot(wpnCtx, hasW ? me.wpn : null, { ...ws, owned: hasW, dim: !me.eq, tag: hasW ? (me.eq ? (me.wpn === 'p9' && me.sd ? 'SD' : null) : 'OFF') : null, tagCol: '#5a6068' });
  const hasI = !!(me.itm && (me.inv[me.itm] ?? -1) >= 0 && !(ITEMS[me.itm].tog && me.inv[me.itm] <= 0));
  const it = hasI ? slotState(me.itm) : {}; if (it.tag === 'SET') it.tag = null;
  drawSlot(itemCtx, hasI ? me.itm : null, { ...it, owned: hasI, dim: false, sel: !!(me.box && me.itm === 'box'), blink });
}

// ---------------------------------------------------------------- render
// CUTAWAY: a tall building between the camera and a player fades to a see-through ghost (decks do the same in
// traverse.js) so the top-down view stays readable when you are under / behind the L2 towers.
function updateCutaway(dt) {
  const vs = [me]; for (const o of peers()) vs.push({ x: o.rx, y: o.ry || 0, z: o.rz });
  for (const c of cutaway) {
    const b = c.b, hide = vs.some((v) => b.h > v.y + 1.4 && occludes(b, b.h, v, 0.35) && !(v.x > b.x1 && v.x < b.x2 && v.z > b.z1 && v.z < b.z2 && !c.tun));
    const k = c.k + ((hide ? 0.28 : 1) - c.k) * Math.min(1, dt * 7);
    if (Math.abs(k - c.k) < 1e-4 && k === c.k) continue;
    c.k = k > 0.995 ? 1 : k;
    const m = c.m.material, tr = c.k < 1;
    if (m.transparent !== tr) { m.transparent = tr; m.depthWrite = !tr; m.needsUpdate = true; }
    m.opacity = c.k;
  }
}
const CAM_H = 12, CAM_Z = 7.2; // top-down cam height / back-offset before zoom (was 15 / 9)
const topCam = new THREE.Vector3(me.x, CAM_H, me.z + CAM_Z), topLook = new THREE.Vector3(), fpsEye = new THREE.Vector3(), fpsLook = new THREE.Vector3(), camLook = new THREE.Vector3();
const SKY = new THREE.Color(0x07141c), TUNNEL_FOG = new THREE.Color(0x06090a);
let scopeK = 0, fpsK = 0, tunK = 0, camYaw = me.a, eyeH = 0.92, eyeF = 0.12, camY = 0;
// DAMAGE REACTIONS (both roles, purely visual): watch the synced state instead of hooking each damage path, so gun /
// melee / FAMAS hits and host- or guest-side damage all land the same way. A player's LIFE dropping -> blood + flinch
// on that player's rig (attacker = nearest guard); a guard going down -> blood + hit-react (shot kill) or a knife-finish
// burst (takedown). hurtN / hurtA / hurtD on a mesh feed sneaker.js update (s.hurt / s.hurtFrom / s.hurtAmt).
const hpSeen = Array(NP).fill(HP_MAX);
function hurtActor(mesh, fx, fz, amt, fy, blood = true) {
  mesh.hurtN = (mesh.hurtN || 0) + 1; mesh.hurtD = amt;
  mesh.hurtA = Math.atan2(fz - mesh.g.position.z, fx - mesh.g.position.x);
  if (blood) bloodOn(mesh, fx, fz, amt, fy);
}
function hurtCheck() {
  const mi = myIdx();
  for (let i = 0; i < NP; i++) {
    const hp = world.hp[i] ?? HP_MAX, mine = i === mi, mesh = meshOf(i), p = pOf(i);
    if (hp < hpSeen[i] && (mine || others[i].on)) {
      const px = mine ? me.x : p.rx, pz = mine ? me.z : p.rz;
      let src = null, best = 1e9; // attacker: nearest standing guard (shooter / clubber)
      for (const g of world.guards) { if (g.st === 'dead' || g.st === 'held') continue; const d = Math.hypot((g.rx ?? g.x) - px, (g.rz ?? g.z) - pz); if (d < best) { best = d; src = g; } }
      const fx = src ? (src.rx ?? src.x) : px + Math.cos(p.a || 0), fz = src ? (src.rz ?? src.z) : pz + Math.sin(p.a || 0);
      hurtActor(mesh, fx, fz, hpSeen[i] - hp, (mine ? me.y : p.ry) || 0, !(mine && fpsK > 0.3)); // no blood in my own face in first person
    }
    hpSeen[i] = hp;
  }
  world.guards.forEach((g, gi) => {
    const m = guardMeshes[gi]; if (!m) return;
    const prev = m.lastSt; m.lastSt = g.st;
    if (prev === undefined || prev === g.st || g.st !== 'dead' || prev === 'dead') return;
    // killer: host knows g.by (slot); the guests don't get it, so they take the nearest player
    const gx = g.rx ?? g.x, gz = g.rz ?? g.z, cand = [{ x: me.x, z: me.z, s: mi }, ...peers().map((o) => ({ x: o.rx, z: o.rz, s: o.s }))];
    let k = cand[0], bd = 1e9; for (const c of cand) { const d = Math.hypot(c.x - gx, c.z - gz); if (d < bd) { bd = d; k = c; } }
    if (role === 'host' && g.by != null) k = cand.find((c) => c.s === g.by) || cand[0];
    const fy = GUARDS[gi].y;
    if (prev === 'held') bloodOn(m, k.x, k.z, 14, fy); // knife finish: burst, no flinch (the hold already sells it)
    else hurtActor(m, k.x, k.z, 30, fy); // shot dead: big spray + snap back as he drops
  });
}
// which climb spot / grapple ring to highlight (whatever ACT would use)
function travNear() {
  const m = curTm; if (!m || me.tr) return null;
  if (m.m === 'climb' || m.m === 'down') return { kind: 'climb', i: m.i };
  if (m.m === 'rappel' || m.m === 'haul') return { kind: 'linkTop', i: m.i };
  if (m.m === 'ropeup' || m.m === 'ropewait') return { kind: 'link', i: m.i };
  if (m.i >= 0 && m.i < COOPS.length && m.m !== 'mantle') return { kind: 'coop', i: m.i }; // hand-placed 2P walls (generated ones: updateCoopHint)
  return null;
}
const lerpA = (a, b, t) => a + angDiff(b, a) * t;
// generated co-op spot under you (no decal of its own): one shared pulsing chevron ring on the floor / lip you'd use
const coopHint = (() => {
  const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: 0xffd27f, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 20), m); ring.rotation.x = -Math.PI / 2; g.add(ring);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 3), m); arrow.position.y = 0.9; g.add(arrow); // tip points up (= the way you go)
  g.visible = false; scene.add(g); return { g, m, arrow };
})();
function updateCoopHint(dt) {
  const m = curTm, show = !!m && !me.tr && m.i >= COOPS.length && ['kneel', 'boost', 'hoist', 'pull'].includes(m.m);
  coopHint.g.visible = show; if (!show) return;
  const c = COOP_ALL[m.i], g = COOP_G[m.i], top = m.m === 'pull', p = top ? g.edge : g.base;
  coopHint.g.position.set(p.x, (top ? c.top : c.y0) + 0.04, p.z);
  coopHint.arrow.rotation.z = top ? Math.PI : 0; coopHint.arrow.position.y = top ? 0.6 : 0.9;
  coopHint.m.opacity = 0.55 + 0.3 * Math.sin(performance.now() / 160);
}
function render(dt) {
  const k = Math.min(1, dt * 12);
  // remote player smoothing: chase a slightly extrapolated position (last packet + net velocity * packet age, capped)
  const now = performance.now();
  const ext = (o) => { const age = o.pt ? Math.min(0.12, (now - o.pt) / 1000) : 0; return [o.x + (o.nvx || 0) * age, o.z + (o.nvz || 0) * age]; };
  const kr = Math.min(1, dt * 10);
  for (const o of peers()) { const [tx, tz] = ext(o); if (o.snap) { o.rx = tx; o.rz = tz; o.snap = false; } else { o.rx += (tx - o.rx) * kr; o.rz += (tz - o.rz) * kr; } o.ra = lerpA(o.ra, o.a, k); }
  const deadMe = world.phase === 'over' && world.dead === myIdx();
  hurtCheck();
  const mySwim = swimCode(me.sw, me.dive);
  meMesh.g.position.set(me.x, me.y - waterSink(meMesh, mySwim, me.moving, dt), me.z); meMesh.g.rotation.y = -me.a;
  // auto-aim lock (pistol drawn, in play): the arms turn at the shoulders toward it; the laser rides the gun
  const play = world.phase === 'play';
  const myTr = me.tr ? poseFor(me.tr.k, me.tr.i, trProg(me.tr, me.y, 1), me.y) : null, myBusy = !!me.tr; // climbing: hands busy, gun slung
  const myGun = isGun(me.wpn) && !me.box;
  let myAim = aimPoint(me, meMesh, me.eq && myGun && !me.td && !myBusy && play && !deadMe);
  // post-shot laser wobble: the aim point swims around (figure-8) and settles as me.wob decays
  if (me.wob > 0.02 && me.eq && myGun && !myBusy && play && !deadMe) {
    if (!myAim) { meMesh.muzzleWorld(_am); myAim = { x: me.x + Math.cos(me.a) * 5, y: _am.y, z: me.z + Math.sin(me.a) * 5 }; }
    const w = me.wob * me.wob, tt = now / 1000 * 13 + me.wobA, d = Math.hypot(myAim.x - me.x, myAim.z - me.z);
    const side = Math.sin(tt) * 0.16 * w * d, upd = Math.sin(tt * 2 + 1) * 0.35 * w;
    myAim = { x: myAim.x - Math.sin(me.a) * side, y: myAim.y + upd, z: myAim.z + Math.cos(me.a) * side };
  }
  meMesh.update(dt, { aimAt: mySwim ? null : myAim, moving: me.moving && !myTr, run: me.run && !mySwim, speed: myBusy ? (myTr ? 0 : 1.6) : Math.hypot(me.vx, me.vz), crouch: me.c && !me.p && !myBusy && !mySwim, prone: me.p && !myBusy && !mySwim, dead: deadMe, hurt: meMesh.hurtN || 0, hurtFrom: meMesh.hurtA, hurtAmt: meMesh.hurtD,
    takedown: me.td ? Math.min(1, me.td.t / TD.time) : null, aim: !mySwim && (me.eq || me.gunT > 0) && myGun && !myBusy, armed: !mySwim && me.eq && myGun && !myBusy, shot: me.shot, trav: myTr, weapon: wkey(), swim: !!mySwim && !myBusy, dive: mySwim > 1 && !myBusy }); // drawn = always in the forward aim stance
  placeBox(cboxes[mySlot], me.box && play, me.x, me.y, me.z, me.a, me.moving, 1);
  // remote players (up to 4): walk/run animation from the net velocity (smooth), falling back to on-screen motion
  const viewers = [me];
  for (let s = 0; s < NP; s++) {
    if (s === mySlot) continue;
    const o = others[s], mesh = meshOf(s), R = remoteRopes[rk(s)], on = o.on;
    mesh.g.visible = on && !o.box; placeBox(cboxes[s], on && !!o.box && play, o.rx, o.ry, o.rz, o.ra, o.spd > 0.4, 1);
    if (!on) { updateRope(R, mesh, '', -1, 0); updateLaser(remoteLasers[rk(s)], mesh, false, dt); continue; }
    if (dt > 0) { const vNet = Math.hypot(o.nvx, o.nvz), vScr = Math.hypot(o.rx - o.px, o.rz - o.pz) / dt;
      const v = o.pt && now - o.pt < 300 ? vNet : vScr; o.spd += (Math.min(v, 8) - o.spd) * Math.min(1, dt * 8); }
    o.px = o.rx; o.pz = o.rz;
    o.ry = Math.abs(o.y - o.ry) > 4 ? o.y : o.ry + (o.y - o.ry) * kr;
    const oSwim = o.sw || 0;
    mesh.g.position.set(o.rx, o.ry - waterSink(mesh, oSwim, o.spd > 0.4, dt), o.rz); mesh.g.rotation.y = -o.ra;
    const dead = world.phase === 'over' && world.dead === s, busy = !!o.tk, tr = busy ? poseFor(o.tk, o.ti, o.tp, o.ry) : null, oGun = isGun(o.w === 'sd' ? 'p9' : (o.w || '')), armed = !oSwim && !!o.eq && oGun && !o.box && o.td < 0 && !busy && play && !dead;
    const aim = aimPoint({ x: o.rx, z: o.rz, y: o.ry, a: o.ra, tun: tunAt(o.rx, o.rz, o.ry) }, mesh, armed);
    mesh.update(dt, { aimAt: oSwim ? null : aim, moving: o.spd > 0.4 && play && o.td < 0 && !tr, run: !oSwim && o.spd > 4.2 && !o.c, speed: play && o.td < 0 && !tr ? o.spd : 0,
      crouch: !oSwim && o.c && !o.p && !busy, prone: !oSwim && o.p && !busy, dead, hurt: mesh.hurtN || 0, hurtFrom: mesh.hurtA, hurtAmt: mesh.hurtD, takedown: o.td >= 0 ? o.td : null, aim: !oSwim && (!!o.gd || !!o.eq) && oGun && !busy, armed: !oSwim && !!o.eq && oGun && !busy, shot: o.shot, trav: tr, weapon: o.w || '', swim: !!oSwim && !busy, dive: oSwim > 1 && !busy });
    updateRope(R, mesh, o.tk, o.ti, o.tp);
    updateLaser(remoteLasers[rk(s)], mesh, armed, dt);
    viewers.push({ x: o.rx, y: o.ry || 0, z: o.rz });
  }
  updateRope(myRope, meMesh, me.tr ? me.tr.k : '', me.tr ? me.tr.i : -1, trProg(me.tr, me.y, 1));
  travFx.tick(dt, travNear(), viewers);
  updateCoopHint(dt);
  updateCutaway(dt);
  // laser sights: only while the pistol is drawn, not mid-takedown / dead / between missions
  updateLaser(myLaser, meMesh, !me.sw && me.eq && myGun && !me.td && !myBusy && play && !deadMe, dt);
  world.guards.forEach((g, i) => {
    if (role === 'host') { g.rx = g.x; g.rz = g.z; g.ra = g.a; }
    else { const [tx, tz] = ext(g); if (g.snap) { g.rx = tx; g.rz = tz; g.snap = false; } else { g.rx += (tx - g.rx) * kr; g.rz += (tz - g.rz) * kr; } g.ra = lerpA(g.ra, g.a, k); }
    const m = guardMeshes[i];
    m.g.position.set(g.rx, GUARDS[i].y, g.rz); m.g.rotation.y = -g.ra; // guards never change floor: y is level data
    if (dt > 0) { const v = Math.hypot(g.rx - m.px, g.rz - m.pz) / dt; m.spd += (Math.min(v, 8) - m.spd) * Math.min(1, dt * 8); }
    m.px = g.rx; m.pz = g.rz;
    const ko = g.st === 'dead' || g.st === 'held' ? 0 : g.ko || 0, down = g.st === 'dead', held = g.st === 'held', live = !down && !held && !ko;
    m.update(dt, { moving: live && m.spd > 0.4 && world.phase === 'play', run: m.spd > 3.4, speed: live && world.phase === 'play' ? m.spd : 0,
      dead: down || ko === 2, crouch: ko === 1, held: held ? Math.min(1, g.tdT / TD.time) : null, rifleAim: live && !!g.shooting && world.phase === 'play', shot: m.shot || 0,
      hurt: m.hurtN || 0, hurtFrom: m.hurtA, hurtAmt: m.hurtD });
    m.coneHolder.visible = live;
    const bob = Math.sin(now / 300 + i) * 0.1;
    m.zz.visible = ko === 2; m.zz.position.set(0.5, 1.0 + bob, 0); m.stz.visible = ko === 1; m.stz.position.y = 2.1 + bob; m.stz.material.rotation = now / 200;
    m.poolK = down ? Math.min(1, m.poolK + dt * 0.5) : 0; m.pool.visible = m.poolK > 0; m.pool.scale.setScalar(0.2 + m.poolK * 0.9);
    const range = SIGHT.stand + (world.alert > 0 ? 2 : 0);
    m.cone.scale.set(range, range, 1);
    m.coneMat.color.setHex(world.alert === 2 ? 0xff3030 : g.meter > 0.3 ? 0xffa030 : 0xffe066);
    m.coneMat.opacity = 0.18 + g.meter * 0.25;
    m.q.visible = g.st === 'investigate'; m.ex.visible = g.st === 'chase' || g.st === 'search';
    if (!live) m.q.visible = m.ex.visible = false;
  });
  // door + switches + extract
  if (doorMesh) {
    const dh = doorMesh.geometry.parameters.height;
    doorMesh.position.y = THREE.MathUtils.lerp(doorMesh.position.y, world.door ? -dh * 0.45 : dh / 2, Math.min(1, dt * 3));
    doorMesh.material.color.setHex(world.door ? 0x2a8a4a : 0x9a2a2a);
  }
  switchMeshes.forEach((s, i) => {
    const armed = world.sw[i] > 0;
    s.pad.material.color.setHex(world.door ? 0x30c060 : armed ? 0xffd040 : 0x557766);
    s.light.material.color.setHex(world.door ? 0x40ff80 : armed ? 0xffd040 : 0x660000);
  });
  extractMesh.material.opacity = world.door ? 0.5 + 0.4 * Math.sin(performance.now() / 200) : 0.25;
  // camera: angled top-down follow (zoomed out a bit more in portrait), blended into FIRST PERSON while MY player is in a tunnel.
  // Purely local: each client only looks at its own me.tun, so the partner's camera is never affected.
  // tighter than the original (15 up / 9 back, x1.25): same tilt, ~23% closer so the sneaker reads bigger; portrait still backs off
  scopeK += ((me.scope && play ? 1 : 0) - scopeK) * Math.min(1, dt * 5);
  const zoom = (camera.aspect < 1 ? 1.15 + (1 - camera.aspect) * 0.5 : 1) * 1.2 * (1 + 0.75 * scopeK); // SCOPE: see much further out
  const camDist = Math.hypot(CAM_H, CAM_Z) * zoom;
  topCam.x += (me.x - topCam.x) * Math.min(1, dt * 6);
  topCam.z += (me.z + CAM_Z * zoom - topCam.z) * Math.min(1, dt * 6);
  camY += ((me.y - (me.dive > 0 ? 0.85 : 0)) - camY) * Math.min(1, dt * 4); // follow the climber up; dip a little on a dive
  topCam.y = CAM_H * zoom + camY;
  topLook.set(topCam.x, camY, topCam.z - CAM_Z * zoom - 0.5);
  fpsK += ((role && (me.tun >= 0 || fpsOn) ? 1 : 0) - fpsK) * Math.min(1, dt * 4.5);
  tunK += ((me.tun >= 0 ? 1 : 0) - tunK) * Math.min(1, dt * 3); // tunnel darkness (the 1ST toggle outdoors keeps daylight fog)
  if (fpsK < 0.002) fpsK = 0; if (fpsK > 0.998) fpsK = 1;
  const f = fpsK * fpsK * (3 - 2 * fpsK); // smoothstep
  camYaw = lerpA(camYaw, me.a, Math.min(1, dt * 12));
  eyeH += ((me.sw ? (me.dive > 0 ? 0.05 : 0.46) : me.p ? 0.3 : me.c || me.tun >= 0 || (me.tr && me.tr.k === 'kn') ? 0.92 : 1.5) - eyeH) * Math.min(1, dt * 6);
  eyeF += ((me.p ? 0.42 : 0.12) - eyeF) * Math.min(1, dt * 6);
  const cy = Math.cos(camYaw), sy = Math.sin(camYaw);
  fpsEye.set(me.x + cy * eyeF, me.y + eyeH, me.z + sy * eyeF);
  fpsLook.set(fpsEye.x + cy * 4, me.y + eyeH - 0.15 - (me.y > 0.5 ? 0.5 : 0), fpsEye.z + sy * 4); // up high: look a touch down
  camera.position.lerpVectors(topCam, fpsEye, f);
  camLook.lerpVectors(topLook, fpsLook, f);
  // screen shake (own shots, getting hit, nearby FAMAS fire): random jolt, squared falloff
  shake = Math.max(0, shake - dt * 0.9);
  if (shake > 0.002) { const s2 = shake * shake * 4 * (1 - f * 0.6); camera.position.x += (Math.random() - 0.5) * s2; camera.position.y += (Math.random() - 0.5) * s2 * 0.5; camera.position.z += (Math.random() - 0.5) * s2; camLook.x += (Math.random() - 0.5) * s2 * 0.6; }
  camera.lookAt(camLook);
  const fov = (40 + 32 * f) * (1 - 0.55 * scopeK * f); // first person + SCOPE = zoomed binoculars
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.near = 0.1 - 0.06 * f; camera.updateProjectionMatrix(); }
  const ft = f * tunK, L3 = THREE.MathUtils.lerp;
  scene.fog.near = L3(L3(camDist + 6, 12, f), 0.6, ft); scene.fog.far = L3(L3(camDist + 42, 70, f), 17, ft);
  scene.fog.color.lerpColors(SKY, TUNNEL_FOG, ft); scene.background.copy(scene.fog.color);
  meMesh.g.visible = f < 0.6 && !(me.box && play); // don't render my own head in first person; box covers the rig
  if (f >= 0.6) cboxes[mySlot].visible = false; // inside the box in first person: the slit overlay does the job
  document.body.classList.toggle('scoped', scopeK > 0.5 && f > 0.5); document.body.classList.toggle('boxed', me.box && play && f > 0.5);
  meMesh.marker.visible = f < 0.5;
  if (f > 0 !== document.body.classList.contains('fps')) document.body.classList.toggle('fps', f > 0);
  $('fpsVignette').style.opacity = (f * (0.35 + 0.65 * tunK)).toFixed(2);
  updateWater(); updateFx(dt); updateBlood(dt); updateGearFx(dt);
  renderer.render(scene, camera);
}

// ACT button label + prompt for each traversal option (prompt '' = button label only)
const TRAV_LABEL = { climb: ['CLIMB', 'CLIMB'], down: ['CLIMB DOWN', 'CLIMB DOWN'], mantle: ['MANTLE', 'MANTLE'],
  rappel: ['RAPPEL', 'GRAPPLE - RAPPEL DOWN'], haul: ['PULL UP', 'GRAPPLE - HAUL PARTNER UP THE ROPE'], ropeup: ['GRAB ROPE', 'GRAB ROPE - PARTNER HAULS YOU UP'],
  ropewait: ['ROPE', 'GRAPPLE IS TOP-ONLY - PARTNER ON THE ROOF RING HAULS YOU'], kneel: ['BOOST', 'KNEEL - BOOST PARTNER'], boost: ['CLIMB ON', 'CLIMB ON PARTNER'], hoist: ['GRAB HAND', 'GET PULLED UP'],
  pull: ['PULL UP', 'PULL PARTNER UP'], solo2p: ['2P', 'TOO HIGH - CO-OP BOOST'], letgo: ['LET GO', ''], stand: ['STAND', ''], busy: ['...', ''] };
// LIFE bars (MGS-style): green > 50%, yellow > 25%, red + blink below. A pale "damage trail" eases down behind the fill.
const hpTrail = Array(NP).fill(HP_MAX);
const hpRows = [1, 2, 3, 4].map((i) => $('hpO' + i)); // teammates (index.html)
function hpBar(el, i, hp, label) {
  if (!el) return;
  const k = clamp(hp / HP_MAX, 0, 1); hpTrail[i] = Math.max(hp, hpTrail[i] - 40 / 60);
  el.querySelector('.hpFill').style.width = (k * 100).toFixed(1) + '%';
  el.querySelector('.hpTrail').style.width = (clamp(hpTrail[i] / HP_MAX, 0, 1) * 100).toFixed(1) + '%';
  el.className = 'hpRow ' + (el.dataset.mini ? 'mini ' : '') + (k > 0.5 ? 'ok' : k > 0.25 ? 'warn' : 'crit');
  const l = el.querySelector('.hpLbl'); if (l.textContent !== label) l.textContent = label;
}
function updateHud() {
  // health: my bar (+ partner's in co-op); hurt flash / shake / buzz when MY life drops
  const mi = myIdx(), myHp = world.hp[mi] ?? HP_MAX;
  if (myHp < lastHp && world.phase === 'play' || (myHp <= 0 && lastHp > 0)) {
    const dm = lastHp - myHp; shake = Math.max(shake, 0.22 + dm * 0.012); hurtT = 0.35; hurtSound(); if (navigator.vibrate) navigator.vibrate(dm >= 15 ? 120 : 50);
  }
  if (myHp > lastHp) hpTrail[mi] = myHp; // restart
  lastHp = myHp;
  hurtT = Math.max(0, hurtT - 1 / 60);
  $('hurtFlash').style.opacity = (hurtT / 0.35 * 0.55).toFixed(2);
  hpBar($('hpMe'), mi, myHp, (solo ? 'LIFE' : 'P' + (mi + 1) + ' LIFE'));
  // teammates' bars (compact rows, in slot order, coloured by their accent)
  let r = 0;
  for (let s = 0; s < NP; s++) {
    if (s === mi) continue;
    const el = hpRows[r++], show = !solo && others[s].on; el.classList.toggle('hidden', !show);
    if (show) { hpBar(el, s, world.hp[s] ?? HP_MAX, 'P' + (s + 1)); el.classList.toggle('hidden', false); el.style.setProperty('--pc', hexCss(PLAYER_LOOK[s].accent)); }
  }
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
    obj = solo ? 'MERIDIAN: ACT a switch on the bow deck or up on the bridge' :
      armed ? `Switch armed — other agent, hit the OTHER MERIDIAN switch (${Math.max(...world.sw).toFixed(1)}s)` :
      'MERIDIAN switches: bow deck and the bridge roof. ACT within 2s of each other';
  } else {
    const n = world.ext.filter(Boolean).length, need = extNeed();
    obj = solo ? 'Door open — climb MERIDIAN\'s stern to the bridge pad and EXTRACT' : `Door open — any ${need} of you on MERIDIAN's bridge pad to EXTRACT (${Math.min(n, need)}/${need})`;
  }
  $('objective').textContent = obj;
  // combat HUD: ammo counter, context label on the ACT button, keyboard prompt when a takedown is possible
  // weapon status line (the MGS weapon / item boxes are canvases drawn by drawGearHud)
  const W = me.wpn, qty = W ? Math.max(0, me.inv[W] ?? 0) : 0, nm = W ? ITEMS[W].name + (W === 'p9' && me.sd ? ' SD' : '') : 'FISTS';
  const ammoTxt = (!W ? 'UNARMED' : me.box ? 'IN C.BOX' + (isTouch ? '' : '  [E] out') : me.eq ? nm + ' ' + (isGun(W) ? (qty ? '|'.repeat(Math.min(qty, 12)) : 'EMPTY') : qty ? 'READY' : 'EMPTY')
    : 'HOLSTERED ' + nm + (isTouch ? '' : '  [G] draw')) + (myCharges() ? '  C4 x' + myCharges() + (isTouch ? '' : ' [T] DET') : '') + (me.stimT > 0 ? '  STIM ' + Math.ceil(me.stimT) : '')
    + (world.kills ? '  KILLS ' + world.kills : '') + (isTouch ? '' : '  [I] GEAR');
  const ammoEl = $('ammo'); if (ammoEl.textContent !== ammoTxt) ammoEl.textContent = ammoTxt;
  ammoEl.classList.toggle('holstered', !me.eq);
  drawGearHud(); syncGunButton();
  $('btnDet').classList.toggle('hidden', !myCharges() || world.phase !== 'play');
  if (invOpen) drawInv();
  const mode = world.phase === 'play' && !me.td ? actMode() : 'none';
  if (mode === 'none' || mode === 'td' || mode === 'use' || mode === 'fire' || mode === 'unbox') curTm = null;
  const tl = TRAV_LABEL[mode];
  const act = $('btnAct'), label = mode === 'td' ? 'TAKE DOWN' : mode === 'use' ? 'USE' : mode === 'unbox' ? 'UNBOX' : mode === 'fire' ? (me.wpn === 'stun' ? 'THROW' : me.wpn === 'c4' ? 'PLANT' : 'FIRE') : tl ? tl[0] : 'ACT';
  if (act.textContent !== label) act.textContent = label;
  act.classList.toggle('kill', mode === 'td');
  act.classList.toggle('climb', !!tl);
  const onRope = mode === 'letgo' && me.tr && ON_LINE(me.tr.k);
  const pr = $('prompt'), ptxt = me.sw ? (isTouch ? 'CROUCH = SHORT DIVE' : 'C  SHORT DIVE  ·  SWIM TO A HULL TO BOARD') : mode === 'td' ? (isTouch ? 'TAKE DOWN' : 'E  TAKE DOWN') : onRope ? (isTouch ? 'STICK UP / DOWN = ROPE · ACT LET GO' : 'W UP · S DOWN · E LET GO')
    : tl && tl[1] ? (isTouch ? tl[1] : 'E  ' + tl[1]) : '';
  if (pr.textContent !== ptxt) { pr.textContent = ptxt; pr.classList.toggle('hidden', !ptxt); }
}

// ---------------------------------------------------------------- main loop
let last = performance.now(), sendAcc = 0, stateAcc = 0, pingAcc = 0;
camera.position.copy(topCam);
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (role) {
    const paused = invOpen && solo; // solo: the gear menu pauses the mission (co-op can't pause other people)
    if (!paused) { updateLocal(dt); if (role === 'host') hostUpdate(dt); }
    sendAcc += dt; stateAcc += dt; pingAcc += dt;
    if (sendAcc > 0.05) { sendAcc = 0; if (role === 'guest') sendPlayer(); }
    if (stateAcc > 1 / 15) { stateAcc = 0; if (role === 'host' && peerConnected) sendState(); }
    if (pingAcc > 2) { pingAcc = 0; if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify({ t: 'ping', ts: performance.now() })); }
    updateHud(); updateOverlay(); drawRadar();
  }
  render(invOpen && solo ? 0 : dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// debug hook for automated tests
window.__ds = { WALLS, SWITCHES, EXTRACT, GUARDS, scene, cutaway, me, others, get other() { return others[mySlot === 0 ? 1 : 0]; }, get mySlot() { return mySlot; }, COOP_ALL, COOP_G,
  get fpsOn() { return fpsOn; }, toggleView, PLAYER_LOOK, meshOf, get curTm() { return curTm; }, RAILS, TRAV, WALK_TOPS, get world() { return world; }, damagePlayer, FAMAS, guardMeshes, HP_MAX, get role() { return role; }, get peer() { return peerConnected; }, armSwitch, net,
  TUNNELS, tunnelAt, get fpsK() { return fpsK; }, camera, toggleProne, toggleCrouch,
  doInteract, fireGun, toggleGun, takedownTarget, actMode, TD, GUN, meMesh, myLaser, autoTarget,
  travMode, startTrav, groundAt, ITEMS, GRID, PICKUPS, pickups, equipWeapon, useItem, toggleBox, detonate, openInv, closeInv, get invOpen() { return invOpen; }, WPN, STUN, C4, CLIMBS, COOPS, LINKS, WALKS, hostCoop, otherMesh, input, GRAPPLE, lineDecode, myRope, players, lineOfSight, guardSees: (g, p) => guardSees(g, p), SIGHT, LOOT, killGuard, MAP, H3, WATERS, DRY, SPAWNS, onDry, waterVolume, SWIM, swimSpot };
