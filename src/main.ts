import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { playMergeSound, playMoveSound, playSpawnSound, resumeAudio } from "./audio";
import { MOVE_DURATION_MS, SPIN_DURATION_MS } from "./config";
import {
  DOWNS,
  DOWN_LABELS,
  N,
  createInitialGrid,
  idx3,
  isGridFull,
  maxExponent,
  settleFully,
  trySpawnFromSky,
  unpack,
  valueFromExp,
} from "./grid3d";

const canvas = document.querySelector<HTMLCanvasElement>("#c")!;
const howto = document.querySelector<HTMLDetailsElement>("#howto");
const scoreEl = document.querySelector<HTMLSpanElement>("#score")!;
const maxEl = document.querySelector<HTMLSpanElement>("#max")!;
const gravLabel = document.querySelector<HTMLSpanElement>("#gravLabel")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const resetBtn = document.querySelector<HTMLButtonElement>("#reset")!;

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

let busy = false;
let spinTween: null | { axis: "x" | "y"; from: number; to: number; t0: number; onDone: () => void } = null;
let moveTween: null | {
  t0: number;
  dur: number;
  starts: THREE.Vector3[];
  ends: THREE.Vector3[];
  onDone: () => void;
} = null;

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
controls.enableRotate = !isMobileLike;
controls.enablePan = false;
controls.enableZoom = true;
controls.target.set(0, 0, 0);
controls.minDistance = 7;
controls.maxDistance = 28;
controls.rotateSpeed = isMobileLike ? 0.65 : 0.9;
controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
if (!isMobileLike) {
  controls.touches.ONE = THREE.TOUCH.ROTATE;
}
controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;

controls.addEventListener("change", () => {
  if (!busy && !spinTween && !moveTween) {
    syncDownIndexFromCamera();
    syncUi();
  }
});

const cellGap = 1;
const origin = (-(N - 1) * cellGap) / 2;

const boardRoot = new THREE.Group();
scene.add(boardRoot);

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
boardRoot.add(cageGroup);

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

function slotLocal(i: number): THREE.Vector3 {
  const { x, y, z } = unpack(i);
  return new THREE.Vector3(origin + x * cellGap, origin + y * cellGap, origin + z * cellGap);
}

function skyOffsetLocal(): THREE.Vector3 {
  const d = DOWNS[downIndex]!;
  return new THREE.Vector3(-d[0]!, -d[1]!, -d[2]!).multiplyScalar(cellGap * (N + 1.2));
}

/** 画面の下（カメラ画像の -Y）をワールドへ → 4種の重力のうち最も近い向き */
function syncDownIndexFromCamera(): void {
  const v = new THREE.Vector3(0, -1, 0);
  v.transformDirection(camera.matrixWorld);
  let best = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < DOWNS.length; i++) {
    const d = DOWNS[i]!;
    const dot = v.x * d[0]! + v.y * d[1]! + v.z * d[2]!;
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  downIndex = best;
}

for (let z = 0; z < N; z++) {
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const group = new THREE.Group();
      group.position.copy(slotLocal(idx3(x, y, z)));

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

      boardRoot.add(group);
      cells.push({ group, mesh, label });
    }
  }
}

function syncUi(): void {
  scoreEl.textContent = String(score);
  const mx = maxExponent(grid);
  maxEl.textContent = String(valueFromExp(mx));
  gravLabel.textContent = DOWN_LABELS[downIndex] ?? "";
}

