# Project Deadsignal — browser co-op prototype (v0.1)

2-player online co-op stealth slice that runs in a phone browser — no install.
Tested flow: iPhone (Safari) hosts, Android (Chrome) joins, or the other way around.

> Original IP, inspired by PS1-era tactical stealth. No third-party names or assets.
> Players use the procedural low-poly olive "sneaker" and guards use the masked slate enemy kit of the same rig (`public/sneaker.js`, preview at `/character.html?who=both`). The yard is still greybox.
> **This is the browser test build. The Unreal Engine / Steam build comes later** and will reuse the design, not this code.

## What's in the slice
- Night yard greybox, 3 patrolling guards with visible sight cones (yellow → orange when suspicious → red on ALERT).
- **Walk** (makes a small noise), **run** (push the stick all the way / Shift; loud — guards come look), **crouch** (slow, silent, shorter sight range, and you can hide behind low crates).
- **Prone** (Z/X or PRONE button): belly-down commando crawl. Slowest, silent, guards only spot you from ~3.5 m and much more slowly; hides behind low crates.
- **Tunnels** (yellow-striped mouths, gold on the radar): West Culvert (spawn yard → north-west yard), Barracks Crawlspace (through the barracks), Compound Drain (west yard → inside the extraction compound; you still need the two-switch door to win). Inside a tunnel your camera goes **first person** (only yours, not your partner's). Up/W crawls forward, left/right turns, down/S backs up. You can't stand up in there. Guards can't enter, see in, or catch you in a tunnel.
- Guards: patrol → `?` investigate noises/glimpses → `!` ALERT (chase, ~15 s), then CAUTION, then calm. A guard touching you in ALERT sends you back to the start.
- **Takedown** (ACT / E / Space, only from *behind* a guard, within ~1.4 m, rear ~±64° arc): sneaker snaps in, choke hold + two knife jabs (~2.2 s), guard drops and stays down (no sight, hearing or catching). Front/side never works; the ACT button turns red and reads TAKE DOWN when it's possible.
- **Handgun** (P-9, holstered on the right thigh): ACT fires when there's no takedown/switch, F always fires. 12 rounds per mission, 0.5 s between shots, auto-aims at the nearest guard in front of you (narrow cone straight ahead in tunnels), one hit drops him. Crates don't stop bullets, walls do. Every shot is loud: live guards within 12 m come investigate (or chase if already on ALERT).
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
| Fire pistol | ACT (when nothing else to do) | F |

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
public/vendor/three.module.js   three.js r160 (vendored, no CDN needed)
public/manifest.webmanifest     Add-to-Home-Screen fullscreen
```
Tuning knobs are at the top of `public/main.js`: `SPEED`, `NOISE`, `SIGHT`, `ALERT_TIME`, `SWITCH_WINDOW`, the guard patrol routes and the level boxes.

## Next steps
- Swap the box characters for Blockbench glTF exports (`GLTFLoader`, nearest-filtered textures, separate parts parented to bones/groups for animation).
- Tranq + distraction (thrown can), revive instead of reset, keycard, ranked score.
- Then port the proven design to the Unreal C++ project for the Steam build.
