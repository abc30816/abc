/**
 * Independently implemented, bounds-checked reader for GTA San Andreas SCM
 * instruction arguments. It decodes structure only; it never executes opcodes.
 *
 * A command's argument count must come from a version-matched opcode catalogue.
 * Unknown commands fail closed rather than guessing an instruction boundary.
 */

export type ScmVariableScope = 'global' | 'local';
export type ScmArrayElementKind = 'number' | 'short-string' | 'long-string';

export type ScmArgument =
  | { type: 'int32'; value: number; offset: number; size: 5 }
  | { type: 'global-variable'; index: number; offset: number; size: 3 }
  | { type: 'local-variable'; index: number; offset: number; size: 3 }
  | { type: 'int8'; value: number; offset: number; size: 2 }
  | { type: 'int16'; value: number; offset: number; size: 3 }
  | { type: 'float32'; value: number; offset: number; size: 5 }
  | {
      type: 'array';
      baseScope: ScmVariableScope;
      baseIndex: number;
      indexScope: ScmVariableScope;
      indexVariable: number;
      elementCount: number;
      elementKind: ScmArrayElementKind;
      flags: number;
      offset: number;
      size: 7;
    }
  | { type: 'string'; encoding: 'fixed-8' | 'fixed-16' | 'length-prefixed' | 'tagged-8'; value: string; bytes: Uint8Array; tag: number; offset: number; size: number }
  | { type: 'global-string-variable'; index: number; offset: number; size: 3 }
  | { type: 'local-string-variable'; index: number; offset: number; size: 3 }
  | { type: 'global-long-string-variable'; index: number; offset: number; size: 3 }
  | { type: 'local-long-string-variable'; index: number; offset: number; size: 3 }
  | { type: 'end-arguments'; offset: number; size: 1 };

export interface ScmOpcodeDefinition {
  /** Canonical 15-bit opcode ID (without the conditional-negation bit). */
  opcode: number;
  name: string;
  parameterCount?: number;
  variadic?: boolean;
  /** For special instructions whose payload is raw bytes, not typed arguments. */
  rawPayloadBytes?: number;
}

export type ScmOpcodeCatalogue = ReadonlyMap<number, ScmOpcodeDefinition>;

export interface DecodedScmInstruction {
  offset: number;
  nextOffset: number;
  encodedOpcode: number;
  opcode: number;
  negativeCondition: boolean;
  name: string;
  arguments: ScmArgument[];
  rawPayload?: Uint8Array;
}

export interface ScmDecodeOptions {
  startOffset?: number;
  endOffset?: number;
  maxInstructions?: number;
  maxArgumentsPerInstruction?: number;
  /** Byte strings in PC SCM data are commonly Windows-1252. */
  stringEncoding?: string;
}

export class ScmDecodeError extends Error {
  readonly offset: number;
  readonly code: 'OUT_OF_BOUNDS' | 'UNSUPPORTED_DATA_TYPE' | 'MISSING_OPCODE_SIGNATURE' | 'BAD_OPCODE_SIGNATURE' | 'LIMIT_EXCEEDED';

  constructor(message: string, offset: number, code: ScmDecodeError['code']) {
    super(`${message} (offset 0x${offset.toString(16)})`);
    this.name = 'ScmDecodeError';
    this.offset = offset;
    this.code = code;
  }
}

function assertRange(bytes: Uint8Array, offset: number, length: number, endOffset: number): void {
  if (!Number.isInteger(offset) || !Number.isInteger(length) || length < 0 || offset < 0 || offset + length > endOffset || offset + length > bytes.length) {
    throw new ScmDecodeError(`SCM read of ${length} byte(s) exceeds the supplied range`, offset, 'OUT_OF_BOUNDS');
  }
}

function readU8(bytes: Uint8Array, offset: number, end: number): number {
  assertRange(bytes, offset, 1, end);
  return bytes[offset]!;
}

function readU16(bytes: Uint8Array, offset: number, end: number): number {
  assertRange(bytes, offset, 2, end);
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}

function readI16(bytes: Uint8Array, offset: number, end: number): number {
  assertRange(bytes, offset, 2, end);
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getInt16(0, true);
}

