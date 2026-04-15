import { MAX_BODIES } from './scene.js';

const TRAIL_LEN = 384;

export class TrailBuffer {
  private readonly data: Float32Array;
  private readonly head: number[] = [];
  private readonly count: number[] = [];

  constructor() {
    this.data = new Float32Array(MAX_BODIES * TRAIL_LEN * 3);
    for (let i = 0; i < MAX_BODIES; i++) {
      this.head[i] = 0;
      this.count[i] = 0;
    }
  }

  reset(): void {
    for (let i = 0; i < MAX_BODIES; i++) {
      this.head[i] = 0;
      this.count[i] = 0;
    }
  }

  push(bodyIndex: number, x: number, y: number, z: number): void {
    const base = bodyIndex * TRAIL_LEN * 3;
    const h = this.head[bodyIndex]!;
    const o = base + h * 3;
    this.data[o] = x;
    this.data[o + 1] = y;
    this.data[o + 2] = z;
    this.head[bodyIndex] = (h + 1) % TRAIL_LEN;
    if (this.count[bodyIndex]! < TRAIL_LEN) this.count[bodyIndex]!++;
  }

  /** 按时间顺序绘制折线（从旧到新） */
  iterateOrdered(bodyIndex: number, fn: (x: number, y: number, z: number, index: number) => void): void {
    const c = this.count[bodyIndex]!;
    if (c === 0) return;
    const h = this.head[bodyIndex]!;
    const base = bodyIndex * TRAIL_LEN * 3;
    const start = c < TRAIL_LEN ? 0 : h;
    for (let k = 0; k < c; k++) {
      const idx = (start + k) % TRAIL_LEN;
      const o = base + idx * 3;
      fn(this.data[o]!, this.data[o + 1]!, this.data[o + 2]!, k);
    }
  }
}

export const TRAIL_COLORS = [
  'rgba(180,220,255,0.75)',
  'rgba(255,200,160,0.75)',
  'rgba(160,255,200,0.75)',
  'rgba(255,180,220,0.75)',
  'rgba(200,200,255,0.75)',
];
