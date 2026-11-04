import { describe, expect, it } from 'vitest';
import { LocalAssetStreamer, createImgArchiveEntryLoader, createLocalBlobLoader } from '../../src/streaming/LocalAssetStreamer';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('local asset streaming queue', () => {
  it('deduplicates concurrent reads and pins the shared cache entry per lease', async () => {
    const streamer = new LocalAssetStreamer({ maxResidentBytes: 64, maxEntryBytes: 64, maxConcurrentLoads: 2 });
    let reads = 0;
    const loader = async () => { reads += 1; await tick(); return new Uint8Array([1, 2, 3]); };
    const [one, two] = await Promise.all([streamer.load('models/test.dff', loader), streamer.load('models/test.dff', loader)]);

    expect(reads).toBe(1);
    expect(one.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(streamer.stats().residentBytes).toBe(3);
    expect(streamer.clearUnused()).toBe(0);

    one.release();
    two.release();
    expect(streamer.clearUnused()).toBe(1);
    expect(streamer.stats().residentBytes).toBe(0);
    streamer.dispose();
  });

  it('runs queued work by priority while preserving FIFO order for ties', async () => {
    const streamer = new LocalAssetStreamer({ maxResidentBytes: 64, maxEntryBytes: 64, maxConcurrentLoads: 1 });
    const started: string[] = [];
    let unblock!: () => void;
    const gate = new Promise<void>((resolve) => { unblock = resolve; });
    const first = streamer.load('first', async () => { started.push('first'); await gate; return new Uint8Array([1]); });
    await tick();
    const low = streamer.load('low', async () => { started.push('low'); return new Uint8Array([2]); }, { priority: 1 });
    const highA = streamer.load('high-a', async () => { started.push('high-a'); return new Uint8Array([3]); }, { priority: 10 });
    const highB = streamer.load('high-b', async () => { started.push('high-b'); return new Uint8Array([4]); }, { priority: 10 });
    unblock();
    const leases = await Promise.all([first, low, highA, highB]);

    expect(started).toEqual(['first', 'high-a', 'high-b', 'low']);
    for (const lease of leases) lease.release();
    streamer.dispose();
  });

  it('enforces entry and resident budgets without evicting leased assets', async () => {
    const streamer = new LocalAssetStreamer({ maxResidentBytes: 4, maxEntryBytes: 4, maxConcurrentLoads: 1 });
    const first = await streamer.load('one', async () => new Uint8Array([1, 2, 3, 4]));
    await expect(streamer.load('two', async () => new Uint8Array([5]))).rejects.toThrow(/fully leased/);
    first.release();
    const second = await streamer.load('two', async () => new Uint8Array([5]));
    expect(streamer.stats().residentBytes).toBe(1);
    second.release();
    streamer.dispose();
  });

  it('loads a selected Blob map by normalized relative path', async () => {
    const files = new Map<string, Blob>([['MODELS\\GTA3.IMG', new Blob([new Uint8Array([7, 8])])]]);
    const makeLoader = createLocalBlobLoader(files);
    const streamer = new LocalAssetStreamer({ maxResidentBytes: 64, maxEntryBytes: 64 });
    const lease = await streamer.load('models/gta3.img', makeLoader('models/gta3.img'));
    expect([...lease.bytes]).toEqual([7, 8]);
    lease.release();
    streamer.dispose();
  });

  it('checks Blob size before allocating its ArrayBuffer copy', async () => {
    const tooLarge = new Blob([new Uint8Array(9)]);
    const makeLoader = createLocalBlobLoader(new Map([['models/large.img', tooLarge]]), 8);
    const streamer = new LocalAssetStreamer({ maxResidentBytes: 16, maxEntryBytes: 16 });
    await expect(streamer.load('models/large.img', makeLoader('models/large.img'))).rejects.toThrow(/pre-read limit/);
    expect(streamer.stats().residentBytes).toBe(0);
    streamer.dispose();
  });

  it('reads one entry from the existing IMG archive reader without copying the whole archive', async () => {
    const entry = { name: 'building.dff' };
    const archive = {
      name: 'gta3.img',
      async read(requested: typeof entry) {
        expect(requested).toBe(entry);
        return new Uint8Array([4, 5, 6]);
      },
    };
    const streamer = new LocalAssetStreamer({ maxResidentBytes: 64, maxEntryBytes: 64 });
    const lease = await streamer.load('gta3.img:building.dff', createImgArchiveEntryLoader(archive, entry), { priority: 100 });
    expect([...lease.bytes]).toEqual([4, 5, 6]);
    lease.release();
    streamer.dispose();
  });

  it('rejects loads after disposal and oversized entries', async () => {
    const streamer = new LocalAssetStreamer({ maxResidentBytes: 4, maxEntryBytes: 2 });
    await expect(streamer.load('too-large', async () => new Uint8Array([1, 2, 3]))).rejects.toThrow(/entry limit/);
    streamer.dispose();
    await expect(streamer.load('closed', async () => new Uint8Array([1]))).rejects.toThrow(/disposed/);
  });
});
