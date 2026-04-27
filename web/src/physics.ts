import type { SceneState } from './scene.js';

/** 软化距离立方倒数 */
function softInvCube(dx: number, dy: number, dz: number, eps: number): [number, number, number] {
  const r2 = dx * dx + dy * dy + dz * dz + eps * eps;
  const inv = 1 / Math.sqrt(r2);
  const inv3 = inv * inv * inv;
  return [dx * inv3, dy * inv3, dz * inv3];
}

/**
 * 计算局部时间缩放因子
 * 基于与黑洞距离和势阱强度
 * @param position 粒子位置 [x, y, z]
 * @param centerPos 中心天体位置 [x, y, z]
 * @param mass 中心天体质量
 * @param state 场景状态
 * @returns 时间缩放因子 (0-1]，越小时间越慢
 */
export function calculateTimeWarp(
  position: [number, number, number],
  centerPos: [number, number, number],
  mass: number,
  state: SceneState,
): number {
  if (!state.timeWarp.enabled) return 1.0;

  const dx = position[0] - centerPos[0];
  const dy = position[1] - centerPos[1];
  const dz = position[2] - centerPos[2];
  const r = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // 计算引力势 (GM/r)
  const potential = (mass * state.timeWarp.potentialScale) / Math.max(r, 0.1);

  // 计算距离贡献 (越近时间越慢)
  const distanceTerm = 1.0 / (1.0 + r / Math.max(state.timeWarp.distanceScale, 0.1));

  // 综合时间缩放因子
  const timeFactor = 1.0 / (1.0 + state.timeWarp.intensity * (potential + distanceTerm));

  return Math.max(0.1, Math.min(1.0, timeFactor));
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
  const timeWarpFactors: number[] = [];
  
  for (let i = 1; i < n; i++) {
    const rx = b[i].position[0] - b[0].position[0];
    const ry = b[i].position[1] - b[0].position[1];
    const rz = b[i].position[2] - b[0].position[2];
    const [ix, iy, iz] = softInvCube(rx, ry, rz, eps);
    acc[i] = [-mu * ix, -mu * iy, -mu * iz];
    
    // 计算时间缩放因子
    timeWarpFactors[i] = calculateTimeWarp(b[i].position, b[0].position, b[0].mass, state);
  }

  for (let i = 1; i < n; i++) {
    const v = b[i].velocity;
    const a = acc[i]!;
    const factor = timeWarpFactors[i]!;
    v[0] += a[0] * dt * factor;
    v[1] += a[1] * dt * factor;
    v[2] += a[2] * dt * factor;
  }

  for (let i = 1; i < n; i++) {
    const p = b[i].position;
    const v = b[i].velocity;
    const factor = timeWarpFactors[i]!;
    p[0] += v[0] * dt * factor;
    p[1] += v[1] * dt * factor;
    p[2] += v[2] * dt * factor;
  }
}

/** N 体：速度 Verlet */
function stepNBody(state: SceneState): void {
  const n = state.bodyCount;
  const G = state.nbodyG;
  const eps = state.softening;
  const dt = state.dt;
  const b = state.bodies;

  // 为每个天体计算时间缩放因子（相对于最重的天体）
  let maxMass = 0;
  let maxMassIdx = 0;
  for (let i = 0; i < n; i++) {
    if (b[i].mass > maxMass) {
      maxMass = b[i].mass;
      maxMassIdx = i;
    }
  }

  const timeWarpFactors: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === maxMassIdx) {
      timeWarpFactors[i] = 1.0;
    } else {
      timeWarpFactors[i] = calculateTimeWarp(b[i].position, b[maxMassIdx].position, b[maxMassIdx].mass, state);
    }
  }

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
    const factor = timeWarpFactors[i]!;
    b[i].velocity[0] += 0.5 * a[0] * dt * factor;
    b[i].velocity[1] += 0.5 * a[1] * dt * factor;
    b[i].velocity[2] += 0.5 * a[2] * dt * factor;
  }

  for (let i = 0; i < n; i++) {
    const factor = timeWarpFactors[i]!;
    b[i].position[0] += b[i].velocity[0] * dt * factor;
    b[i].position[1] += b[i].velocity[1] * dt * factor;
    b[i].position[2] += b[i].velocity[2] * dt * factor;
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
    const factor = timeWarpFactors[i]!;
    b[i].velocity[0] += 0.5 * a1[0] * dt * factor;
    b[i].velocity[1] += 0.5 * a1[1] * dt * factor;
    b[i].velocity[2] += 0.5 * a1[2] * dt * factor;
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
