import { describe, expect, it } from 'vitest';
import { openImgArchive } from '../src/formats/img';

function u32(view: DataView, offset: number, value: number): void { view.setUint32(offset, value, true); }
function u16(view: DataView, offset: number, value: number): void { view.setUint16(offset, value, true); }

describe('IMG VER2 directory', () => {
  it('indexes a sector entry and reads its byte range', async () => {
    const bytes = new Uint8Array(4096);
    bytes.set(new TextEncoder().encode('VER2'), 0);
    const view = new DataView(bytes.buffer);
    u32(view, 4, 1);
    u32(view, 8, 1); u16(view, 12, 1); u16(view, 14, 0);
    bytes.set(new TextEncoder().encode('test.dff'), 16);
    bytes.set(new TextEncoder().encode('DFFTEST'), 2048);
    const file = new File([bytes], 'gta3.img');
    const archive = await openImgArchive(file);
    expect(archive.version).toBe('VER2');
    const entry = archive.entries.get('test.dff');
    expect(entry?.offset).toBe(2048);
    const data = new Uint8Array(await archive.read(entry!));
    expect(new TextDecoder().decode(data.slice(0, 7))).toBe('DFFTEST');
  });
});
