export const MAX_BODIES = 5;

export type BodyKind = 'blackHole' | 'whiteHole' | 'neutronStar';

export interface BodyParams {
  size: number;
  glowColor: string;
  glowIntensity: number;
  adiskIntensity: number;
  distortionStrength: number;
}

export interface SceneBody {
  position: [number, number, number];
  velocity: [number, number, number];
  mass: number;
  kind: BodyKind;
  visual: BodyParams;
}

export type DynamicsMode = 'static' | 'kepler' | 'nbody';

export interface TimeWarpParams {
  /** 是否启用局部时间缩放 */
  enabled: boolean;
  /** 时间缩放强度系数（0-1） */
  intensity: number;
  /** 势阱强度参考值 */
  potentialScale: number;
  /** 距离参考值（黑洞半径的倍数） */
  distanceScale: number;
}

export interface SceneState {
  bodyCount: number;
  bodies: SceneBody[];
  dynamics: DynamicsMode;
  /** 开普勒模式：中心引力常数 μ = GM（作用于绕原点天体） */
  gmCentral: number;
  /** N 体模式：引力常数 G */
  nbodyG: number;
  softening: number;
  /** 每帧积分步长（秒，仿真时间） */
  dt: number;
  showTrails: boolean;
  /** 局部时间缩放模型参数 */
  timeWarp: TimeWarpParams;
}

export function defaultBodyParams(kind: BodyKind): BodyParams {
  const base: Record<BodyKind, BodyParams> = {
    blackHole: {
      size: 1,
      glowColor: '#050508',
      glowIntensity: 0,
      adiskIntensity: 1,
      distortionStrength: 1,
    },
    whiteHole: {
      size: 1.15,
      glowColor: '#eaf6ff',
      glowIntensity: 3.5,
      adiskIntensity: 1.2,
      distortionStrength: 1,
    },
    neutronStar: {
      size: 0.4,
      glowColor: '#9fd8ff',
      glowIntensity: 2.2,
      adiskIntensity: 0.9,
      distortionStrength: 0.5,
    },
  };
  return { ...base[kind] };
}

export function cloneSceneState(s: SceneState): SceneState {
  return JSON.parse(JSON.stringify(s)) as SceneState;
}

/** 将 src 深拷贝到 target，保持 target 对象引用不变（便于 lil-gui 绑定） */
export function applySceneState(target: SceneState, src: SceneState): void {
  target.bodyCount = src.bodyCount;
  target.dynamics = src.dynamics;
  target.gmCentral = src.gmCentral;
  target.nbodyG = src.nbodyG;
  target.softening = src.softening;
  target.dt = src.dt;
  target.showTrails = src.showTrails;
  target.timeWarp.enabled = src.timeWarp.enabled;
  target.timeWarp.intensity = src.timeWarp.intensity;
  target.timeWarp.potentialScale = src.timeWarp.potentialScale;
  target.timeWarp.distanceScale = src.timeWarp.distanceScale;
  for (let i = 0; i < MAX_BODIES; i++) {
    const sb = src.bodies[i]!;
    const tb = target.bodies[i]!;
    tb.position[0] = sb.position[0];
    tb.position[1] = sb.position[1];
    tb.position[2] = sb.position[2];
    tb.velocity[0] = sb.velocity[0];
    tb.velocity[1] = sb.velocity[1];
    tb.velocity[2] = sb.velocity[2];
    tb.mass = sb.mass;
    tb.kind = sb.kind;
    tb.visual.size = sb.visual.size;
    tb.visual.glowColor = sb.visual.glowColor;
    tb.visual.glowIntensity = sb.visual.glowIntensity;
    tb.visual.adiskIntensity = sb.visual.adiskIntensity;
    tb.visual.distortionStrength = sb.visual.distortionStrength;
  }
}
