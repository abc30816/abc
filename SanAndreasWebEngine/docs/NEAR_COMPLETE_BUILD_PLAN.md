# San Andreas Web Engine — near-complete build plan

## Product target

Build an independently implemented browser runtime that can load the user's own compatible PC game installation locally and reproduce the major single-player systems before asking the user to perform a hands-on play test. The browser must not upload the user's game files, nor ship Rockstar executable code or proprietary game assets in the project package.

“Near-complete” means the major game loop and content systems exist together: world rendering/streaming, player character and animation, vehicles, pedestrians/traffic, combat, interiors, audio, HUD, mission scripting, progression, and save/load. It does not mean exact parity has been proven; parity requires a later compatibility pass against the user's own files.

## Verified current code baseline

- TypeScript + Vite + Three.js browser application.
- Local folder indexing for the selected installation; IMG archive entries are read lazily.
- IMG VER2 directory parsing, IDE definitions, text IPL instances, binary `bnry` IPL placements, and a bounded `gta.dat` resource manifest linker with separate direct/archived SCM indexing.
- A limited non-native RenderWare DFF clump/frame/geometry/atomic reader.
- Partial PC TXD decoding (DXT1–DXT5 and common raw raster formats).
- COL2/COL3 collision parsing and collision-mesh construction.
- Spatial world chunk streamer and a basic third-person movement/camera harness.
- Added Increment 02 modules: bounded local asset streaming, `stream.ini` parser, Rapier WASM physics adapter, and a runtime wrapper. These are present as modules but are not yet fully connected to the main game loop.
- Added Increment 03 modules: bounds-checked SCM instruction/argument decoder and opcode-signature INI parser. These decode data only; there is no mission VM or opcode implementation yet.
- Added Increment 05/06 vehicle data modules: classic-PC `handling.cfg` and `vehicles.ide` parsers, diagnostics, and a joined vehicle catalog. Increment 07 applies them to an initial DFF/TXD-backed car-driving loop.

## Major systems still required

1. **Asset compatibility:** native DFF pipelines, skin/HAnim, IFP skeleton and animation clips, remaining TXD palette/raster variants, full COL coverage, remaining IPL sections, LOD pairing, 2DFX, model flags, texture alpha/blending, and version-specific edge cases.
2. **Character:** real CJ model assembly, skeleton/IFP animation state machine, clothing components, locomotion transitions, jumping/falling, swimming, climbing, crouching, interaction and damage states.
3. **World:** correct map sectors and LODs, interior and portal transitions, collision streaming, water, roads, time-of-day, weather, lights, doors, pickups, checkpoints and map boundaries.
4. **Vehicles:** extend the Increment 07 car slice with proper wheel contact, suspension, per-wheel traction, collision/deformation, lights, doors and robust entry/exit; then add bike/boat/aircraft/heli/train behaviour and AI traffic.
5. **Population:** pedestrian models and animation, spawn density/zones, traffic vehicles, routing, traffic lights, pedestrian tasks, reactions, wanted-level response and police/EMS/fire services.
6. **Combat:** weapon data, aiming, firing, projectiles/hitscan, melee, reloading, ammo, damage, health/armour, explosions, ragdoll/fallback reactions and target selection.
7. **Missions:** script archive lookup, validated SCM header/segment parsing, thread scheduler, variable storage, opcode handler coverage, mission state transitions, checkpoints, cutscenes, failure/retry, side activities and save compatibility. The SCM decoder alone is not a mission runtime.
8. **Audio:** Web Audio mixer, streaming audio, supported Vorbis decode, 3D sound, radio stations, music transitions, dialogue/subtitles, effects and audio settings. Windows DLLs cannot be loaded in the browser.
9. **Presentation/UI:** title/pause menus, HUD, radar/minimap, weapon wheel/selection, vehicle HUD, mission text, phone/text prompts, map, settings, input remapping and gamepad support.
10. **Persistence/performance:** save/load format adapter, deterministic state boundaries, worker-based parsing where appropriate, bounded caches, disposal/recovery paths, frame pacing and low-memory fallback.

## Development gates (no user play-test yet)

- **Gate A — unified foundation:** combine the saved increments, resolve TypeScript/module integration, and keep internal automated checks green.
- **Gate B — complete asset pipeline:** implement the missing model/texture/animation/collision formats and robust streaming.
- **Gate C — playable core loop:** CJ, camera, movement, collisions, vehicle entry/exit and driving.
- **Gate D — living world:** population, traffic, AI, combat, interiors, weather/time and audio.
- **Gate E — mission/progression loop:** SCM VM/opcodes, missions, save/load, UI and activities.
- **Gate F — pre-release hardening:** performance budgets, recovery paths, browser compatibility, complete internal tests and build.
- Only after Gate F should the user be asked to perform the first full gameplay test. Internal unit tests and static checks still run during development; they do not require the user to test incomplete builds.

## Current caveats

- The saved baseline is an early prototype, not a near-complete game.
- Increments 02, 03, 05 and 06 were available and merged into this working copy. No Increment 04 archive was present; the available modules do not depend on it by filename/sequence.
- The package build has not been verified in this environment because dependency installation timed out. Do not treat a successful build or gameplay compatibility as established until it is run successfully.
- The original `gta3.img` archive should remain on the user's PC. The intended loading path is browser local-folder access and indexed/lazy reads, not uploading the full archive to ChatGPT or committing it to a public repository.
