# Increment 07 — integrated vehicle-driving slice

## Additional Increment 07 resource-manifest work

- Added a bounded `data/gta.dat` parser for IDE, IPL, COLFILE, IMG and CDIMAGE entries.
- Normalized slash/case and rejected absolute paths, parent-directory traversal and empty path segments.
- IMG/CDIMAGE entries declared in `gta.dat` are prioritized during local archive indexing; missing declared resources are surfaced as warnings.
- Direct files under `data/script/` and `.scm`/`.cs` entries inside indexed IMG archives are indexed separately for the later mission subsystem. They are not executed.

## Inputs and evidence

This increment uses only the user's locally selected classic-PC `data/vehicles.ide`, `data/handling.cfg`, and model/texture entries indexed from their local IMG archives. The uploaded configuration files were already parsed in Increment 06. The original Windows executable and DLLs are not loaded or invoked by the browser.

The executable's static inspection identifies `HANDLING.CFG`, RenderWare assets and IMG archives as integration points, but that observation alone is not treated as proof of handling formulas. The new handling-to-browser-physics mapping is an explicitly approximate, independently written first pass.

## Implemented behavior

- Join a parsed vehicle definition to its handling row.
- Only attempt models present in the user's indexed IMG archives.
- Decode DFF/TXD with the browser parser. Skip models with unsupported native geometry instead of showing invented box substitutes.
- Spawn up to eight decoded cars near the player start as an interaction/vehicle-controller slice.
- Enter the nearest car with E; exit with F.
- W/S throttle and reverse request; A/D steering; Space service brake; Shift handbrake. Exit is restricted to low speed so the player cannot immediately eject at road speed.
- Drive state integrates speed, drag, brake force, steering/yaw, gear estimate, RPM and body health.
- Camera and world streaming follow the active vehicle.
- HUD shows model, speed, gear and body health.

## Known gaps (not represented as complete)

- No tire raycasts, suspension travel, wheel spin, differential, torque curve or per-axle traction.
- No vehicle-to-world or vehicle-to-vehicle collision response, deformation, fire/explosion state, doors, windows, lights or damage components.
- No AI driver/traffic system, passenger seating or vehicle class-specific control models.
- Handling data are mapped to a browser approximation, not verified for exact retail-game parity.
- Some native DFF render pipelines are unsupported and are skipped; no assets are substituted.

## Validation

The pure dynamics module was compiled with strict TypeScript alongside the existing handling parser. A deterministic Node harness exercised a real-shaped 36-field handling row and verified forward acceleration, forward displacement, braking to zero, heading change under steering and health clamping under impact.

Full Vite/Vitest/typecheck validation could not run in the packaging environment because package dependencies were absent and npm registry DNS/network access was unavailable. The modified app modules passed a TypeScript syntax/transpile-only pass; this does not certify their full type correctness or browser runtime behavior.

## Safety and reversibility

- All game assets are read from File/Blob objects selected by the player in the browser.
- No `fetch`, remote upload, shell command, `eval`, executable launch, memory patching or DLL loading is added.
- No Rockstar executable, DLL, IMG, DFF, TXD, audio or mission data is placed in this package.
- The increment changes only original TypeScript, HTML, CSS, tests and documentation. Reverting it means restoring the pre-Increment-07 versions of `README.md`, `package.json`, `index.html`, `src/main.ts`, `src/style.css`, `src/gameplay/PlayerController.ts`, `docs/INTEGRATION_STATUS.md`, and `docs/NEAR_COMPLETE_BUILD_PLAN.md`, and removing `src/gameplay/VehicleDynamics.ts`, `src/gameplay/VehicleSystem.ts`, `tests/vehicles/VehicleDynamics.test.ts`, and this document.
