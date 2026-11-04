/** Read-only parser for the classic PC data/vehicles.ide `cars` section. */

export interface VehicleIdeEntry {
  modelId: number;
  modelName: string;
  txdName: string;
  vehicleType: string;
  handlingId: string;
  gameName: string;
  animationName: string;
  vehicleClass: string;
  frequency: number;
  flags: number;
  componentRules: string;
  extraFields: readonly string[];
  sourceLine: number;
  rawFields: readonly string[];
}
export interface VehicleIdeIssue {
  line: number;
  severity: 'warning' | 'error';
  message: string;
}
export interface VehicleIdeResult {
  vehicles: VehicleIdeEntry[];
  issues: VehicleIdeIssue[];
  recordsRead: number;
  recordsAccepted: number;
}
export interface VehicleIdeOptions {
  maxBytes?: number;
  maxRecords?: number;
}
const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_RECORDS = 4096;

function safeName(value: string): boolean {
  return /^[A-Za-z0-9_]{1,32}$/.test(value);
}
function parseInteger(value: string, fieldName: string): number {
  if (!/^[+-]?\d+$/.test(value)) throw new Error(`${fieldName} must be an integer.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`${fieldName} is outside the safe integer range.`);
  return number;
}

export function parseVehiclesIde(text: string, options: VehicleIdeOptions = {}): VehicleIdeResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 128) throw new RangeError('maxBytes must be at least 128.');
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) throw new RangeError('maxRecords must be positive.');
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new RangeError(`vehicles.ide exceeds the ${maxBytes}-byte safety limit.`);

  const vehicles: VehicleIdeEntry[] = [];
  const issues: VehicleIdeIssue[] = [];
  const ids = new Set<number>();
  let inCarsSection = false;
  let foundCarsSection = false;
  let recordsRead = 0;

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.toLowerCase() === 'cars') {
      inCarsSection = true;
      foundCarsSection = true;
      continue;
    }
    if (trimmed.toLowerCase() === 'end') {
      inCarsSection = false;
      continue;
    }
    if (!inCarsSection) continue;

    recordsRead += 1;
    const lineNumber = index + 1;
    if (recordsRead > maxRecords) {
      issues.push({ line: lineNumber, severity: 'error', message: `Record count exceeds the ${maxRecords}-record safety limit.` });
      break;
    }
    const fields = rawLine.split(',').map((field) => field.trim());
    try {
      if (fields.length < 11) throw new Error(`Expected at least 11 comma-separated base fields; received ${fields.length}.`);
      const modelId = parseInteger(fields[0], 'Model ID');
      if (modelId < 0 || modelId > 65535) throw new Error('Model ID must be in the range 0..65535.');
      if (!safeName(fields[1])) throw new Error('Model name is invalid or appears to contain a missing comma before the TXD name.');
      if (!safeName(fields[2])) throw new Error('TXD name is invalid.');
      if (!safeName(fields[3])) throw new Error('Vehicle type must be a single identifier.');
      if (!/^[A-Za-z0-9_-]{1,14}$/.test(fields[4])) throw new Error('Handling ID must be a 1–14 character identifier.');
      if (!safeName(fields[5])) throw new Error('Game name must be a single identifier.');
      if (!safeName(fields[6])) throw new Error('Animation name must be a single identifier.');
      if (!safeName(fields[7])) throw new Error('Vehicle class must be a single identifier.');
      const frequency = parseInteger(fields[8], 'Frequency');
      const flags = parseInteger(fields[9], 'Flags');
      if (frequency < 0 || frequency > 255) throw new Error('Frequency must be in the range 0..255.');
      if (flags < 0 || flags > 0xffffffff) throw new Error('Flags must be in the unsigned 32-bit range.');
      if (!fields[10]) throw new Error('Component rules field is empty.');
      if (ids.has(modelId)) throw new Error(`Duplicate model ID ${modelId}; first definition kept.`);

      ids.add(modelId);
      vehicles.push({
        modelId,
        modelName: fields[1],
        txdName: fields[2],
        vehicleType: fields[3],
        handlingId: fields[4],
        gameName: fields[5],
        animationName: fields[6],
        vehicleClass: fields[7],
        frequency,
        flags,
        componentRules: fields[10],
        extraFields: fields.slice(11),
        sourceLine: lineNumber,
        rawFields: fields,
      });
    } catch (error) {
      issues.push({ line: lineNumber, severity: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!foundCarsSection) issues.push({ line: 0, severity: 'error', message: 'No `cars` section was found in vehicles.ide.' });
  return { vehicles, issues, recordsRead, recordsAccepted: vehicles.length };
}

export async function parseVehiclesIdeFromFiles(files: ReadonlyMap<string, Blob>, options: VehicleIdeOptions = {}): Promise<VehicleIdeResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const candidates = [...files.entries()]
    .map(([path, file]) => ({ path: path.replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase(), file }))
    .filter((item) => item.path === 'data/vehicles.ide' || item.path.endsWith('/data/vehicles.ide'))
    .sort((a, b) => a.path.length - b.path.length);
  const found = candidates[0];
  if (!found) throw new Error('Could not find data/vehicles.ide in the selected local game folder.');
  if (found.file.size > maxBytes) throw new RangeError(`vehicles.ide is ${found.file.size} bytes; limit is ${maxBytes}.`);
  return parseVehiclesIde(await found.file.text(), options);
}
