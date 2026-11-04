import * as THREE from 'three';
import type { GameFileSet } from '../core/GameFiles';
import { readModelDff, readTextureDictionary } from '../core/GameFiles';
import { loadVehicleCatalogFromFiles, type VehicleCatalogEntry } from '../config/vehicleCatalog';
import { buildDffObject } from '../world/DffObject';
import { createVehicleDriveState, createVehicleDriveTuning, stepVehicleDrive, type VehicleDriveState, type VehicleDriveTuning } from './VehicleDynamics';
import type { PlayerController } from './PlayerController';

interface BrowserVehicle {
  entry: VehicleCatalogEntry;
  root: THREE.Group;
  state: VehicleDriveState;
  tuning: VehicleDriveTuning;
}

export interface VehicleHudState {
  driving: boolean;
  prompt: string;
  modelName: string;
  speedKmh: number;
  gear: string;
  health: number;
  loaded: number;
  skipped: number;
}

const PREFERRED_MODELS = ['landstal', 'bravura', 'buffalo', 'sentinel', 'premier', 'admiral', 'club', 'elegy', 'sultan', 'taxi', 'police'];
const MAX_SPAWNED_VEHICLES = 8;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Browser-local vehicle assets and first integrated driving controller. */
export class VehicleSystem {
  readonly root = new THREE.Group();
  readonly catalog: Map<number, VehicleCatalogEntry>;
  private readonly vehicles: BrowserVehicle[] = [];
  private readonly keys = new Set<string>();
  private readonly ownedTextures = new Set<THREE.Texture>();
  private readonly textureCache = new Map<string, Map<string, THREE.Texture>>();
  private active: BrowserVehicle | null = null;
  private skipped = 0;
  private cameraYawOffset = 0;
  private cameraPitch = -0.12;
  private disposed = false;

  private constructor(
    private readonly game: GameFileSet,
    private readonly player: PlayerController,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    catalog: Map<number, VehicleCatalogEntry>,
  ) {
    this.catalog = catalog;
    this.root.name = 'vehicle-system';
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
  }

  static async create(game: GameFileSet, player: PlayerController, camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement): Promise<VehicleSystem> {
    const parsed = await loadVehicleCatalogFromFiles(game.files);
    const system = new VehicleSystem(game, player, camera, canvas, parsed.catalog.byModelId);
    const preferred = PREFERRED_MODELS
      .map((name) => parsed.catalog.byModelName.get(name))
      .filter((entry): entry is VehicleCatalogEntry => Boolean(entry && game.modelEntries.has(entry.modelName.toLowerCase())));
    const fallback = [...parsed.catalog.byModelId.values()]
      .filter((entry) => entry.vehicleType.toLowerCase() === 'car' && game.modelEntries.has(entry.modelName.toLowerCase()))
      .sort((a, b) => b.frequency - a.frequency);
    const chosen = new Map<string, VehicleCatalogEntry>();
    for (const entry of [...preferred, ...fallback]) {
      if (!chosen.has(entry.modelName.toLowerCase())) chosen.set(entry.modelName.toLowerCase(), entry);
      if (chosen.size >= MAX_SPAWNED_VEHICLES) break;
    }
    const candidates = [...chosen.values()];

    const origin = player.position.clone();
    const offsets = [
      new THREE.Vector3(4.0, -1.0, 0), new THREE.Vector3(-4.0, -1.0, 0),
      new THREE.Vector3(10, -1.0, 8), new THREE.Vector3(-10, -1.0, 8),
      new THREE.Vector3(0, -1.0, 13), new THREE.Vector3(18, -1.0, 0),
      new THREE.Vector3(-18, -1.0, 0), new THREE.Vector3(0, -1.0, -16),
    ];
    for (const entry of candidates.slice(0, MAX_SPAWNED_VEHICLES)) {
      const loaded = await system.loadVehicle(entry);
      if (!loaded) { system.skipped += 1; continue; }
      const offset = offsets[system.vehicles.length] ?? new THREE.Vector3(10 + system.vehicles.length * 2, -1, 10);
      const spawn = origin.clone().add(offset);
      const state = createVehicleDriveState(spawn, Math.PI);
      loaded.root.position.set(state.x, state.y, state.z);
      loaded.root.rotation.y = state.heading;
      system.root.add(loaded.root);
      system.vehicles.push({ entry, root: loaded.root, state, tuning: createVehicleDriveTuning(entry.handling) });
    }
    return system;
  }

  get isDriving(): boolean { return this.active !== null; }
  get streamPosition(): THREE.Vector3 { return this.active ? this.active.root.position.clone() : this.player.position.clone(); }

  private async loadVehicle(entry: VehicleCatalogEntry): Promise<{ root: THREE.Group } | null> {
    if (!this.game.modelEntries.has(entry.modelName.toLowerCase())) return null;
    try {
      const bytes = await readModelDff(this.game, entry.modelName);
      if (!bytes) return null;
      const textures = await this.getTextures(entry.txdName);
      const root = buildDffObject(bytes, entry.modelName, textures);
      let meshCount = 0;
      root.traverse((object) => { if (object instanceof THREE.Mesh) meshCount += 1; });
      if (meshCount === 0) {
        // Native/unsupported vehicle pipelines are not represented by a fake box.
        root.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
        return null;
      }
      root.name = `vehicle:${entry.modelName}`;
      root.userData.modelId = entry.modelId;
      root.userData.handlingId = entry.handlingId;
      return { root };
    } catch (error) {
      console.warn(`Vehicle ${entry.modelName} could not be decoded; skipped safely.`, error);
      return null;
    }
  }

