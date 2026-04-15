import type { SceneState } from './scene.js';

/** 软化距离立方倒数 */
function softInvCube(dx: number, dy: number, dz: number, eps: number): [number, number, number] {
  const r2 = dx * dx + dy * dy + dz * dz + eps * eps;
  const inv = 1 / Math.sqrt(r2);
  const inv3 = inv * inv * inv;
  return [dx * inv3, dy * inv3, dz * inv3];
}

/**
 * 开普勒模式：body[0] 固定在原点；body[1..n-1] 仅受中心 μ 引力。
 */
function stepKeplerCentral(state: SceneState): void {
  const n = state.bodyCount;
  const mu = state.gmCentral;
  const eps = state.softening;
  const dt = state.dt;

  const b = state.bodies;
  if (n < 1) return;

  b[0].velocity[0] = 0;
  b[0].velocity[1] = 0;
  b[0].velocity[2] = 0;

  const acc: [number, number, number][] = [];
  for (let i = 1; i < n; i++) {
    const rx = b[i].position[0] - b[0].position[0];
    const ry = b[i].position[1] - b[0].position[1];
    const rz = b[i].position[2] - b[0].position[2];
    const [ix, iy, iz] = softInvCube(rx, ry, rz, eps);
    acc[i] = [-mu * ix, -mu * iy, -mu * iz];
  }

  for (let i = 1; i < n; i++) {
    const v = b[i].velocity;
    const a = acc[i]!;
    v[0] += a[0] * dt;
    v[1] += a[1] * dt;
    v[2] += a[2] * dt;
  }

  for (let i = 1; i < n; i++) {
    const p = b[i].position;
    const v = b[i].velocity;
    p[0] += v[0] * dt;
    p[1] += v[1] * dt;
    p[2] += v[2] * dt;
  }
}

/** N 体：速度 Verlet */
function stepNBody(state: SceneState): void {
  const n = state.bodyCount;
  const G = state.nbodyG;
  const eps = state.softening;
  const dt = state.dt;
  const b = state.bodies;

  const acc0: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    let ax = 0;
    let ay = 0;
    let az = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dx = b[j].position[0] - b[i].position[0];
      const dy = b[j].position[1] - b[i].position[1];
      const dz = b[j].position[2] - b[i].position[2];
      const mj = b[j].mass;
      const [ix, iy, iz] = softInvCube(dx, dy, dz, eps);
      ax += G * mj * ix;
      ay += G * mj * iy;
      az += G * mj * iz;
    }
    acc0[i] = [ax, ay, az];
  }

  for (let i = 0; i < n; i++) {
    const a = acc0[i]!;
    b[i].velocity[0] += 0.5 * a[0] * dt;
    b[i].velocity[1] += 0.5 * a[1] * dt;
    b[i].velocity[2] += 0.5 * a[2] * dt;
  }

  for (let i = 0; i < n; i++) {
    b[i].position[0] += b[i].velocity[0] * dt;
    b[i].position[1] += b[i].velocity[1] * dt;
    b[i].position[2] += b[i].velocity[2] * dt;
  }

  const acc1: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    let ax = 0;
    let ay = 0;
    let az = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dx = b[j].position[0] - b[i].position[0];
      const dy = b[j].position[1] - b[i].position[1];
      const dz = b[j].position[2] - b[i].position[2];
      const mj = b[j].mass;
      const [ix, iy, iz] = softInvCube(dx, dy, dz, eps);
      ax += G * mj * ix;
      ay += G * mj * iy;
      az += G * mj * iz;
    }
    acc1[i] = [ax, ay, az];
  }

  for (let i = 0; i < n; i++) {
    const a1 = acc1[i]!;
    b[i].velocity[0] += 0.5 * a1[0] * dt;
    b[i].velocity[1] += 0.5 * a1[1] * dt;
    b[i].velocity[2] += 0.5 * a1[2] * dt;
  }
}

export function stepScene(state: SceneState): void {
  if (state.dynamics === 'static') return;
  if (state.dynamics === 'kepler') {
    stepKeplerCentral(state);
  } else {
    stepNBody(state);
  }
}
