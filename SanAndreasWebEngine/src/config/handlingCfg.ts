/**
 * Read-only parser for classic PC GTA San Andreas data/handling.cfg.
 *
 * The ordinary vehicle rows in the supplied classic-PC file contain 36 tokens.
 * The documented unused E column is NOT serialized in those rows. Special
 * '%' / '!' / '$' / '^' records are retained separately as extension data.
 * No game executable, DLL, script or native code is loaded or executed here.
 */

export type VehicleDriveType = 'F' | 'R' | '4';
export type VehicleEngineType = 'P' | 'D' | 'E';
export type VehicleKind = 'car' | 'bike' | 'helicopter' | 'plane' | 'boat' | 'unknown';
export type HandlingExtensionKind = 'boat' | 'bike' | 'flying' | 'animation';

export interface VehicleHandling {
  vehicleId: string;
  mass: number;
  turnMass: number;
  dragMultiplier: number;
  centreOfMass: { x: number; y: number; z: number };
  percentSubmerged: number;
  tractionMultiplier: number;
  tractionLoss: number;
  tractionBias: number;
  numberOfGears: number;
  maxVelocity: number;
  engineAcceleration: number;
  engineInertia: number;
  driveType: VehicleDriveType;
  engineType: VehicleEngineType;
  brakeDeceleration: number;
  brakeBias: number;
  abs: boolean;
  steeringLock: number;
  suspensionForceLevel: number;
  suspensionDampingLevel: number;
  suspensionHighSpeedCompressionDamping: number;
  suspensionUpperLimit: number;
  suspensionLowerLimit: number;
  suspensionBiasFrontRear: number;
  suspensionAntiDiveMultiplier: number;
  seatOffsetDistance: number;
  collisionDamageMultiplier: number;
  monetaryValue: number;
  modelFlags: number;
  handlingFlags: number;
  frontLights: number;
  rearLights: number;
  animationGroup: number;
  rawFields: readonly string[];
  sourceLine: number;
}

export interface HandlingExtension {
  kind: HandlingExtensionKind;
  /** Vehicle handling ID for boat/bike/flying data; numeric group ID for animation data. */
  id: string;
  values: readonly number[];
  rawFields: readonly string[];
  sourceLine: number;
}

export interface HandlingCfgIssue {
  line: number;
  severity: 'warning' | 'error';
  message: string;
}

export interface HandlingCfgResult {
  vehicles: Map<string, VehicleHandling>;
  extensions: HandlingExtension[];
  issues: HandlingCfgIssue[];
  recordsRead: number;
  recordsAccepted: number;
}

export interface HandlingCfgOptions {
  maxBytes?: number;
  maxRecords?: number;
  maxExtensions?: number;
}

const FIELD_COUNT = 36;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_RECORDS = 2048;
const DEFAULT_MAX_EXTENSIONS = 512;
const SPECIAL_MARKERS: Record<string, HandlingExtensionKind> = {
  '%': 'boat',
  '!': 'bike',
  '$': 'flying',
  '^': 'animation',
};
const MODEL_FLAG_MASKS = {
  isBike: 0x01000000,
  isHelicopter: 0x02000000,
  isPlane: 0x04000000,
  isBoat: 0x08000000,
} as const;

function isFiniteNumberToken(token: string): boolean {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(token) && Number.isFinite(Number(token));
}
function numeric(fields: readonly string[], index: number, name: string): number {
  const token = fields[index];
  if (token === undefined || !isFiniteNumberToken(token)) {
    throw new Error(`${name} must be a finite number (field ${index + 1}).`);
  }
  return Number(token);
}
function integer(fields: readonly string[], index: number, name: string): number {
  const value = numeric(fields, index, name);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer (field ${index + 1}).`);
  return value;
}
function hexFlags(fields: readonly string[], index: number, name: string): number {
  const token = fields[index];
  if (token === undefined || !/^(?:0x)?[0-9a-f]{1,13}$/i.test(token)) {
    throw new Error(`${name} must be a 1–13 digit hexadecimal flag value (field ${index + 1}).`);
  }
  const parsed = BigInt(`0x${token.replace(/^0x/i, '')}`);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${name} exceeds JavaScript's exact integer range.`);
  return Number(parsed);
}
function addRangeWarning(issues: HandlingCfgIssue[], line: number, name: string, value: number, min: number, max: number): void {
  if (value < min || value > max) {
    issues.push({ line, severity: 'warning', message: `${name}=${value} is outside the common classic-PC range ${min}..${max}; value was preserved.` });
  }
}

