import { describe, expect, it } from 'vitest';
import { classifyHandlingVehicle, listSetFlagBits, parseHandlingCfg } from '../../src/config/handlingCfg';

// Classic PC serialized row: 36 fields. The documented unused E column is omitted.
const landstal = 'LANDSTAL 1700.0 5008.3 2.5 0.0 0.0 -0.3 85 0.75 0.85 0.5 5 160.0 25.0 20.0 4 D 6.2 0.60 0 35.0 2.4 0.08 0.0 0.28 -0.14 0.5 0.25 0.27 0.23 25000 20 500002 0 1 0';
const bike = 'NRG500 300.0 500.0 1.2 0 0 -0.1 85 1.0 0.8 0.5 5 190 30 15 R P 5 0.5 0 35 1.0 0.1 0 0.2 -0.1 0.5 0 0.2 0.5 30000 1000000 0 0 0 0';

describe('parseHandlingCfg', () => {
  it('parses the actual 36-field layout without inserting the unused E column', () => {
    const result = parseHandlingCfg(`; comment\n${landstal}`);
    const item = result.vehicles.get('landstal');
    expect(item).toBeDefined();
    expect(item?.mass).toBe(1700);
    expect(item?.centreOfMass).toEqual({ x: 0, y: 0, z: -0.3 });
    expect(item?.percentSubmerged).toBe(85);
    expect(item?.driveType).toBe('4');
    expect(item?.engineType).toBe('D');
    expect(item?.steeringLock).toBe(35);
    expect(item?.modelFlags).toBe(0x20);
    expect(item?.handlingFlags).toBe(0x500002);
    expect(item?.animationGroup).toBe(0);
    expect(result.recordsAccepted).toBe(1);
  });

  it('rejects the obsolete 37-field assumption and continues parsing', () => {
    const obsolete = `${landstal} 0`;
    const result = parseHandlingCfg(`${obsolete}\n${landstal}`);
    expect(result.vehicles.size).toBe(1);
    expect(result.issues.some((issue) => issue.line === 1 && issue.message.includes('Expected 36 fields'))).toBe(true);
  });

  it('parses ordinary rows while preserving the four specialized extension types', () => {
    const result = parseHandlingCfg([
      landstal,
      '% PREDATOR 0.79 0.5 0.6',
      '! NRG500 0.25 0.10 0.30',
      '$ SEAPLANE 0.5 0.4 0.0001',
      '^ 0 0 0 1 0.5',
    ].join('\n'));
    expect(result.vehicles.size).toBe(1);
    expect(result.extensions.map((entry) => entry.kind)).toEqual(['boat', 'bike', 'flying', 'animation']);
    expect(result.extensions[3].id).toBe('0');
  });

  it('rejects invalid drive/engine types and keeps the first duplicate', () => {
    const badDrive = landstal.replace(' 4 D 6.2 ', ' X D 6.2 ');
    const badEngine = landstal.replace(' 4 D 6.2 ', ' 4 X 6.2 ');
    expect(parseHandlingCfg(badDrive).vehicles.size).toBe(0);
    expect(parseHandlingCfg(badEngine).vehicles.size).toBe(0);
    const duplicate = parseHandlingCfg(`${landstal}\n${landstal.replace('1700.0', '1800.0')}`);
    expect(duplicate.vehicles.get('landstal')?.mass).toBe(1700);
    expect(duplicate.issues.some((issue) => issue.message.includes('Duplicate vehicle identifier'))).toBe(true);
  });

  it('preserves wide hexadecimal flags instead of truncating them to 32 bits', () => {
    const wide = landstal.replace(' 20 500002 0 1 0', ' 400220000 2010000 0 1 0');
    const result = parseHandlingCfg(wide);
    expect(result.vehicles.get('landstal')?.modelFlags).toBe(Number.parseInt('400220000', 16));
    expect(result.issues.some((issue) => issue.message.includes('exceeds 32 bits'))).toBe(true);
  });

  it('decodes hexadecimal model flags and classifies bikes', () => {
    const result = parseHandlingCfg(bike);
    const item = result.vehicles.get('nrg500');
    expect(item?.modelFlags).toBe(0x01000000);
    expect(classifyHandlingVehicle(item!)).toBe('bike');
    expect(listSetFlagBits(0x01000005)).toEqual([0, 2, 24]);
  });
});
