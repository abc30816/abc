import RAPIER from '@dimforge/rapier3d-compat';

/** The renderer and the physics layer both use Y-up world coordinates. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PhysicsWorldOptions {
  gravity?: Vec3;
  fixedTimeStep?: number;
  maxSubsteps?: number;
  solverIterations?: number;
}

export interface CharacterOptions {
  position?: Vec3;
  radius?: number;
  halfHeight?: number;
  offset?: number;
  maxSlopeDegrees?: number;
  stepHeight?: number;
}

export interface VehicleOptions {
  position?: Vec3;
  halfExtents?: Vec3;
  wheelRadius?: number;
  wheelBase?: number;
  trackWidth?: number;
  suspensionLength?: number;
  massDensity?: number;
  engineForce?: number;
  brakeForce?: number;
  steeringAngle?: number;
}

export interface VehicleControls {
  /** -1..1: reverse to forward */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1..1: left to right */
  steering: number;
}

export interface CharacterState {
  position: Vec3;
  grounded: boolean;
  verticalVelocity: number;
}

const DEFAULT_GRAVITY: Vec3 = { x: 0, y: -9.81, z: 0 };
const DEFAULT_FIXED_STEP = 1 / 60;
const DEFAULT_MAX_SUBSTEPS = 5;
const MAX_FRAME_DELTA = 0.25;
const MAX_TRIANGLE_MESH_VERTICES = 250_000;
const MAX_TRIANGLE_MESH_INDICES = 1_500_000;

let rapierInit: Promise<void> | undefined;

/** Loads Rapier's actual WebAssembly module once per page lifetime. */
export async function initializePhysicsWasm(): Promise<void> {
  if (!rapierInit) {
    rapierInit = RAPIER.init().catch((error: unknown) => {
      // Permit a later retry if WASM initialization failed (for example, a transient fetch error).
      rapierInit = undefined;
      throw error;
    });
  }
  await rapierInit;
}

