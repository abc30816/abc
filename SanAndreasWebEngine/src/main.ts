import * as THREE from 'three';
import './style.css';
import { indexGameFolder, type GameFileSet } from './core/GameFiles';
import { PlayerController } from './gameplay/PlayerController';
import { WorldStreamer } from './world/WorldStreamer';
import { VehicleSystem, type VehicleHudState } from './gameplay/VehicleSystem';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const folderInput = document.querySelector<HTMLInputElement>('#game-folder')!;
const bootPanel = document.querySelector<HTMLElement>('#boot')!;
const bootStatus = document.querySelector<HTMLElement>('#boot-status')!;
const progressFill = document.querySelector<HTMLElement>('#progress-fill')!;
const hud = document.querySelector<HTMLElement>('#hud')!;
const hudState = document.querySelector<HTMLElement>('#hud-state')!;
const diagnostics = document.querySelector<HTMLElement>('#diagnostics')!;
const vehicleStatus = document.querySelector<HTMLElement>('#vehicle-status')!;
const vehiclePrompt = document.querySelector<HTMLElement>('#vehicle-prompt')!;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x91b3c4);
scene.fog = new THREE.Fog(0x91b3c4, 240, 1250);
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.08, 2000);
const hemi = new THREE.HemisphereLight(0xddeeff, 0x66594b, 1.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe4bd, 2.5);
sun.position.set(-120, 260, 110);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -180; sun.shadow.camera.right = 180; sun.shadow.camera.top = 180; sun.shadow.camera.bottom = -180;
scene.add(sun);

const worldRoot = new THREE.Group();
scene.add(worldRoot);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(10000, 10000), new THREE.MeshStandardMaterial({ color: 0x53624e, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = 13.35;
ground.receiveShadow = true;
scene.add(ground);

let game: GameFileSet | null = null;
let streamer: WorldStreamer | null = null;
let player: PlayerController | null = null;
let vehicleSystem: VehicleSystem | null = null;
let ready = false;
const clock = new THREE.Clock();

function setStatus(message: string, progress: number): void {
  bootStatus.textContent = message;
  progressFill.style.width = `${Math.max(0, Math.min(100, progress))}%`;
}

folderInput.addEventListener('change', async () => {
  if (!folderInput.files?.length) return;
  folderInput.disabled = true;
  try {
    setStatus(`Indexing ${folderInput.files.length.toLocaleString()} local files…`, 8);
    game = await indexGameFolder(folderInput.files);
    setStatus(`Indexed ${game.archives.length} IMG archive(s), ${game.modelEntries.size.toLocaleString()} DFF models, ${game.ide.size.toLocaleString()} IDE definitions and ${game.instances.length.toLocaleString()} map placements.`, 70);
    streamer = new WorldStreamer(game);
    worldRoot.add(streamer.root);
    player = new PlayerController(canvas, camera);
    scene.add(player.visual);
    const start = player.position.clone();
    await streamer.update(start);
    try {
      setStatus('Indexing vehicle definitions and loading nearby vehicle models…', 86);
      vehicleSystem = await VehicleSystem.create(game, player, camera, canvas);
      scene.add(vehicleSystem.root);
    } catch (error) {
      console.warn('Vehicle subsystem unavailable for this folder selection:', error);
      vehicleSystem = null;
    }
    setStatus('World index ready. Unsupported native assets and gameplay systems are still being developed.', 100);
    bootPanel.classList.add('hidden');
    hud.classList.remove('hidden');
    diagnostics.classList.remove('hidden');
    hudState.textContent = 'ENGINE ONLINE · VEHICLE SYSTEM MILESTONE';
    ready = true;
    if (game.warnings.length) console.warn('Game folder warnings:', game.warnings);
  } catch (error) {
    console.error(error);
    setStatus((error as Error).message || String(error), 0);
    folderInput.disabled = false;
  }
});

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

let lastStream = 0;
function frame(): void {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (ready && player && streamer) {
    if (!vehicleSystem?.isDriving) player.update(dt, streamer.root);
    const vehicleHud: VehicleHudState | null = vehicleSystem?.update(dt) ?? null;
    if (vehicleHud?.driving) {
      vehicleStatus.classList.remove('hidden');
      vehicleStatus.textContent = `${vehicleHud.modelName.toUpperCase()}  ·  ${vehicleHud.speedKmh} KM/H  ·  GEAR ${vehicleHud.gear}  ·  BODY ${vehicleHud.health}`;
    } else {
      vehicleStatus.classList.add('hidden');
      vehicleStatus.textContent = '';
    }
    if (vehicleHud?.prompt) {
      vehiclePrompt.classList.remove('hidden');
      vehiclePrompt.textContent = vehicleHud.prompt;
    } else {
      vehiclePrompt.classList.add('hidden');
      vehiclePrompt.textContent = '';
    }
    if (clock.elapsedTime - lastStream > 0.25) {
      lastStream = clock.elapsedTime;
      void streamer.update(vehicleSystem?.streamPosition ?? player.position);
    }
    const stats = streamer.getStats();
    diagnostics.textContent = `ENGINE 0.2\nCHUNKS ${stats.activeChunks}\nOBJECTS ${stats.visibleInstances}\nDFF CACHE ${stats.loadedModels}\nWORLD SKIPS ${stats.skippedModels}\nVEHICLES ${vehicleHud?.loaded ?? 0}\nVEHICLE SKIPS ${vehicleHud?.skipped ?? 0}\nMAP INSTANCES ${game?.instances.length ?? 0}`;
  }
  renderer.render(scene, camera);
}
frame();

window.addEventListener('beforeunload', () => {
  vehicleSystem?.dispose();
  player?.dispose();
});
