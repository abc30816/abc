import { describe, expect, it } from 'vitest';
import { parseVehiclesIde } from '../../src/config/vehiclesIde';

const validRow = '400, landstal, landstal, car, LANDSTAL, LANDSTK, null, normal, 10, 0, 0, -1, 0.768, 0.768, 0';

describe('parseVehiclesIde', () => {
  it('parses the base columns and retains optional wheel/LOD fields', () => {
    const result = parseVehiclesIde(`# header\ncars\n${validRow}\nend`);
    expect(result.vehicles).toHaveLength(1);
    expect(result.vehicles[0]).toMatchObject({ modelId: 400, modelName: 'landstal', handlingId: 'LANDSTAL', frequency: 10, flags: 0 });
    expect(result.vehicles[0].extraFields).toEqual(['-1', '0.768', '0.768', '0']);
  });

  it('reports a missing comma instead of shifting all columns', () => {
    const result = parseVehiclesIde(`cars\n585, emperor\t\temperor, car, EMPEROR, EMPEROR, null, normal, 10, 0, 0, -1\nend`);
    expect(result.vehicles).toHaveLength(0);
    expect(result.issues[0].message).toMatch(/missing comma/);
  });

  it('rejects duplicate model IDs and invalid base fields', () => {
    const result = parseVehiclesIde(`cars\n${validRow}\n${validRow.replace('landstal', 'bravura')}\nend`);
    expect(result.vehicles).toHaveLength(1);
    expect(result.issues.some((issue) => issue.message.includes('Duplicate model ID 400'))).toBe(true);
  });
});
