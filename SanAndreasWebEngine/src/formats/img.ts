import { BinaryReader } from './binary';

export interface ImgEntry {
  readonly name: string;
  readonly offset: number;
  readonly size: number;
}

export interface ImgArchive {
  readonly name: string;
  readonly version: 'VER2' | 'DIR';
  readonly entries: ReadonlyMap<string, ImgEntry>;
  read(entry: ImgEntry): Promise<ArrayBuffer>;
}

const SECTOR = 2048;
const MAX_ENTRIES = 1_000_000;

export async function openImgArchive(imgFile: File, dirFile?: File): Promise<ImgArchive> {
  const head = new Uint8Array(await imgFile.slice(0, 8).arrayBuffer());
  const entries = new Map<string, ImgEntry>();
  let version: ImgArchive['version'];
  if (head.length >= 8 && new TextDecoder().decode(head.subarray(0, 4)) === 'VER2') {
    version = 'VER2';
    const header = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const count = header.getUint32(4, true);
    if (count > MAX_ENTRIES) throw new Error(`${imgFile.name}: unreasonable IMG entry count ${count}`);
    const dirBytes = new Uint8Array(await imgFile.slice(8, 8 + count * 32).arrayBuffer());
    if (dirBytes.byteLength !== count * 32) throw new Error(`${imgFile.name}: truncated VER2 directory`);
    const reader = new BinaryReader(dirBytes, `${imgFile.name} directory`);
    for (let i = 0; i < count; i++) {
      const at = i * 32;
      const sectorOffset = reader.u32(at);
      const streamSectors = reader.u16(at + 4);
      const archiveSectors = reader.u16(at + 6);
      const filename = reader.ascii(at + 8, 24).toLowerCase();
      if (!filename) continue;
      const sectors = streamSectors || archiveSectors;
      const offset = sectorOffset * SECTOR;
      const size = sectors * SECTOR;
      if (!Number.isSafeInteger(offset + size) || offset + size > imgFile.size) continue;
      entries.set(filename, { name: filename, offset, size });
    }
  } else {
    version = 'DIR';
    if (!dirFile) throw new Error(`${imgFile.name}: no VER2 header and matching .dir file is missing`);
    if (dirFile.size % 32 !== 0) throw new Error(`${dirFile.name}: directory length is not divisible by 32`);
    const dirBytes = new Uint8Array(await dirFile.arrayBuffer());
    const reader = new BinaryReader(dirBytes, `${dirFile.name} directory`);
    const count = dirBytes.byteLength / 32;
    if (count > MAX_ENTRIES) throw new Error(`${dirFile.name}: unreasonable IMG entry count ${count}`);
    for (let i = 0; i < count; i++) {
      const at = i * 32;
      const offset = reader.u32(at) * SECTOR;
      const size = reader.u32(at + 4) * SECTOR;
      const filename = reader.ascii(at + 8, 24).toLowerCase();
      if (!filename || offset + size > imgFile.size) continue;
      entries.set(filename, { name: filename, offset, size });
    }
  }
  return {
    name: imgFile.name,
    version,
    entries,
    async read(entry) {
      return imgFile.slice(entry.offset, entry.offset + entry.size).arrayBuffer();
    },
  };
}
