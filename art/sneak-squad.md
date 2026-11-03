# Sneak squad

Original agents for Deadsignal. The hi body follows the cut of a PS1-era sneaking suit — dark quilted vest, lighter sleeves, stand-up collar, forearm bands, a row of rectangular belt pouches — modelled and painted in this repo. No Konami meshes or textures.

The face is covered by a balaclava (eyes only). **BARE** in the lobby is the same Reed suit with the mask off.

## Who

| Agent | Vest / sleeves | What sets them apart |
|---|---|---|
| Reed | navy / blue-grey | cropped hair over the balaclava, earpiece |
| Wren | indigo / blue-grey | rust stripe above the eye holes |
| Sable | charcoal / grey | hood down over the mask, headset |
| Dune | dust / sand | shemagh over the collar |
| Iris | navy / pale blue | goggles on the brow, ice piping |
| Bare | same as Reed | balaclava off |

Classic Night Ops, Ash Fox, Dust Viper, Red Heron and Sand Owl are still in the lobby under CLASSIC. In a mission they wear the hi body; guards stay on the low enemy kit.

## Density

Counted in `/character.html?squad=1` (visible meshes only):

| | Tris | Meshes | Suit | Torso | Face | Filter |
|---|---:|---:|---:|---:|---:|---|
| Night Ops, low body | 3825 | 56 | 128 | 256 | 128 | nearest, crush step 8 |
| Reed, hi body | 7018 | 55 | 256 | 512 | 256 | linear + mipmaps, crush step 2 |

The hi body uses the same joints. Loft rings go from 6–10 sides to 12–16, with an extra ring between each profile sample. The sneak torso is a darker quilted vest than the sleeves, with pec and ab plates, a taller collar, forearm bands, and a rectangular belt.

## Select

Lobby row **YOUR AGENT**. AUTO assigns the squad by slot: host Reed, then Wren, Sable, Dune, Iris (balaclava on). A name overrides that. BARE is Reed without the mask. `?agent=wren` preselects. The choice is sent as `lk` on the player and state packets.

Preview: `/character.html?squad=1`. Close-up: `/character.html?k1=reed&one=1&px=1`. Open face: `/character.html?k1=bare&one=1&px=1`.
