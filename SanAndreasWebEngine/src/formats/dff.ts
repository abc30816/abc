import { BinaryReader } from './binary';
import { findRwChild, readRwChunk, readRwChildren, RW, type RwChunk } from './renderware';

export interface DffFrame {
  basis: number[];
  position: [number, number, number];
  parent: number;
  name: string;
}
export interface DffMaterial { color: [number, number, number, number]; textureName: string | null; }
export interface DffGeometry {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Uint8Array;
  indices: Uint32Array;
  materialIds: Uint16Array;
  native: boolean;
  materials: DffMaterial[];
}
export interface DffAtomic { frameIndex: number; geometryIndex: number; }
export interface DffModel { frames: DffFrame[]; geometries: DffGeometry[]; atomics: DffAtomic[]; version: number; warnings: string[]; }

const MAX_VERTICES = 2_000_000;
const MAX_TRIANGLES = 4_000_000;

function descendants(reader: BinaryReader, root: RwChunk, wanted: number, depth = 0): RwChunk[] {
  if (depth > 12) return [];
  const result: RwChunk[] = [];
  for (const child of readRwChildren(reader, root)) {
    if (child.type === wanted) result.push(child);
    if ([RW.CLUMP, RW.FRAME_LIST, RW.GEOMETRY_LIST, RW.GEOMETRY, RW.MATERIAL_LIST, RW.MATERIAL, RW.TEXTURE, RW.ATOMIC, RW.EXTENSION].includes(child.type as never)) {
      result.push(...descendants(reader, child, wanted, depth + 1));
    }
  }
  return result;
}

function parseFrameList(reader: BinaryReader, frameList: RwChunk): DffFrame[] {
  const struct = findRwChild(reader, frameList, RW.STRUCT);
  if (!struct) return [];
  const count = reader.u32(struct.dataOffset);
  if (count > 100_000 || struct.dataOffset + 4 + count * 56 > struct.end) throw new Error('DFF: invalid frame list length');
  const frames: DffFrame[] = [];
  let p = struct.dataOffset + 4;
  for (let i = 0; i < count; i++, p += 56) {
    const basis: number[] = [];
    for (let j = 0; j < 9; j++) basis.push(reader.f32(p + j * 4));
    const position: [number, number, number] = [reader.f32(p + 36), reader.f32(p + 40), reader.f32(p + 44)];
    frames.push({ basis, position, parent: reader.i32(p + 48), name: `frame_${i}` });
  }
  // Rockstar Frame plugin commonly stores an ASCII node name. Keep fallback names if absent.
  const extensions = readRwChildren(reader, frameList).filter((c) => c.type === RW.EXTENSION);
  if (extensions.length) {
    const framePlugins = descendants(reader, extensions[0], 0x253f2fe);
    for (let i = 0; i < Math.min(frames.length, framePlugins.length); i++) {
      const plugin = framePlugins[i];
      if (plugin.size >= 4) {
        const raw = reader.ascii(plugin.dataOffset, Math.min(plugin.size, 64));
        if (raw) frames[i].name = raw;
      }
    }
  }
  return frames;
}

function parseMaterials(reader: BinaryReader, geometry: RwChunk): DffMaterial[] {
  const list = findRwChild(reader, geometry, RW.MATERIAL_LIST);
  if (!list) return [{ color: [190, 190, 190, 255], textureName: null }];
  const struct = findRwChild(reader, list, RW.STRUCT);
  if (!struct || struct.size < 4) return [{ color: [190, 190, 190, 255], textureName: null }];
  const count = reader.u32(struct.dataOffset);
  if (count > 4096 || struct.size < 4 + count * 4) throw new Error('DFF: unreasonable material list');
  const definitions = readRwChildren(reader, list).filter((c) => c.type === RW.MATERIAL);
  const parsedDefinitions: DffMaterial[] = [];
  for (const material of definitions) {
    const mStruct = findRwChild(reader, material, RW.STRUCT);
    if (!mStruct || mStruct.size < 12) { parsedDefinitions.push({ color: [190, 190, 190, 255], textureName: null }); continue; }
    const at = mStruct.dataOffset;
    const color: [number, number, number, number] = [reader.u8(at + 4), reader.u8(at + 5), reader.u8(at + 6), reader.u8(at + 7)];
    const texture = readRwChildren(reader, material).find((c) => c.type === RW.TEXTURE);
    let textureName: string | null = null;
    if (texture) {
      const strings = readRwChildren(reader, texture).filter((c) => c.type === RW.STRING);
      if (strings[0] && strings[0].size > 0) textureName = reader.ascii(strings[0].dataOffset, strings[0].size).toLowerCase();
    }
    parsedDefinitions.push({ color, textureName });
  }
  const materials: DffMaterial[] = [];
  let nextDefinition = 0;
  for (let i = 0; i < count; i++) {
    const reference = reader.i32(struct.dataOffset + 4 + i * 4);
    if (reference < 0) {
      materials.push(parsedDefinitions[nextDefinition++] ?? { color: [190, 190, 190, 255], textureName: null });
    } else {
      materials.push(materials[reference] ?? { color: [190, 190, 190, 255], textureName: null });
    }
  }
  return materials.length ? materials : [{ color: [190, 190, 190, 255], textureName: null }];
}

