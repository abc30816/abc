import * as THREE from 'three';
import { parseDff, type DffGeometry, type DffModel } from '../formats/dff';

const gtaToThree = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const threeToGta = gtaToThree.clone().invert();

function frameTransform(frame: DffModel['frames'][number]): THREE.Matrix4 {
  const b = frame.basis;
  const right = new THREE.Vector3(b[0], b[2], -b[1]);
  const up = new THREE.Vector3(b[3], b[5], -b[4]);
  const at = new THREE.Vector3(b[6], b[8], -b[7]);
  const p = new THREE.Vector3(frame.position[0], frame.position[2], -frame.position[1]);
  const m = new THREE.Matrix4().set(
    right.x, up.x, at.x, p.x,
    right.y, up.y, at.y, p.y,
    right.z, up.z, at.z, p.z,
    0, 0, 0, 1,
  );
  return m;
}

function geometryToThree(source: DffGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(source.positions, 3));
  if (source.normals.length) geometry.setAttribute('normal', new THREE.BufferAttribute(source.normals, 3));
  else geometry.computeVertexNormals();
  if (source.uvs.length) geometry.setAttribute('uv', new THREE.BufferAttribute(source.uvs, 2));
  if (source.colors.length) {
    const normalized = new Float32Array(source.colors.length);
    for (let i = 0; i < source.colors.length; i++) normalized[i] = source.colors[i] / 255;
    geometry.setAttribute('color', new THREE.BufferAttribute(normalized, 4));
  }
  const materialTriangles = new Map<number, number[]>();
  for (let tri = 0; tri < source.materialIds.length; tri++) {
    const material = source.materialIds[tri];
    const indices = materialTriangles.get(material) ?? [];
    indices.push(source.indices[tri * 3], source.indices[tri * 3 + 1], source.indices[tri * 3 + 2]);
    materialTriangles.set(material, indices);
  }
  const reordered: number[] = [];
  for (const [material, indices] of materialTriangles) {
    geometry.addGroup(reordered.length, indices.length, material);
    reordered.push(...indices);
  }
  geometry.setIndex(reordered);
  geometry.computeBoundingSphere();
  return geometry;
}

export function buildDffObject(bytes: Uint8Array, modelName: string, textures: Map<string, THREE.Texture> = new Map()): THREE.Group {
  const model = parseDff(bytes, `${modelName}.dff`);
  const group = new THREE.Group();
  group.name = modelName;
  group.userData.warnings = model.warnings;
  const frameObjects = model.frames.map((frame) => {
    const node = new THREE.Group();
    node.name = frame.name;
    node.matrixAutoUpdate = false;
    node.matrix.copy(frameTransform(frame));
    node.matrix.decompose(node.position, node.quaternion, node.scale);
    node.matrixAutoUpdate = true;
    return node;
  });
  for (let i = 0; i < frameObjects.length; i++) {
    const parent = model.frames[i].parent;
    if (parent >= 0 && parent < frameObjects.length && parent !== i) frameObjects[parent].add(frameObjects[i]);
    else group.add(frameObjects[i]);
  }
  if (!frameObjects.length) group.add(new THREE.Group());

  for (const atomic of model.atomics) {
    const source = model.geometries[atomic.geometryIndex];
    if (!source || source.native || !source.indices.length) continue;
    const geom = geometryToThree(source);
    const materialList = source.materials.map((m) => {
      const map = m.textureName ? textures.get(m.textureName) : undefined;
      return new THREE.MeshStandardMaterial({
        color: map ? 0xffffff : new THREE.Color(m.color[0] / 255, m.color[1] / 255, m.color[2] / 255),
        map,
        roughness: 0.88,
        metalness: 0.02,
        vertexColors: source.colors.length > 0,
        side: THREE.DoubleSide,
        transparent: m.color[3] < 255 || Boolean(map?.userData.hasAlpha),
        opacity: m.color[3] / 255,
        depthWrite: !(m.color[3] < 255 || Boolean(map?.userData.hasAlpha)),
      });
    });
    const safeMaterials = materialList.length ? materialList : [new THREE.MeshStandardMaterial({ color: 0xaaaaaa, side: THREE.DoubleSide })];
    const mesh = new THREE.Mesh(geom, safeMaterials.length === 1 ? safeMaterials[0] : safeMaterials);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const node = frameObjects[atomic.frameIndex] ?? group;
    node.add(mesh);
  }
  return group;
}

export function gtaQuaternionToThree(rotation: [number, number, number, number]): THREE.Quaternion {
  const source = new THREE.Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]).normalize();
  return gtaToThree.clone().multiply(source).multiply(threeToGta).normalize();
}
export function gtaPositionToThree(position: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(position[0], position[2], -position[1]);
}

export function buildCollisionMesh(model: import('../formats/col').CollisionModel): THREE.Mesh | null {
  if (!model.indices.length || !model.positions.length) return null;
  const positions = new Float32Array(model.positions.length);
  for (let i = 0; i < model.positions.length; i += 3) {
    positions[i] = model.positions[i];
    positions[i + 1] = model.positions[i + 2];
    positions[i + 2] = -model.positions[i + 1];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(model.indices, 1));
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `collision:${model.name}`;
  mesh.userData.isCollisionOnly = true;
  mesh.renderOrder = -10;
  return mesh;
}
