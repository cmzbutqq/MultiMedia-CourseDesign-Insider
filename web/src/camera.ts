/** 与 blackhole_main.frag 中 main() 相机一致 */

const PI = Math.PI;

function degToRad(d: number): number {
  return (d * PI) / 180;
}

export function getCameraLookBasis(
  time: number,
  mouseX: number,
  mouseY: number,
  resolutionX: number,
  resolutionY: number,
  mouseControl: boolean,
  frontView: boolean,
  topView: boolean,
  cameraRollDeg: number,
  cameraPosOverride?: [number, number, number],
): {
  cameraPos: [number, number, number];
  uu: [number, number, number];
  vv: [number, number, number];
  ww: [number, number, number];
} {
  let cameraPos: [number, number, number];
  if (cameraPosOverride) {
    cameraPos = [...cameraPosOverride];
  } else if (frontView) {
    cameraPos = [10, 1, 10];
  } else if (topView) {
    cameraPos = [15, 15, 0];
  } else if (mouseControl) {
    const mx = Math.max(0, Math.min(1, mouseX / resolutionX)) - 0.5;
    const my = Math.max(0, Math.min(1, mouseY / resolutionY)) - 0.5;
    cameraPos = [-Math.cos(mx * 10) * 15, my * 30, Math.sin(mx * 10) * 15];
  } else {
    cameraPos = [
      -Math.cos(time * 0.1) * 15,
      Math.sin(time * 0.1) * 15,
      Math.sin(time * 0.1) * 15,
    ];
  }

  const target: [number, number, number] = [0, 0, 0];
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

  return { cameraPos, uu, vv, ww };
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
  // Canvas2D 的 y 轴向下，需将相机空间 y 投影翻转到屏幕坐标。
  const py = height * (0.5 - puvY);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  return { x: px, y: py };
}