function parseBinMesh(reader: BinaryReader, geometry: RwChunk, vertexCount: number): { indices: Uint32Array; materialIds: Uint16Array } | null {
  const extension = readRwChildren(reader, geometry).find((child) => child.type === RW.EXTENSION);
  if (!extension) return null;
  const plugin = readRwChildren(reader, extension).find((child) => child.type === RW.BIN_MESH);
  if (!plugin || plugin.size < 12) return null;
  let p = plugin.dataOffset;
  const flags = reader.u32(p); p += 4;
  const splits = reader.u32(p); p += 4;
  const totalIndices = reader.u32(p); p += 4;
  if (splits > 4096 || totalIndices > MAX_TRIANGLES * 3) throw new Error('DFF: BinMesh size exceeds safety limit');
  const indices: number[] = [];
  const materialIds: number[] = [];
  for (let split = 0; split < splits; split++) {
    const count = reader.u32(p); const material = reader.u32(p + 4); p += 8;
    if (count > totalIndices || p + count * 4 > plugin.end) throw new Error('DFF: invalid BinMesh split length');
    const run: number[] = [];
    for (let i = 0; i < count; i++) {
      const index = reader.u32(p); p += 4;
      if (index >= vertexCount) throw new Error(`DFF: BinMesh index ${index} is outside ${vertexCount} vertices`);
      run.push(index);
    }
    if (flags === 0) {
      for (let i = 0; i + 2 < run.length; i += 3) {
        indices.push(run[i], run[i + 1], run[i + 2]);
        materialIds.push(material);
      }
    } else if (flags === 1) {
      for (let i = 2; i < run.length; i++) {
        const a = run[i - 2], b = run[i - 1], c = run[i];
        if (a === b || b === c || a === c) continue;
        if (i % 2 === 0) indices.push(a, b, c); else indices.push(b, a, c);
        materialIds.push(material);
      }
    } else {
      throw new Error(`DFF: unsupported BinMesh primitive flag ${flags}`);
    }
  }
  if (indices.length / 3 > MAX_TRIANGLES) throw new Error('DFF: decoded BinMesh triangle count exceeds safety limit');
  return { indices: new Uint32Array(indices), materialIds: new Uint16Array(materialIds) };
}