function readI32(bytes: Uint8Array, offset: number, end: number): number {
  assertRange(bytes, offset, 4, end);
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0, true);
}

function readF32(bytes: Uint8Array, offset: number, end: number): number {
  assertRange(bytes, offset, 4, end);
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getFloat32(0, true);
}

function readString(bytes: Uint8Array, offset: number, length: number, encoding: string, end: number): { value: string; bytes: Uint8Array } {
  assertRange(bytes, offset, length, end);
  const raw = bytes.slice(offset, offset + length);
  const terminator = raw.indexOf(0);
  const visible = terminator >= 0 ? raw.subarray(0, terminator) : raw;
  let value: string;
  try {
    value = new TextDecoder(encoding, { fatal: false }).decode(visible);
  } catch {
    value = new TextDecoder('windows-1252', { fatal: false }).decode(visible);
  }
  return { value, bytes: raw };
}

/** Decode one typed SCM argument. This does not infer opcode arity. */
export function decodeScmArgument(
  bytes: Uint8Array,
  offset: number,
  endOffset = bytes.length,
  stringEncoding = 'windows-1252',
): { argument: ScmArgument; nextOffset: number } {
  const typeOffset = offset;
  const dataType = readU8(bytes, offset, endOffset);
  let cursor = offset + 1;

  if (dataType === 0x00) {
    return { argument: { type: 'end-arguments', offset: typeOffset, size: 1 }, nextOffset: cursor };
  }
  if (dataType === 0x01) {
    const value = readI32(bytes, cursor, endOffset);
    return { argument: { type: 'int32', value, offset: typeOffset, size: 5 }, nextOffset: cursor + 4 };
  }
  if (dataType === 0x02 || dataType === 0x03) {
    const index = readU16(bytes, cursor, endOffset);
    const argument: ScmArgument = dataType === 0x02
      ? { type: 'global-variable', index, offset: typeOffset, size: 3 }
      : { type: 'local-variable', index, offset: typeOffset, size: 3 };
    return { argument, nextOffset: cursor + 2 };
  }
  if (dataType === 0x04) {
    assertRange(bytes, cursor, 1, endOffset);
    const value = new DataView(bytes.buffer, bytes.byteOffset + cursor, 1).getInt8(0);
    return { argument: { type: 'int8', value, offset: typeOffset, size: 2 }, nextOffset: cursor + 1 };
  }
  if (dataType === 0x05) {
    const value = readI16(bytes, cursor, endOffset);
    return { argument: { type: 'int16', value, offset: typeOffset, size: 3 }, nextOffset: cursor + 2 };
  }
  if (dataType === 0x06) {
    const value = readF32(bytes, cursor, endOffset);
    return { argument: { type: 'float32', value, offset: typeOffset, size: 5 }, nextOffset: cursor + 4 };
  }

  // Array records are 6 bytes after the type: base index, index-variable
  // index, element count and flags. Preserve all raw flags for future fidelity.
  if (dataType === 0x07 || dataType === 0x08 || dataType === 0x0c || dataType === 0x0d || dataType === 0x12 || dataType === 0x13) {
    assertRange(bytes, cursor, 6, endOffset);
    const baseIndex = readU16(bytes, cursor, endOffset);
    const indexVariable = readU16(bytes, cursor + 2, endOffset);
    const elementCount = readU8(bytes, cursor + 4, endOffset);
    const flags = readU8(bytes, cursor + 5, endOffset);
    const baseScope: ScmVariableScope = dataType === 0x07 || dataType === 0x0c || dataType === 0x12 ? 'global' : 'local';
    const indexScope: ScmVariableScope = (flags & 0x80) !== 0 ? 'global' : 'local';
    const elementKind: ScmArrayElementKind = dataType === 0x07 || dataType === 0x08
      ? ((flags & 0x03) === 2 ? 'short-string' : (flags & 0x03) === 3 ? 'long-string' : 'number')
      : dataType === 0x0c || dataType === 0x0d ? 'short-string' : 'long-string';
    return {
      argument: { type: 'array', baseScope, baseIndex, indexScope, indexVariable, elementCount, elementKind, flags, offset: typeOffset, size: 7 },
      nextOffset: cursor + 6,
    };
  }

  if (dataType === 0x09 || dataType === 0x0f || dataType >= 0x20) {
    const length = dataType === 0x0f ? 16 : 8;
    const { value, bytes: raw } = readString(bytes, cursor, length, stringEncoding, endOffset);
    const encoding = dataType === 0x09 ? 'fixed-8' : dataType === 0x0f ? 'fixed-16' : 'tagged-8';
    return {
      argument: { type: 'string', encoding, value, bytes: raw, tag: dataType, offset: typeOffset, size: 1 + length },
      nextOffset: cursor + length,
    };
  }

  if (dataType === 0x0a || dataType === 0x0b || dataType === 0x10 || dataType === 0x11) {
    const index = readU16(bytes, cursor, endOffset);
    let argument: ScmArgument;
    if (dataType === 0x0a) argument = { type: 'global-string-variable', index, offset: typeOffset, size: 3 };
    else if (dataType === 0x0b) argument = { type: 'local-string-variable', index, offset: typeOffset, size: 3 };
    else if (dataType === 0x10) argument = { type: 'global-long-string-variable', index, offset: typeOffset, size: 3 };
    else argument = { type: 'local-long-string-variable', index, offset: typeOffset, size: 3 };
    return { argument, nextOffset: cursor + 2 };
  }

  if (dataType === 0x0e) {
    const length = readU8(bytes, cursor, endOffset);
    cursor += 1;
    const { value, bytes: raw } = readString(bytes, cursor, length, stringEncoding, endOffset);
    return {
      argument: { type: 'string', encoding: 'length-prefixed', value, bytes: raw, tag: dataType, offset: typeOffset, size: 2 + length },
      nextOffset: cursor + length,
    };
  }

  // 0x14..0x1F are intentionally rejected. Treating an undocumented tag as
  // an 8-byte string would silently corrupt every instruction after it.
  throw new ScmDecodeError(`Unsupported or undocumented SCM argument type 0x${dataType.toString(16).padStart(2, '0')}`, typeOffset, 'UNSUPPORTED_DATA_TYPE');
}

