# Audit of the uploaded `handling.cfg` and `vehicles.ide`

This report records only parsing/consistency observations from the two local files uploaded for this task. The proprietary source files are deliberately not copied into this package.

## `handling.cfg`

- 210 ordinary vehicle handling rows were read and accepted using the 36-field layout.
- The file contains separate specialized row groups: 12 boat (`%`), 13 bike (`!`), 23 flying (`$`) and 30 animation-group (`^`) records were accepted.
- Physical line 403, `$ RCRAIDER`, contains the token `0.1s` where a numeric value is expected. The specialized flying record is rejected rather than converting or guessing that token. The ordinary base handling row for the vehicle remains separately readable.
- Physical line 231, `TORNADO`, has modelFlags `400220000` (9 hexadecimal digits). The parser preserves the value and emits a warning that it is wider than 32 bits. It is not truncated or silently rewritten.

## `vehicles.ide`

The `cars` section contains 212 model rows. Three rows are malformed:

| Physical line | Model ID | Model name shown | Problem |
|---:|---:|---|---|
| 198 | 585 | `emperor` | Missing comma between model name and TXD name |
| 199 | 586 | `wayfarer` | Missing comma between model name and TXD name |
| 206 | 593 | `dodo` | Missing comma between model name and TXD name |

The parser rejects these rows, preserving the remaining columns rather than shifting them into the wrong properties. It accepts the other 209 rows.

## Cross-reference results

- Every one of the 209 accepted IDE rows resolves to an accepted base handling record.
- Nine base handling identifiers are not referenced by any accepted IDE row: `AIRTRAIN`, `BLOODRB`, `RANGER`, `EMPEROR`, `FLOAT`, `ROLLER`, `WAYFARER`, `RIO` and `DODO`.
- `EMPEROR`, `WAYFARER` and `DODO` correspond to the three malformed IDE rows above. The remaining six are not referenced by the uploaded `cars` section and require checking against the rest of the installation/configuration before deciding whether they are obsolete, special-case or from a different version.

## What to correct or provide

1. Inspect `vehicles.ide` physical lines 198, 199 and 206 in a text editor and restore the missing comma between each model name and its TXD name. Do not change any other columns.
2. Inspect `handling.cfg` physical line 403 to determine whether `0.1s` is a typo or a version-specific token. The correct numeric value cannot be inferred safely from these files alone.
3. Confirm the precise game build/version (for example, retail 1.0 US, 1.01, Steam/RGL, or a modded installation) before using executable offsets or assuming all flag layouts are identical.
4. Keep the original config files private and local. Do not commit them, the game executable, DLLs, IMG archives, models or textures to a public repository.
