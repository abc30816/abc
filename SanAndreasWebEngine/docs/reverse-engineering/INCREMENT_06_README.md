# San Andreas browser engine — Increment 06: correct vehicle-data import and cross-linking

This increment replaces the incorrect Increment 05 `handling.cfg` column assumption and adds a read-only `vehicles.ide` parser plus a joined vehicle catalog. It does not include any game assets or executable code.

## Important correction

The supplied classic-PC `handling.cfg` serializes ordinary vehicle records as **36 whitespace-separated fields**. Its comments describe field E as unused, but that unused field is not present in the data rows. Increment 05 incorrectly expected 37 fields and shifted the decoded values. Increment 06 replaces that parser and backs up the previous file as `handlingCfg.ts.bak-increment-06` when applicable.

## What it adds

- Correct 36-field parsing for standard handling rows, with no inserted unused E value.
- Preservation of 32-bit and wider hexadecimal flags up to JavaScript's exact-integer limit; values beyond 32 bits are warned about, never silently truncated.
- Separate typed, read-only capture of the four special `handling.cfg` row families: `%` boat, `!` bike, `$` flying, and `^` vehicle animation-group records.
- A bounded parser for the `cars` section of `data/vehicles.ide`, including optional trailing wheel/LOD/component fields.
- A cross-linked catalog keyed by model ID and model name, joining each IDE model with base handling and any matching boat/bike/flying/animation data.
- Local-only loaders that accept the existing browser-selected `Map<string, File>`; files are not uploaded.
- Diagnostics for bad field counts, duplicate identifiers, missing references, and malformed source lines.

## Apply

Extract this ZIP into the actual Vite project folder containing `package.json`, then run from that project root:

```bash
node sa-engine-increment-06/apply-increment.mjs
```

Then run:

```bash
npm test
npm run typecheck
npm run build
```

The installer copies only TypeScript source, tests and documentation. Existing destination files are backed up once with `.bak-increment-06` suffixes before replacement.

## Use with the existing local game-file map

```ts
import { loadVehicleCatalogFromFiles } from './config/vehicleCatalog';

const result = await loadVehicleCatalogFromFiles(game.files);
const landstal = result.catalog.byModelId.get(400);
console.log(landstal?.handling.mass, landstal?.handling.maxVelocity);
console.log(result.handling.issues, result.vehicles.issues, result.catalog.issues);
```

`game.files` is expected to be the existing local `Map<string, File>` indexed by the browser folder picker. It must include `data/handling.cfg` and `data/vehicles.ide`.

## Validation against the two files uploaded in this conversation

The parser was run against the actual uploaded text files, but the files themselves are **not** included in this ZIP.

- `handling.cfg`: 210 ordinary 36-field records accepted.
- `handling.cfg` special rows: 12 boat, 13 bike, 23 flying and 30 animation-group records accepted. One additional flying record is rejected with a precise diagnostic (see the audit report).
- `vehicles.ide`: 212 rows encountered; 209 accepted and 3 rejected because the model-name/TXD-name comma is missing.
- All 209 accepted `vehicles.ide` rows resolve to a base handling record. Nine base handling IDs are not referenced by any accepted IDE row; three coincide with the three malformed IDE records and six remain unreferenced by this `cars` section.

See `docs/reverse-engineering/UPLOADED_VEHICLE_DATA_AUDIT.md` for exact source lines and remaining issues.

## What it does not do yet

- It does not yet feed these values into the Rapier vehicle controller or implement GTA's full vehicle dynamics.
- It does not recreate native handling flags, wheel contact, gear shifting, differentials, hydraulics, boat buoyancy, aircraft control surfaces or suspension exactly.
- It does not load or execute `gta_sa.exe`, DLLs, CLEO scripts, SCM bytecode, or any other native/game code.
- It does not distribute or upload any proprietary game files.
