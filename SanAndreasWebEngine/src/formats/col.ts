import { BinaryReader } from './binary';

export interface CollisionModel {
  name: string;
  version: 1 | 2 | 3;
  positions: Float32Array;
  indices: Uint32Array;
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

const MAX_FACES = 2_000_000;
const MAX_MODELS = 100_000;

function vec3(reader: BinaryReader, at: number): [number, number, number] {
  return [reader.f32(at), reader.f32(at + 4), reader.f32(at + 8)];
}

function parseCol23(reader: BinaryReader, start: number, end: number, version: 2 | 3, name: string): CollisionModel {
  // Offsets in COL2/COL3 are relative to the byte immediately after the FourCC.
  const base = start + 4;
  const sphereCount = reader.u16(start + 72);
  const boxCount = reader.u16(start + 74);
  const faceCount = reader.u32(start + 76);
  const flags = reader.u32(start + 80);
  const verticesOffset = reader.u32(start + 96);
  const facesOffset = reader.u32(start + 100);
  if (faceCount > MAX_FACES) throw new Error(`${name}: excessive collision face count`);
  const min = vec3(reader, start + 32);
  const max = vec3(reader, start + 44);
  if (faceCount === 0) return { name, version, positions: new Float32Array(), indices: new Uint32Array(), bounds: { min, max } };
  const facesAt = base + facesOffset;
  const verticesAt = base + verticesOffset;
  if (facesAt < start || facesAt + faceCount * 8 > end) throw new Error(`${name}: collision faces exceed model bounds`);
  if (verticesAt < start || verticesAt >= end) throw new Error(`${name}: invalid collision vertex offset`);
  const indices = new Uint32Array(faceCount * 3);
  let maxVertex = -1;
  for (let i = 0; i < faceCount; i++) {
    const at = facesAt + i * 8;
    const a = reader.u16(at), b = reader.u16(at + 2), c = reader.u16(at + 4);
    indices[i * 3] = a; indices[i * 3 + 1] = b; indices[i * 3 + 2] = c;
    maxVertex = Math.max(maxVertex, a, b, c);
  }
  const vertexCount = maxVertex + 1;
  if (vertexCount > 0) {
    const bytesNeeded = vertexCount * 6;
    if (verticesAt + bytesNeeded > end) throw new Error(`${name}: collision vertices exceed model bounds`);
    const positions = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      positions[i * 3] = reader.i16(verticesAt + i * 6) / 128;
      positions[i * 3 + 1] = reader.i16(verticesAt + i * 6 + 2) / 128;
      positions[i * 3 + 2] = reader.i16(verticesAt + i * 6 + 4) / 128;
    }
    return { name, version, positions, indices, bounds: { min, max } };
  }
  void sphereCount; void boxCount; void flags;
  return { name, version, positions: new Float32Array(), indices: new Uint32Array(), bounds: { min, max } };
}

export function parseCollisionFile(bytes: Uint8Array, label = 'COL'): CollisionModel[] {
  const reader = new BinaryReader(bytes, label);
  const models: CollisionModel[] = [];
  let offset = 0;
  while (offset + 8 <= bytes.byteLength) {
    const fourcc = reader.ascii(offset, 4);
    const size = reader.u32(offset + 4);
    const end = offset + 8 + size;
    if (end > bytes.byteLength || end <= offset + 8) throw new Error(`${label}: invalid model size at ${offset}`);
    const name = reader.ascii(offset + 8, 24).toLowerCase();
    if (fourcc === 'COL2' || fourcc === 'COL3') {
      models.push(parseCol23(reader, offset, end, fourcc === 'COL2' ? 2 : 3, name));
    } else if (fourcc === 'COLL') {
      // COL1 uses 32-bit vertices/faces and a different body layout; deliberately report, don't misread it.
      models.push({ name, version: 1, positions: new Float32Array(), indices: new Uint32Array(), bounds: { min: [0, 0, 0], max: [0, 0, 0] } });
    } else {
      throw new Error(`${label}: unknown collision FourCC "${fourcc}" at ${offset}`);
    }
    if (models.length > MAX_MODELS) throw new Error(`${label}: too many collision models`);
    offset = end;
  }
  return models;
}
