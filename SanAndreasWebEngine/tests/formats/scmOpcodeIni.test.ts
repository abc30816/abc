import { describe, expect, it } from 'vitest';
import { parseScmOpcodeIni } from '../../src/mission/scmOpcodeIni';

describe('SASCM.ini metadata reader', () => {
  it('reads opcode ID, arity and description while ignoring metadata/comments', () => {
    const ini = '; generated list\nVERSION=1\n0001=1, wait %1d% ms\n004F=0, create_thread %1p%\n0913=0, launch_mission %1d%';
    const map = parseScmOpcodeIni(ini);
    expect(map.get(1)).toMatchObject({ opcode: 1, name: 'wait %1d% ms', parameterCount: 1 });
    expect(map.get(0x004f)).toMatchObject({ opcode: 0x004f, name: 'create_thread %1p%', variadic: true });
    expect(map.get(0x0913)).toMatchObject({ variadic: true });
  });

  it('uses the last duplicate entry', () => {
    const map = parseScmOpcodeIni('0001=1, first\n0001=2, second');
    expect(map.get(1)).toMatchObject({ parameterCount: 2, name: 'second' });
  });

  it('rejects implausible argument counts', () => {
    expect(() => parseScmOpcodeIni('0001=33, too many')).toThrow(/SA limit is 32/);
  });

  it('rejects an empty or wrong-version list', () => {
    expect(() => parseScmOpcodeIni('VERSION=1\n; no opcodes')).toThrow(/No GTA SA opcode entries/);
  });
});
