# Integration status — consolidated working copy

The original GitHub-ready starter and the available saved increments have been combined into this source tree in this order: Increment 02, Increment 03, Increment 05, then Increment 06. Increment 06 intentionally supersedes the Increment 05 handling parser because it corrects the classic-PC row width from 37 to 36 fields.

This is a source consolidation, not a claim that every module is wired into the live browser loop. In particular:

- `BrowserEngineRuntime`, `LocalAssetStreamer` and `RapierPhysicsWorld` exist but `src/main.ts` still uses the starter's basic movement/raycast path.
- The new `gta.dat` reader resolves declared loose resources, prioritizes listed IMG archives, and indexes direct/archived SCM resources. The SCM modules decode instructions and parse signatures, but there is no scheduler/VM/opcode execution engine.
- Increment 07 adds a local vehicle loader and a first handling-driven car controller. It currently spawns up to eight nearby cars (only when their DFF/TXD assets can be decoded), supports enter/exit and basic steering/throttle/brake, and follows the active vehicle for world streaming. It is not yet GTA-accurate and has no wheel/suspension/impact collision or traffic AI.
- The current placeholder player body is not CJ and has no IFP skeleton, clothing or animation system. Vehicle visuals come from the user-selected local DFF/TXD assets; native-pipeline vehicle models are skipped rather than replaced by fake boxes.

The complete scope and build gates are in `NEAR_COMPLETE_BUILD_PLAN.md`.


## Increment 07 verification

- `VehicleDynamics.ts` compiles independently under strict TypeScript together with the existing handling parser.
- Manual deterministic checks passed for parsing a 36-field handling row, forward acceleration, movement along heading, service braking to a full stop, steering and bounded impact damage.
- The full application TypeScript check, Vitest suite and Vite production build remain blocked in this environment because dependencies (`three`, Rapier, Vite and Vitest) are absent and `npm install` could not reach `registry.npmjs.org`. A syntax/transpile-only TypeScript pass on the changed application files succeeded; this is not a substitute for a full typecheck/build.
