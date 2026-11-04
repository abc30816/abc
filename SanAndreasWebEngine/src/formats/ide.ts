import { decodeText } from './binary';

export interface IdeObject {
  id: number;
  modelName: string;
  txdName: string;
  drawDistance: number;
  flags: number;
}

export function parseTextIde(bytes: Uint8Array): IdeObject[] {
  const text = decodeText(bytes);
  const sample = text.slice(0, Math.min(text.length, 2048));
  const printable = [...sample].filter((c) => c === '\n' || c === '\r' || c === '\t' || c >= ' ').length;
  if (sample.length && printable / sample.length < 0.92) return [];
  const result: IdeObject[] = [];
  let section = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const low = line.toLowerCase();
    if (low === 'end') { section = ''; continue; }
    if (/^[a-z][a-z0-9_]*$/i.test(line)) { section = low; continue; }
    if (section !== 'objs' && section !== 'tobj') continue;
    const v = line.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
    if (v.length < 5) continue;
    const id = Number(v[0]);
    const drawDistance = Number(v[4]);
    const flags = Number(v[5] ?? 0);
    if (!Number.isFinite(id) || !v[1] || !v[2] || !Number.isFinite(drawDistance)) continue;
    result.push({ id, modelName: v[1].toLowerCase(), txdName: v[2].toLowerCase(), drawDistance, flags: Number.isFinite(flags) ? flags : 0 });
  }
  return result;
}
