/**
 * Bounded, local-only asset streaming queue.
 *
 * Loaders are supplied by the game-file layer (File/Blob or IMG archive reads).
 * This module never performs network requests and never uploads data.
 */

export type AssetLoader = () => Promise<Uint8Array>;

export interface LocalAssetStreamerOptions {
  maxResidentBytes?: number;
  maxEntryBytes?: number;
  maxConcurrentLoads?: number;
  maxQueuedLoads?: number;
}

export interface AssetLease {
  readonly key: string;
  /** Treat the returned bytes as immutable while the lease is held. */
  readonly bytes: Uint8Array;
  release(): void;
}

export interface AssetLoadOptions {
  /** Higher priorities run first. Equal priorities preserve request order. */
  priority?: number;
}

export interface AssetStreamerStats {
  residentBytes: number;
  cachedAssets: number;
  queuedLoads: number;
  activeLoads: number;
  pendingKeys: number;
}

interface CacheEntry {
  key: string;
  bytes: Uint8Array;
  pins: number;
  lastUsed: number;
}

interface PendingJob {
  key: string;
  loader: AssetLoader;
  priority: number;
  sequence: number;
  waiters: number;
  started: boolean;
  settled: boolean;
  promise: Promise<CacheEntry>;
  resolve: (entry: CacheEntry) => void;
  reject: (error: Error) => void;
}

const MIB = 1024 * 1024;

function positiveInteger(value: number, label: string, max: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new RangeError(`${label} must be an integer from 1 through ${max}.`);
  }
  return value;
}

export class LocalAssetStreamer {
  readonly maxResidentBytes: number;
  readonly maxEntryBytes: number;
  readonly maxConcurrentLoads: number;
  readonly maxQueuedLoads: number;

  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, PendingJob>();
  private readonly queue: PendingJob[] = [];
  private residentBytes = 0;
  private activeLoads = 0;
  private sequence = 0;
  private clock = 0;
  private disposed = false;

  constructor(options: LocalAssetStreamerOptions = {}) {
    this.maxResidentBytes = positiveInteger(options.maxResidentBytes ?? 96 * MIB, 'maxResidentBytes', 2 ** 31);
    this.maxEntryBytes = positiveInteger(options.maxEntryBytes ?? 32 * MIB, 'maxEntryBytes', this.maxResidentBytes);
    this.maxConcurrentLoads = positiveInteger(options.maxConcurrentLoads ?? 3, 'maxConcurrentLoads', 16);
    this.maxQueuedLoads = positiveInteger(options.maxQueuedLoads ?? 512, 'maxQueuedLoads', 16_384);
  }

  load(key: string, loader: AssetLoader, options: AssetLoadOptions = {}): Promise<AssetLease> {
    if (this.disposed) return Promise.reject(new Error('Asset streamer has been disposed.'));
    if (!key || key.trim() !== key || key.length > 1_024) {
      return Promise.reject(new TypeError('Asset key must be a non-empty, trimmed string of at most 1024 characters.'));
    }
    if (typeof loader !== 'function') return Promise.reject(new TypeError('Asset loader must be a function.'));
    const priority = options.priority ?? 0;
    if (!Number.isFinite(priority)) return Promise.reject(new TypeError('Asset priority must be finite.'));

    const cached = this.cache.get(key);
    if (cached) {
      cached.pins += 1;
      cached.lastUsed = ++this.clock;
      return Promise.resolve(this.createLease(cached));
    }

    const existing = this.pending.get(key);
    if (existing) {
      existing.waiters += 1;
      if (!existing.started && priority > existing.priority) {
        existing.priority = priority;
        this.sortQueue();
      }
      return existing.promise.then((entry) => this.createLease(entry, true));
    }

    if (this.queue.length >= this.maxQueuedLoads) {
      return Promise.reject(new Error(`Asset queue is full (${this.maxQueuedLoads} queued jobs).`));
    }

    let resolve!: (entry: CacheEntry) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<CacheEntry>((res, rej) => { resolve = res; reject = rej; });
    const job: PendingJob = {
      key,
      loader,
      priority,
      sequence: this.sequence++,
      waiters: 1,
      started: false,
      settled: false,
      promise,
      resolve,
      reject,
    };
    this.pending.set(key, job);
    this.queue.push(job);
    this.sortQueue();
    this.pump();
    return promise.then((entry) => this.createLease(entry, true));
  }

  stats(): AssetStreamerStats {
    return {
      residentBytes: this.residentBytes,
      cachedAssets: this.cache.size,
      queuedLoads: this.queue.length,
      activeLoads: this.activeLoads,
      pendingKeys: this.pending.size,
    };
  }

