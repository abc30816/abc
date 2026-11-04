# San Andreas SCM reader — format notes and validation requirements

This increment adds an independently written, bounds-checked **decoder**, not a mission executor. It reads a command only when a caller supplies an opcode signature catalogue matching the target game/script version. It refuses to guess an unknown command's length because a wrong guess would desynchronize the entire stream.

## Findings used to design the reader

- SCM instructions begin with a 16-bit little-endian opcode ID.
- The high bit (`0x8000`) denotes a negated/negative condition; the canonical opcode is the low 15 bits.
- Each typed argument begins with a one-byte data-type tag. The GTA SA argument table documents immediate signed integers, variables, float values, arrays, fixed strings and length-prefixed strings.
- Array argument records carry a base variable index, an index-variable index, an element count and flags.
- Variadic commands use a zero data-type byte to terminate the argument list; GTA SA allows up to 32 arguments.
- Opcode `0x05B6` is followed by a raw 128-byte table payload.
- The command's parameter count is metadata external to the byte stream. `SASCM.ini` provides opcode IDs, parameter counts and descriptions; it must match the intended game version.

## Important deliberate limits

- This code does not execute a script, call native functions, access files, or perform networking.
- It does not guess the `main.scm` segment table. Header pointer candidates can be scanned separately, but their meaning must be validated against the exact user's file.
- Tags `0x14..0x1F` are rejected until their target-version semantics are established.
- The decoder is for the PC San Andreas SCM family. Mobile/other GTA SCM variants must use separate catalogues and format adapters.
- A successful decode is not proof that mission behaviour is faithfully implemented.

## Required local inputs for the next milestone

1. `data/script/main.scm` from the user's installed PC game.
2. `data/script/script.img` (and its matching `.dir` if present) for streamed mission/support scripts.
3. The exact PC game executable version (for example, 1.0 US) and the matching opcode definition file `SASCM.ini` from Sanny Builder's `data/sa` mode, or an equivalent version-matched opcode catalogue.

Keep these files local. Do not commit or publish the scripts, IMG archives, extracted game assets, audio, EXE or DLLs.

## References consulted

- Grand Theft Wiki, “Mission Scripting (Overview)”, sections on opcode encoding, SCM data types, strings and arrays: https://www.grandtheftwiki.com/Mission_Scripting_(Overview)
- Sanny Builder documentation, “Opcodes”: https://docs.sannybuilder.com/language/instructions/opcodes
- Sanny Builder documentation, “Opcodes List (SCM.INI)”: https://docs.sannybuilder.com/edit-modes/opcodes-list-scm.ini
- Sanny Builder Library project description and coverage: https://github.com/sannybuilder/library

These references describe public file-format/tooling information. The implementation in this patch is newly authored and does not import a third-party mission interpreter or include a third-party opcode database.
