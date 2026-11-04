import { describe, expect, it } from 'vitest';
import { indexGameFolder } from '../src/core/GameFiles';

function localFile(path: string, bytes: Uint8Array | string): File {
  const file = new File([bytes], path.split('/').at(-1) ?? 'file.bin');
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

describe('local game folder indexing', () => {
  it('resolves binary streamed IPL ids through text IDE definitions', async () => {
    const archive = new Uint8Array(4096);
    const av = new DataView(archive.buffer);
    archive.set(new TextEncoder().encode('VER2'), 0);
    av.setUint32(4, 1, true);
    av.setUint32(8, 1, true); // data begins at sector 1
    av.setUint16(12, 1, true);
    av.setUint16(14, 1, true);
    archive.set(new TextEncoder().encode('stream0.ipl'), 16);

    const binaryIpl = new Uint8Array(116);
    const iv = new DataView(binaryIpl.buffer);
    binaryIpl.set(new TextEncoder().encode('bnry'), 0);
    iv.setUint32(4, 1, true);
    iv.setUint32(28, 76, true);
    iv.setFloat32(76, 2495, true); iv.setFloat32(80, -1675, true); iv.setFloat32(84, 13.4, true);
    iv.setFloat32(100, 1, true);
    iv.setInt32(104, 100, true); iv.setInt32(108, 0, true); iv.setInt32(112, -1, true);
    archive.set(binaryIpl, 2048);

    const exe = localFile('SA/gta_sa.exe', 'MZ');
    const img = localFile('SA/models/gta3.img', archive);
    const ide = localFile('SA/data/test.ide', 'objs\n100, streetlamp, generic, 100, 200, 0\nend\n');
    const game = await indexGameFolder([exe, img, ide]);

    expect(game.archives).toHaveLength(1);
    expect(game.ide.get(100)?.modelName).toBe('streetlamp');
    expect(game.instances).toHaveLength(1);
    expect(game.instances[0].id).toBe(100);
    expect(game.instances[0].source).toBe('gta3.img:stream0.ipl');
  });
});

describe('GTA.DAT resource linking', () => {
  it('indexes referenced IMG/IDE/IPL resources and keeps script sources separate', async () => {
    const archive = new Uint8Array(6144);
    const av = new DataView(archive.buffer);
    archive.set(new TextEncoder().encode('VER2'), 0);
    av.setUint32(4, 2, true);
    // Binary IPL entry in sector 1.
    av.setUint32(8, 1, true);
    av.setUint16(12, 1, true);
    av.setUint16(14, 1, true);
    archive.set(new TextEncoder().encode('stream0.ipl'), 16);
    // Script entry in sector 2.
    av.setUint32(40, 2, true);
    av.setUint16(44, 1, true);
    av.setUint16(46, 1, true);
    archive.set(new TextEncoder().encode('intro.scm'), 48);

    const exe = localFile('SA/gta_sa.exe', 'MZ');
    const img = localFile('SA/models/gta3.img', archive);
    const ide = localFile('SA/data/test.ide', 'objs\n100, streetlamp, generic, 100, 200, 0\nend\n');
    const ipl = localFile('SA/data/test.ipl', 'inst\nend\n');
    const gtaDat = localFile('SA/data/gta.dat', 'IDE DATA/test.ide\nIPL DATA/test.ipl\nIMG MODELS/gta3.img\n');
    const mainScm = localFile('SA/data/script/main.scm', new Uint8Array([0, 0]));
    const game = await indexGameFolder([exe, img, ide, ipl, gtaDat, mainScm]);

    expect(game.manifest?.resources.map((item) => item.kind)).toEqual(['ide', 'ipl', 'img']);
    expect(game.scriptFiles.has('sa/data/script/main.scm')).toBe(true);
    expect(game.scriptEntries.has('intro.scm')).toBe(true);
    expect(game.warnings.some((warning) => warning.includes('referenced'))).toBe(false);
  });
});
