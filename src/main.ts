import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SPAWN_INTERVAL_MS } from "./config";
import {
  DOWNS,
  DOWN_LABELS,
  N,
  createInitialGrid,
  idx3,
  isGridFull,
  maxExponent,
  rotateDownIndexAroundX,
  rotateDownIndexAroundY,
  settleFully,
  trySpawnFromSky,
  unpack,
  valueFromExp,
} from "./grid3d";

const canvas = document.querySelector<HTMLCanvasElement>("#c")!;
const howto = document.querySelector<HTMLDetailsElement>("#howto");
const scoreEl = document.querySelector<HTMLSpanElement>("#score")!;
const maxEl = document.querySelector<HTMLSpanElement>("#max")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const resetBtn = document.querySelector<HTMLButtonElement>("#reset")!;
const gravSel = document.querySelector<HTMLSelectElement>("#grav")!;
const rotYBtn = document.querySelector<HTMLButtonElement>("#rot-y")!;
const rotXBtn = document.querySelector<HTMLButtonElement>("#rot-x")!;

for (let i = 0; i < DOWNS.length; i++) {
  const opt = document.createElement("option");
  opt.value = String(i);
  opt.textContent = DOWN_LABELS[i]!;
  gravSel.appendChild(opt);
}
gravSel.value = "0";

if (howto && window.matchMedia("(min-width: 720px)").matches) {
  howto.open = true;
}

const isMobileLike =
  window.matchMedia("(pointer: coarse)").matches ||
  window.matchMedia("(max-width: 540px)").matches;

let grid = createInitialGrid();
let downIndex = 0;
let score = 0;
let gameOver = false;
let spawnTimer = 0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070b18);
scene.fog = new THREE.Fog(0x070b18, 14, 36);

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 120);
camera.position.set(7.8, 6.2, 9.4);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !isMobileLike,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobileLike ? 1.5 : 2));
renderer.shadowMap.enabled = !isMobileLike;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const hemi = new THREE.HemisphereLight(0xa0b8ff, 0x120820, 0.9);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 1.05);
dir.position.set(5, 12, 8);
dir.castShadow = !isMobileLike;
dir.shadow.mapSize.set(isMobileLike ? 1024 : 2048, isMobileLike ? 1024 : 2048);
dir.shadow.camera.near = 0.5;
dir.shadow.camera.far = 50;
dir.shadow.camera.left = -12;
dir.shadow.camera.right = 12;
dir.shadow.camera.top = 12;
dir.shadow.camera.bottom = -12;
scene.add(dir);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.rotateSpeed = isMobileLike ? 0.72 : 1;
controls.target.set(0, 0, 0);
controls.minDistance = 7;
controls.maxDistance = 28;
controls.touches.ONE = THREE.TOUCH.ROTATE;
controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;

const cellGap = 1;
const origin = (-(N - 1) * cellGap) / 2;

const cageGroup = new THREE.Group();
{
  const cageGeo = new THREE.BoxGeometry(N * cellGap, N * cellGap, N * cellGap);
  const edges = new THREE.EdgesGeometry(cageGeo);
  const cageLines = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({
      color: 0x7a9cff,
      transparent: true,
      opacity: 0.85,
    })
  );
  cageGroup.add(cageLines);

  const glass = new THREE.Mesh(
    cageGeo,
    new THREE.MeshStandardMaterial({
      color: 0x4a62c4,
      transparent: true,
      opacity: 0.08,
      roughness: 0.35,
      metalness: 0.05,
      depthWrite: false,
    })
  );
  cageGroup.add(glass);
}
scene.add(cageGroup);

const boxGeo = new THREE.BoxGeometry(0.82 * cellGap, 0.82 * cellGap, 0.82 * cellGap);
type CellVis = { group: THREE.Group; mesh: THREE.Mesh; label: THREE.Sprite };
const cells: CellVis[] = [];

function makeLabelTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 160;
  c.height = 160;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 160, 160);
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  ctx.beginPath();
  ctx.arc(80, 80, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "bold 52px system-ui,sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, 80, 82);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function levelColor(exp: number): THREE.Color {
  const h = (0.55 + exp * 0.045) % 1;
  return new THREE.Color().setHSL(h, 0.55, 0.52);
}