/** Decode one instruction, using caller-supplied version-matched signatures. */
export function decodeScmInstruction(
  bytes: Uint8Array,
  offset: number,
  catalogue: ScmOpcodeCatalogue,
  endOffset = bytes.length,
  options: Pick<ScmDecodeOptions, 'maxArgumentsPerInstruction' | 'stringEncoding'> = {},
): DecodedScmInstruction {
  const instructionOffset = offset;
  const encodedOpcode = readU16(bytes, offset, endOffset);
  const negativeCondition = (encodedOpcode & 0x8000) !== 0;
  const opcode = encodedOpcode & 0x7fff;
  let cursor = offset + 2;

  // SA opcode 05B6 introduces a fixed 128-byte table directly after its ID.
  if (opcode === 0x05b6) {
    assertRange(bytes, cursor, 128, endOffset);
    return {
      offset: instructionOffset,
      nextOffset: cursor + 128,
      encodedOpcode,
      opcode,
      negativeCondition,
      name: 'DEFINE_128_BYTE_TABLE',
      arguments: [],
      rawPayload: bytes.slice(cursor, cursor + 128),
    };
  }

  const definition = catalogue.get(opcode);
  if (!definition) {
    throw new ScmDecodeError(`No opcode signature for 0x${opcode.toString(16).padStart(4, '0')}; refusing to guess its length`, instructionOffset, 'MISSING_OPCODE_SIGNATURE');
  }
  if (definition.opcode !== opcode || (!definition.variadic && !Number.isInteger(definition.parameterCount)) || (definition.parameterCount ?? 0) < 0 || (definition.parameterCount ?? 0) > 32) {
    throw new ScmDecodeError(`Invalid signature for opcode 0x${opcode.toString(16).padStart(4, '0')}`, instructionOffset, 'BAD_OPCODE_SIGNATURE');
  }
  const maxArguments = options.maxArgumentsPerInstruction ?? 32;
  const args: ScmArgument[] = [];

  if (definition.rawPayloadBytes !== undefined) {
    if (!Number.isInteger(definition.rawPayloadBytes) || definition.rawPayloadBytes < 0 || definition.rawPayloadBytes > 1024 * 1024) {
      throw new ScmDecodeError('Invalid raw payload length in opcode catalogue', instructionOffset, 'BAD_OPCODE_SIGNATURE');
    }
    assertRange(bytes, cursor, definition.rawPayloadBytes, endOffset);
    return {
      offset: instructionOffset,
      nextOffset: cursor + definition.rawPayloadBytes,
      encodedOpcode,
      opcode,
      negativeCondition,
      name: definition.name,
      arguments: [],
      rawPayload: bytes.slice(cursor, cursor + definition.rawPayloadBytes),
    };
  }

  if (definition.variadic) {
    let foundTerminator = false;
    while (args.length < maxArguments) {
      const decoded = decodeScmArgument(bytes, cursor, endOffset, options.stringEncoding);
      cursor = decoded.nextOffset;
      if (decoded.argument.type === 'end-arguments') {
        foundTerminator = true;
        break;
      }
      args.push(decoded.argument);
    }
    if (!foundTerminator) {
      throw new ScmDecodeError(`Variadic opcode exceeded ${maxArguments} arguments or has no terminator`, cursor, 'LIMIT_EXCEEDED');
    }
  } else {
    const count = definition.parameterCount!;
    for (let index = 0; index < count; index += 1) {
      const decoded = decodeScmArgument(bytes, cursor, endOffset, options.stringEncoding);
      if (decoded.argument.type === 'end-arguments') {
        throw new ScmDecodeError(`Opcode ${definition.name} ended its argument list after ${index} of ${count} arguments`, cursor, 'BAD_OPCODE_SIGNATURE');
      }
      args.push(decoded.argument);
      cursor = decoded.nextOffset;
    }
  }

  return { offset: instructionOffset, nextOffset: cursor, encodedOpcode, opcode, negativeCondition, name: definition.name, arguments: args };
}

