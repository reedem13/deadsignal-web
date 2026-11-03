# Project Deadsignal — browser co-op prototype (v0.1)

2-player online co-op stealth slice that runs in a phone browser — no install.
Tested flow: iPhone (Safari) hosts, Android (Chrome) joins, or the other way around.

> Original IP, inspired by PS1-era tactical stealth. No third-party names or assets.
> Players use the procedural low-poly olive "sneaker" and guards use the masked slate enemy kit of the same rig (`public/sneaker.js`, preview at `/character.html?who=both`). The yard is still greybox.
> **This is the browser test build. The Unreal Engine / Steam build comes later** and will reuse the design, not this code.

## What's in the slice
- Night facility greybox: the original relay yard plus a south motor pool, east cooling plant (with an L3 penthouse), west service yard and north dock. 15 patrolling guards across the floors, with visible sight cones (yellow → orange when suspicious → red on ALERT).
- **Walk** (makes a small noise), **run** (push the stick all the way / Shift; loud — guards come look), **crouch** (slow, silent, shorter sight range, and you can hide behind low crates).
- **Prone** (Z/X or PRONE button): belly-down commando crawl. Slowest, silent, guards only spot you from ~3.5 m and much more slowly; hides behind low crates.
- **Tunnels** (yellow-striped mouths, gold on the radar): West Culvert (spawn yard → north-west yard), Barracks Crawlspace (through the barracks), Compound Drain (west yard → inside the extraction compound; you still need the two-switch door to win). Inside a tunnel your camera goes **first person** (only yours, not your partner's). Up/W crawls forward, left/right turns, down/S backs up. You can't stand up in there. Guards can't enter, see in, or catch you in a tunnel.
- Guards: patrol → `?` investigate noises/glimpses → `!` ALERT (chase, ~15 s), then CAUTION, then calm. A guard touching you in ALERT sends you back to the start.
- **Vertical grapple lines** (orange rings at a wall's foot / behind its lip): ACT runs a short throw + tug (or hook-set + over the edge), then **you drive the rope** — W / stick up = climb hand-over-hand, S / stick down = bounding descent, let go of the stick = hang still. Up at the top = mantle onto the roof, down at the bottom = boots down, ACT on the rope = let go (a high standing drop thuds).
- **Guards see up**: roofs, gantry, ladders and ropes are checked in 3D from the guard's eye (vertical cone ~49° up, ~60° on ALERT; straight overhead is blind). Roof edges and decks hide you if you're back from the lip, crouched or prone; looking up makes them slower to be sure.
- **Takedown** (ACT / E / Space, only from *behind* a guard, within ~1.4 m, rear ~±64° arc): sneaker snaps in, choke hold + two knife jabs (~2.2 s), guard drops and stays down (no sight, hearing or catching). Front/side never works; the ACT button turns red and reads TAKE DOWN when it's possible.
- **On-site procurement:** missions start with **empty hands** — no pistol, no grenades, no ration. G (or the weapon button) draws whatever you have found; with nothing equipped it stays on FISTS and neither ACT nor F can fire. Holstered: ACT is only TAKE DOWN / USE. Drawn: ACT fires when there's no takedown/switch, F always fires. A takedown swaps the weapon for the knife and goes back to it after. The P-9 is a locker just through the **south gate** (12 rounds in that locker; more ammo in crates). 0.5 s between shots, auto-aims at the nearest guard in front of you (narrow cone straight ahead in tunnels), one hit drops him. Crates don't stop bullets, walls do. Every shot is loud: live guards within 12 m come investigate (or chase if already on ALERT). A dead or taken-down guard drops one bundle (FAMAS mag / quiet kit) and nothing else.
- **Two-person door:** two switch pads by the red door, 10 m apart. Each player stands on one and presses ACT; the presses must land within 2 s of each other. One person can't do it alone.
- **Extract:** both players inside the green ring behind the door = MISSION COMPLETE (time, alerts, times caught, rank). The host can restart.
- Soliton-style radar in the top right, alert banner, objective line, beeps and vibration (Android) on ALERT.
- **Listen-server:** the host's phone runs the guards, alerts, door, catches and win check. The guest only sends its own position and button presses. `server.js` just pairs two phones in a room and passes messages between them.

## Run it
Needs Node 18+.
```bash
cd deadsignal-web
npm install        # only dependency is "ws" (already in node_modules in the zip)
npm start          # or: PORT=8080 node server.js
```
The server prints a `localhost` URL and your LAN URL, e.g. `http://192.168.1.20:8080`.

### Playing with someone on a different network (you and your brother)
Phones on the same WiFi can just open the LAN URL. For anywhere else, expose the server with a free tunnel that gives you an **https** link (WebSockets work through it):
```bash
# Cloudflare quick tunnel (no account needed)
npx cloudflared tunnel --url http://localhost:8080
# → prints https://something.trycloudflare.com  — open that on both phones

# or ngrok (free account)
ngrok http 8080
```
For an always-on link, deploy this folder as-is to any Node host that supports WebSockets (Render, Railway, Fly.io, a $5 VPS). The start command is `npm start`, and the host sets `PORT`.

Advanced: the client can talk to a relay on a different host with `?server=wss://your-relay.example.com/ws`.

## Join flow
1. **Host** opens the link and taps **HOST MISSION**. A 4-letter room code shows top left, plus a **Share link** button (opens the iOS/Android share sheet).
2. **Guest** opens the shared link (`…/?room=ABCD`) and taps **JOIN ABCD**, or opens the plain link, types the code and taps JOIN.
3. Status top left changes to `partner in` / `with host`. Go.
- **Solo test** checkbox in the lobby: the door and extract only need you (for checking things alone).
- If a phone locks or switches apps, the game reconnects to the same room when you come back. The room stays open for 3 minutes after both leave.

## Controls
| | Phone | Keyboard |
|---|---|---|
| Move | Drag anywhere on the left side (floating stick) | WASD / arrows |
| Run (loud) | Push the stick to the edge | Hold Shift |
| Crouch toggle | CROUCH button | C |
| Prone toggle | PRONE button | Z or X |
| In a tunnel (1st person) | stick up/down = forward/back, left/right = turn | W/S forward/back, A/D turn |
| Takedown (from behind) / use switch / fire | ACT button (label changes: TAKE DOWN / USE / FIRE) | E / Space |
| Draw / holster pistol | GUN / HOLSTER button | G |
| Fire pistol (only when drawn) | ACT (when nothing else to do) | F |
| Gear menu (MGS-style grid) | GEAR button (top right) or tap the weapon box | I or Tab (arrows/WASD move, E/Enter = equip/use, Esc closes) |
| Quick-swap weapon | open GEAR | 1 P-9 · 2 FR-5 · 3 MK-T · 4 STUN.G · 5 C4 |
| Use current item | tap the item box (bottom left) | Q |
| Detonate C4 | DET button | T |

## Gear (weapons + items)
Open the grid with GEAR / I / Tab. Tap a slot to select it and tap again (or EQUIP / USE) to act. Solo pauses while the menu is open; co-op doesn't. Unowned slots show `- - -`. You start with nothing equipped and nothing in inventory. Lockers (grey cabinets) and olive crates are marked on the radar; each player can take each one. Guards drop one searchable bundle when they go down (gun/C4 kills lean FAMAS ammo, takedowns lean suppressor / darts / ration / stun) — one drop per guard, no respawn.

| Gear | What it does |
|---|---|
| P-9 | Sidearm, one hit drops a guard, loud (12 m). Ammo crates respawn. |
| SUPP. | Toggle on the P-9: noise radius 3 m. |
| FR-5 | Assault rifle, 3-round bursts, longer range, very loud (16 m). |
| MK-T | Tranquilizer: built-in quiet, a dart puts a guard to sleep 30 s (Z). Sleeping/stunned guards can be taken down from any side. |
| STUN.G | Thrown ~7 m, 1.2 s fuse, white flash: guards within 5 m stunned 7 s (\*). Non-lethal. |
| C4 | FIRE plants at your feet, T / DET sets off all yours: kills guards within 3.2 m, hurts players within 3 m (you too), very loud. |
| RATION | +40 LIFE. |
| STIM | 30 s of steady aim (no recoil bloom / sway). |
| C.BOX | Hide in a cardboard box: standing still you're invisible unless a guard on ALERT bumps into you; moving is slow and half as visible. |
| SCOPE | Toggle: zooms the top-down camera out ×1.75 / narrows first-person FOV. |

Gear art + the table live in `public/gear.js`. Damage, sleep, stun, C4 and healing are all host-authoritative. Pickups are per player (each teammate can grab every crate once; ammo/ration/grenade crates respawn).

## Phone tips / known limits
- **iPhone/iOS Safari**
  - Real fullscreen isn't available to web pages on iPhone. For the most screen: Share → **Add to Home Screen**, then launch from the icon. Landscape or portrait both work; portrait zooms the camera out.
  - Sound only starts after your first tap (iOS rule). There's no vibration on iOS.
  - Safari pauses background tabs. If you switch apps as the **host**, the guards freeze for your partner until you come back.
  - Low Power Mode caps the game at 30 fps. It's still playable.
- **Android Chrome:** works in the browser. Add to Home screen also gives fullscreen. Vibrates on ALERT.
- Use the **https** tunnel link when not on the same WiFi. Plain `http://LAN-IP` only works on the same network.
- Latency: the host is authoritative, so the guest sees guards about one round trip late (usually 50–150 ms on a tunnel). Your own movement is instant on both phones.
- Movement is client-trusted (fine for co-op testing with family, not cheat-proof).
- No mid-game host migration: if the host quits, the guest waits until the host returns.
- Placeholder art. Collision is box-based. Guards can sometimes give up a chase when a wall is in the way.

## Files
```
server.js                 static file server + WebSocket room relay (/ws), heartbeat, reconnect-friendly rooms
public/index.html         lobby, HUD, touch controls markup
public/style.css          mobile-first UI (safe-area aware, no zoom/scroll)
public/main.js            game: three.js scene, input, host simulation, netcode, radar, UI
public/gear.js            weapons/items table, pixel font + red/grey pixel icons, MGS-style slot renderer
public/vendor/three.module.js   three.js r160 (vendored, no CDN needed)
public/manifest.webmanifest     Add-to-Home-Screen fullscreen
```
Tuning knobs are at the top of `public/main.js`: `SPEED`, `NOISE`, `SIGHT`, `SIGHT_V` (vertical vision), `ALERT_TIME`, `SWITCH_WINDOW`, the guard patrol routes and the level boxes.

## Next steps
- Swap the box characters for Blockbench glTF exports (`GLTFLoader`, nearest-filtered textures, separate parts parented to bones/groups for animation).
- Tranq + distraction (thrown can), revive instead of reset, keycard, ranked score.
- Then port the proven design to the Unreal C++ project for the Steam build.