function parseStandardRecord(fields: readonly string[], line: number, issues: HandlingCfgIssue[]): VehicleHandling {
  if (fields.length !== FIELD_COUNT) throw new Error(`Expected ${FIELD_COUNT} fields in the classic-PC row (unused E is omitted); received ${fields.length}.`);
  const vehicleId = fields[0];
  if (!/^[A-Za-z0-9_-]{1,14}$/.test(vehicleId)) throw new Error('Vehicle identifier must be 1–14 letters, digits, underscores or hyphens.');
  const driveType = fields[15]?.toUpperCase();
  if (driveType !== 'F' && driveType !== 'R' && driveType !== '4') throw new Error(`Unknown drive type ${JSON.stringify(fields[15])}; expected F, R or 4.`);
  const engineType = fields[16]?.toUpperCase();
  if (engineType !== 'P' && engineType !== 'D' && engineType !== 'E') throw new Error(`Unknown engine type ${JSON.stringify(fields[16])}; expected P, D or E.`);
  const absValue = integer(fields, 19, 'ABS');
  if (absValue !== 0 && absValue !== 1) throw new Error(`ABS must be 0 or 1; received ${absValue}.`);

  const record: VehicleHandling = {
    vehicleId,
    mass: numeric(fields, 1, 'mass'),
    turnMass: numeric(fields, 2, 'turnMass'),
    dragMultiplier: numeric(fields, 3, 'dragMultiplier'),
    centreOfMass: { x: numeric(fields, 4, 'centreOfMass.x'), y: numeric(fields, 5, 'centreOfMass.y'), z: numeric(fields, 6, 'centreOfMass.z') },
    percentSubmerged: integer(fields, 7, 'percentSubmerged'),
    tractionMultiplier: numeric(fields, 8, 'tractionMultiplier'),
    tractionLoss: numeric(fields, 9, 'tractionLoss'),
    tractionBias: numeric(fields, 10, 'tractionBias'),
    numberOfGears: integer(fields, 11, 'numberOfGears'),
    maxVelocity: numeric(fields, 12, 'maxVelocity'),
    engineAcceleration: numeric(fields, 13, 'engineAcceleration'),
    engineInertia: numeric(fields, 14, 'engineInertia'),
    driveType,
    engineType,
    brakeDeceleration: numeric(fields, 17, 'brakeDeceleration'),
    brakeBias: numeric(fields, 18, 'brakeBias'),
    abs: absValue === 1,
    steeringLock: numeric(fields, 20, 'steeringLock'),
    suspensionForceLevel: numeric(fields, 21, 'suspensionForceLevel'),
    suspensionDampingLevel: numeric(fields, 22, 'suspensionDampingLevel'),
    suspensionHighSpeedCompressionDamping: numeric(fields, 23, 'suspensionHighSpeedCompressionDamping'),
    suspensionUpperLimit: numeric(fields, 24, 'suspensionUpperLimit'),
    suspensionLowerLimit: numeric(fields, 25, 'suspensionLowerLimit'),
    suspensionBiasFrontRear: numeric(fields, 26, 'suspensionBiasFrontRear'),
    suspensionAntiDiveMultiplier: numeric(fields, 27, 'suspensionAntiDiveMultiplier'),
    seatOffsetDistance: numeric(fields, 28, 'seatOffsetDistance'),
    collisionDamageMultiplier: numeric(fields, 29, 'collisionDamageMultiplier'),
    monetaryValue: integer(fields, 30, 'monetaryValue'),
    modelFlags: hexFlags(fields, 31, 'modelFlags'),
    handlingFlags: hexFlags(fields, 32, 'handlingFlags'),
    frontLights: integer(fields, 33, 'frontLights'),
    rearLights: integer(fields, 34, 'rearLights'),
    animationGroup: integer(fields, 35, 'animationGroup'),
    rawFields: [...fields],
    sourceLine: line,
  };

  if (record.modelFlags > 0xffffffff) issues.push({ line, severity: 'warning', message: `modelFlags=${record.modelFlags.toString(16)} exceeds 32 bits; original value was preserved without truncation.` });
  if (record.handlingFlags > 0xffffffff) issues.push({ line, severity: 'warning', message: `handlingFlags=${record.handlingFlags.toString(16)} exceeds 32 bits; original value was preserved without truncation.` });
  addRangeWarning(issues, line, 'mass', record.mass, 1, 50000);
  addRangeWarning(issues, line, 'percentSubmerged', record.percentSubmerged, 10, 120);
  addRangeWarning(issues, line, 'tractionMultiplier', record.tractionMultiplier, 0.5, 2.0);
  addRangeWarning(issues, line, 'numberOfGears', record.numberOfGears, 1, 8);
  addRangeWarning(issues, line, 'steeringLock', record.steeringLock, 10, 60);
  addRangeWarning(issues, line, 'frontLights', record.frontLights, 0, 3);
  addRangeWarning(issues, line, 'rearLights', record.rearLights, 0, 3);
  return record;
}

function parseExtension(fields: readonly string[], line: number, kind: HandlingExtensionKind): HandlingExtension {
  if (fields.length < 3) throw new Error(`The ${kind} extension requires an identifier and at least one numeric value.`);
  const id = fields[1];
  if (kind === 'animation') {
    if (!/^\d{1,4}$/.test(id)) throw new Error('Animation-group extension ID must be an integer from 0 to 9999.');
  } else if (!/^[A-Za-z0-9_-]{1,14}$/.test(id)) {
    throw new Error(`${kind} extension ID must be a 1–14 character handling identifier.`);
  }
  const values = fields.slice(2).map((token, index) => {
    if (!isFiniteNumberToken(token)) throw new Error(`${kind} extension value ${index + 1} must be finite numeric data.`);
    return Number(token);
  });
  if (values.length > 128) throw new Error(`${kind} extension exceeds the 128-value limit.`);
  return { kind, id, values, rawFields: [...fields], sourceLine: line };
}