/** Decode a bounded SCM code range. A missing signature stops the decode. */
export function decodeScmCode(
  bytes: Uint8Array,
  catalogue: ScmOpcodeCatalogue,
  options: ScmDecodeOptions = {},
): DecodedScmInstruction[] {
  const start = options.startOffset ?? 0;
  const end = options.endOffset ?? bytes.length;
  const maxInstructions = options.maxInstructions ?? 1_000_000;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > bytes.length) {
    throw new ScmDecodeError('Invalid SCM code range', start, 'OUT_OF_BOUNDS');
  }
  const result: DecodedScmInstruction[] = [];
  let cursor = start;
  while (cursor < end) {
    if (result.length >= maxInstructions) {
      throw new ScmDecodeError(`SCM instruction limit ${maxInstructions} exceeded`, cursor, 'LIMIT_EXCEEDED');
    }
    const instruction = decodeScmInstruction(bytes, cursor, catalogue, end, options);
    if (instruction.nextOffset <= cursor) {
      throw new ScmDecodeError('SCM decoder made no forward progress', cursor, 'BAD_OPCODE_SIGNATURE');
    }
    result.push(instruction);
    cursor = instruction.nextOffset;
  }
  return result;
}

/**
 * Inspect (but do not assign meanings to) the SCM header's documented
 * 02 00 01 + uint32 jump marker pattern. Candidates are only evidence for
 * later validation against the actual retail main.scm file.
 */
export function scanScmHeaderJumpCandidates(
  bytes: Uint8Array,
  scanLimit = Math.min(bytes.length, 1024 * 1024),
): Array<{ markerOffset: number; targetOffset: number }> {
  const limit = Math.max(0, Math.min(bytes.length, Math.floor(scanLimit)));
  const candidates: Array<{ markerOffset: number; targetOffset: number }> = [];
  for (let offset = 0; offset + 7 <= limit; offset += 1) {
    if (bytes[offset] !== 0x02 || bytes[offset + 1] !== 0x00 || bytes[offset + 2] !== 0x01) continue;
    const targetOffset = new DataView(bytes.buffer, bytes.byteOffset + offset + 3, 4).getUint32(0, true);
    if (targetOffset > offset + 6 && targetOffset < bytes.length) candidates.push({ markerOffset: offset, targetOffset });
  }
  return candidates;
}