for (let z = 0; z < N; z++) {
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const group = new THREE.Group();
      group.position.set(origin + x * cellGap, origin + y * cellGap, origin + z * cellGap);

      const mat = new THREE.MeshStandardMaterial({
        color: 0x4b6fff,
        roughness: 0.32,
        metalness: 0.14,
        emissive: new THREE.Color(0x000000),
      });
      const mesh = new THREE.Mesh(boxGeo, mat);
      mesh.castShadow = !isMobileLike;
      mesh.receiveShadow = !isMobileLike;
      mesh.userData.ix = idx3(x, y, z);
      group.add(mesh);

      const spriteMat = new THREE.SpriteMaterial({
        map: makeLabelTexture(""),
        transparent: true,
        depthWrite: false,
      });
      const label = new THREE.Sprite(spriteMat);
      label.scale.set(0.72, 0.72, 0.72);
      label.position.set(0, 0.55 * cellGap, 0);
      group.add(label);

      scene.add(group);
      cells.push({ group, mesh, label });
    }
  }
}

function syncUi(): void {
  scoreEl.textContent = String(score);
  const mx = maxExponent(grid);
  maxEl.textContent = String(valueFromExp(mx));
  gravSel.value = String(downIndex);
}

function updateVisuals(): void {
  for (let i = 0; i < cells.length; i++) {
    const exp = grid[i]!;
    const { group, mesh, label } = cells[i]!;
    const mat = mesh.material as THREE.MeshStandardMaterial;

    if (exp <= 0) {
      group.visible = false;
      continue;
    }
    group.visible = true;

    const { x, y, z } = unpack(i);
    group.position.set(origin + x * cellGap, origin + y * cellGap, origin + z * cellGap);

    mat.color.copy(levelColor(exp));
    mat.emissive.copy(levelColor(exp)).multiplyScalar(0.1);

    const val = valueFromExp(exp);
    const map = makeLabelTexture(String(val));
    const sm = label.material as THREE.SpriteMaterial;
    sm.map?.dispose();
    sm.map = map;
    sm.needsUpdate = true;
  }
  syncUi();
}

function applySettle(): void {
  const s = settleFully(grid, DOWNS[downIndex]!);
  score += s;
}

function setGameOver(msg: string): void {
  gameOver = true;
  statusEl.textContent = msg;
}

function tickSpawn(dt: number): void {
  if (gameOver) return;
  spawnTimer += dt;
  if (spawnTimer < SPAWN_INTERVAL_MS) return;
  spawnTimer = 0;
  const ok = trySpawnFromSky(grid, DOWNS[downIndex]!);
  if (!ok) {
    setGameOver("ケース上部から入れません。満杯です。");
    updateVisuals();
    return;
  }
  applySettle();
  if (isGridFull(grid)) {
    setGameOver("マスがすべて埋まりました。");
  }
  updateVisuals();
}

function resetGame(): void {
  gameOver = false;
  statusEl.textContent = "";
  score = 0;
  spawnTimer = 0;
  downIndex = 0;
  grid = createInitialGrid();
  applySettle();
  syncUi();
  updateVisuals();
}

function onResize(): void {
  const vv = window.visualViewport;
  const w = vv?.width ?? window.innerWidth;
  const h = vv?.height ?? window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
window.addEventListener("resize", onResize);
window.visualViewport?.addEventListener("resize", onResize);
window.visualViewport?.addEventListener("scroll", onResize);
screen.orientation?.addEventListener("change", onResize);
onResize();

gravSel.addEventListener("change", () => {
  if (gameOver) return;
  downIndex = Number(gravSel.value);
  applySettle();
  updateVisuals();
});

rotYBtn.addEventListener("click", () => {
  if (gameOver) return;
  downIndex = rotateDownIndexAroundY(downIndex);
  applySettle();
  updateVisuals();
});

rotXBtn.addEventListener("click", () => {
  if (gameOver) return;
  downIndex = rotateDownIndexAroundX(downIndex);
  applySettle();
  updateVisuals();
});

resetBtn.addEventListener("click", () => resetGame());

resetGame();

let last = performance.now();
function tick(now: number): void {
  const dt = now - last;
  last = now;
  controls.update();
  tickSpawn(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
