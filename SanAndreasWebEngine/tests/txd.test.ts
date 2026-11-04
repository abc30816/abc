import { describe, expect, it } from 'vitest';
import { parseTxd } from '../src/formats/txd';

function chunk(type: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, type, true); view.setUint32(4, data.length, true); view.setUint32(8, 0x1803ffff, true);
  out.set(data, 12);
  return out;
}
function join(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size); let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}

describe('PC D3D9 TXD texture decoding', () => {
  it('decodes a 4x4 DXT1 red block', () => {
    const native = new Uint8Array(88 + 4 + 8);
    const v = new DataView(native.buffer);
    v.setUint32(0, 9, true);
    native.set(new TextEncoder().encode('red_test'), 8);
    v.setUint32(72, 0, true);
    v.setUint32(76, 0x31545844, true); // DXT1
    v.setUint16(80, 4, true); v.setUint16(82, 4, true);
    native[84] = 8; native[85] = 1; native[87] = 0;
    v.setUint32(88, 8, true);
    v.setUint16(92, 0xf800, true); v.setUint16(94, 0x07e0, true);
    const nativeChunk = chunk(0x15, chunk(0x01, native));
    const dictionaryStruct = new Uint8Array(4);
    new DataView(dictionaryStruct.buffer).setUint16(0, 1, true);
    new DataView(dictionaryStruct.buffer).setUint16(2, 2, true);
    const root = chunk(0x16, join([chunk(0x01, dictionaryStruct), nativeChunk, chunk(0x03, new Uint8Array())]));
    const decoded = parseTxd(root).get('red_test');
    expect(decoded?.width).toBe(4);
    expect(decoded?.rgba[0]).toBe(255);
    expect(decoded?.rgba[1]).toBe(0);
    expect(decoded?.rgba[2]).toBe(0);
    expect(decoded?.rgba[3]).toBe(255);
  });
});


describe('TXD mip-chain bounds', () => {
  it('decodes the base mip and safely advances past the remaining mip records', () => {
    const native = new Uint8Array(88 + 4 + 8 + 4 + 8);
    const v = new DataView(native.buffer);
    v.setUint32(0, 9, true);
    native.set(new TextEncoder().encode('mip_test'), 8);
    v.setUint32(76, 0x31545844, true);
    v.setUint16(80, 4, true); v.setUint16(82, 4, true);
    native[84] = 8; native[85] = 2;
    v.setUint32(88, 8, true);
    v.setUint16(92, 0xf800, true); v.setUint16(94, 0x07e0, true);
    v.setUint32(100, 8, true);
    v.setUint16(104, 0x07e0, true); v.setUint16(106, 0xf800, true);
    const root = chunk(0x16, join([
      chunk(0x01, new Uint8Array(4)),
      chunk(0x15, chunk(0x01, native)),
      chunk(0x03, new Uint8Array()),
    ]));
    const texture = parseTxd(root).get('mip_test');
    expect(texture?.width).toBe(4);
    expect([...texture!.rgba.slice(0, 4)]).toEqual([255, 0, 0, 255]);
  });
});
