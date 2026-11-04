# GTA San Andreas executable: static compatibility map

This note records only observations from a read-only PE inspection of the user-provided `gta_sa.exe` and its companion DLLs on 2026-11-04. No executable or DLL was launched. It is not a malware verdict and is not a full decompilation.

## Executable format

- Windows PE32, Intel i386 (32-bit), GUI subsystem.
- Preferred image base `0x00400000`; image size `0x020E0000`.
- Entry point RVA `0x00425330`.
- Symbols and base relocations are stripped. The import table is small compared with the size of the program because large engine systems are statically linked or exposed through middleware.

## Imported compatibility boundaries

| Native dependency | Observed use/imports | Browser-side replacement to implement |
|---|---|---|
| `WINMM.dll` | `timeBeginPeriod`, `timeEndPeriod`, `timeGetTime`, `timeGetDevCaps` | Fixed-step simulation driven by `requestAnimationFrame` and `performance.now`; clamp long tab-suspension deltas. |
| `vorbisfile.dll` | `ov_open_callbacks`, `ov_clear`, `ov_time_total`, `ov_time_tell`, `ov_read`, `ov_info`, `ov_time_seek` | Browser audio pipeline using Web Audio / supported media decoding; maintain seek and streaming semantics where needed. |
| `WS2_32.dll` | Imports by ordinal (names unavailable in this inspection) | Do not infer a particular network protocol from ordinal imports alone. Isolate networking behind a disabled-by-default adapter until its calls are identified. |
| `EAX.DLL` | Import by ordinal; companion DLL exports EAX DirectSound entry points | Web Audio spatialization and effects graph; EAX presets need explicit mapping, not direct DLL reuse. |
| `KERNEL32.dll` | File I/O, file mapping, threads, synchronization, virtual memory, timers, locale and resource APIs | Browser-selected local files/Blob slices, Web Workers, typed-array memory, IndexedDB/Cache Storage, browser timers. |
| `USER32.dll`, `GDI32.dll`, `OLE32.dll`, `ADVAPI32.dll` | Windows UI, graphics/system and COM support imports | Browser DOM/canvas/input APIs, WebGL/WebGPU, browser permissions and platform APIs. Specific routines require call-site analysis before mapping. |

## Engine/data references found in the binary

Strings include references to `MODELS\\GTA3.IMG`, `MODELS\\GTA_INT.IMG`, `main.scm`, `DATA\\GTA.DAT`, `DATA\\WEAPON.DAT`, `DATA\\PED.DAT`, `AUDIO\\SFX`, `AUDIO\\STREAMS`, RenderWare 3.6 identifiers and D3D9 RenderWare pipeline identifiers. These strings identify likely data and subsystem boundaries; by themselves they do not reveal function semantics.

## Companion libraries

- `ogg.dll` and `vorbis.dll` form part of the Ogg/Vorbis decoding chain used by `vorbisfile.dll`.
- `eax.dll` provides legacy EAX/DirectSound integration and is not directly loadable by a browser.
- All supplied PE files are 32-bit Windows binaries, not WebAssembly modules.

## `stream.ini` values observed

| Key | Value |
|---|---:|
| `memory` | `13500` |
| `devkit_memory` | `13500` |
| `vehicles` | `12` |
| `pe_lightchangerate` | `0.0005` |
| `pe_lightingbasecap` | `0.35` |
| `pe_lightingbasemult` | `0.5` |
| `pe_leftx`, `pe_topy`, `pe_rightx`, `pe_bottomy` | `16` each |
| `dontbuildpaths` | present as a flag |

The browser implementation preserves these values as legacy settings. It does **not** assume `memory=13500` means 13,500 MB. A separate conservative browser memory budget must be computed for the current device.

## Reverse-engineering limits and safety

- No native executable or DLL execution, debugger, dynamic tracing, patching, or decompilation was performed.
- The PE has stripped symbols, so import inspection and strings are not enough to recover function bodies.
- Do not publish the executable, DLLs, game archives, extracted game assets, audio or mission data in the public repository.
- Implement new browser adapters from documented file formats and independently verified behavior. Do not transplant proprietary machine code or claim that static strings prove runtime behavior.
