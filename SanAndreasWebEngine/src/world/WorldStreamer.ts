import * as THREE from 'three';
import type { GameFileSet } from '../core/GameFiles';
import { readModelDff, readTextureDictionary } from '../core/GameFiles';
import { buildCollisionMesh, buildDffObject, gtaPositionToThree, gtaQuaternionToThree } from './DffObject';

interface WorldChunk {
  key: string;
  group: THREE.Group;
  loaded: boolean;
  loading: boolean;
  instances: GameFileSet['instances'];
}

export interface StreamStats { activeChunks: number; visibleInstances: number; loadedModels: number; skippedModels: number; }

export class WorldStreamer {
  readonly root = new THREE.Group();
  private readonly chunks = new Map<string, WorldChunk>();
  private readonly modelCache = new Map<string, Promise<THREE.Group | null>>();
  private readonly textureCache = new Map<string, Promise<Map<string, THREE.Texture>>>();
  private skipped = 0;
  private readonly byChunk = new Map<string, GameFileSet['instances']>();
  private readonly chunkSize = 180;
  private readonly radius = 440;

  constructor(private readonly game: GameFileSet) {
    this.root.name = 'streamed-world';
    for (const item of game.instances) {
      const cx = Math.floor(item.position[0] / this.chunkSize);
      const cz = Math.floor(item.position[1] / this.chunkSize);
      const key = `${cx}:${cz}`;
      const list = this.byChunk.get(key) ?? [];
      list.push(item);
      this.byChunk.set(key, list);
    }
  }

  async update(player: THREE.Vector3): Promise<void> {
    const gtaX = player.x;
    const gtaY = -player.z;
    const cx = Math.floor(gtaX / this.chunkSize);
    const cz = Math.floor(gtaY / this.chunkSize);
    const r = Math.ceil(this.radius / this.chunkSize);
    const wanted = new Set<string>();
    const candidates: WorldChunk[] = [];
    for (let x = cx - r; x <= cx + r; x++) {
      for (let z = cz - r; z <= cz + r; z++) {
        const centerX = (x + 0.5) * this.chunkSize;
        const centerZ = (z + 0.5) * this.chunkSize;
        if (Math.hypot(centerX - gtaX, centerZ - gtaY) > this.radius + this.chunkSize * 0.8) continue;
        const key = `${x}:${z}`;
        const instances = this.byChunk.get(key);
        if (!instances?.length) continue;
        wanted.add(key);
        let chunk = this.chunks.get(key);
        if (!chunk) {
          chunk = { key, group: new THREE.Group(), loaded: false, loading: false, instances };
          chunk.group.name = `world-cell-${key}`;
          this.chunks.set(key, chunk);
          this.root.add(chunk.group);
        }
        if (!chunk.loaded && !chunk.loading) candidates.push(chunk);
      }
    }
    for (const [key, chunk] of this.chunks) {
      if (!wanted.has(key)) { this.root.remove(chunk.group); this.chunks.delete(key); }
    }
    // Load a small number of cells at a time to avoid a long main-thread stall.
    await Promise.all(candidates.slice(0, 2).map((chunk) => this.loadChunk(chunk)));
  }

  private async loadChunk(chunk: WorldChunk): Promise<void> {
    chunk.loading = true;
    try {
      let loaded = 0;
      for (const instance of chunk.instances) {
        const def = this.game.ide.get(instance.id);
        const modelName = (def?.modelName ?? instance.modelName).toLowerCase();
        const txdName = (def?.txdName ?? '').toLowerCase();
        const model = await this.getModel(modelName, txdName);
        const collisionModel = this.game.collisions.get(modelName);
        const collision = collisionModel ? buildCollisionMesh(collisionModel) : null;
        if (collision) {
          collision.position.copy(gtaPositionToThree(instance.position));
          collision.quaternion.copy(gtaQuaternionToThree(instance.rotation));
          chunk.group.add(collision);
        }
        if (!model) { if (!collision) this.skipped++; continue; }
        const object = model.clone(true);
        object.position.copy(gtaPositionToThree(instance.position));
        object.quaternion.copy(gtaQuaternionToThree(instance.rotation));
        const distance = def?.drawDistance ?? 120;
        object.userData.drawDistance = distance;
        object.userData.modelName = modelName;
        chunk.group.add(object);
        loaded++;
      }
      chunk.loaded = true;
      chunk.group.userData.instanceCount = loaded;
    } finally {
      chunk.loading = false;
    }
  }

  private getModel(name: string, txdName: string): Promise<THREE.Group | null> {
    const cacheKey = `${name}|${txdName}`;
    let result = this.modelCache.get(cacheKey);
    if (!result) {
      result = (async () => {
        try {
          const data = await readModelDff(this.game, name);
          if (!data) return null;
          const textures = txdName ? await this.getTextures(txdName) : new Map();
          return buildDffObject(data, name, textures);
        } catch (error) {
          console.warn(`Could not load ${name}.dff`, error);
          return null;
        }
      })();
      this.modelCache.set(cacheKey, result);
    }
    return result;
  }

  private getTextures(name: string): Promise<Map<string, THREE.Texture>> {
    let result = this.textureCache.get(name);
    if (!result) {
      result = (async () => {
        const decoded = await readTextureDictionary(this.game, name);
        const textures = new Map<string, THREE.Texture>();
        for (const [key, item] of decoded ?? []) {
          const texture = new THREE.DataTexture(item.rgba, item.width, item.height, THREE.RGBAFormat, THREE.UnsignedByteType);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
          texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.generateMipmaps = true; texture.flipY = true; texture.needsUpdate = true;
          texture.userData.hasAlpha = item.hasAlpha;
          textures.set(key, texture);
        }
        return textures;
      })();
      this.textureCache.set(name, result);
    }
    return result;
  }

  getStats(): StreamStats {
    let visibleInstances = 0;
    for (const chunk of this.chunks.values()) visibleInstances += chunk.group.children.length;
    return { activeChunks: this.chunks.size, visibleInstances, loadedModels: this.modelCache.size, skippedModels: this.skipped };
  }
}