function finiteVec3(value: Vec3, label: string): void {
  if (![value.x, value.y, value.z].every(Number.isFinite)) {
    throw new TypeError(`${label} must contain three finite numbers.`);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Original project physics adapter backed by Rapier 3D WebAssembly.
 * It is an engine foundation, not a claim of GTA's exact physics parity.
 */
export class RapierPhysicsWorld {
  readonly world: RAPIER.World;
  readonly fixedTimeStep: number;
  readonly maxSubsteps: number;
  readonly gravity: Vec3;

  private accumulator = 0;
  private character: {
    body: RAPIER.RigidBody;
    collider: RAPIER.Collider;
    controller: RAPIER.KinematicCharacterController;
    verticalVelocity: number;
    grounded: boolean;
  } | null = null;
  private readonly vehicleControllers: RAPIER.DynamicRayCastVehicleController[] = [];
  private disposed = false;

  private constructor(options: PhysicsWorldOptions) {
    this.gravity = options.gravity ?? DEFAULT_GRAVITY;
    finiteVec3(this.gravity, 'gravity');
    if ([this.gravity.x, this.gravity.y, this.gravity.z].some((value) => Math.abs(value) > 1_000)) {
      throw new RangeError('Gravity components must be within ±1000 m/s².');
    }

    this.fixedTimeStep = options.fixedTimeStep ?? DEFAULT_FIXED_STEP;
    if (!Number.isFinite(this.fixedTimeStep) || this.fixedTimeStep < 1 / 1_000 || this.fixedTimeStep > 1 / 15) {
      throw new RangeError('fixedTimeStep must be between 1/1000 and 1/15 second.');
    }

    this.maxSubsteps = options.maxSubsteps ?? DEFAULT_MAX_SUBSTEPS;
    if (!Number.isInteger(this.maxSubsteps) || this.maxSubsteps < 1 || this.maxSubsteps > 20) {
      throw new RangeError('maxSubsteps must be an integer from 1 through 20.');
    }

    const solverIterations = options.solverIterations ?? 8;
    if (!Number.isInteger(solverIterations) || solverIterations < 1 || solverIterations > 64) {
      throw new RangeError('solverIterations must be an integer from 1 through 64.');
    }

    this.world = new RAPIER.World(this.gravity);
    this.world.timestep = this.fixedTimeStep;
    this.world.integrationParameters.numSolverIterations = solverIterations;
  }

  static async create(options: PhysicsWorldOptions = {}): Promise<RapierPhysicsWorld> {
    await initializePhysicsWasm();
    return new RapierPhysicsWorld(options);
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error('Physics world has already been disposed.');
  }

  /** Adds a fixed cuboid collider. Coordinates and half-extents are in metres. */
  addStaticBox(center: Vec3, halfExtents: Vec3, friction = 0.9): RAPIER.Collider {
    this.assertAlive();
    finiteVec3(center, 'center');
    finiteVec3(halfExtents, 'halfExtents');
    if (!Number.isFinite(friction)) throw new TypeError('friction must be finite.');
    if (halfExtents.x <= 0 || halfExtents.y <= 0 || halfExtents.z <= 0) {
      throw new RangeError('Box half-extents must be positive.');
    }
    const descriptor = RAPIER.ColliderDesc
      .cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setTranslation(center.x, center.y, center.z)
      .setFriction(clamp(friction, 0, 2));
    return this.world.createCollider(descriptor);
  }

  /**
   * Adds a fixed triangle mesh, suitable for COL-derived world collision.
   * The vertex array is [x,y,z,...] and indices are triangle triplets.
   */
  addStaticTriangleMesh(vertices: Float32Array, indices: Uint32Array, friction = 0.9): RAPIER.Collider {
    this.assertAlive();
    if (!Number.isFinite(friction)) throw new TypeError('friction must be finite.');
    if (vertices.length < 9 || vertices.length % 3 !== 0) {
      throw new RangeError('A triangle mesh needs at least three XYZ vertices.');
    }
    if (vertices.length / 3 > MAX_TRIANGLE_MESH_VERTICES) {
      throw new RangeError(`Triangle mesh exceeds ${MAX_TRIANGLE_MESH_VERTICES} vertices.`);
    }
    if (indices.length < 3 || indices.length % 3 !== 0) {
      throw new RangeError('Triangle indices must contain complete triplets.');
    }
    if (indices.length > MAX_TRIANGLE_MESH_INDICES) {
      throw new RangeError(`Triangle mesh exceeds ${MAX_TRIANGLE_MESH_INDICES / 3} triangles.`);
    }
    for (const component of vertices) {
      if (!Number.isFinite(component)) throw new TypeError('Triangle mesh contains a non-finite vertex.');
    }
    const vertexCount = vertices.length / 3;
    for (const index of indices) {
      if (index >= vertexCount) throw new RangeError(`Triangle mesh index ${index} exceeds ${vertexCount - 1}.`);
    }
    const descriptor = RAPIER.ColliderDesc
      .trimesh(vertices, indices)
      .setFriction(clamp(friction, 0, 2));
    return this.world.createCollider(descriptor);
  }

  /** Adds a dynamic box for props/debris tests. */
  createDynamicBox(position: Vec3, halfExtents: Vec3, density = 1, friction = 0.7): RAPIER.RigidBody {
    this.assertAlive();
    finiteVec3(position, 'position');
    finiteVec3(halfExtents, 'halfExtents');
    if (!Number.isFinite(density) || !Number.isFinite(friction)) throw new TypeError('density and friction must be finite.');
    if (halfExtents.x <= 0 || halfExtents.y <= 0 || halfExtents.z <= 0
      || halfExtents.x > 10_000 || halfExtents.y > 10_000 || halfExtents.z > 10_000
      || density <= 0 || density > 5_000) {
      throw new RangeError('Dynamic box dimensions or density exceed safe bounds.');
    }
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setCanSleep(false),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
        .setDensity(density)
        .setFriction(clamp(friction, 0, 2)),
      body,
    );
    return body;
  }

  /** Creates a kinematic capsule character and Rapier's slide/step controller. */
  createPlayerCharacter(options: CharacterOptions = {}): void {
    this.assertAlive();
    if (this.character) throw new Error('A player character already exists.');

    const position = options.position ?? { x: 0, y: 2, z: 0 };
    finiteVec3(position, 'character position');
    const radius = options.radius ?? 0.35;
    const halfHeight = options.halfHeight ?? 0.55;
    const offset = options.offset ?? 0.015;
    const maxSlopeDegrees = options.maxSlopeDegrees ?? 45;
    const stepHeight = options.stepHeight ?? 0.32;
    if (![radius, halfHeight, offset, maxSlopeDegrees, stepHeight].every(Number.isFinite)) {
      throw new TypeError('Character dimensions and controller settings must be finite.');
    }
    if (radius <= 0 || radius > 5 || halfHeight <= 0 || halfHeight > 10
      || offset <= 0 || offset > 0.25 || stepHeight < 0 || stepHeight > 2
      || maxSlopeDegrees <= 0 || maxSlopeDegrees >= 90) {
      throw new RangeError('Character dimensions exceed safe bounds (radius ≤5 m, half-height ≤10 m, offset ≤0.25 m, step ≤2 m; slope between 0 and 90 degrees).');
    }

    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(position.x, position.y, position.z)
        .setCanSleep(false),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius).setFriction(0).setRestitution(0),
      body,
    );

    const controller = this.world.createCharacterController(offset);
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.setMaxSlopeClimbAngle(maxSlopeDegrees * Math.PI / 180);
    controller.setMinSlopeSlideAngle(30 * Math.PI / 180);
    if (stepHeight > 0) controller.enableAutostep(stepHeight, 0.18, true);
    controller.enableSnapToGround(0.2);
    controller.setApplyImpulsesToDynamicBodies(true);

    this.character = { body, collider, controller, verticalVelocity: 0, grounded: false };
  }

  /**
   * Computes collision-corrected player movement for one fixed physics tick.
   * Call from the beforeStep callback passed to stepFrame(). Horizontal input is velocity in m/s.
   */
  movePlayer(horizontalVelocity: Vec3, deltaSeconds = this.fixedTimeStep): CharacterState {
    this.assertAlive();
    const player = this.character;
    if (!player) throw new Error('Call createPlayerCharacter() before moving the player.');
    finiteVec3(horizontalVelocity, 'horizontalVelocity');
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || deltaSeconds > this.fixedTimeStep * 1.01) {
      throw new RangeError('Player movement must be advanced by one positive fixed physics timestep.');
    }

    player.verticalVelocity = clamp(
      player.verticalVelocity + this.gravity.y * deltaSeconds,
      -55,
      55,
    );
    const desired = {
      x: horizontalVelocity.x * deltaSeconds,
      y: player.verticalVelocity * deltaSeconds,
      z: horizontalVelocity.z * deltaSeconds,
    };

    player.controller.computeColliderMovement(player.collider, desired);
    const corrected = player.controller.computedMovement();
    player.grounded = player.controller.computedGrounded();
    if (player.grounded && player.verticalVelocity < 0) player.verticalVelocity = 0;

    const current = player.body.translation();
    const next = {
      x: current.x + corrected.x,
      y: current.y + corrected.y,
      z: current.z + corrected.z,
    };
    player.body.setNextKinematicTranslation(next);

    // Return the computed next pose; the rigid body is committed by world.step().
    return { position: next, grounded: player.grounded, verticalVelocity: player.verticalVelocity };
  }

  /** Returns false unless the previous character-controller move reported grounded. */
  jumpPlayer(speed = 5.5): boolean {
    this.assertAlive();
    const player = this.character;
    if (!player || !player.grounded || !Number.isFinite(speed) || speed <= 0) return false;
    player.verticalVelocity = speed;
    player.grounded = false;
    return true;
  }

  getPlayerState(): CharacterState {
    this.assertAlive();
    const player = this.character;
    if (!player) throw new Error('No player character has been created.');
    const position = player.body.translation();
    return {
      position: { x: position.x, y: position.y, z: position.z },
      grounded: player.grounded,
      verticalVelocity: player.verticalVelocity,
    };
  }

  /**
   * Creates a four-wheel raycast chassis. This is a generic baseline only;
   * actual San Andreas handling.cfg values and model-specific wheel data must be imported later.
   */
  createFourWheelVehicle(options: VehicleOptions = {}) {
    this.assertAlive();
    const position = options.position ?? { x: 0, y: 0.9, z: 0 };
    const half = options.halfExtents ?? { x: 0.9, y: 0.32, z: 1.8 };
    finiteVec3(position, 'vehicle position');
    finiteVec3(half, 'vehicle halfExtents');
    if (half.x <= 0 || half.y <= 0 || half.z <= 0) {
      throw new RangeError('Vehicle half-extents must be positive.');
    }

    // Validate all tuning before allocating Rapier objects, so invalid input cannot
    // leave a half-created chassis/controller inside the world.
    const wheelRadius = options.wheelRadius ?? 0.34;
    const wheelBase = options.wheelBase ?? half.z * 1.35;
    const trackWidth = options.trackWidth ?? half.x * 1.55;
    const suspensionLength = options.suspensionLength ?? 0.28;
    const massDensity = options.massDensity ?? 180;
    const engineForce = options.engineForce ?? 1800;
    const brakeForce = options.brakeForce ?? 45;
    const steeringAngle = options.steeringAngle ?? 0.42;
    const tuning = [wheelRadius, wheelBase, trackWidth, suspensionLength, massDensity, engineForce, brakeForce, steeringAngle];
    if (!tuning.every(Number.isFinite)) throw new TypeError('Vehicle dimensions and tuning values must be finite.');
    if (wheelRadius <= 0 || wheelRadius > 2
      || wheelBase <= 0 || wheelBase > 10
      || trackWidth <= 0 || trackWidth > 5
      || suspensionLength <= 0 || suspensionLength > 2
      || massDensity <= 0 || massDensity > 5_000
      || engineForce < 0 || engineForce > 100_000
      || brakeForce < 0 || brakeForce > 10_000
      || steeringAngle < 0 || steeringAngle > 1.2) {
      throw new RangeError('Vehicle tuning is outside safe physical bounds.');
    }

    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setLinearDamping(0.04)
        .setAngularDamping(0.35)
        .setCanSleep(false),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
        .setDensity(massDensity)
        .setFriction(0.8),
      body,
    );

    const vehicle = this.world.createVehicleController(body);
    this.vehicleControllers.push(vehicle);
    // San Andreas-style models use +Z forward and +Y up. Rapier defaults to +X forward.
    vehicle.setIndexForwardAxis = 2;
    vehicle.indexUpAxis = 1;

    const wheelY = -half.y;
    const wheelPositions: Vec3[] = [
      { x: -trackWidth / 2, y: wheelY, z: wheelBase / 2 },
      { x: trackWidth / 2, y: wheelY, z: wheelBase / 2 },
      { x: -trackWidth / 2, y: wheelY, z: -wheelBase / 2 },
      { x: trackWidth / 2, y: wheelY, z: -wheelBase / 2 },
    ];
    for (const wheelPosition of wheelPositions) {
      vehicle.addWheel(
        wheelPosition,
        { x: 0, y: -1, z: 0 },
        { x: 1, y: 0, z: 0 },
        suspensionLength,
        wheelRadius,
      );
    }
    for (let index = 0; index < vehicle.numWheels(); index += 1) {
      vehicle.setWheelSuspensionStiffness(index, 100);
      vehicle.setWheelSuspensionCompression(index, 10);
      vehicle.setWheelSuspensionRelaxation(index, 10);
    }

    return {
      body,
      controller: vehicle,
      currentSpeed: (): number => vehicle.currentVehicleSpeed(),
      update: (controls: VehicleControls, deltaSeconds = this.fixedTimeStep): void => {
        this.assertAlive();
        if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || deltaSeconds > this.fixedTimeStep * 1.01) {
          throw new RangeError('Vehicle update must use one positive fixed physics timestep.');
        }
        if (![controls.throttle, controls.brake, controls.steering].every(Number.isFinite)) {
          throw new TypeError('Vehicle controls must be finite numbers.');
        }
        const throttle = clamp(controls.throttle, -1, 1);
        const brake = clamp(controls.brake, 0, 1);
        const steering = clamp(controls.steering, -1, 1);
        for (let index = 0; index < vehicle.numWheels(); index += 1) {
          vehicle.setWheelEngineForce(index, throttle * engineForce);
          vehicle.setWheelBrake(index, brake * brakeForce);
          vehicle.setWheelSteering(index, index < 2 ? steering * steeringAngle : 0);
        }
        vehicle.updateVehicle(deltaSeconds, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
      },
    };
  }

  /**
   * Advances the world at a fixed rate. beforeEachStep runs before each world.step(),
   * so character movement and vehicle raycasts stay synchronized with the simulation.
   */
  stepFrame(frameDeltaSeconds: number, beforeEachStep?: (fixedDeltaSeconds: number) => void): number {
    this.assertAlive();
    if (!Number.isFinite(frameDeltaSeconds) || frameDeltaSeconds < 0) {
      throw new RangeError('Frame delta must be a finite, non-negative number.');
    }
    this.accumulator += Math.min(frameDeltaSeconds, MAX_FRAME_DELTA);
    let steps = 0;
    while (this.accumulator >= this.fixedTimeStep && steps < this.maxSubsteps) {
      beforeEachStep?.(this.fixedTimeStep);
      this.world.timestep = this.fixedTimeStep;
      this.world.step();
      this.accumulator -= this.fixedTimeStep;
      steps += 1;
    }
    // Drop excessive backlog after a suspended tab; do not attempt hundreds of catch-up steps.
    if (steps === this.maxSubsteps && this.accumulator >= this.fixedTimeStep) {
      this.accumulator = 0;
    }
    return steps;
  }

  /** Exposes Rapier's wireframe debug geometry for Three.js/WebGL rendering. */
  debugRender(): { vertices: Float32Array; colors: Float32Array } {
    this.assertAlive();
    return this.world.debugRender();
  }

  dispose(): void {
    if (this.disposed) return;
    for (const vehicle of this.vehicleControllers) this.world.removeVehicleController(vehicle);
    this.vehicleControllers.length = 0;
    if (this.character) {
      this.world.removeCharacterController(this.character.controller);
      this.world.removeRigidBody(this.character.body);
      this.character = null;
    }
    this.world.free();
    this.disposed = true;
  }
}
