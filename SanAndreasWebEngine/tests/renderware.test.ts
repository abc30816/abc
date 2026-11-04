import { describe, expect, it } from 'vitest';
import { BinaryReader } from '../src/formats/binary';
import { readRwChunk } from '../src/formats/renderware';

describe('RenderWare chunk bounds', () => {
  it('reads a valid 12-byte header', () => {
    const bytes = new Uint8Array(16);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 1, true); view.setUint32(4, 4, true); view.setUint32(8, 0x1803ffff, true);
    const chunk = readRwChunk(new BinaryReader(bytes), 0);
    expect(chunk.type).toBe(1);
    expect(chunk.size).toBe(4);
    expect(chunk.end).toBe(16);
  });
  it('rejects a chunk that extends past its containing file', () => {
    const bytes = new Uint8Array(12);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 16, true); view.setUint32(4, 100, true);
    expect(() => readRwChunk(new BinaryReader(bytes), 0)).toThrow(/exceeds parent/);
  });
});
