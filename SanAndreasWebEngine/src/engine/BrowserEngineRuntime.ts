import type { GameFileSet } from '../core/GameFiles';
import { RapierPhysicsWorld, type PhysicsWorldOptions } from '../physics/RapierPhysicsWorld';
import {
  LocalAssetStreamer,
  createImgArchiveEntryLoader,
  createLocalBlobLoader,
  type AssetLease,
  type ReadableImgArchive,
} from '../streaming/LocalAssetStreamer';
import {
  deriveBrowserStreamingLimits,
  parseStreamIni,
  readLegacyStreamSettings,
  type LegacyStreamSettings,
} from '../config/streamIni';

export interface LegacyStreamConfigResult {
  settings: LegacyStreamSettings;
  warnings: readonly string[];
  path: string;
}

export interface BrowserEngineRuntimeOptions {
  /** Coarse device-memory hint supplied by the browser, when available. */
  deviceMemoryGB?: number;
  physics?: PhysicsWorldOptions;
}

/**
 * Owns the browser-side physics and local-asset lifetimes for one selected game folder.
 * This is intentionally transport-free: it never sends game files to a server.
 */
export class BrowserEngineRuntime {
  readonly physics: RapierPhysicsWorld;
  readonly assets: LocalAssetStreamer;

  private readonly localFileLoader: ReturnType<typeof createLocalBlobLoader>;
  private readonly gameFiles: GameFileSet;
  private disposed = false;

  private constructor(game: GameFileSet, physics: RapierPhysicsWorld, deviceMemoryGB?: number) {
    const limits = deriveBrowserStreamingLimits(deviceMemoryGB);
    this.gameFiles = game;
    this.physics = physics;
    this.assets = new LocalAssetStreamer({
      maxResidentBytes: limits.maxResidentBytes,
      maxEntryBytes: limits.maxEntryBytes,
      maxConcurrentLoads: limits.maxConcurrentLoads,
      maxQueuedLoads: limits.maxQueuedLoads,
    });
    this.localFileLoader = createLocalBlobLoader(game.files, limits.maxEntryBytes);
  }

  static async create(
    game: GameFileSet,
    options: BrowserEngineRuntimeOptions = {},
  ): Promise<BrowserEngineRuntime> {
    const physics = await RapierPhysicsWorld.create(options.physics);
    return new BrowserEngineRuntime(game, physics, options.deviceMemoryGB);
  }

  /** Load one directly selected local file by its normalized relative path. */
  loadLocalFile(relativePath: string, priority = 100): Promise<AssetLease> {
    this.assertOpen();
    const key = relativePath.replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase();
    return this.assets.load(key, this.localFileLoader(relativePath), { priority });
  }

  /**
   * Reads the selected installation's stream.ini as bounded data. If no explicit path is
   * supplied, the game's root stream.ini is preferred, then the first matching basename.
   * Legacy memory values are returned unchanged; they are not used as browser byte budgets.
   */
  async readLegacyStreamConfig(relativePath?: string): Promise<LegacyStreamConfigResult | null> {
    this.assertOpen();
    const normalize = (value: string): string => value.replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase();
    const requested = relativePath ? normalize(relativePath) : undefined;
    const preferred = normalize(`${this.gameFiles.gameRoot}stream.ini`);
    let selected: [string, File] | undefined;
    if (requested) {
      const file = this.gameFiles.files.get(requested);
      if (file) selected = [requested, file];
    } else {
      const candidates = [...this.gameFiles.files.entries()]
        .filter(([path]) => normalize(path).endsWith('/stream.ini') || normalize(path) === 'stream.ini');
      selected = candidates.find(([path]) => normalize(path) === preferred) ?? candidates[0];
    }
    if (!selected) return null;
    const [path, file] = selected;
    if (file.size > 64 * 1024) {
      throw new RangeError(`stream.ini at ${path} exceeds the 65536-byte read limit.`);
    }
    const document = parseStreamIni(await file.text());
    return { settings: readLegacyStreamSettings(document), warnings: document.warnings, path };
  }

  /** Load only one requested entry from an already-indexed IMG archive. */
  loadArchiveEntry<TEntry extends { name: string }>(
    archive: ReadableImgArchive<TEntry>,
    entry: TEntry,
    priority = 100,
  ): Promise<AssetLease> {
    this.assertOpen();
    const key = `${archive.name}:${entry.name}`;
    return this.assets.load(key, createImgArchiveEntryLoader(archive, entry), { priority });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.assets.dispose();
    this.physics.dispose();
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('Browser engine runtime has been disposed.');
  }
}
