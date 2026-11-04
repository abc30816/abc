import { describe, expect, it } from 'vitest';
import { parseGtaDat, resolveGtaDatPath } from '../../src/formats/gtaDat';

describe('gta.dat resource manifest', () => {
  it('parses common resource directives and normalizes separators', () => {
    const manifest = parseGtaDat(`; classic PC manifest\nIDE DATA\\MAPS\\generic.ide\nIPL DATA\\MAPS\\LA\\LAe.ipl\nCOLFILE 0 MODELS\\COLL\\LA.COL\nIMG MODELS\\GTA3.IMG\nCDIMAGE MODELS\\GTA_INT.IMG\n`);
    expect(manifest.resources.map((item) => item.kind)).toEqual(['ide', 'ipl', 'col', 'img', 'cdimage']);
    expect(manifest.resources[0]?.path).toBe('data/maps/generic.ide');
    expect(manifest.resources[2]?.path).toBe('models/coll/la.col');
    expect(resolveGtaDatPath('SA/', manifest.resources[3]!.path!)).toBe('sa/models/gta3.img');
  });

  it('rejects path traversal and absolute paths rather than resolving outside the game folder', () => {
    const manifest = parseGtaDat('IMG ..\\outside.img\nIPL C:\\Windows\\bad.ipl\n');
    expect(manifest.resources.every((item) => item.path === null)).toBe(true);
    expect(manifest.issues).toHaveLength(2);
  });

  it('retains unknown directives without guessing a file path', () => {
    const manifest = parseGtaDat('SPLASH some-opaque-value\n');
    expect(manifest.resources[0]?.kind).toBe('unknown');
    expect(manifest.resources[0]?.path).toBeNull();
  });
});
