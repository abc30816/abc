import { openImgArchive, type ImgArchive, type ImgEntry } from '../formats/img';
import { parseTextIde, type IdeObject } from '../formats/ide';
import { parseBinaryIpl, parseTextIpl, type IplInstance } from '../formats/ipl';
import { parseCollisionFile, type CollisionModel } from '../formats/col';
import { parseTxd, type DecodedTexture } from '../formats/txd';
import { parseGtaDat, resolveGtaDatPath, type GtaDatManifest } from '../formats/gtaDat';

export interface GameFileSet {
  files: Map<string, File>;
  gameRoot: string;
  archives: ImgArchive[];
  ide: Map<number, IdeObject>;
  instances: IplInstance[];
  modelEntries: Map<string, { archive: ImgArchive; entry: ImgEntry }>;
  collisions: Map<string, CollisionModel>;
  textureEntries: Map<string, { archive: ImgArchive; entry: ImgEntry }>;
  scriptEntries: Map<string, { archive: ImgArchive; entry: ImgEntry }>;
  scriptFiles: Map<string, File>;
  manifest: GtaDatManifest | null;
  warnings: string[];
}

function normalPath(path: string): string { return path.replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase(); }

export async function indexGameFolder(fileList: FileList | File[]): Promise<GameFileSet> {
  const files = new Map<string, File>();
  for (const file of Array.from(fileList)) {
    const path = normalPath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name);
    files.set(path, file);
  }
  const exePath = [...files.keys()].find((path) => path.endsWith('/gta_sa.exe') || path === 'gta_sa.exe');
  if (!exePath) throw new Error('Could not find gta_sa.exe. Select the main game folder, not the models folder.');
  const gameRoot = exePath.slice(0, exePath.length - 'gta_sa.exe'.length);
  const warnings: string[] = [];
  const gtaDatFile = [...files.entries()].find(([path]) => path === `${gameRoot}data/gta.dat` || path.endsWith('/data/gta.dat'))?.[1];
  let manifest: GtaDatManifest | null = null;
  if (gtaDatFile) {
    try { manifest = parseGtaDat(await gtaDatFile.text()); }
    catch (error) { warnings.push(`data/gta.dat: ${(error as Error).message}`); }
  }

  const imgFiles = [...files.entries()].filter(([path]) => path.startsWith(gameRoot) && path.endsWith('.img'));
  const manifestImagePaths = new Map<string, number>();
  for (const resource of manifest?.resources ?? []) {
    if (resource.path && (resource.kind === 'img' || resource.kind === 'cdimage')) {
      manifestImagePaths.set(resolveGtaDatPath(gameRoot, resource.path), manifestImagePaths.size);
    }
  }
  imgFiles.sort(([a], [b]) => (manifestImagePaths.get(a) ?? Number.MAX_SAFE_INTEGER) - (manifestImagePaths.get(b) ?? Number.MAX_SAFE_INTEGER));
  const archives: ImgArchive[] = [];
  for (const [path, file] of imgFiles) {
    const dir = files.get(path.slice(0, -4) + '.dir');
    try { archives.push(await openImgArchive(file, dir)); }
    catch (error) { warnings.push(`${path.slice(gameRoot.length)}: ${(error as Error).message}`); }
  }
  if (!archives.length) throw new Error('No readable IMG archives found under models/. Check that models/gta3.img exists.');

  const modelEntries = new Map<string, { archive: ImgArchive; entry: ImgEntry }>();
  const textureEntries = new Map<string, { archive: ImgArchive; entry: ImgEntry }>();
  const scriptEntries = new Map<string, { archive: ImgArchive; entry: ImgEntry }>();
  for (const archive of archives) {
    for (const [name, entry] of archive.entries) {
      if (name.endsWith('.dff') && !modelEntries.has(name.slice(0, -4))) modelEntries.set(name.slice(0, -4), { archive, entry });
      if (name.endsWith('.txd') && !textureEntries.has(name.slice(0, -4))) textureEntries.set(name.slice(0, -4), { archive, entry });
      if ((name.endsWith('.scm') || name.endsWith('.cs')) && !scriptEntries.has(name)) scriptEntries.set(name, { archive, entry });
    }
  }

  const ide = new Map<number, IdeObject>();
  const instances: IplInstance[] = [];
  const collisions = new Map<string, CollisionModel>();
  for (const [path, file] of files) {
    if (path.startsWith(gameRoot + 'models/coll/') && path.endsWith('.col')) {
      try {
        const models = parseCollisionFile(new Uint8Array(await file.arrayBuffer()), path);
        for (const model of models) if (model.name) collisions.set(model.name, model);
      } catch (error) { warnings.push(`${path}: COL parse failed: ${(error as Error).message}`); }
      continue;
    }
    if (!path.startsWith(gameRoot + 'data/')) continue;
    if (path.endsWith('.ide')) {
      try {
        const parsed = parseTextIde(new Uint8Array(await file.arrayBuffer()));
        for (const item of parsed) ide.set(item.id, item);
      } catch (error) { warnings.push(`${path}: IDE parse failed: ${(error as Error).message}`); }
    } else if (path.endsWith('.ipl')) {
      try {
        const parsed = parseTextIpl(new Uint8Array(await file.arrayBuffer()), path.slice(gameRoot.length));
        instances.push(...parsed);
      } catch (error) { warnings.push(`${path}: IPL parse failed: ${(error as Error).message}`); }
    }
  }
  // Streaming IPLs are stored as binary bnry entries inside IMG archives. Their model
  // references are numeric IDE ids, which the world streamer resolves through `ide`.
  for (const archive of archives) {
    for (const entry of archive.entries.values()) {
      if (!entry.name.endsWith('.ipl')) continue;
      try {
        const bytes = new Uint8Array(await archive.read(entry));
        const parsed = parseBinaryIpl(bytes, `${archive.name}:${entry.name}`);
        if (parsed?.length) instances.push(...parsed);
      } catch (error) {
        warnings.push(`${archive.name}:${entry.name}: binary IPL parse failed: ${(error as Error).message}`);
      }
    }
  }
  if (!instances.length) warnings.push('No text or binary INST placements were found. Check that the selected folder includes data/maps and the streamed IMG archives.');
  if (manifest) {
    warnings.push(...manifest.issues.map((issue) => `gta.dat:${issue.line}: ${issue.message}`));
    for (const resource of manifest.resources) {
      if (!resource.path) continue;
      const resolved = resolveGtaDatPath(gameRoot, resource.path);
      if (!files.has(resolved)) warnings.push(`gta.dat:${resource.sourceLine}: referenced ${resource.path} was not selected.`);
    }
  }
  const scriptFiles = new Map([...files.entries()].filter(([path]) => path.startsWith(`${gameRoot}data/script/`) && /\.(?:scm|ini|dat)$/i.test(path)));
  return { files, gameRoot, archives, ide, instances, modelEntries, collisions, textureEntries, scriptEntries, scriptFiles, manifest, warnings };

}

export async function readModelDff(game: GameFileSet, modelName: string): Promise<Uint8Array | null> {
  const item = game.modelEntries.get(modelName.toLowerCase());
  if (!item) return null;
  return new Uint8Array(await item.archive.read(item.entry));
}


export async function readTextureDictionary(game: GameFileSet, dictionaryName: string): Promise<Map<string, DecodedTexture> | null> {
  const found = game.textureEntries.get(dictionaryName.toLowerCase());
  if (!found) return null;
  const bytes = new Uint8Array(await found.archive.read(found.entry));
  return parseTxd(bytes, `${dictionaryName}.txd`);
}
