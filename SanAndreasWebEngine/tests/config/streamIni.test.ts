import { describe, expect, it } from 'vitest';
import { parseStreamIni, readLegacyStreamSettings } from '../../src/config/streamIni';

const suppliedStreamIni = `memory\t\t\t13500
devkit_memory 13500
vehicles 12
pe_lightchangerate 0.0005
pe_lightingbasecap 0.35
pe_lightingbasemult 0.5
pe_leftx 16
pe_topy 16
pe_rightx 16
pe_bottomy 16
dontbuildpaths
`;

describe('stream.ini compatibility parser', () => {
  it('reads the supplied legacy values without changing their units', () => {
    const document = parseStreamIni(suppliedStreamIni);
    const settings = readLegacyStreamSettings(document);
    expect(settings.memory).toBe(13_500);
    expect(settings.devkitMemory).toBe(13_500);
    expect(settings.vehicles).toBe(12);
    expect(settings.peLightChangeRate).toBe(0.0005);
    expect(settings.peLightingBaseCap).toBe(0.35);
    expect(settings.peLightingBaseMult).toBe(0.5);
    expect(settings.dontBuildPaths).toBe(true);
  });

  it('preserves unknown keys as data and does not evaluate them', () => {
    const document = parseStreamIni('future_setting hello-world\npath value;not-a-comment');
    expect(document.values.get('future_setting')).toBe('hello-world');
    expect(document.values.get('path')).toBe('value;not-a-comment');
  });

  it('uses bounded defaults for out-of-range settings', () => {
    const document = parseStreamIni('vehicles 999999\nmemory -1');
    const settings = readLegacyStreamSettings(document);
    expect(settings.vehicles).toBe(12);
    expect(settings.memory).toBe(13_500);
    expect(document.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects oversized input and skips overlong lines', () => {
    expect(() => parseStreamIni('x'.repeat(32), { maxBytes: 8 })).toThrow(/safety limit/);
    const document = parseStreamIni('a '.concat('x'.repeat(30)), { maxLineLength: 10 });
    expect(document.values.size).toBe(0);
    expect(document.warnings[0]).toMatch(/exceeds/);
  });
});
