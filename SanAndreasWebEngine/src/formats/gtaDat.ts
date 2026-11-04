/** Bounded parser for the classic PC DATA/GTA.DAT resource manifest. */

export type GtaDatResourceKind = 'ide' | 'ipl' | 'col' | 'img' | 'cdimage' | 'unknown';

export interface GtaDatResource {
  kind: GtaDatResourceKind;
  directive: string;
  path: string | null;
  parameters: readonly string[];
  sourceLine: number;
  rawLine: string;
}

export interface GtaDatIssue {
  line: number;
  severity: 'warning' | 'error';
  message: string;
}

export interface GtaDatManifest {
  resources: GtaDatResource[];
  issues: GtaDatIssue[];
  recordsRead: number;
}

export interface GtaDatOptions {
  maxBytes?: number;
  maxRecords?: number;
}

const DEFAULT_MAX_BYTES = 256 * 1024;
const DEFAULT_MAX_RECORDS = 4096;
const RESOURCE_DIRECTIVES: Record<string, GtaDatResourceKind> = {
  IDE: 'ide', IPL: 'ipl', COLFILE: 'col', IMG: 'img', CDIMAGE: 'cdimage',
};

function normalizeRelativePath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase();
  if (!normalized || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)) {
    throw new Error('Resource path must be relative to the selected game folder.');
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '..' || segment === '')) {
    throw new Error('Resource path contains an unsafe or empty path segment.');
  }
  return segments.join('/');
}

function unquote(token: string): string {
  return token.replace(/^['"]|['"]$/g, '');
}

/**
 * Parses resource declarations without executing any GTA scripts or directives.
 * Unknown directives are retained with no guessed path so later versions can be audited.
 */
export function parseGtaDat(text: string, options: GtaDatOptions = {}): GtaDatManifest {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 64) throw new RangeError('maxBytes must be at least 64.');
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) throw new RangeError('maxRecords must be positive.');
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new RangeError(`gta.dat exceeds the ${maxBytes}-byte safety limit.`);

  const resources: GtaDatResource[] = [];
  const issues: GtaDatIssue[] = [];
  let recordsRead = 0;
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]!;
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    recordsRead += 1;
    if (recordsRead > maxRecords) {
      issues.push({ line: index + 1, severity: 'error', message: `Record count exceeds the ${maxRecords}-record safety limit.` });
      break;
    }

    const tokens = trimmed.split(/\s+/).map(unquote);
    const directive = tokens[0]!.toUpperCase();
    const kind = RESOURCE_DIRECTIVES[directive] ?? 'unknown';
    let pathToken: string | undefined;
    if (kind === 'ide' || kind === 'ipl' || kind === 'img' || kind === 'cdimage') pathToken = tokens[1];
    if (kind === 'col') pathToken = /^\d+$/.test(tokens[1] ?? '') ? tokens[2] : tokens[1];

    let path: string | null = null;
    if (pathToken) {
      try {
        path = normalizeRelativePath(pathToken);
      } catch (error) {
        issues.push({ line: index + 1, severity: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    } else if (kind !== 'unknown') {
      issues.push({ line: index + 1, severity: 'warning', message: `${directive} has no recognized resource path; declaration retained without a path.` });
    }

    resources.push({ kind, directive, path, parameters: tokens.slice(1), sourceLine: index + 1, rawLine });
  }
  return { resources, issues, recordsRead };
}

/** Resolve a parsed manifest path against the folder containing gta_sa.exe. */
export function resolveGtaDatPath(gameRoot: string, relativePath: string): string {
  const root = gameRoot.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '').toLowerCase();
  const resource = normalizeRelativePath(relativePath);
  return root ? `${root}/${resource}` : resource;
}