function parseGeometry(reader: BinaryReader, chunk: RwChunk): DffGeometry {
  const struct = findRwChild(reader, chunk, RW.STRUCT);
  if (!struct) throw new Error('DFF: geometry is missing its struct');
  const p0 = struct.dataOffset;
  const format = reader.u32(p0);
  const triangleCount = reader.u32(p0 + 4);
  const vertexCount = reader.u32(p0 + 8);
  const morphCount = reader.u32(p0 + 12);
  const native = (format & 0x01000000) !== 0;
  if (vertexCount > MAX_VERTICES || triangleCount > MAX_TRIANGLES || morphCount > 64) throw new Error('DFF: geometry count exceeds safety limit');
  if (native) return { positions: new Float32Array(), normals: new Float32Array(), uvs: new Float32Array(), colors: new Uint8Array(), indices: new Uint32Array(), materialIds: new Uint16Array(), native: true, materials: parseMaterials(reader, chunk) };

  let p = p0 + 16;
  const isPrelit = (format & 0x8) !== 0;
  const uvRaw = (format >>> 16) & 0xff;
  const uvCount = uvRaw || ((format & 0x80) ? 2 : ((format & 0x4) ? 1 : 0));
  if (uvCount > 8) throw new Error(`DFF: unsupported UV layer count ${uvCount}`);
  const colors = isPrelit ? reader.slice(p, vertexCount * 4).slice() : new Uint8Array();
  if (isPrelit) p += vertexCount * 4;
  const uv = new Float32Array(vertexCount * 2);
  for (let layer = 0; layer < uvCount; layer++) {
    for (let i = 0; i < vertexCount; i++) {
      const u = reader.f32(p); const v = reader.f32(p + 4); p += 8;
      if (layer === 0) { uv[i * 2] = u; uv[i * 2 + 1] = 1 - v; }
    }
  }
  const triangles = new Uint32Array(triangleCount * 3);
  const matIds = new Uint16Array(triangleCount);
  for (let i = 0; i < triangleCount; i++) {
    const v2 = reader.u16(p); const v1 = reader.u16(p + 2); const material = reader.u16(p + 4); const v3 = reader.u16(p + 6); p += 8;
    triangles[i * 3] = v1; triangles[i * 3 + 1] = v2; triangles[i * 3 + 2] = v3;
    matIds[i] = material;
  }

  let indices = triangles;
  let materialIds = matIds;
  const binMesh = parseBinMesh(reader, chunk, vertexCount);
  if (binMesh) { indices = binMesh.indices; materialIds = binMesh.materialIds; }
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  for (let target = 0; target < morphCount; target++) {
    p += 16; // Bounding sphere
    const hasVertices = reader.u32(p); p += 4;
    const hasNormals = reader.u32(p); p += 4;
    if (hasVertices) {
      for (let i = 0; i < vertexCount; i++) {
        const x = reader.f32(p), y = reader.f32(p + 4), z = reader.f32(p + 8); p += 12;
        if (target === 0) { positions[i * 3] = x; positions[i * 3 + 1] = z; positions[i * 3 + 2] = -y; }
      }
    }
    if (hasNormals) {
      for (let i = 0; i < vertexCount; i++) {
        const x = reader.f32(p), y = reader.f32(p + 4), z = reader.f32(p + 8); p += 12;
        if (target === 0) { normals[i * 3] = x; normals[i * 3 + 1] = z; normals[i * 3 + 2] = -y; }
      }
    }
  }
  return { positions, normals, uvs: uv, colors, indices, materialIds, native: false, materials: parseMaterials(reader, chunk) };
}

function parseAtomics(reader: BinaryReader, clump: RwChunk): DffAtomic[] {
  const result: DffAtomic[] = [];
  for (const chunk of readRwChildren(reader, clump).filter((c) => c.type === RW.ATOMIC)) {
    const struct = findRwChild(reader, chunk, RW.STRUCT);
    if (!struct || struct.size < 16) continue;
    result.push({ frameIndex: reader.u32(struct.dataOffset), geometryIndex: reader.u32(struct.dataOffset + 4) });
  }
  return result;
}

export function parseDff(bytes: Uint8Array, label = 'DFF'): DffModel {
  const reader = new BinaryReader(bytes, label);
  const roots: RwChunk[] = [];
  let cursor = 0;
  while (cursor + 12 <= bytes.byteLength) {
    const chunk = readRwChunk(reader, cursor, bytes.byteLength);
    roots.push(chunk); cursor = chunk.end;
  }
  const clump = roots.find((c) => c.type === RW.CLUMP);
  if (!clump) throw new Error(`${label}: no RenderWare clump root found`);
  const children = readRwChildren(reader, clump);
  const frameList = children.find((c) => c.type === RW.FRAME_LIST);
  const geometryList = children.find((c) => c.type === RW.GEOMETRY_LIST);
  if (!frameList || !geometryList) throw new Error(`${label}: clump is missing frame/geometry list`);
  const geoChildren = readRwChildren(reader, geometryList).filter((c) => c.type === RW.GEOMETRY);
  const geometries = geoChildren.map((c) => parseGeometry(reader, c));
  const warnings: string[] = [];
  const nativeCount = geometries.filter((g) => g.native).length;
  if (nativeCount) warnings.push(`${nativeCount} native geometry block(s) require D3D9-native decoding; skipped in this milestone`);
  return {
    frames: parseFrameList(reader, frameList),
    geometries,
    atomics: parseAtomics(reader, clump),
    version: clump.version,
    warnings,
  };
}