function applyMaterialsFromGrid(): void {
  for (let i = 0; i < cells.length; i++) {
    const exp = grid[i]!;
    const { group, mesh, label } = cells[i]!;
    const mat = mesh.material as THREE.MeshStandardMaterial;

    if (exp <= 0) {
      group.visible = false;
      continue;
    }
    group.visible = true;

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

function snapPositionsToGrid(): void {
  for (let i = 0; i < cells.length; i++) {
    cells[i]!.group.position.copy(slotLocal(i));
  }
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function setGameOver(msg: string): void {
  gameOver = true;
  statusEl.textContent = msg;
}

function settleAndScore(): number {
  return settleFully(grid, DOWNS[downIndex]!);
}

function startBlockTween(spawnIdx: number): void {
  const starts: THREE.Vector3[] = [];
  const ends: THREE.Vector3[] = [];
  for (let i = 0; i < cells.length; i++) {
    starts.push(cells[i]!.group.position.clone());
    ends.push(slotLocal(i));
  }
  if (spawnIdx >= 0) {
    starts[spawnIdx] = slotLocal(spawnIdx).clone().add(skyOffsetLocal());
  }

  applyMaterialsFromGrid();

  let moved = false;
  for (let i = 0; i < cells.length; i++) {
    if (starts[i]!.distanceToSquared(ends[i]!) > 1e-6) moved = true;
  }
  if (moved) playMoveSound();

  moveTween = {
    t0: performance.now(),
    dur: MOVE_DURATION_MS,
    starts,
    ends,
    onDone: () => {
      moveTween = null;
      snapPositionsToGrid();
      busy = false;
      controls.enabled = true;
    },
  };
}

function runPhysicsAfterOrientationChange(spawnOne: boolean): void {
  const mergeA = settleAndScore();
  score += mergeA;
  if (mergeA > 0) playMergeSound();

  let spawnIdx = -1;
  if (spawnOne) {
    spawnIdx = trySpawnFromSky(grid, DOWNS[downIndex]!);
    if (spawnIdx < 0) {
      setGameOver("ケース上部から入れません。満杯です。");
      applyMaterialsFromGrid();
      busy = false;
      controls.enabled = true;
      return;
    }
    playSpawnSound();
  }

  const mergeB = settleAndScore();
  score += mergeB;
  if (mergeB > 0) playMergeSound();

  if (isGridFull(grid)) {
    setGameOver("マスがすべて埋まりました。");
  }

  startBlockTween(spawnIdx);
}

function runAfterSpin(): void {
  syncDownIndexFromCamera();
  runPhysicsAfterOrientationChange(true);
}

function beginSpinThenApply(spinAxis: "x" | "y", angle: number): void {
  busy = true;
  controls.enabled = false;
  boardRoot.rotation.set(0, 0, 0);
  spinTween = {
    axis: spinAxis,
    from: 0,
    to: angle,
    t0: performance.now(),
    onDone: () => {
      spinTween = null;
      boardRoot.rotation.set(0, 0, 0);
      runAfterSpin();
    },
  };
}

/** スワイプ方向に合わせた視覚回転（重力は終了後にカメラの「下」で決定） */
function applySwipeForTilt(dx: number, dy: number): void {
  if (busy || gameOver) return;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < 48) return;

  void resumeAudio();

  if (ax >= ay) {
    const ang = dx < 0 ? Math.PI / 2 : -Math.PI / 2;
    beginSpinThenApply("y", ang);
  } else {
    const ang = dy < 0 ? -Math.PI / 2 : Math.PI / 2;
    beginSpinThenApply("x", ang);
  }
}

let swipeStart: null | { x: number; y: number; id: number; t: number } = null;

function isInUi(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false;
  return Boolean((target as HTMLElement).closest?.("#ui"));
}

canvas.addEventListener(
  "pointerdown",
  (ev) => {
    if (isInUi(ev.target)) return;
    swipeStart = { x: ev.clientX, y: ev.clientY, id: ev.pointerId, t: performance.now() };
    void resumeAudio();
  },
  { passive: true }
);

canvas.addEventListener(
  "pointerup",
  (ev) => {
    if (!swipeStart || swipeStart.id !== ev.pointerId) return;
    const dx = ev.clientX - swipeStart.x;
    const dy = ev.clientY - swipeStart.y;
    const dt = performance.now() - swipeStart.t;
    swipeStart = null;
    const quick = dt < 320;
    const far = Math.max(Math.abs(dx), Math.abs(dy)) >= 48;
    if (quick && far) applySwipeForTilt(dx, dy);
  },
  { passive: true }
);

canvas.addEventListener(
  "pointercancel",
  (ev) => {
    if (swipeStart && swipeStart.id === ev.pointerId) swipeStart = null;
  },
  { passive: true }
);

function resetGame(): void {
  gameOver = false;
  statusEl.textContent = "";
  score = 0;
  spinTween = null;
  moveTween = null;
  busy = false;
  boardRoot.rotation.set(0, 0, 0);
  grid = createInitialGrid();
  syncDownIndexFromCamera();
  score += settleAndScore();
  controls.enabled = true;
  applyMaterialsFromGrid();
  snapPositionsToGrid();
  syncUi();
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

resetBtn.addEventListener("click", () => resetGame());

resetGame();

function tick(now: number): void {
  controls.update();

  if (spinTween) {
    const u = Math.min(1, (now - spinTween.t0) / SPIN_DURATION_MS);
    const k = easeOutCubic(u);
    const a = spinTween.from + (spinTween.to - spinTween.from) * k;
    if (spinTween.axis === "y") {
      boardRoot.rotation.x = 0;
      boardRoot.rotation.y = a;
    } else {
      boardRoot.rotation.y = 0;
      boardRoot.rotation.x = a;
    }
    if (u >= 1) {
      const done = spinTween.onDone;
      spinTween = null;
      done();
    }
  } else if (moveTween) {
    const u = Math.min(1, (now - moveTween.t0) / moveTween.dur);
    const k = easeOutCubic(u);
    for (let i = 0; i < cells.length; i++) {
      cells[i]!.group.position.lerpVectors(moveTween.starts[i]!, moveTween.ends[i]!, k);
    }
    if (u >= 1) {
      const done = moveTween.onDone;
      moveTween = null;
      done();
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
