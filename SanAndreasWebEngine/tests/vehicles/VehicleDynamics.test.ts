import { describe, expect, it } from 'vitest';
import { parseHandlingCfg } from '../../src/config/handlingCfg';
import { applyVehicleImpact, createVehicleDriveState, createVehicleDriveTuning, stepVehicleDrive } from '../../src/gameplay/VehicleDynamics';

const handling = parseHandlingCfg(`TESTCAR 1500 3000 2.0 0 0 0 85 1.0 0.85 0.5 5 160 10 1 F P 8 0.6 0 30 0.8 0.15 0.1 0.25 -0.15 0.5 0.0 0.25 0.8 20000 0 0 1 1 0`).vehicles.get('testcar')!;

describe('VehicleDynamics', () => {
  it('converts parsed handling data into bounded tuning', () => {
    const tuning = createVehicleDriveTuning(handling);
    expect(tuning.maxSpeed).toBeGreaterThan(0);
    expect(tuning.acceleration).toBeGreaterThan(0);
    expect(tuning.gearCount).toBe(5);
    expect(tuning.steeringLockRadians).toBeGreaterThan(0);
  });

  it('accelerates forward and advances along the heading', () => {
    const tuning = createVehicleDriveTuning(handling);
    let state = createVehicleDriveState({ x: 0, y: 0, z: 0 }, Math.PI);
    for (let i = 0; i < 60; i += 1) state = stepVehicleDrive(state, tuning, { throttle: 1, brake: 0, steering: 0 }, 1 / 60);
    expect(state.speed).toBeGreaterThan(0);
    expect(state.z).toBeGreaterThan(0);
  });

  it('brakes to a stop without reversing direction', () => {
    const tuning = createVehicleDriveTuning(handling);
    let state = { ...createVehicleDriveState({ x: 0, y: 0, z: 0 }), speed: 12 };
    for (let i = 0; i < 180; i += 1) state = stepVehicleDrive(state, tuning, { throttle: 0, brake: 1, steering: 0 }, 1 / 60);
    expect(state.speed).toBe(0);
  });

  it('steers while moving and clamps speed and impact damage', () => {
    const tuning = createVehicleDriveTuning(handling);
    let state = { ...createVehicleDriveState({ x: 0, y: 0, z: 0 }), speed: 14 };
    for (let i = 0; i < 60; i += 1) state = stepVehicleDrive(state, tuning, { throttle: 0, brake: 0, steering: 1 }, 1 / 60);
    expect(Math.abs(state.heading)).toBeGreaterThan(0);
    expect(state.speed).toBeLessThanOrEqual(tuning.maxSpeed);
    expect(applyVehicleImpact(state, 20, 1).health).toBeLessThan(state.health);
    expect(applyVehicleImpact(state, 20_000, 100).health).toBe(0);
  });
});
