import { BinaryReader } from './binary';
import { findRwChild, readRwChunk, readRwChildren, RW } from './renderware';

export interface DecodedTexture { name: string; width: number; height: number; rgba: Uint8Array; hasAlpha: boolean; format: string; }

function rgb565(value: number): [number, number, number] {
  return [Math.round(((value >>> 11) & 31) * 255 / 31), Math.round(((value >>> 5) & 63) * 255 / 63), Math.round((value & 31) * 255 / 31)];
}
function mix(a: number, b: number, wa: number, wb: number, divisor: number): number { return Math.round((a * wa + b * wb) / divisor); }

function decodeDxt(data: Uint8Array, width: number, height: number, kind: 1 | 2 | 3 | 4 | 5): Uint8Array {
  const output = new Uint8Array(width * height * 4);
  const blockBytes = kind === 1 ? 8 : 16;
  let offset = 0;
  for (let by = 0; by < height; by += 4) {
    for (let bx = 0; bx < width; bx += 4) {
      if (offset + blockBytes > data.length) throw new Error('TXD: truncated DXT mip level');
      let alphaValues: number[] | null = null;
      let colorOffset = offset;
      if (kind === 3 || kind === 2) {
        alphaValues = new Array<number>(16);
        for (let i = 0; i < 16; i++) {
          const packed = data[offset + (i >>> 1)];
          alphaValues[i] = ((i & 1) === 0 ? packed & 15 : packed >>> 4) * 17;
        }
        colorOffset += 8;
      } else if (kind === 5 || kind === 4) {
        const a0 = data[offset], a1 = data[offset + 1];
        let bits = 0n;
        for (let i = 0; i < 6; i++) bits |= BigInt(data[offset + 2 + i]) << BigInt(i * 8);
        const table = [a0, a1];
        if (a0 > a1) {
          for (let i = 1; i <= 6; i++) table.push(Math.round(((7 - i) * a0 + i * a1) / 7));
        } else {
          for (let i = 1; i <= 4; i++) table.push(Math.round(((5 - i) * a0 + i * a1) / 5));
          table.push(0, 255);
        }
        alphaValues = new Array<number>(16);
        for (let i = 0; i < 16; i++) alphaValues[i] = table[Number((bits >> BigInt(i * 3)) & 7n)];
        colorOffset += 8;
      }
      const view = new DataView(data.buffer, data.byteOffset + colorOffset, 8);
      const c0 = view.getUint16(0, true), c1 = view.getUint16(2, true);
      const colorBits = view.getUint32(4, true);
      const p0 = rgb565(c0), p1 = rgb565(c1);
      const palette: [number, number, number, number][] = [
        [p0[0], p0[1], p0[2], 255],
        [p1[0], p1[1], p1[2], 255],
      ];
      const transparentMode = kind === 1 && c0 <= c1;
      if (transparentMode) {
        palette.push([mix(p0[0], p1[0], 1, 1, 2), mix(p0[1], p1[1], 1, 1, 2), mix(p0[2], p1[2], 1, 1, 2), 255]);
        palette.push([0, 0, 0, 0]);
      } else {
        palette.push([mix(p0[0], p1[0], 2, 1, 3), mix(p0[1], p1[1], 2, 1, 3), mix(p0[2], p1[2], 2, 1, 3), 255]);
        palette.push([mix(p0[0], p1[0], 1, 2, 3), mix(p0[1], p1[1], 1, 2, 3), mix(p0[2], p1[2], 1, 2, 3), 255]);
      }
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const local = py * 4 + px;
          const colorIndex = (colorBits >>> (local * 2)) & 3;
          const color = palette[colorIndex];
          const x = bx + px, y = by + py;
          if (x >= width || y >= height) continue;
          const alpha = alphaValues ? alphaValues[local] : color[3];
          const out = (y * width + x) * 4;
          let r = color[0], g = color[1], b = color[2];
          if ((kind === 2 || kind === 4) && alpha > 0) {
            r = Math.min(255, Math.round(r * 255 / alpha));
            g = Math.min(255, Math.round(g * 255 / alpha));
            b = Math.min(255, Math.round(b * 255 / alpha));
          }
          output[out] = r; output[out + 1] = g; output[out + 2] = b; output[out + 3] = alpha;
        }
      }
      offset += blockBytes;
    }
  }
  return output;
}

function decodeUncompressed(data: Uint8Array, width: number, height: number, format: number): Uint8Array {
  const output = new Uint8Array(width * height * 4);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const pixels = width * height;
  const require = (n: number): void => { if (data.byteLength < n) throw new Error('TXD: uncompressed texture is truncated'); };
  if (format === 21 || format === 22) {
    const stride = format === 21 ? 4 : 3; require(pixels * stride);
    for (let i = 0; i < pixels; i++) {
      const src = i * stride, dst = i * 4;
      output[dst] = data[src + 2]; output[dst + 1] = data[src + 1]; output[dst + 2] = data[src]; output[dst + 3] = format === 21 ? data[src + 3] : 255;
    }
    return output;
  }
  if (format === 50 || format === 51) {
    const stride = format === 50 ? 1 : 2; require(pixels * stride);
    for (let i = 0; i < pixels; i++) {
      const luma = data[i * stride], alpha = format === 51 ? data[i * stride + 1] : 255;
      output.set([luma, luma, luma, alpha], i * 4);
    }
    return output;
  }
  require(pixels * 2);
  for (let i = 0; i < pixels; i++) {
    const value = view.getUint16(i * 2, true);
    let r = 0, g = 0, b = 0, a = 255;
    if (format === 23) { [r, g, b] = rgb565(value); }
    else if (format === 24) { r = ((value >>> 10) & 31) * 255 / 31; g = ((value >>> 5) & 31) * 255 / 31; b = (value & 31) * 255 / 31; }
    else if (format === 25) { a = (value & 0x8000) ? 255 : 0; r = ((value >>> 10) & 31) * 255 / 31; g = ((value >>> 5) & 31) * 255 / 31; b = (value & 31) * 255 / 31; }
    else if (format === 26) { a = ((value >>> 12) & 15) * 17; r = ((value >>> 8) & 15) * 17; g = ((value >>> 4) & 15) * 17; b = (value & 15) * 17; }
    else throw new Error(`TXD: unsupported D3D9 pixel format ${format}`);
    output.set([r, g, b, a], i * 4);
  }
  return output;
}

