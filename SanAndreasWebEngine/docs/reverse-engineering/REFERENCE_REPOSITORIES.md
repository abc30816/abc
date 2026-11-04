# Reference repository review — independent San Andreas browser engine

Reviewed 2026-11-04. These projects are technical references, not code dependencies of this engine.

## 1. Dryxio/plugin-sdk-sa

Repository: https://github.com/Dryxio/plugin-sdk-sa

Useful for:

- Reverse-engineered GTA SA class names, field semantics, offsets and sizes.
- Vehicle handling model: `tHandlingData` is documented as 0xE0 bytes.
- Common handling-data offsets include mass 0x04, turn mass 0x0C, drag 0x10, centre of mass 0x14, percent submerged 0x20, traction multiplier 0x28, transmission 0x2C, brake deceleration 0x94, steering lock 0xA0, traction loss 0xA4, traction bias 0xA8, suspension 0xAC–0xC4, collision damage multiplier 0xC8, model flags 0xCC, handling flags 0xD0 and trailing seat/value/light/animation fields 0xD4–0xDE.
- Automobile state concepts: wheel contact, wheel position/rotation/speed, suspension compression, wheel collisions, doors, panels and damage.
- Streaming function concepts such as model requests, loading channels, scene collision and zone model requests.

Important limitations:

- It targets classic 32-bit Windows GTA SA 1.0 US (Compact and Hoodlum variants), not a browser runtime.
- Its plugin API uses native pointers, executable addresses, hooks, Windows calling conventions and in-process game memory. Those mechanisms must not be carried into the browser.
- It is a Plugin-SDK fork, not a complete source release for the game.

License: the repository's LICENSE file grants broad use, modification and redistribution subject to attribution/provenance, marking altered versions and retaining the notice. This increment does not copy its source code; the documented layout facts are used as reverse-engineering references. If code is ever reused, preserve the complete license notice and required attribution.

## 2. alemariusnexus/gtatools

Repository: https://github.com/alemariusnexus/gtatools

Useful for cross-checking the format families and parser boundaries:

- IMG archive indexing and entry handling (`gtaformats/img`).
- RenderWare binary section streams (`gtaformats/rwbs`).
- DFF clumps, frames, geometry, materials and meshes (`gtaformats/dff`).
- TXD texture archives (`gtaformats/txd`).
- COL collision data (`gtaformats/col`).
- IDE and IPL records (`gtaformats/ide`, `gtaformats/ipl`).

Important limitations:

- The project is a C++ desktop toolkit, not a browser port.
- Its desktop engine uses OpenGL/GLEW, LuaJIT, Bullet and CEGUI; these are not directly browser-compatible and its renderer is not a substitute for the WebGL/WebGPU layer.
- Its README identifies the project as GPL-3.0-or-later. Do not copy or link its implementation into this independently licensed project unless the project deliberately adopts compatible GPL distribution terms.

This increment uses the repository only as a format-family cross-check. No GTATools source code is copied.

## 3. Decisions for our own engine

- Continue an original TypeScript implementation for browser file access, data validation, streaming and game systems.
- Use WebAssembly modules only for components with a clear portable implementation and measured benefit (for example, physics or heavy binary decode); do not assume a Windows plugin or executable can be converted by changing its extension.
- Treat the user's local game folder as the asset source. Never upload `gta_sa.exe`, DLLs, IMG archives, models, textures, audio or scripts into the public repository.
- Keep all parsers bounded: cap file sizes, record counts, offsets and decompressed output before allocating.
- Validate against the exact user's retail PC version. SDK layouts for 1.0 US must not silently be assumed correct for other builds.

## 4. Handling.cfg format cross-check

The parser added in `src/config/handlingCfg.ts` uses the 36 whitespace-separated fields measured in the user-supplied classic-PC `handling.cfg` data rows (210 ordinary rows were accepted in Increment 06). Do not conflate a serialized text row with the in-memory `tHandlingData` structure: an internal/unknown structure slot is not automatically a text column. Model and handling flags are parsed as hexadecimal values without silently truncating wider tokens. Range findings are warnings, not clamps, so modded values are not silently rewritten.

Sources:

- Plugin-SDK vehicle handling structure: `plugin_sa/game_sa/tHandlingData.h` in Dryxio/plugin-sdk-sa.
- Plugin-SDK automobile wheel/suspension data: `plugin_sa/game_sa/CAutomobile.h` in Dryxio/plugin-sdk-sa.
- Public field descriptions (which may describe layout slots differently from the supplied file rows): https://gta.fandom.com/wiki/Handling.cfg_in_GTA_San_Andreas and https://thegta.wiki/wiki/vehicle-stats-in-gta-san-andreas/.

The parser does not claim that a handling record alone reproduces GTA's full vehicle physics. It is input data for a later, separately validated vehicle dynamics implementation.
