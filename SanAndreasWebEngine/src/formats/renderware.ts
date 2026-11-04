import { BinaryReader } from './binary';

export const RW = {
  STRUCT: 0x01, STRING: 0x02, EXTENSION: 0x03, TEXTURE: 0x06, MATERIAL: 0x07,
  MATERIAL_LIST: 0x08, FRAME_LIST: 0x0e, GEOMETRY: 0x0f, CLUMP: 0x10,
  ATOMIC: 0x14, TEXTURE_NATIVE: 0x15, TEXTURE_DICTIONARY: 0x16, GEOMETRY_LIST: 0x1a,
  BIN_MESH: 0x050e, NATIVE_DATA: 0x0510,
} as const;

export interface RwChunk {
  type: number;
  size: number;
  version: number;
  offset: number;
  dataOffset: number;
  end: number;
}

export function readRwChunk(reader: BinaryReader, offset: number, limit = reader.bytes.byteLength): RwChunk {
  if (offset + 12 > limit) throw new Error(`RenderWare: incomplete chunk header at ${offset}`);
  const type = reader.u32(offset);
  let size = reader.u32(offset + 4);
  const version = reader.u32(offset + 8);
  // RenderWare uses this high bit as a lock marker in selected Struct/Texture chunks.
  if ((type === RW.STRUCT || type === RW.TEXTURE) && (size & 0x01000000) !== 0) size &= ~0x01000000;
  const end = offset + 12 + size;
  if (!Number.isSafeInteger(end) || end > limit) throw new Error(`RenderWare: chunk 0x${type.toString(16)} exceeds parent at ${offset}`);
  return { type, size, version, offset, dataOffset: offset + 12, end };
}

export function readRwChildren(reader: BinaryReader, parent: RwChunk): RwChunk[] {
  const children: RwChunk[] = [];
  let cursor = parent.dataOffset;
  while (cursor + 12 <= parent.end) {
    const child = readRwChunk(reader, cursor, parent.end);
    children.push(child);
    cursor = child.end;
  }
  // Padding of fewer than 12 bytes is permitted by some exporters.
  return children;
}

export function findRwChild(reader: BinaryReader, parent: RwChunk, type: number): RwChunk | undefined {
  return readRwChildren(reader, parent).find((child) => child.type === type);
}