function decodeNativeStruct(reader: BinaryReader, structOffset: number, structSize: number): DecodedTexture | null {
  if (structSize < 88) throw new Error('TXD: short D3D9 native texture header');
  const platform = reader.u32(structOffset);
  if (platform !== 9) return null;
  const name = reader.ascii(structOffset + 8, 32).toLowerCase();
  const flags = reader.u32(structOffset + 72);
  const d3dFormat = reader.u32(structOffset + 76);
  const width = reader.u16(structOffset + 80);
  const height = reader.u16(structOffset + 82);
  const depth = reader.u8(structOffset + 84);
  const levels = Math.max(1, reader.u8(structOffset + 85));
  const platformFlags = reader.u8(structOffset + 87);
  if (!name || !width || !height || width > 8192 || height > 8192 || levels > 16) return null;
  const paletteType = (flags >>> 13) & 3;
  const paletteBytes = paletteType === 1 ? 1024 : paletteType === 0 ? 0 : (depth === 4 ? 64 : 128);
  // Each mip level is stored as uint32 byteLength followed by its pixel payload.
  // The browser currently uploads the top level and asks WebGL to generate lower levels,
  // but we still walk and bounds-check the complete mip chain so a bad tail cannot be
  // mistaken for the next RenderWare chunk.
  let p = structOffset + 88 + paletteBytes;
  let topLevel: Uint8Array | null = null;
  for (let level = 0; level < levels; level++) {
    if (p + 4 > structOffset + structSize) throw new Error(`${name}: TXD mip ${level} length is missing`);
    const pixelLength = reader.u32(p); p += 4;
    if (pixelLength > structOffset + structSize - p) throw new Error(`${name}: TXD mip ${level} exceeds native section`);
    if (level === 0) topLevel = reader.slice(p, pixelLength).slice();
    p += pixelLength;
  }
  if (!topLevel) throw new Error(`${name}: TXD has no base mip level`);
  const pixels = topLevel;
  let rgba: Uint8Array;
  let formatName: string;
  if (d3dFormat === 0x31545844) { rgba = decodeDxt(pixels, width, height, 1); formatName = 'DXT1'; }
  else if (d3dFormat === 0x32545844) { rgba = decodeDxt(pixels, width, height, 2); formatName = 'DXT2'; }
  else if (d3dFormat === 0x33545844) { rgba = decodeDxt(pixels, width, height, 3); formatName = 'DXT3'; }
  else if (d3dFormat === 0x34545844) { rgba = decodeDxt(pixels, width, height, 4); formatName = 'DXT4'; }
  else if (d3dFormat === 0x35545844) { rgba = decodeDxt(pixels, width, height, 5); formatName = 'DXT5'; }
  else { rgba = decodeUncompressed(pixels, width, height, d3dFormat); formatName = `D3D${d3dFormat}`; }
  const formatHasAlpha = [0x32545844, 0x33545844, 0x34545844, 0x35545844, 21, 25, 26, 51].includes(d3dFormat);
  return { name, width, height, rgba, hasAlpha: (platformFlags & 1) !== 0 || formatHasAlpha, format: formatName };
}

export function parseTxd(bytes: Uint8Array, label = 'TXD'): Map<string, DecodedTexture> {
  const reader = new BinaryReader(bytes, label);
  const result = new Map<string, DecodedTexture>();
  let offset = 0;
  while (offset + 12 <= bytes.byteLength) {
    const root = readRwChunk(reader, offset, bytes.byteLength);
    offset = root.end;
    if (root.type !== RW.TEXTURE_DICTIONARY) continue;
    const struct = findRwChild(reader, root, RW.STRUCT);
    if (!struct || struct.size < 4) continue;
    const count = reader.u16(struct.dataOffset);
    if (count > 4096) throw new Error(`${label}: unreasonable texture count`);
    const natives = readRwChildren(reader, root).filter((child) => child.type === RW.TEXTURE_NATIVE);
    for (const native of natives) {
      const nativeStruct = findRwChild(reader, native, RW.STRUCT);
      if (!nativeStruct) continue;
      try {
        const decoded = decodeNativeStruct(reader, nativeStruct.dataOffset, nativeStruct.size);
        if (decoded) result.set(decoded.name, decoded);
      } catch (error) {
        // Keep the rest of a valid dictionary usable when one texture is unsupported
        // (for example, a paletted or malformed platform-specific entry).
        console.warn(`${label}: skipped one native texture: ${(error as Error).message}`);
      }
    }
  }
  return result;
}
