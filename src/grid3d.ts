import { GRID_N, START_VOXELS } from "./config";

export const N = GRID_N;

/** セルは「2 の指数」。0=空、1=2、2=4 … */
export type CellExp = number;

export type Vec3 = readonly [number, number, number];

/** 重力（下向き）単位ベクトル。インデックスで UI と同期 */
export const DOWNS: Vec3[] = [
  [0, -1, 0],
  [0, 1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export const DOWN_LABELS = [
  "下 -Y",
  "上 +Y",
  "右 +X",
  "左 -X",
  "奥 +Z",
  "手前 -Z",
];

export function idx3(x: number, y: number, z: number): number {
  return x + y * N + z * N * N;
}

export function unpack(i: number): { x: number; y: number; z: number } {
  const x = i % N;
  const y = Math.floor(i / N) % N;
  const z = Math.floor(i / (N * N));
  return { x, y, z };
}

export function createEmptyGrid(): Uint8Array {
  return new Uint8Array(N * N * N);
}

function shuffleInPlace(a: number[]): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
}

export function createInitialGrid(): Uint8Array {
  const g = createEmptyGrid();
  const ids = Array.from({ length: N * N * N }, (_, i) => i);
  shuffleInPlace(ids);
  for (let k = 0; k < Math.min(START_VOXELS, ids.length); k++) {
    g[ids[k]!] = 1;
  }
  return g;
}

function primaryAxis(d: Vec3): 0 | 1 | 2 {
  if (d[0] !== 0) return 0;
  if (d[1] !== 0) return 1;
  return 2;
}

function otherAxes(axis: 0 | 1 | 2): readonly [0 | 1 | 2, 0 | 1 | 2] {
  if (axis === 0) return [1, 2];
  if (axis === 1) return [0, 2];
  return [0, 1];
}

/** t=0 が「下（いちばん重力側）」、t=N-1 が空の上側 */
function coordOnLine(down: Vec3, t: number, p1: number, p2: number): [number, number, number] {
  const axis = primaryAxis(down);
  const d = down[axis]!;
  const ground = d < 0 ? 0 : N - 1;
  const step = d < 0 ? 1 : -1;
  const main = ground + t * step;
  const [a1, a2] = otherAxes(axis);
  const pos: [number, number, number] = [0, 0, 0];
  pos[axis] = main;
  pos[a1] = p1;
  pos[a2] = p2;
  return pos;
}

function getAt(g: Uint8Array, x: number, y: number, z: number): CellExp {
  return g[idx3(x, y, z)]!;
}

function setAt(g: Uint8Array, x: number, y: number, z: number, v: CellExp): void {
  g[idx3(x, y, z)] = v;
}

/** 2048 と同様：下側から隣接同値を一度ずつ合体し、空きは上側に */
function mergeLine2048(vals: CellExp[]): { line: CellExp[]; score: number } {
  const tiles = vals.filter((v) => v > 0);
  const out: CellExp[] = [];
  let score = 0;
  let i = 0;
  while (i < tiles.length) {
    const a = tiles[i]!;
    const b = tiles[i + 1];
    if (b !== undefined && a === b) {
      const ne = a + 1;
      out.push(ne);
      score += 1 << ne;
      i += 2;
    } else {
      out.push(a);
      i += 1;
    }
  }
  while (out.length < N) out.push(0);
  return { line: out, score };
}

/** 1 パス分：現在の down に沿って全ラインを解く */
export function settlePass(g: Uint8Array, down: Vec3): { changed: boolean; score: number } {
  const axis = primaryAxis(down);
  const [a1, a2] = otherAxes(axis);
  let changed = false;
  let score = 0;

  for (let p1 = 0; p1 < N; p1++) {
    for (let p2 = 0; p2 < N; p2++) {
      const vals: CellExp[] = [];
      for (let t = 0; t < N; t++) {
        const [x, y, z] = coordOnLine(down, t, p1, p2);
        vals.push(getAt(g, x, y, z));
      }
      const { line, score: s } = mergeLine2048(vals);
      score += s;
      for (let t = 0; t < N; t++) {
        const [x, y, z] = coordOnLine(down, t, p1, p2);
        const nv = line[t]!;
        if (nv !== getAt(g, x, y, z)) changed = true;
        setAt(g, x, y, z, nv);
      }
    }
  }

  return { changed, score };
}

/** 連鎖が止むまで繰り返し（通常は 1 回で収束） */
export function settleFully(g: Uint8Array, down: Vec3): number {
  let total = 0;
  for (let k = 0; k < 32; k++) {
    const { changed, score } = settlePass(g, down);
    total += score;
    if (!changed) break;
  }
  return total;
}

/** 上端（空側）のセルが空なら指数1（数字2）を置く。戻り値はセルインデックス、失敗時は -1 */
export function trySpawnFromSky(g: Uint8Array, down: Vec3): number {
  const axis = primaryAxis(down);
  const order = Array.from({ length: N * N }, (_, i) => i);
  shuffleInPlace(order);

  for (const id of order) {
    const p1 = id % N;
    const p2 = Math.floor(id / N);
    const [x, y, z] = coordOnLine(down, N - 1, p1, p2);
    if (getAt(g, x, y, z) === 0) {
      setAt(g, x, y, z, 1);
      return idx3(x, y, z);
    }
  }
  return -1;
}

export function isGridFull(g: Uint8Array): boolean {
  for (let i = 0; i < g.length; i++) if (g[i] === 0) return false;
  return true;
}

export function maxExponent(g: Uint8Array): number {
  let m = 0;
  for (let i = 0; i < g.length; i++) if (g[i]! > m) m = g[i]!;
  return m;
}

export function valueFromExp(e: CellExp): number {
  if (e <= 0) return 0;
  return 1 << e;
}

/** 「上から見て反時計回り」：-Y → +X → +Y → -X */
export function rotateDownIndexAroundY(downIndex: number): number {
  const ring = [0, 2, 1, 3] as const;
  const i = ring.indexOf(downIndex as 0 | 2 | 1 | 3);
  if (i < 0) return ring[0]!;
  return ring[(i + 1) % ring.length]!;
}

export function rotateDownIndexAroundYInverse(downIndex: number): number {
  const ring = [0, 2, 1, 3] as const;
  const i = ring.indexOf(downIndex as 0 | 2 | 1 | 3);
  if (i < 0) return ring[0]!;
  return ring[(i + ring.length - 1) % ring.length]!;
}

/** 左右軸周り：-Y → +Z → +Y → -Z */
export function rotateDownIndexAroundX(downIndex: number): number {
  const ring = [0, 4, 1, 5] as const;
  const i = ring.indexOf(downIndex as 0 | 4 | 1 | 5);
  if (i < 0) return ring[0]!;
  return ring[(i + 1) % ring.length]!;
}

export function rotateDownIndexAroundXInverse(downIndex: number): number {
  const ring = [0, 4, 1, 5] as const;
  const i = ring.indexOf(downIndex as 0 | 4 | 1 | 5);
  if (i < 0) return ring[0]!;
  return ring[(i + ring.length - 1) % ring.length]!;
}
