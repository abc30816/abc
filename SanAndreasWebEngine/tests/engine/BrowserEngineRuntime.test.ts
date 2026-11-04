import { describe, expect, it } from 'vitest';
import { BrowserEngineRuntime } from '../../src/engine/BrowserEngineRuntime';
import type { GameFileSet } from '../../src/core/GameFiles';

describe('browser engine runtime', () => {
  it('connects the selected local file map to bounded streaming and WASM physics', async () => {
    const file = new File([new Uint8Array([11, 12, 13])], 'gta3.img');
    const game = { files: new Map<string, File>([['models/gta3.img', file]]) } as unknown as GameFileSet;
    const runtime = await BrowserEngineRuntime.create(game, { deviceMemoryGB: 2 });
    try {
      const lease = await runtime.loadLocalFile('models/gta3.img');
      expect([...lease.bytes]).toEqual([11, 12, 13]);
      expect(runtime.assets.stats().residentBytes).toBe(3);
      lease.release();
    } finally {
      runtime.dispose();
    }
  }, 20_000);


  it('reads stream.ini locally and preserves legacy units instead of treating memory as bytes', async () => {
    const streamIni = new File([
      'memory 13500\nvehicles 12\npe_lightchangerate 0.0005\ndontbuildpaths\n',
    ], 'stream.ini');
    const game = {
      gameRoot: 'san-andreas/',
      files: new Map<string, File>([['san-andreas/stream.ini', streamIni]]),
    } as unknown as GameFileSet;
    const runtime = await BrowserEngineRuntime.create(game, { deviceMemoryGB: 2 });
    try {
      const config = await runtime.readLegacyStreamConfig();
      expect(config?.path).toBe('san-andreas/stream.ini');
      expect(config?.settings.memory).toBe(13_500);
      expect(config?.settings.vehicles).toBe(12);
      expect(config?.settings.dontBuildPaths).toBe(true);
      expect(runtime.assets.maxResidentBytes).toBe(48 * 1024 * 1024);
    } finally {
      runtime.dispose();
    }
  }, 20_000);

  it('loads one requested archive entry without reading the full archive', async () => {
    const game = { files: new Map<string, File>() } as unknown as GameFileSet;
    const runtime = await BrowserEngineRuntime.create(game);
    const entry = { name: 'grove.dff' };
    let requestedReads = 0;
    const archive = {
      name: 'gta3.img',
      async read(readEntry: typeof entry) {
        expect(readEntry).toBe(entry);
        requestedReads += 1;
        return new Uint8Array([21, 22]);
      },
    };
    try {
      const lease = await runtime.loadArchiveEntry(archive, entry, 200);
      expect([...lease.bytes]).toEqual([21, 22]);
      expect(requestedReads).toBe(1);
      lease.release();
    } finally {
      runtime.dispose();
    }
  }, 20_000);
});
