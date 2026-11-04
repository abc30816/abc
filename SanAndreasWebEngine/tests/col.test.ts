import { describe, expect, it } from 'vitest';
import { parseCollisionFile } from '../src/formats/col';

describe('COL3 collision mesh', () => {
  it('reads compressed vertices and triangle indices', () => {
    const data = new Uint8Array(148);
    const v = new DataView(data.buffer);
    data.set(new TextEncoder().encode('COL3'), 0);
    v.setUint32(4, data.length - 8, true);
    data.set(new TextEncoder().encode('test_floor'), 8);
    v.setFloat32(32, -1, true); v.setFloat32(36, 0, true); v.setFloat32(40, -1, true);
    v.setFloat32(44, 1, true); v.setFloat32(48, 0, true); v.setFloat32(52, 1, true);
    v.setUint16(72, 0, true); v.setUint16(74, 0, true); v.setUint32(76, 1, true); v.setUint32(80, 2, true);
    v.setUint32(96, 116, true); // vertex offset relative to byte 4
    v.setUint32(100, 136, true); // face offset relative to byte 4
    // Three compressed vertices, fixed-point 1/128, then 2 bytes alignment padding.
    v.setInt16(120, 0, true); v.setInt16(122, 0, true); v.setInt16(124, 0, true);
    v.setInt16(126, 128, true); v.setInt16(128, 0, true); v.setInt16(130, 0, true);
    v.setInt16(132, 0, true); v.setInt16(134, 128, true); v.setInt16(136, 0, true);
    v.setUint16(140, 0, true); v.setUint16(142, 1, true); v.setUint16(144, 2, true);
    const parsed = parseCollisionFile(data, 'test.col');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('test_floor');
    expect([...parsed[0].indices]).toEqual([0, 1, 2]);
    expect(parsed[0].positions[3]).toBe(1);
    expect(parsed[0].positions[7]).toBe(1);
  });
});
