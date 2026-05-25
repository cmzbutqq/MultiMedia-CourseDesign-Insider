import { MAX_BODIES, cloneSceneState, type SceneState } from './scene.js';

type JsonObject = Record<string, unknown>;

const BODY_KINDS = ['blackHole', 'whiteHole', 'neutronStar'] as const;
const DYNAMICS_MODES = ['static', 'kepler', 'nbody'] as const;
const RENDER_BOOLEAN_FIELDS = [
  'gravatationalLensing',
  'renderBlackHole',
  'adiskEnabled',
  'adiskParticle',
  'tonemappingEnabled',
] as const;
const RENDER_NUMBER_FIELDS = [
  'adiskDensityV',
  'adiskDensityH',
  'adiskHeight',
  'adiskLit',
  'adiskNoiseLOD',
  'adiskNoiseScale',
  'adiskSpeed',
  'bloomIterations',
  'bloomStrength',
  'gamma',
] as const;

const MAX_RECORDED_BLOOM_ITER = 8;
const MAX_RECORDED_VECTOR_ABS = 10000;
const MIN_CAMERA_DISTANCE = 0.001;
const MAX_RECORDING_JSON_BYTES = 50 * 1024 * 1024;
const MAX_RECORDING_FRAMES = 120000;
const MAX_RECORDING_DURATION_SECONDS = 3600;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNumberInRange(value: unknown, min: number, max: number): value is number {
  return isFiniteNumber(value) && value >= min && value <= max;
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value >= min && value <= max;
}

function isVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

function isVec3Within(value: unknown, absMax: number): value is [number, number, number] {
  return isVec3(value) && value.every((item) => Math.abs(item) <= absMax);
}

