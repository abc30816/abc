import { describe, expect, it } from 'vitest';
import { RapierPhysicsWorld } from '../../src/physics/RapierPhysicsWorld';

describe('Rapier WebAssembly physics foundation', () => {
  it('loads the WASM engine and keeps a dynamic body above a fixed floor', async () => {
    const physics = await RapierPhysicsWorld.create();
    try {
      physics.addStaticBox(
        { x: 0, y: -0.25, z: 0 },
        { x: 20, y: 0.25, z: 20 },
      );
      const box = physics.createDynamicBox(
        { x: 0, y: 3, z: 0 },
        { x: 0.5, y: 0.5, z: 0.5 },
      );

      for (let frame = 0; frame < 180; frame += 1) {
        physics.stepFrame(1 / 60);
      }

      expect(box.translation().y).toBeGreaterThan(0.35);
      expect(box.translation().y).toBeLessThan(0.8);
    } finally {
      physics.dispose();
    }
  }, 20_000);

  it('moves a kinematic player capsule using collision-corrected movement', async () => {
    const physics = await RapierPhysicsWorld.create();
    try {
      physics.addStaticBox(
        { x: 0, y: -0.25, z: 0 },
        { x: 10, y: 0.25, z: 10 },
      );
      physics.addStaticBox(
        { x: 1.5, y: 1.0, z: 0 },
        { x: 0.25, y: 1.0, z: 2.0 },
      );
      physics.createPlayerCharacter({ position: { x: 0, y: 1.2, z: 0 } });

      for (let frame = 0; frame < 120; frame += 1) {
        physics.stepFrame(1 / 60, (dt) => {
          physics.movePlayer({ x: 1.5, y: 0, z: 0 }, dt);
        });
      }

      const state = physics.getPlayerState();
      expect(state.position.x).toBeLessThan(1.3);
      expect(state.position.y).toBeGreaterThan(0.7);
    } finally {
      physics.dispose();
    }
  }, 20_000);

  it('creates a +Z-forward raycast vehicle and advances its wheel controller', async () => {
    const physics = await RapierPhysicsWorld.create();
    try {
      physics.addStaticBox(
        { x: 0, y: -0.25, z: 0 },
        { x: 30, y: 0.25, z: 30 },
      );
      const vehicle = physics.createFourWheelVehicle({ position: { x: 0, y: 0.9, z: 0 } });
      for (let frame = 0; frame < 90; frame += 1) {
        physics.stepFrame(1 / 60, (dt) => vehicle.update({ throttle: 0.25, brake: 0, steering: 0 }, dt));
      }
      expect(vehicle.controller.indexForwardAxis).toBe(2);
      expect(Number.isFinite(vehicle.currentSpeed())).toBe(true);
      expect(vehicle.body.translation().z).toBeGreaterThan(0);
    } finally {
      physics.dispose();
    }
  }, 20_000);

});
