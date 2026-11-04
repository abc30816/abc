import { describe, expect, it } from 'vitest';
import { decodeScmArgument, decodeScmCode, decodeScmInstruction, scanScmHeaderJumpCandidates, ScmDecodeError } from '../../src/formats/scm';

const oneArg = new Map([[0x0001, { opcode: 0x0001, name: 'wait', parameterCount: 1 }]]);

 describe('SCM typed argument decoder', () => {
  it('decodes signed immediate integers and advances exactly', () => {
    const bytes = new Uint8Array([0x01, 0x04, 0xff]);
    const decoded = decodeScmArgument(bytes, 0);
    expect(decoded.argument).toMatchObject({ type: 'int8', value: -1, offset: 0, size: 2 });
    expect(decoded.nextOffset).toBe(2);
  });

  it('decodes float32 without changing its value', () => {
    const bytes = new Uint8Array([0x06, 0x00, 0x00, 0x80, 0x3f]);
    expect(decodeScmArgument(bytes, 0).argument).toMatchObject({ type: 'float32', value: 1 });
  });

  it('decodes array metadata and keeps flags', () => {
    const bytes = new Uint8Array([0x07, 0x96, 0x00, 0x03, 0x00, 0x06, 0x81]);
    expect(decodeScmArgument(bytes, 0).argument).toMatchObject({
      type: 'array', baseScope: 'global', baseIndex: 150, indexScope: 'global', indexVariable: 3,
      elementCount: 6, elementKind: 'number', flags: 0x81,
    });
  });

  it('decodes an eight-byte immediate string', () => {
    const bytes = new Uint8Array([0x09, 0x4d, 0x41, 0x49, 0x4e, 0, 0, 0, 0]);
    expect(decodeScmArgument(bytes, 0).argument).toMatchObject({ type: 'string', encoding: 'fixed-8', value: 'MAIN' });
  });

  it('decodes a length-prefixed string with a strict length bound', () => {
    const bytes = new Uint8Array([0x0e, 0x03, 0x41, 0x42, 0x43]);
    const decoded = decodeScmArgument(bytes, 0);
    expect(decoded.argument).toMatchObject({ type: 'string', encoding: 'length-prefixed', value: 'ABC' });
    expect(decoded.nextOffset).toBe(5);
    expect(() => decodeScmArgument(bytes, 0, 4)).toThrow(ScmDecodeError);
  });

  it('rejects undocumented tags instead of desynchronizing later opcodes', () => {
    expect(() => decodeScmArgument(new Uint8Array([0x14, 0, 0, 0, 0, 0, 0, 0, 0]), 0)).toThrow(/Unsupported or undocumented/);
  });
});

describe('SCM instruction decoder', () => {
  it('decodes a fixed-arity WAIT-style instruction', () => {
    const bytes = new Uint8Array([0x01, 0x00, 0x04, 0x00]);
    const decoded = decodeScmInstruction(bytes, 0, oneArg);
    expect(decoded).toMatchObject({ opcode: 1, name: 'wait', negativeCondition: false, nextOffset: 4 });
    expect(decoded.arguments[0]).toMatchObject({ type: 'int8', value: 0 });
  });

  it('normalizes the conditional-negation bit without losing the encoded opcode', () => {
    const bytes = new Uint8Array([0x01, 0x80, 0x04, 0x01]);
    const decoded = decodeScmInstruction(bytes, 0, oneArg);
    expect(decoded).toMatchObject({ encodedOpcode: 0x8001, opcode: 1, negativeCondition: true });
  });

  it('decodes a variadic argument list through its 00 terminator', () => {
    const catalogue = new Map([[0x004f, { opcode: 0x004f, name: 'create_thread', variadic: true }]]);
    const bytes = new Uint8Array([0x4f, 0x00, 0x04, 0x7f, 0x05, 0x34, 0x12, 0x00]);
    const decoded = decodeScmInstruction(bytes, 0, catalogue);
    expect(decoded.arguments).toHaveLength(2);
    expect(decoded.nextOffset).toBe(8);
  });

  it('handles the documented 128-byte table payload', () => {
    const bytes = new Uint8Array(130);
    bytes[0] = 0xb6;
    bytes[1] = 0x05;
    const decoded = decodeScmInstruction(bytes, 0, new Map());
    expect(decoded.name).toBe('DEFINE_128_BYTE_TABLE');
    expect(decoded.rawPayload).toHaveLength(128);
    expect(decoded.nextOffset).toBe(130);
  });

  it('fails closed when an opcode signature is missing', () => {
    expect(() => decodeScmInstruction(new Uint8Array([0x34, 0x12]), 0, new Map())).toThrow(/refusing to guess/);
  });

  it('decodes a bounded code range with consecutive instructions', () => {
    const bytes = new Uint8Array([0x01, 0x00, 0x04, 0x01, 0x01, 0x00, 0x04, 0x02]);
    expect(decodeScmCode(bytes, oneArg)).toHaveLength(2);
    expect(() => decodeScmCode(bytes, oneArg, { maxInstructions: 1 })).toThrow(/instruction limit/);
  });

  it('reports bounded SCM header jump-marker candidates without assigning segment meanings', () => {
    const bytes = new Uint8Array([0x02, 0x00, 0x01, 0x10, 0x00, 0x00, 0x00, 0, 0, 0, 0, 0x02, 0x00, 0x01, 0x18, 0x00, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0]);
    expect(scanScmHeaderJumpCandidates(bytes)).toEqual([
      { markerOffset: 0, targetOffset: 16 },
      { markerOffset: 11, targetOffset: 24 },
    ]);
  });
});
