import { BinaryReader, decodeText } from './binary';

export interface IplInstance {
  id: number;
  modelName: string;
  interior: number;
  position: [number, number, number];
  rotation: [number, number, number, number];
  lod: number;
  source: string;
}

function fields(line: string): string[] {
  return line.split(',').map((part) => part.trim().replace(/^['"]|['"]$/g, ''));
}

export function parseTextIpl(bytes: Uint8Array, source: string): IplInstance[] {
  const text = decodeText(bytes);
  // Refuse binary IPL data instead of accidentally parsing it as thousands of bogus rows.
  const sample = text.slice(0, Math.min(text.length, 2048));
  const printable = [...sample].filter((c) => c === '\n' || c === '\r' || c === '\t' || c >= ' ').length;
  if (sample.length && printable / sample.length < 0.92) return [];

  const result: IplInstance[] = [];
  let section = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const low = line.toLowerCase();
    if (low === 'end') { section = ''; continue; }
    if (/^[a-z][a-z0-9_]*$/i.test(line)) { section = low; continue; }
    if (section !== 'inst') continue;
    const v = fields(line);
    if (v.length < 11) continue;
    const n = v.map((x) => Number(x));
    const id = n[0];
    const interior = n[2];
    const x = n[3], y = n[4], z = n[5];
    const qx = n[6], qy = n[7], qz = n[8], qw = n[9];
    const lod = n[10];
    if (![id, interior, x, y, z, qx, qy, qz, qw, lod].every(Number.isFinite) || !v[1]) continue;
    result.push({ id, modelName: v[1].toLowerCase(), interior, position: [x, y, z], rotation: [qx, qy, qz, qw], lod, source });
  }
  return result;
}


/**
 * Parse the compact San Andreas streaming IPL format ("bnry").
 * The retail layout uses a 76-byte header followed by 40-byte INST records:
 * position + quaternion (7 float32 values), object IDE id, interior and LOD index.
 * Non-binary inputs return null so callers can safely probe IMG entries.
 */
export function parseBinaryIpl(bytes: Uint8Array, source: string): IplInstance[] | null {
  if (bytes.byteLength < 76 || new TextDecoder().decode(bytes.subarray(0, 4)) !== 'bnry') return null;
  const reader = new BinaryReader(bytes, source);
  const count = reader.u32(4);
  const instancesOffset = reader.u32(28) || 76;
  const recordSize = 40;
  if (count > 2_000_000) throw new Error(`${source}: unreasonable binary IPL instance count ${count}`);
  if (instancesOffset < 76 || instancesOffset + count * recordSize > bytes.byteLength) {
    throw new Error(`${source}: binary IPL INST records exceed file bounds`);
  }
  const result: IplInstance[] = [];
  for (let i = 0; i < count; i++) {
    const at = instancesOffset + i * recordSize;
    const x = reader.f32(at), y = reader.f32(at + 4), z = reader.f32(at + 8);
    const qx = reader.f32(at + 12), qy = reader.f32(at + 16), qz = reader.f32(at + 20), qw = reader.f32(at + 24);
    const id = reader.i32(at + 28), interior = reader.i32(at + 32), lod = reader.i32(at + 36);
    if (![x, y, z, qx, qy, qz, qw].every(Number.isFinite) || id < 0 || !Number.isFinite(interior) || !Number.isFinite(lod)) {
      throw new Error(`${source}: invalid binary IPL instance ${i}`);
    }
    result.push({ id, modelName: '', interior, position: [x, y, z], rotation: [qx, qy, qz, qw], lod, source });
  }
  return result;
}