export function parseHandlingCfg(text: string, options: HandlingCfgOptions = {}): HandlingCfgResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
  const maxExtensions = options.maxExtensions ?? DEFAULT_MAX_EXTENSIONS;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 256) throw new RangeError('maxBytes must be at least 256.');
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) throw new RangeError('maxRecords must be positive.');
  if (!Number.isSafeInteger(maxExtensions) || maxExtensions < 1) throw new RangeError('maxExtensions must be positive.');
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new RangeError(`handling.cfg exceeds the ${maxBytes}-byte safety limit.`);

  const vehicles = new Map<string, VehicleHandling>();
  const extensions: HandlingExtension[] = [];
  const extensionKeys = new Set<string>();
  const issues: HandlingCfgIssue[] = [];
  let recordsRead = 0;
  let recordsAccepted = 0;
  let extensionRecordsRead = 0;

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;
    const fields = trimmed.split(/\s+/);
    const markerKind = SPECIAL_MARKERS[fields[0]];
    if (markerKind) {
      extensionRecordsRead += 1;
      if (extensionRecordsRead > maxExtensions) {
        issues.push({ line: lineNumber, severity: 'error', message: `Extension count exceeds the ${maxExtensions}-record safety limit.` });
        break;
      }
      try {
        const extension = parseExtension(fields, lineNumber, markerKind);
        const key = `${extension.kind}:${extension.id.toUpperCase()}`;
        if (extensionKeys.has(key)) {
          issues.push({ line: lineNumber, severity: 'error', message: `Duplicate ${extension.kind} extension ID ${extension.id}; first definition kept.` });
          continue;
        }
        extensionKeys.add(key);
        extensions.push(extension);
      } catch (error) {
        issues.push({ line: lineNumber, severity: 'error', message: error instanceof Error ? error.message : String(error) });
      }
      continue;
    }

    // Non-data headings such as "name mass turnmass ..." are ignored. Rows
    // that begin with an identifier but have the wrong number of columns are
    // recorded as errors so a damaged actual record is not silently accepted.
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,13}$/.test(fields[0]) || fields[0].toLowerCase() === 'name') continue;
    recordsRead += 1;
    if (recordsRead > maxRecords) {
      issues.push({ line: lineNumber, severity: 'error', message: `Record count exceeds the ${maxRecords}-record safety limit.` });
      break;
    }
    try {
      const record = parseStandardRecord(fields, lineNumber, issues);
      const key = record.vehicleId.toLowerCase();
      if (vehicles.has(key)) {
        issues.push({ line: lineNumber, severity: 'error', message: `Duplicate vehicle identifier ${record.vehicleId}; first definition kept.` });
        continue;
      }
      vehicles.set(key, record);
      recordsAccepted += 1;
    } catch (error) {
      issues.push({ line: lineNumber, severity: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { vehicles, extensions, issues, recordsRead, recordsAccepted };
}

export async function parseHandlingCfgFromFiles(files: ReadonlyMap<string, Blob>, options: HandlingCfgOptions = {}): Promise<HandlingCfgResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const candidates = [...files.entries()]
    .map(([path, file]) => ({ path: path.replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase(), file }))
    .filter((item) => item.path === 'data/handling.cfg' || item.path.endsWith('/data/handling.cfg'))
    .sort((a, b) => a.path.length - b.path.length);
  const found = candidates[0];
  if (!found) throw new Error('Could not find data/handling.cfg in the selected local game folder.');
  if (found.file.size > maxBytes) throw new RangeError(`handling.cfg is ${found.file.size} bytes; limit is ${maxBytes}.`);
  return parseHandlingCfg(await found.file.text(), options);
}

export function classifyHandlingVehicle(record: Pick<VehicleHandling, 'modelFlags'>): VehicleKind {
  const flags = record.modelFlags;
  if ((flags & MODEL_FLAG_MASKS.isBike) !== 0) return 'bike';
  if ((flags & MODEL_FLAG_MASKS.isHelicopter) !== 0) return 'helicopter';
  if ((flags & MODEL_FLAG_MASKS.isPlane) !== 0) return 'plane';
  if ((flags & MODEL_FLAG_MASKS.isBoat) !== 0) return 'boat';
  return flags === 0 ? 'unknown' : 'car';
}
export function listSetFlagBits(value: number): number[] {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Flag value must be a non-negative safe integer.');
  const result: number[] = [];
  for (let bit = 0; bit < 53; bit += 1) if (Math.floor(value / 2 ** bit) % 2 >= 1) result.push(bit);
  return result;
}
