import type { ScmOpcodeDefinition } from '../formats/scm';

export interface ScmOpcodeIniOptions {
  /** GTA SA's documented variable-argument commands. Supply overrides for a different mode. */
  variadicOpcodes?: ReadonlySet<number>;
  /** Optional fixed raw payload definitions in addition to the built-in 05B6 table opcode. */
  rawPayloadBytes?: ReadonlyMap<number, number>;
}

const DEFAULT_VARIADIC = new Set([0x004f, 0x0913]);

/**
 * Parse the Sanny Builder SCM.INI text format into opcode arity metadata.
 * Only the user's local opcode-definition text is read; no script is executed.
 * Later duplicate entries replace earlier ones, matching the documented format.
 */
export function parseScmOpcodeIni(text: string, options: ScmOpcodeIniOptions = {}): Map<number, ScmOpcodeDefinition> {
  const variadic = options.variadicOpcodes ?? DEFAULT_VARIADIC;
  const result = new Map<number, ScmOpcodeDefinition>();
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const match = /^([0-9a-fA-F]{4})\s*=\s*(\d+)\s*,\s*(.*)$/.exec(line);
    if (!match) continue; // metadata and unknown keys are not opcode entries

    const opcode = Number.parseInt(match[1]!, 16);
    const parameterCount = Number.parseInt(match[2]!, 10);
    const name = match[3]!.trim() || `OP_${match[1]!.toUpperCase()}`;
    if (parameterCount > 32) {
      throw new Error(`SCM opcode 0x${opcode.toString(16).padStart(4, '0')} has ${parameterCount} parameters on line ${lineIndex + 1}; SA limit is 32`);
    }
    const isVariadic = variadic.has(opcode);
    const rawPayloadBytes = options.rawPayloadBytes?.get(opcode);
    result.set(opcode, {
      opcode,
      name,
      ...(isVariadic ? { variadic: true } : { parameterCount }),
      ...(rawPayloadBytes !== undefined ? { rawPayloadBytes } : {}),
    });
  }

  if (result.size === 0) throw new Error('No GTA SA opcode entries were found. Check that this is the correct SASCM.ini file for the selected game version.');
  return result;
}