  /** Evicts every currently unleased asset; leased assets remain valid. */
  clearUnused(): number {
    let evicted = 0;
    for (const [key, entry] of this.cache) {
      if (entry.pins === 0) {
        this.cache.delete(key);
        this.residentBytes -= entry.bytes.byteLength;
        evicted += 1;
      }
    }
    return evicted;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const error = new Error('Asset streamer was disposed before the queued load started.');
    for (const job of this.queue.splice(0)) {
      if (!job.settled) {
        job.settled = true;
        this.pending.delete(job.key);
        job.reject(error);
      }
    }
    this.clearUnused();
  }


  private createLease(entry: CacheEntry, pinAlreadyReserved = false): AssetLease {
    if (!pinAlreadyReserved) entry.pins += 1;
    let released = false;
    return {
      key: entry.key,
      bytes: entry.bytes,
      release: () => {
        if (released) return;
        released = true;
        entry.pins = Math.max(0, entry.pins - 1);
        entry.lastUsed = ++this.clock;
        if (this.disposed && entry.pins === 0 && this.cache.get(entry.key) === entry) {
          this.cache.delete(entry.key);
          this.residentBytes -= entry.bytes.byteLength;
        }
      },
    };
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
  }

  private pump(): void {
    while (!this.disposed && this.activeLoads < this.maxConcurrentLoads && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job || job.settled) continue;
      job.started = true;
      this.activeLoads += 1;
      void this.run(job);
    }
  }

  private async run(job: PendingJob): Promise<void> {
    try {
      const bytes = await job.loader();
      if (!(bytes instanceof Uint8Array)) throw new TypeError(`Asset "${job.key}" loader did not return Uint8Array data.`);
      if (bytes.byteLength > this.maxEntryBytes) {
        throw new RangeError(`Asset "${job.key}" is ${bytes.byteLength} bytes; entry limit is ${this.maxEntryBytes}.`);
      }
      if (this.disposed) throw new Error('Asset streamer was disposed while an asset was loading.');

      this.makeRoom(bytes.byteLength);
      const entry: CacheEntry = {
        key: job.key,
        bytes,
        pins: job.waiters,
        lastUsed: ++this.clock,
      };
      this.cache.set(job.key, entry);
      this.residentBytes += bytes.byteLength;
      this.pending.delete(job.key);
      job.settled = true;
      job.resolve(entry);
    } catch (cause) {
      this.pending.delete(job.key);
      if (!job.settled) {
        job.settled = true;
        job.reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    } finally {
      this.activeLoads = Math.max(0, this.activeLoads - 1);
      this.pump();
    }
  }

  private makeRoom(requiredBytes: number): void {
    if (requiredBytes > this.maxResidentBytes) {
      throw new RangeError(`Asset needs ${requiredBytes} bytes, larger than the resident budget ${this.maxResidentBytes}.`);
    }

    while (this.residentBytes + requiredBytes > this.maxResidentBytes) {
      let oldest: CacheEntry | undefined;
      for (const entry of this.cache.values()) {
        if (entry.pins === 0 && (!oldest || entry.lastUsed < oldest.lastUsed)) oldest = entry;
      }
      if (!oldest) {
        throw new Error('Asset memory budget is fully leased; release unused asset leases before loading more data.');
      }
      this.cache.delete(oldest.key);
      this.residentBytes -= oldest.bytes.byteLength;
    }
  }
}

/** Creates a loader for a browser-selected File/Blob map. No server upload occurs. */
export function createLocalBlobLoader(
  files: ReadonlyMap<string, Blob>,
  maxBlobBytes = 32 * MIB,
): AssetLoaderFactory {
  positiveInteger(maxBlobBytes, 'maxBlobBytes', 2 ** 31);
  const normalized = new Map<string, Blob>();
  for (const [path, blob] of files) {
    normalized.set(path.replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase(), blob);
  }
  return (path: string) => async () => {
    const key = path.replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase();
    const blob = normalized.get(key);
    if (!blob) throw new Error(`Local game file not found: ${path}`);
    // Check Blob metadata before arrayBuffer() allocates a potentially large copy.
    if (blob.size > maxBlobBytes) {
      throw new RangeError(`Local file "${path}" is ${blob.size} bytes; pre-read limit is ${maxBlobBytes}.`);
    }
    return new Uint8Array(await blob.arrayBuffer());
  };
}

export type AssetLoaderFactory = (path: string) => AssetLoader;


/** Creates a loader for one entry in an already-open IMG archive. */
export interface ReadableImgArchive<TEntry extends { name: string }> {
  readonly name: string;
  read(entry: TEntry): Promise<ArrayBuffer | Uint8Array>;
}

export function createImgArchiveEntryLoader<TEntry extends { name: string }>(
  archive: ReadableImgArchive<TEntry>,
  entry: TEntry,
): AssetLoader {
  return async () => {
    const result = await archive.read(entry);
    return result instanceof Uint8Array ? result : new Uint8Array(result);
  };
}
