import { describe, expect, it } from 'vitest';
import { parseHandlingCfg } from '../../src/config/handlingCfg';
import { parseVehiclesIde } from '../../src/config/vehiclesIde';
import { buildVehicleCatalog, vehicleCatalogToSummary } from '../../src/config/vehicleCatalog';

const handlingRow = 'LANDSTAL 1700 5008.3 2.5 0 0 -0.3 85 0.75 0.85 0.5 5 160 25 20 4 D 6.2 0.6 0 35 2.4 0.08 0 0.28 -0.14 0.5 0.25 0.27 0.23 25000 20 500002 0 1 0';
const vehicleRow = '400, landstal, landstal, car, LANDSTAL, LANDSTK, null, normal, 10, 0, 0';

describe('buildVehicleCatalog', () => {
  it('joins model IDs to handling records and optional extension records', () => {
    const handling = parseHandlingCfg(`${handlingRow}\n^ 0 0 0.5 0.5\n! LANDSTAL 0.3 0.4`);
    const vehicles = parseVehiclesIde(`cars\n${vehicleRow}\nend`);
    const catalog = buildVehicleCatalog(vehicles, handling);
    const entry = catalog.byModelId.get(400);
    expect(entry?.handling.vehicleId).toBe('LANDSTAL');
    expect(entry?.bikeHandling?.kind).toBe('bike');
    expect(entry?.animationGroupData?.kind).toBe('animation');
    expect(vehicleCatalogToSummary(catalog).vehicleCount).toBe(1);
  });

  it('reports missing handling IDs instead of producing incomplete entries', () => {
    const handling = parseHandlingCfg(handlingRow);
    const vehicles = parseVehiclesIde(`cars\n${vehicleRow.replace('LANDSTAL', 'UNKNOWN')}\nend`);
    const catalog = buildVehicleCatalog(vehicles, handling);
    expect(catalog.byModelId.size).toBe(0);
    expect(catalog.issues.some((issue) => issue.severity === 'error' && issue.message.includes('UNKNOWN'))).toBe(true);
  });
});
