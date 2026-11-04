import { describe, expect, it } from 'vitest';
import { parseDff } from '../src/formats/dff';

function chunk(type: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, type, true);
  view.setUint32(4, data.length, true);
  view.setUint32(8, 0x1803ffff, true);
  out.set(data, 12);
  return out;
}
function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

function fixture(): Uint8Array {
  const frame = new Uint8Array(60);
  const fv = new DataView(frame.buffer);
  fv.setUint32(0, 1, true);
  [1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 20, 30].forEach((value, i) => fv.setFloat32(4 + i * 4, value, true));
  fv.setInt32(52, -1, true);
  const frameList = chunk(0x0e, join([chunk(0x01, frame), chunk(0x03, new Uint8Array())]));

  const geometryStruct = new Uint8Array(16 + 24 + 8 + 16 + 8 + 36);
  const gv = new DataView(geometryStruct.buffer);
  gv.setUint32(0, 0x04, true); // textured, one UV set
  gv.setUint32(4, 1, true); gv.setUint32(8, 3, true); gv.setUint32(12, 1, true);
  let p = 16;
  [[0, 0], [1, 0], [0, 1]].forEach(([u, v]) => { gv.setFloat32(p, u, true); gv.setFloat32(p + 4, v, true); p += 8; });
  gv.setUint16(p, 1, true); gv.setUint16(p + 2, 0, true); gv.setUint16(p + 4, 0, true); gv.setUint16(p + 6, 2, true); p += 8;
  gv.setFloat32(p + 12, 1, true); p += 16; // bounding sphere radius
  gv.setUint32(p, 1, true); gv.setUint32(p + 4, 0, true); p += 8;
  [[0, 0, 0], [1, 0, 0], [0, 1, 0]].forEach(([x, y, z]) => { gv.setFloat32(p, x, true); gv.setFloat32(p + 4, y, true); gv.setFloat32(p + 8, z, true); p += 12; });

  const materialListStruct = new Uint8Array(8);
  const mlv = new DataView(materialListStruct.buffer);
  mlv.setUint32(0, 1, true); mlv.setInt32(4, -1, true);
  const materialStruct = new Uint8Array(16);
  materialStruct.set([255, 255, 255, 255], 4);
  const material = chunk(0x07, chunk(0x01, materialStruct));
  const materialList = chunk(0x08, join([chunk(0x01, materialListStruct), material]));

  const binMesh = new Uint8Array(32);
  const bv = new DataView(binMesh.buffer);
  bv.setUint32(0, 0, true); bv.setUint32(4, 1, true); bv.setUint32(8, 3, true);
  bv.setUint32(12, 3, true); bv.setUint32(16, 0, true);
  bv.setUint32(20, 0, true); bv.setUint32(24, 1, true); bv.setUint32(28, 2, true);
  const geometry = chunk(0x0f, join([chunk(0x01, geometryStruct), materialList, chunk(0x03, chunk(0x050e, binMesh))]));

  const geometryListStruct = new Uint8Array(4);
  new DataView(geometryListStruct.buffer).setUint32(0, 1, true);
  const geometryList = chunk(0x1a, join([chunk(0x01, geometryListStruct), geometry]));
  const atomicStruct = new Uint8Array(16);
  const av = new DataView(atomicStruct.buffer);
  av.setUint32(0, 0, true); av.setUint32(4, 0, true);
  const atomic = chunk(0x14, chunk(0x01, atomicStruct));
  const clumpStruct = new Uint8Array(12);
  new DataView(clumpStruct.buffer).setUint32(0, 1, true);
  return chunk(0x10, join([chunk(0x01, clumpStruct), frameList, geometryList, atomic, chunk(0x03, new Uint8Array())]));
}

describe('RenderWare DFF subset', () => {
  it('reads a non-native mesh, frame, atomic and BinMesh indices', () => {
    const model = parseDff(fixture(), 'triangle.dff');
    expect(model.frames).toHaveLength(1);
    expect(model.frames[0].position).toEqual([10, 20, 30]);
    expect(model.geometries).toHaveLength(1);
    expect(model.geometries[0].native).toBe(false);
    expect([...model.geometries[0].indices]).toEqual([0, 1, 2]);
    expect([...model.geometries[0].materialIds]).toEqual([0]);
    expect(model.atomics).toEqual([{ frameIndex: 0, geometryIndex: 0 }]);
  });
});
