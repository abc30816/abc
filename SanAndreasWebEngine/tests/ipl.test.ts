import { describe, expect, it } from 'vitest';
import { parseBinaryIpl, parseTextIpl } from '../src/formats/ipl';

describe('San Andreas text IPL', () => {
  it('reads INST rows using interior and quaternion fields', () => {
    const text = 'inst\n100, streetlamp, 0, 2495.0, -1675.0, 13.4, 0, 0, 0, 1, -1\nend\n';
    const rows = parseTextIpl(new TextEncoder().encode(text), 'data/maps/test.ipl');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 100, modelName: 'streetlamp', interior: 0, position: [2495, -1675, 13.4], lod: -1 });
  });
});


describe('San Andreas binary streaming IPL', () => {
  it('reads bnry INST records and keeps the numeric IDE id', () => {
    const data = new Uint8Array(116);
    const view = new DataView(data.buffer);
    data.set(new TextEncoder().encode('bnry'), 0);
    view.setUint32(4, 1, true);
    view.setUint32(28, 76, true);
    view.setFloat32(76, 2495, true); view.setFloat32(80, -1675, true); view.setFloat32(84, 13.4, true);
    view.setFloat32(88, 0, true); view.setFloat32(92, 0, true); view.setFloat32(96, 0, true); view.setFloat32(100, 1, true);
    view.setInt32(104, 100, true); view.setInt32(108, 0, true); view.setInt32(112, -1, true);
    const rows = parseBinaryIpl(data, 'gta3.img:test_stream.ipl');
    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({ id: 100, modelName: '', interior: 0, lod: -1 });
    expect(rows?.[0].position[0]).toBe(2495);
    expect(rows?.[0].position[1]).toBe(-1675);
    expect(rows?.[0].position[2]).toBeCloseTo(13.4, 2);
  });
  it('returns null for a text IPL input', () => {
    expect(parseBinaryIpl(new TextEncoder().encode('inst\nend\n'), 'text.ipl')).toBeNull();
  });
});