  private async getTextures(dictionaryName: string): Promise<Map<string, THREE.Texture>> {
    const key = dictionaryName.toLowerCase();
    const cached = this.textureCache.get(key);
    if (cached) return cached;
    const textures = new Map<string, THREE.Texture>();
    const decoded = await readTextureDictionary(this.game, dictionaryName);
    for (const [name, item] of decoded ?? []) {
      const texture = new THREE.DataTexture(item.rgba, item.width, item.height, THREE.RGBAFormat, THREE.UnsignedByteType);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      texture.flipY = true;
      texture.userData.hasAlpha = item.hasAlpha;
      texture.needsUpdate = true;
      textures.set(name, texture);
      this.ownedTextures.add(texture);
    }
    this.textureCache.set(key, textures);
    return textures;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (['KeyE', 'KeyF', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(event.code)) event.preventDefault();
    if (!event.repeat) this.keys.add(event.code);
    if (event.code === 'KeyE' && !event.repeat && !this.active) this.tryEnterNearest();
    if (event.code === 'KeyF' && !event.repeat && this.active && Math.abs(this.active.state.speed) < 1.5) this.exitVehicle();
  };

  private onKeyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code); };
  private onMouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas || !this.active) return;
    this.cameraYawOffset = clamp(this.cameraYawOffset - event.movementX * 0.002, -1.15, 1.15);
    this.cameraPitch = clamp(this.cameraPitch - event.movementY * 0.0016, -0.5, 0.2);
  };

  private nearestVehicle(): { vehicle: BrowserVehicle; distance: number } | null {
    let best: { vehicle: BrowserVehicle; distance: number } | null = null;
    for (const vehicle of this.vehicles) {
      const distance = this.player.position.distanceTo(vehicle.root.position);
      if (!best || distance < best.distance) best = { vehicle, distance };
    }
    return best;
  }

  private tryEnterNearest(): void {
    const nearest = this.nearestVehicle();
    if (!nearest || nearest.distance > 5.0) return;
    this.active = nearest.vehicle;
    this.player.setDriving(true);
    this.cameraYawOffset = 0;
    this.cameraPitch = -0.12;
  }

  private exitVehicle(): void {
    if (!this.active) return;
    const vehicle = this.active;
    const side = new THREE.Vector3(Math.cos(vehicle.state.heading), 0, -Math.sin(vehicle.state.heading));
    const exit = vehicle.root.position.clone().addScaledVector(side, 3.2);
    this.player.setPosition(exit, vehicle.state.heading);
    this.player.setDriving(false);
    this.active = null;
  }

  update(deltaSeconds: number): VehicleHudState {
    if (this.disposed) return this.emptyHud();
    if (this.active) {
      const throttle = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
      const steering = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
      const brake = this.keys.has('Space') ? 1 : 0;
      const handbrake = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 1 : 0;
      this.active.state = stepVehicleDrive(this.active.state, this.active.tuning, { throttle, steering, brake, handbrake }, deltaSeconds);
      this.active.root.position.set(this.active.state.x, this.active.state.y, this.active.state.z);
      this.active.root.rotation.y = this.active.state.heading;
      this.updateDrivingCamera(deltaSeconds);
    }
    const nearest = this.active ? null : this.nearestVehicle();
    const prompt = nearest && nearest.distance <= 5
      ? `PRESS E TO ENTER ${nearest.vehicle.entry.modelName.toUpperCase()}`
      : '';
    return this.active
      ? {
          driving: true,
          prompt: Math.abs(this.active.state.speed) < 1.5
            ? 'W/S DRIVE · A/D STEER · SPACE BRAKE · SHIFT HANDBRAKE · F EXIT'
            : 'W/S DRIVE · A/D STEER · SPACE BRAKE · SHIFT HANDBRAKE · SLOW DOWN TO EXIT',
          modelName: this.active.entry.modelName,
          speedKmh: Math.round(Math.abs(this.active.state.speed) * 3.6),
          gear: this.active.state.gear < 0 ? 'R' : String(this.active.state.gear),
          health: Math.round(this.active.state.health),
          loaded: this.vehicles.length,
          skipped: this.skipped,
        }
      : { ...this.emptyHud(), prompt };
  }

  private updateDrivingCamera(dt: number): void {
    if (!this.active) return;
    const state = this.active.state;
    const yaw = state.heading + this.cameraYawOffset;
    const target = new THREE.Vector3(state.x, state.y + 1.8, state.z);
    const distance = 8 + Math.min(3, Math.abs(state.speed) * 0.08);
    const desired = target.clone().add(new THREE.Vector3(Math.sin(yaw) * distance, 3.0 + this.cameraPitch * 3, Math.cos(yaw) * distance));
    this.camera.position.lerp(desired, 1 - Math.exp(-5.5 * Math.max(0, Math.min(dt, 0.05))));
    this.camera.lookAt(target);
  }

  private emptyHud(): VehicleHudState {
    return { driving: false, prompt: '', modelName: '', speedKmh: 0, gear: 'N', health: 1000, loaded: this.vehicles.length, skipped: this.skipped };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    for (const vehicle of this.vehicles) {
      vehicle.root.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
        if (object instanceof THREE.Mesh) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) material.dispose();
        }
      });
    }
    for (const texture of this.ownedTextures) texture.dispose();
    this.textureCache.clear();
    this.vehicles.length = 0;
    this.root.clear();
  }
}
