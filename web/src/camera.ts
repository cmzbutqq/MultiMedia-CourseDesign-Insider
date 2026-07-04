const PI = Math.PI;
const ORBIT_PITCH_RANGE = PI * 0.75;

function normalizeVec3(
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

function scaleDirection(
  direction: [number, number, number],
  distance: number,
): [number, number, number] {
  return [
    direction[0] * distance,
    direction[1] * distance,
    direction[2] * distance,
  ];
}

function addVec3(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function degToRad(d: number): number {
  return (d * PI) / 180;
}

export function getCameraLookBasis(
  time: number,
  orbitYaw: number,
  orbitPitch: number,
  cameraDistance: number,
  cameraTarget: [number, number, number],
  mouseControl: boolean,
  frontView: boolean,
  topView: boolean,
  cameraRollDeg: number,
  cameraPosOverride?: [number, number, number],
  cameraTargetOverride?: [number, number, number],
): {
  cameraPos: [number, number, number];
  cameraTarget: [number, number, number];
  uu: [number, number, number];
  vv: [number, number, number];
  ww: [number, number, number];
} {
  let cameraPos: [number, number, number];
  const distance = Math.max(cameraDistance, 0.001);
  const target = cameraTargetOverride ? [...cameraTargetOverride] : [...cameraTarget];
  if (cameraPosOverride) {
    cameraPos = [...cameraPosOverride];
  } else if (frontView) {
    cameraPos = addVec3(target, scaleDirection(normalizeVec3(10, 1, 10), distance));
  } else if (topView) {
    cameraPos = addVec3(target, scaleDirection(normalizeVec3(15, 15, 0), distance));
  } else if (mouseControl) {
    const pitch = Math.max(-ORBIT_PITCH_RANGE * 0.5, Math.min(ORBIT_PITCH_RANGE * 0.5, orbitPitch));
    const cosPitch = Math.cos(pitch);
    cameraPos = [
      target[0] - Math.cos(orbitYaw) * cosPitch * distance,
      target[1] + Math.sin(pitch) * distance,
      target[2] + Math.sin(orbitYaw) * cosPitch * distance,
    ];
  } else {
    const autoDirection = normalizeVec3(-Math.cos(time * 0.1), Math.sin(time * 0.1), Math.sin(time * 0.1));
    cameraPos = addVec3(target, scaleDirection(autoDirection, distance));
  }

  const roll = degToRad(cameraRollDeg);
  let rr: [number, number, number] = [Math.sin(roll), Math.cos(roll), 0];

  const wx = target[0] - cameraPos[0];
  const wy = target[1] - cameraPos[1];
  const wz = target[2] - cameraPos[2];
  const len = Math.hypot(wx, wy, wz) || 1;
  const ww: [number, number, number] = [wx / len, wy / len, wz / len];

  const cross = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  let uRaw = cross(ww, rr);
  let uLen = Math.hypot(uRaw[0], uRaw[1], uRaw[2]);
  if (uLen <= 0.0001) {
    rr = Math.abs(ww[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    uRaw = cross(ww, rr);
    uLen = Math.hypot(uRaw[0], uRaw[1], uRaw[2]) || 1;
  }
  const uu: [number, number, number] = [uRaw[0] / uLen, uRaw[1] / uLen, uRaw[2] / uLen];
  const vRaw = cross(uu, ww);
  const vLen = Math.hypot(vRaw[0], vRaw[1], vRaw[2]) || 1;
  const vv: [number, number, number] = [vRaw[0] / vLen, vRaw[1] / vLen, vRaw[2] / vLen];

  return { cameraPos, cameraTarget: target, uu, vv, ww };
}

export function worldToScreenPx(
  world: [number, number, number],
  camera: ReturnType<typeof getCameraLookBasis>,
  fovScale: number,
  width: number,
  height: number,
): { x: number; y: number } | null {
  const { cameraPos, uu, vv, ww } = camera;
  const wx = world[0] - cameraPos[0];
  const wy = world[1] - cameraPos[1];
  const wz = world[2] - cameraPos[2];
  const xc = wx * uu[0] + wy * uu[1] + wz * uu[2];
  const yc = wx * vv[0] + wy * vv[1] + wz * vv[2];
  const zc = wx * ww[0] + wy * ww[1] + wz * ww[2];
  if (zc <= 0.01) return null;
  const puvX = -xc / (zc * fovScale);
  const puvY = yc / (zc * fovScale);
  const px = width * 0.5 + puvX * height;
  const py = height * (0.5 - puvY);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  return { x: px, y: py };
}
