import * as THREE from 'three';

export class PlayerController {
  readonly position = new THREE.Vector3(2495, 14.5, 1675);
  readonly velocity = new THREE.Vector3();
  readonly visual = new THREE.Group();
  yaw = Math.PI;
  pitch = -0.12;
  private readonly keys = new Set<string>();
  private grounded = false;
  private driving = false;
  private jumpQueued = false;
  private readonly body: THREE.Mesh;
  private readonly raycaster = new THREE.Raycaster();

  constructor(private readonly canvas: HTMLCanvasElement, private readonly camera: THREE.PerspectiveCamera) {
    const bodyGeometry = new THREE.CapsuleGeometry(0.32, 0.82, 5, 10);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x93b5a0, roughness: 0.82 });
    this.body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    this.body.castShadow = true;
    this.body.position.y = 0.94;
    this.visual.add(this.body);
    this.visual.position.copy(this.position);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.canvas.addEventListener('click', this.requestPointerLock);
    document.addEventListener('mousemove', this.onMouseMove);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
    if (event.code === 'Space' && !event.repeat) this.jumpQueued = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  };
  private onKeyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code); };
  private requestPointerLock = (): void => { if (document.pointerLockElement !== this.canvas) void this.canvas.requestPointerLock(); };
  private onMouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas) return;
    this.yaw -= event.movementX * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * 0.0018, -0.8, 0.35);
  };

  setDriving(driving: boolean): void {
    this.driving = driving;
    this.visual.visible = !driving;
    if (driving) this.velocity.set(0, 0, 0);
  }

  setPosition(position: THREE.Vector3, yaw = this.yaw): void {
    this.position.copy(position);
    this.yaw = yaw;
    this.velocity.set(0, 0, 0);
    this.visual.position.copy(this.position);
    this.visual.rotation.y = this.yaw;
    this.grounded = false;
  }

  update(dt: number, world: THREE.Object3D): void {
    if (this.driving) return;
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const move = new THREE.Vector3();
    if (this.keys.has('KeyW')) move.add(forward);
    if (this.keys.has('KeyS')) move.sub(forward);
    if (this.keys.has('KeyD')) move.add(right);
    if (this.keys.has('KeyA')) move.sub(right);
    if (move.lengthSq() > 0) move.normalize();
    const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 8.5 : 4.3;
    this.velocity.x = THREE.MathUtils.damp(this.velocity.x, move.x * speed, 12, dt);
    this.velocity.z = THREE.MathUtils.damp(this.velocity.z, move.z * speed, 12, dt);
    if (this.jumpQueued && this.grounded) { this.velocity.y = 5.2; this.grounded = false; }
    this.jumpQueued = false;
    this.velocity.y -= 18 * dt;
    this.position.addScaledVector(this.velocity, dt);

    // Temporary visual ground contact: raycast loaded world geometry, then use the Ganton start plane as fallback.
    const rayOrigin = new THREE.Vector3(this.position.x, this.position.y + 1.8, this.position.z);
    this.raycaster.set(rayOrigin, new THREE.Vector3(0, -1, 0));
    this.raycaster.far = 14;
    const hits = this.raycaster.intersectObject(world, true);
    const hit = hits.find((candidate) => candidate.point.y <= this.position.y + 0.2);
    const groundY = hit?.point.y ?? 13.4;
    if (this.position.y < groundY) {
      this.position.y = groundY;
      this.velocity.y = 0;
      this.grounded = true;
    }
    this.visual.position.copy(this.position);
    this.visual.rotation.y = this.yaw;

    const target = this.position.clone().add(new THREE.Vector3(0, 1.45, 0));
    const behind = new THREE.Vector3(Math.sin(this.yaw) * 5.2, 2.1 + this.pitch * 2, Math.cos(this.yaw) * 5.2);
    const cameraPosition = target.clone().add(behind);
    this.camera.position.lerp(cameraPosition, 1 - Math.exp(-8 * dt));
    this.camera.lookAt(target);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('click', this.requestPointerLock);
    document.removeEventListener('mousemove', this.onMouseMove);
  }
}