function isCameraPosition(value: unknown): value is [number, number, number] {
  return isVec3Within(value, MAX_RECORDED_VECTOR_ABS) && Math.hypot(...value) > MIN_CAMERA_DISTANCE;
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function isBodyKind(value: unknown): value is SceneState['bodies'][number]['kind'] {
  return typeof value === 'string' && BODY_KINDS.includes(value as (typeof BODY_KINDS)[number]);
}

function isDynamicsMode(value: unknown): value is SceneState['dynamics'] {
  return typeof value === 'string' && DYNAMICS_MODES.includes(value as (typeof DYNAMICS_MODES)[number]);
}

function isBodyVisual(value: unknown): value is SceneState['bodies'][number]['visual'] {
  return (
    isObject(value) &&
    isNumberInRange(value.size, 0.05, 4) &&
    isHexColor(value.glowColor) &&
    isNumberInRange(value.glowIntensity, 0, 8) &&
    isNumberInRange(value.adiskIntensity, 0, 3) &&
    isNumberInRange(value.distortionStrength, 0, 3)
  );
}

function isSceneBody(value: unknown): value is SceneState['bodies'][number] {
  return (
    isObject(value) &&
    isVec3Within(value.position, MAX_RECORDED_VECTOR_ABS) &&
    isVec3Within(value.velocity, MAX_RECORDED_VECTOR_ABS) &&
    isNumberInRange(value.mass, 0.01, 80) &&
    isBodyKind(value.kind) &&
    isBodyVisual(value.visual)
  );
}

function isTimeWarp(value: unknown): value is SceneState['timeWarp'] {
  return (
    isObject(value) &&
    typeof value.enabled === 'boolean' &&
    isNumberInRange(value.intensity, 0, 1) &&
    isNumberInRange(value.potentialScale, 0.1, 5) &&
    isNumberInRange(value.distanceScale, 0.5, 20)
  );
}

function isSceneState(value: unknown): value is SceneState {
  if (!isObject(value)) return false;
  const bodyCount = value.bodyCount;
  return (
    Number.isInteger(bodyCount) &&
    typeof bodyCount === 'number' &&
    bodyCount >= 1 &&
    bodyCount <= MAX_BODIES &&
    Array.isArray(value.bodies) &&
    value.bodies.length === MAX_BODIES &&
    value.bodies.slice(0, MAX_BODIES).every(isSceneBody) &&
    isDynamicsMode(value.dynamics) &&
    isNumberInRange(value.gmCentral, 1, 500) &&
    isNumberInRange(value.nbodyG, 0.1, 20) &&
    isNumberInRange(value.softening, 0.01, 2) &&
    isNumberInRange(value.dt, 0.001, 0.1) &&
    typeof value.showTrails === 'boolean' &&
    isTimeWarp(value.timeWarp)
  );
}

function isRenderState(value: unknown): value is RecordingFrame['render'] {
  return (
    isObject(value) &&
    RENDER_BOOLEAN_FIELDS.every((field) => typeof value[field] === 'boolean') &&
    RENDER_NUMBER_FIELDS.every((field) => isFiniteNumber(value[field])) &&
    isNumberInRange(value.adiskDensityV, 0, 10) &&
    isNumberInRange(value.adiskDensityH, 0, 10) &&
    isNumberInRange(value.adiskHeight, 0, 1) &&
    isNumberInRange(value.adiskLit, 0, 4) &&
    isIntegerInRange(value.adiskNoiseLOD, 1, 12) &&
    isNumberInRange(value.adiskNoiseScale, 0, 10) &&
    isNumberInRange(value.adiskSpeed, 0, 1) &&
    isIntegerInRange(value.bloomIterations, 1, MAX_RECORDED_BLOOM_ITER) &&
    isNumberInRange(value.bloomStrength, 0, 1) &&
    isNumberInRange(value.gamma, 1, 4)
  );
}

function isRecordingFrame(value: unknown): value is RecordingFrame {
  if (!isObject(value) || !isObject(value.camera)) return false;
  return (
    isNumberInRange(value.timestamp, 0, MAX_RECORDING_DURATION_SECONDS) &&
    isCameraPosition(value.camera.position) &&
    isNumberInRange(value.camera.roll, -180, 180) &&
    typeof value.camera.mouseControl === 'boolean' &&
    typeof value.camera.frontView === 'boolean' &&
    typeof value.camera.topView === 'boolean' &&
    isNumberInRange(value.camera.mouseX, 0, MAX_RECORDED_VECTOR_ABS) &&
    isNumberInRange(value.camera.mouseY, 0, MAX_RECORDED_VECTOR_ABS) &&
    isSceneState(value.scene) &&
    isRenderState(value.render)
  );
}

function copySceneState(scene: SceneState): SceneState {
  return {
    bodyCount: scene.bodyCount,
    bodies: scene.bodies.slice(0, MAX_BODIES).map((body) => ({
      position: [...body.position],
      velocity: [...body.velocity],
      mass: body.mass,
      kind: body.kind,
      visual: {
        size: body.visual.size,
        glowColor: body.visual.glowColor,
        glowIntensity: body.visual.glowIntensity,
        adiskIntensity: body.visual.adiskIntensity,
        distortionStrength: body.visual.distortionStrength,
      },
    })),
    dynamics: scene.dynamics,
    gmCentral: scene.gmCentral,
    nbodyG: scene.nbodyG,
    softening: scene.softening,
    dt: scene.dt,
    showTrails: scene.showTrails,
    timeWarp: {
      enabled: scene.timeWarp.enabled,
      intensity: scene.timeWarp.intensity,
      potentialScale: scene.timeWarp.potentialScale,
      distanceScale: scene.timeWarp.distanceScale,
    },
  };
}

function parseRecordingFrames(data: unknown): RecordingFrame[] | null {
  if (!isObject(data) || !Array.isArray(data.frames) || data.frames.length > MAX_RECORDING_FRAMES) {
    return null;
  }
  if (!data.frames.every(isRecordingFrame)) {
    return null;
  }
  for (let i = 1; i < data.frames.length; i++) {
    if (data.frames[i]!.timestamp < data.frames[i - 1]!.timestamp) {
      return null;
    }
  }
  return data.frames.map((frame) => ({
    timestamp: frame.timestamp,
    camera: {
      position: [...frame.camera.position],
      roll: frame.camera.roll,
      mouseControl: frame.camera.mouseControl,
      frontView: frame.camera.frontView,
      topView: frame.camera.topView,
      mouseX: frame.camera.mouseX,
      mouseY: frame.camera.mouseY,
    },
    scene: copySceneState(frame.scene),
    render: {
      gravatationalLensing: frame.render.gravatationalLensing,
      renderBlackHole: frame.render.renderBlackHole,
      adiskEnabled: frame.render.adiskEnabled,
      adiskParticle: frame.render.adiskParticle,
      adiskDensityV: frame.render.adiskDensityV,
      adiskDensityH: frame.render.adiskDensityH,
      adiskHeight: frame.render.adiskHeight,
      adiskLit: frame.render.adiskLit,
      adiskNoiseLOD: frame.render.adiskNoiseLOD,
      adiskNoiseScale: frame.render.adiskNoiseScale,
      adiskSpeed: frame.render.adiskSpeed,
      bloomIterations: frame.render.bloomIterations,
      bloomStrength: frame.render.bloomStrength,
      tonemappingEnabled: frame.render.tonemappingEnabled,
      gamma: frame.render.gamma,
    },
  }));
}

/**
 * 单帧快照数据结构
 */
export interface RecordingFrame {
  /** 相对于录制开始的时间（秒） */
  timestamp: number;

  /** 相机状态 */
  camera: {
    position: [number, number, number];
    roll: number;
    mouseControl: boolean;
    frontView: boolean;
    topView: boolean;
    mouseX: number;
    mouseY: number;
  };

  /** 场景完整状态（含 bodies），保证 applySceneState 可直接使用 */
  scene: SceneState;

  /** 渲染参数 */
  render: {
    gravatationalLensing: boolean;
    renderBlackHole: boolean;
    adiskEnabled: boolean;
    adiskParticle: boolean;
    adiskDensityV: number;
    adiskDensityH: number;
    adiskHeight: number;
    adiskLit: number;
    adiskNoiseLOD: number;
    adiskNoiseScale: number;
    adiskSpeed: number;
    bloomIterations: number;
    bloomStrength: number;
    tonemappingEnabled: boolean;
    gamma: number;
  };
}

/**
 * 录制/回放管理器
 */
export class RecordingManager {
  frames: RecordingFrame[] = [];
  private isRecording = false;
  private isPlayback = false;
  private playbackStartTime = 0;

  /** 每帧最多间隔（秒），用于减少冗余帧 */
  private frameInterval = 0.016; // ~60fps
  private lastRecordTime = 0;

  /** 录制开始时使用的 wall-clock 基准（由外部 time 决定） */
  private timeOrigin = 0;

  /**
   * 开始录制
   */
  startRecording(): void {
    this.frames = [];
    this.isRecording = true;
    this.isPlayback = false;
    this.timeOrigin = -1; // 用首帧 time 作为基准（见 recordFrame）
    this.lastRecordTime = -this.frameInterval; // 确保第一帧被录入
    console.log('🎬 录制已开始');
  }

  /**
   * 停止录制
   */
  stopRecording(): void {
    this.isRecording = false;
    console.log(`📹 录制已停止，共 ${this.frames.length} 帧`);
  }

  /**
   * 记录一帧（由主循环调用）
   */
  recordFrame(
    time: number,
    cameraPos: [number, number, number],
    cameraRoll: number,
    mouseControl: boolean,
    frontView: boolean,
    topView: boolean,
    mouseX: number,
    mouseY: number,
    scene: SceneState,
    params: {
      gravatationalLensing: boolean;
      renderBlackHole: boolean;
      adiskEnabled: boolean;
      adiskParticle: boolean;
      adiskDensityV: number;
      adiskDensityH: number;
      adiskHeight: number;
      adiskLit: number;
      adiskNoiseLOD: number;
      adiskNoiseScale: number;
      adiskSpeed: number;
      bloomIterations: number;
      bloomStrength: number;
      tonemappingEnabled: boolean;
      gamma: number;
    },
  ): void {
    if (!this.isRecording) return;

    // 用传入 time 作为基准（避免 Date.now 与 frame 内 time 不同步）
    if (this.timeOrigin < 0) this.timeOrigin = time;
    const elapsedTime = time - this.timeOrigin;

    // 降采样：每 frameInterval 秒记录一帧
    if (elapsedTime - this.lastRecordTime < this.frameInterval) {
      return;
    }

    this.lastRecordTime = elapsedTime;

    const frame: RecordingFrame = {
      timestamp: elapsedTime,
      camera: {
        position: [...cameraPos],
        roll: cameraRoll,
        mouseControl,
        frontView,
        topView,
        mouseX,
        mouseY,
      },
      scene: cloneSceneState(scene),
      render: {
        gravatationalLensing: params.gravatationalLensing,
        renderBlackHole: params.renderBlackHole,
        adiskEnabled: params.adiskEnabled,
        adiskParticle: params.adiskParticle,
        adiskDensityV: params.adiskDensityV,
        adiskDensityH: params.adiskDensityH,
        adiskHeight: params.adiskHeight,
        adiskLit: params.adiskLit,
        adiskNoiseLOD: params.adiskNoiseLOD,
        adiskNoiseScale: params.adiskNoiseScale,
        adiskSpeed: params.adiskSpeed,
        bloomIterations: params.bloomIterations,
        bloomStrength: params.bloomStrength,
        tonemappingEnabled: params.tonemappingEnabled,
        gamma: params.gamma,
      },
    };

    this.frames.push(frame);
  }

  /**
   * 开始回放
   */
  startPlayback(): boolean {
    if (this.frames.length === 0) {
      console.warn('⚠️ 没有录制数据');
      return false;
    }
    this.isRecording = false;
    this.isPlayback = true;
    this.playbackStartTime = Date.now() / 1000;
    console.log('▶️ 回放已开始');
    return true;
  }

  /**
   * 停止回放
   */
  stopPlayback(): void {
    this.isPlayback = false;
    console.log('⏹️ 回放已停止');
  }

  /**
   * 暂停/继续回放
   */
  togglePlayback(): void {
    this.isPlayback = !this.isPlayback;
    if (!this.isPlayback) {
      console.log('⏸️ 回放已暂停');
    } else {
      console.log('▶️ 回放已继续');
    }
  }

  /**
   * 获取当前应该应用的帧数据
   */
  getPlaybackFrame(): RecordingFrame | null {
    if (!this.isPlayback || this.frames.length === 0) {
      return null;
    }

    const elapsed = Date.now() / 1000 - this.playbackStartTime;

    // 找到对应时间戳的帧（线性插值）
    let frameIndex = 0;
    for (let i = 0; i < this.frames.length; i++) {
      if (this.frames[i]!.timestamp <= elapsed) {
        frameIndex = i;
      } else {
        break;
      }
    }

    // 如果超出范围，停止回放
    if (frameIndex >= this.frames.length - 1) {
      this.stopPlayback();
      return this.frames[this.frames.length - 1] ?? null;
    }

    return this.frames[frameIndex] ?? null;
  }

  /**
   * 获取回放进度 (0-1)
   */
  getPlaybackProgress(): number {
    if (!this.isPlayback) return 0;
    if (this.frames.length === 0) return 0;

    const elapsed = Date.now() / 1000 - this.playbackStartTime;
    const totalDuration = this.frames[this.frames.length - 1]!.timestamp;
    if (totalDuration <= 0) return this.isPlayback ? 1 : 0;

    return Math.min(1, elapsed / totalDuration);
  }

  /**
   * 设置回放进度 (0-1)
   */
  setPlaybackProgress(progress: number): void {
    if (this.frames.length === 0) return;

    const totalDuration = this.frames[this.frames.length - 1]!.timestamp;
    if (totalDuration <= 0) return;
    const targetTime = progress * totalDuration;

    // 调整playbackStartTime使得elapsed时间对应目标时间
    this.playbackStartTime = Date.now() / 1000 - targetTime;
  }

  /**
   * 导出为JSON
   */
  exportJSON(): string {
    return JSON.stringify(
      {
        version: '1.0',
        recordedAt: new Date().toISOString(),
        frameCount: this.frames.length,
        duration: this.frames.length > 0 ? this.frames[this.frames.length - 1]!.timestamp : 0,
        frames: this.frames,
      },
      null,
      2,
    );
  }

  /**
   * 从JSON导入
   */
  importJSON(jsonString: string): boolean {
    try {
      if (jsonString.length > MAX_RECORDING_JSON_BYTES) {
        console.error('❌ JSON文件过大');
        return false;
      }
      const data = JSON.parse(jsonString);
      const frames = parseRecordingFrames(data);
      if (!frames) {
        console.error('❌ 无效的JSON格式');
        return false;
      }
      this.frames = frames;
      this.isRecording = false;
      this.isPlayback = false;
      this.playbackStartTime = 0;
      this.timeOrigin = -1;
      this.lastRecordTime = -this.frameInterval;
      console.log(`✅ 导入 ${this.frames.length} 帧数据`);
      return true;
    } catch (e) {
      console.error('❌ JSON解析失败:', e);
      return false;
    }
  }

  /**
   * 保存到localStorage
   */
  saveToLocalStorage(key: string = 'recording'): boolean {
    try {
      const json = this.exportJSON();
      localStorage.setItem(key, json);
      console.log(`💾 已保存到localStorage (${(json.length / 1024).toFixed(1)} KB)`);
      return true;
    } catch (e) {
      console.error('❌ 保存失败:', e);
      return false;
    }
  }

  /**
   * 从localStorage加载
   */
  loadFromLocalStorage(key: string = 'recording'): boolean {
    try {
      const json = localStorage.getItem(key);
      if (!json) {
        console.warn('⚠️ localStorage中没有数据');
        return false;
      }
      return this.importJSON(json);
    } catch (e) {
      console.error('❌ 加载失败:', e);
      return false;
    }
  }

  /**
   * 导出为文件下载
   */
  downloadJSON(filename: string = 'recording.json'): void {
    const json = this.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    console.log(`📥 已下载 ${filename}`);
  }

  /**
   * 获取录制状态
   */
  getStatus(): {
    isRecording: boolean;
    isPlayback: boolean;
    frameCount: number;
    duration: number;
    playbackProgress: number;
  } {
    return {
      isRecording: this.isRecording,
      isPlayback: this.isPlayback,
      frameCount: this.frames.length,
      duration: this.frames.length > 0 ? this.frames[this.frames.length - 1]!.timestamp : 0,
      playbackProgress: this.getPlaybackProgress(),
    };
  }
}

/**
 * 全局单例
 */
export const recordingManager = new RecordingManager();
