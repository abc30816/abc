/**
 * Safe, data-only parser for San Andreas stream.ini.
 *
 * This parser never evaluates input as code. Unknown keys are retained as
 * strings/numbers/flags so later compatibility work can inspect them without
 * silently discarding values. Legacy `memory` values are kept in their native
 * numeric units; they are NOT assumed to be megabytes.
 */

export type StreamIniValue = number | string | true;

export interface StreamIniParseOptions {
  maxBytes?: number;
  maxLines?: number;
  maxLineLength?: number;
}

export interface StreamIniDocument {
  readonly values: ReadonlyMap<string, StreamIniValue>;
  readonly warnings: readonly string[];
}

export interface LegacyStreamSettings {
  memory: number;
  devkitMemory: number;
  vehicles: number;
  peLightChangeRate: number;
  peLightingBaseCap: number;
  peLightingBaseMult: number;
  peLeftX: number;
  peTopY: number;
  peRightX: number;
  peBottomY: number;
  dontBuildPaths: boolean;
}

const DEFAULTS: LegacyStreamSettings = {
  memory: 13_500,
  devkitMemory: 13_500,
  vehicles: 12,
  peLightChangeRate: 0.0005,
  peLightingBaseCap: 0.35,
  peLightingBaseMult: 0.5,
  peLeftX: 16,
  peTopY: 16,
  peRightX: 16,
  peBottomY: 16,
  dontBuildPaths: false,
};

const KNOWN_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  memory: [1, 65_536],
  devkit_memory: [1, 65_536],
  vehicles: [0, 128],
  pe_lightchangerate: [0, 1],
  pe_lightingbasecap: [0, 10],
  pe_lightingbasemult: [0, 10],
  pe_leftx: [-4_096, 4_096],
  pe_topy: [-4_096, 4_096],
  pe_rightx: [-4_096, 4_096],
  pe_bottomy: [-4_096, 4_096],
};

const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/i;

function parseValue(raw: string): StreamIniValue {
  const value = raw.trim();
  if (!value) return true;
  if (NUMBER_PATTERN.test(value)) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return value;
}

export function parseStreamIni(
  input: string,
  options: StreamIniParseOptions = {},
): StreamIniDocument {
  const maxBytes = options.maxBytes ?? 64 * 1024;
  const maxLines = options.maxLines ?? 512;
  const maxLineLength = options.maxLineLength ?? 512;

  if (typeof input !== 'string') throw new TypeError('stream.ini input must be text.');
  if (new TextEncoder().encode(input).byteLength > maxBytes) {
    throw new RangeError(`stream.ini exceeds the ${maxBytes}-byte safety limit.`);
  }

  const values = new Map<string, StreamIniValue>();
  const warnings: string[] = [];
  const lines = input.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.length > maxLines) {
    warnings.push(`Input has ${lines.length} lines; only the first ${maxLines} are parsed.`);
  }

  for (let index = 0; index < Math.min(lines.length, maxLines); index += 1) {
    const original = lines[index] ?? '';
    if (original.length > maxLineLength) {
      warnings.push(`Line ${index + 1} exceeds ${maxLineLength} characters and was skipped.`);
      continue;
    }

    const line = original.trim();
    if (!line || line.startsWith(';') || line.startsWith('#') || line.startsWith('//')) continue;

    const match = /^([^\s=]+)(?:\s*=\s*(.*?)|\s+(.*?))?\s*$/.exec(line);
    if (!match) {
      warnings.push(`Line ${index + 1} is not a key/value entry and was skipped.`);
      continue;
    }

    const key = (match[1] ?? '').toLowerCase();
    const rawValue = match[2] ?? match[3] ?? '';
    if (!KEY_PATTERN.test(key)) {
      warnings.push(`Line ${index + 1} has an invalid setting name and was skipped.`);
      continue;
    }

    const value = parseValue(rawValue);
    if (values.has(key)) warnings.push(`Setting "${key}" appears more than once; the last value wins.`);
    values.set(key, value);

    const range = KNOWN_RANGES[key];
    if (range) {
      if (typeof value !== 'number' || value < range[0] || value > range[1]) {
        warnings.push(`Setting "${key}" is outside the accepted compatibility range and will use a safe default.`);
      }
    }
  }

  return { values, warnings };
}

function numberOrDefault(
  document: StreamIniDocument,
  key: string,
  fallback: number,
): number {
  const value = document.values.get(key);
  const range = KNOWN_RANGES[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (range && (value < range[0] || value > range[1])) return fallback;
  return value;
}

export function readLegacyStreamSettings(document: StreamIniDocument): LegacyStreamSettings {
  const flag = document.values.get('dontbuildpaths');
  const dontBuildPaths = flag === true
    || (typeof flag === 'string' && ['1', 'true', 'yes', 'on'].includes(flag.toLowerCase()))
    || (typeof flag === 'number' && flag === 1);

  return {
    memory: numberOrDefault(document, 'memory', DEFAULTS.memory),
    devkitMemory: numberOrDefault(document, 'devkit_memory', DEFAULTS.devkitMemory),
    vehicles: numberOrDefault(document, 'vehicles', DEFAULTS.vehicles),
    peLightChangeRate: numberOrDefault(document, 'pe_lightchangerate', DEFAULTS.peLightChangeRate),
    peLightingBaseCap: numberOrDefault(document, 'pe_lightingbasecap', DEFAULTS.peLightingBaseCap),
    peLightingBaseMult: numberOrDefault(document, 'pe_lightingbasemult', DEFAULTS.peLightingBaseMult),
    peLeftX: numberOrDefault(document, 'pe_leftx', DEFAULTS.peLeftX),
    peTopY: numberOrDefault(document, 'pe_topy', DEFAULTS.peTopY),
    peRightX: numberOrDefault(document, 'pe_rightx', DEFAULTS.peRightX),
    peBottomY: numberOrDefault(document, 'pe_bottomy', DEFAULTS.peBottomY),
    dontBuildPaths,
  };
}

/**
 * Converts coarse browser device-memory hints into a conservative byte budget.
 * This is a new browser policy, not a reinterpretation of stream.ini's legacy
 * `memory` field.
 */
export interface BrowserStreamingLimits {
  maxResidentBytes: number;
  maxEntryBytes: number;
  maxConcurrentLoads: number;
  maxQueuedLoads: number;
}

export function deriveBrowserStreamingLimits(deviceMemoryGB?: number): BrowserStreamingLimits {
  const memory = Number.isFinite(deviceMemoryGB) && (deviceMemoryGB ?? 0) > 0
    ? deviceMemoryGB as number
    : 4;
  const maxResidentBytes = memory <= 2
    ? 48 * 1024 * 1024
    : memory <= 4
      ? 96 * 1024 * 1024
      : memory <= 8
        ? 128 * 1024 * 1024
        : 192 * 1024 * 1024;

  return {
    maxResidentBytes,
    maxEntryBytes: Math.min(32 * 1024 * 1024, Math.floor(maxResidentBytes / 3)),
    maxConcurrentLoads: memory <= 2 ? 2 : memory <= 4 ? 3 : 4,
    maxQueuedLoads: 512,
  };
}
