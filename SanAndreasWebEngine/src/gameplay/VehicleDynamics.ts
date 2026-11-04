import type { VehicleHandling } from '../config/handlingCfg';

export interface VehicleDriveInput {
  /** Engine request: -1 reverse, 0 coast, +1 forward. */
  throttle: number;
  /** Service brake, 0..1. */
  brake: number;
  /** Steering request, -1 left .. +1 right. */
  steering: number;
  /** Handbrake request, 0..1. */
  handbrake?: number;
}

export interface VehicleDriveState {
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  rpm: number;
  gear: number;
  health: number;
  steering: number;
  engineOn: boolean;
}

export interface VehicleDriveTuning {
  maxSpeed: number;
  acceleration: number;
  braking: number;
  drag: number;
  grip: number;
  steeringLockRadians: number;
  gearCount: number;
  inertia: number;
  wheelBase: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const finiteOr = (value: number, fallback: number): number => Number.isFinite(value) ? value : fallback;

/** Convert the user's parsed classic-PC handling row into stable SI-ish browser tuning. */
export function createVehicleDriveTuning(handling: VehicleHandling): VehicleDriveTuning {
  const maxVelocityKmh = clamp(finiteOr(handling.maxVelocity, 140), 20, 500);
  const engineAcceleration = clamp(finiteOr(handling.engineAcceleration, 8), 0.1, 100);
  const mass = clamp(finiteOr(handling.mass, 1500), 100, 100_000);
  const traction = clamp(finiteOr(handling.tractionMultiplier, 1), 0.1, 5);
  const tractionLoss = clamp(finiteOr(handling.tractionLoss, 1), 0.05, 5);
  const inertia = clamp(finiteOr(handling.engineInertia, 1), 0.05, 20);
  const gears = clamp(Math.round(finiteOr(handling.numberOfGears, 5)), 1, 8);
  const brake = clamp(finiteOr(handling.brakeDeceleration, 8), 0.1, 100);
  const drag = clamp(finiteOr(handling.dragMultiplier, 1), 0, 20);
  const steeringLock = clamp(finiteOr(handling.steeringLock, 30), 5, 70);
  return {
    // handling.cfg maxVelocity is a game tuning value; this conversion is a
    // first-pass scale, intentionally isolated so calibration can change later.
    maxSpeed: maxVelocityKmh / 3.6,
    acceleration: clamp(engineAcceleration * (1500 / mass) * 0.58, 0.35, 8.5),
    braking: clamp(brake * 0.85, 1, 18),
    drag: 0.006 + drag * 0.0008,
    grip: clamp(traction * (1.15 / tractionLoss), 0.12, 2.5),
    steeringLockRadians: steeringLock * Math.PI / 180,
    gearCount: gears,
    inertia,
    wheelBase: 2.65,
  };
}

export function createVehicleDriveState(position: { x: number; y: number; z: number }, heading = Math.PI): VehicleDriveState {
  if (![position.x, position.y, position.z, heading].every(Number.isFinite)) {
    throw new TypeError('Vehicle spawn position and heading must be finite.');
  }
  return { x: position.x, y: position.y, z: position.z, heading, speed: 0, rpm: 850, gear: 1, health: 1000, steering: 0, engineOn: true };
}

/**
 * Fixed-step-friendly arcade/bicycle vehicle model driven by the parsed handling row.
 * It deliberately does not claim exact GTA handling parity; collision response and
 * wheel/suspension contact are separate systems still to be integrated.
 */
export function stepVehicleDrive(
  state: VehicleDriveState,
  tuning: VehicleDriveTuning,
  input: VehicleDriveInput,
  deltaSeconds: number,
): VehicleDriveState {
  const dt = clamp(finiteOr(deltaSeconds, 0), 0, 0.05);
  if (dt === 0) return { ...state };
  const throttle = clamp(finiteOr(input.throttle, 0), -1, 1);
  const brake = clamp(finiteOr(input.brake, 0), 0, 1);
  const handbrake = clamp(finiteOr(input.handbrake ?? 0, 0), 0, 1);
  const steering = clamp(finiteOr(input.steering, 0), -1, 1);
  const next = { ...state };

  const rollingDirection = Math.sign(next.speed);
  const sameDirection = Math.sign(throttle) === rollingDirection || Math.abs(next.speed) < 0.6;
  if (next.engineOn && Math.abs(throttle) > 0 && sameDirection && brake < 0.05) {
    const engineFactor = clamp(1 - Math.abs(next.speed) / Math.max(0.1, tuning.maxSpeed), 0.08, 1);
    next.speed += throttle * tuning.acceleration * engineFactor * dt;
  }

  const resistance = tuning.drag * next.speed * Math.abs(next.speed);
  next.speed -= resistance * dt;
  if (brake > 0 || handbrake > 0 || (Math.abs(throttle) > 0 && !sameDirection)) {
    const brakeDemand = Math.max(brake, handbrake * 1.35, !sameDirection ? 0.75 : 0);
    const reduction = tuning.braking * brakeDemand * dt;
    next.speed = Math.abs(next.speed) <= reduction ? 0 : next.speed - Math.sign(next.speed) * reduction;
  }
  next.speed = clamp(next.speed, -tuning.maxSpeed * 0.32, tuning.maxSpeed);

  const lowSpeedSteer = 1 / (1 + Math.abs(next.speed) * 0.35);
  const steerResponse = clamp(7.5 / tuning.inertia, 1.2, 12);
  next.steering += (steering - next.steering) * (1 - Math.exp(-steerResponse * dt));
  const steerAngle = next.steering * tuning.steeringLockRadians * lowSpeedSteer;
  const gripFactor = clamp(tuning.grip * (1 - handbrake * 0.7), 0.08, 1.5);
  const yawRate = clamp((next.speed / tuning.wheelBase) * Math.tan(steerAngle) * gripFactor, -1.5, 1.5);
  next.heading += yawRate * dt;

  // Heading convention matches PlayerController: forward is (-sin(yaw), 0, -cos(yaw)).
  next.x += -Math.sin(next.heading) * next.speed * dt;
  next.z += -Math.cos(next.heading) * next.speed * dt;

  const speedKmh = Math.abs(next.speed) * 3.6;
  const maxKmh = tuning.maxSpeed * 3.6;
  const gear = Math.min(tuning.gearCount, Math.max(1, Math.floor((speedKmh / Math.max(1, maxKmh)) * tuning.gearCount * 1.12) + 1));
  next.gear = next.speed < -0.2 ? -1 : gear;
  const targetRpm = next.engineOn
    ? 850 + (Math.abs(throttle) * 5_100) + ((speedKmh / Math.max(1, maxKmh)) * 1_700) - (gear - 1) * 220
    : 0;
  next.rpm += (targetRpm - next.rpm) * (1 - Math.exp(-5 * dt));
  next.rpm = clamp(next.rpm, 0, 7_500);
  return next;
}

export function applyVehicleImpact(state: VehicleDriveState, impactSpeed: number, damageMultiplier: number): VehicleDriveState {
  if (!Number.isFinite(impactSpeed) || impactSpeed < 0 || !Number.isFinite(damageMultiplier) || damageMultiplier < 0) {
    throw new RangeError('Impact speed and damage multiplier must be finite and non-negative.');
  }
  const damage = clamp(impactSpeed * impactSpeed * 0.018 * damageMultiplier, 0, 1000);
  return { ...state, health: clamp(state.health - damage, 0, 1000) };
}
