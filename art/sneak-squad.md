# Sneak squad

Original agents for Deadsignal. The silhouette follows a late-90s tactical sneak suit — matte cloth, black webbing, a standing collar, belt pouches, a drop-leg holster, boots — drawn and modelled in this repo. No Konami meshes or textures.

## Who

| Agent | Cloth | What sets them apart |
|---|---|---|
| Reed | olive drab | cropped hair, bead earpiece |
| Wren | darker olive | rust head-wrap, one short tail, buzz cut |
| Sable | black-olive | hood down on the shoulders, headset |
| Dune | khaki | sand shemagh, bleached crop |
| Iris | blue-grey | ice seam piping, goggles up on the brow |

Classic Night Ops, Ash Fox, Dust Viper, Red Heron and Sand Owl are still in the lobby under CLASSIC. In a mission they wear the hi body; guards stay on the low enemy kit.

## Density

Counted in `/character.html?squad=1` (visible meshes only):

| | Tris | Meshes | Suit | Torso | Face | Filter |
|---|---:|---:|---:|---:|---:|---|
| Night Ops, low body | 3825 | 56 | 128 | 256 | 128 | nearest, crush step 8 |
| Reed, hi body | 7010 | 54 | 256 | 512 | 256 | linear + mipmaps, crush step 2 |

Reed also keeps the other kits' headgear in memory, hidden: about 9056 tris resident. Hair and boots on the sneak kits are 256; webbing, pouches and gloves are 128 (classic kit textures are 64, gun/blade 32).

The hi body uses the same joints. Loft rings go from 6–10 sides to 12–16, with an extra ring between each profile sample, a taller collar, and a sheath on the off thigh.

## Select

Lobby row **YOUR AGENT**. AUTO assigns the squad by slot: host Reed, then Wren, Sable, Dune, Iris. A name overrides that. `?agent=wren` preselects. The choice is sent as `lk` on the player and state packets.

Preview: `/character.html?squad=1`. Close-up: `/character.html?k1=reed&one=1&px=1`.
