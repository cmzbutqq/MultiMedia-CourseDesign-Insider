import { cloneSceneState, type SceneState } from './scene.js';

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
      render: { ...params },
    };

    this.frames.push(frame);
  }

  /**
   * 开始回放
   */
  startPlayback(): void {
    if (this.frames.length === 0) {
      console.warn('⚠️ 没有录制数据');
      return;
    }
    this.isPlayback = true;
    this.playbackStartTime = Date.now() / 1000;
    console.log('▶️ 回放已开始');
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
    if (this.frames.length === 0) return 0;

    const elapsed = Date.now() / 1000 - this.playbackStartTime;
    const totalDuration = this.frames[this.frames.length - 1]!.timestamp;

    return Math.min(1, elapsed / totalDuration);
  }

  /**
   * 设置回放进度 (0-1)
   */
  setPlaybackProgress(progress: number): void {
    if (this.frames.length === 0) return;

    const totalDuration = this.frames[this.frames.length - 1]!.timestamp;
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
      const data = JSON.parse(jsonString);
      if (!data.frames || !Array.isArray(data.frames)) {
        console.error('❌ 无效的JSON格式');
        return false;
      }
      this.frames = data.frames;
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
  saveToLocalStorage(key: string = 'recording'): void {
    const json = this.exportJSON();
    try {
      localStorage.setItem(key, json);
      console.log(`💾 已保存到localStorage (${(json.length / 1024).toFixed(1)} KB)`);
    } catch (e) {
      console.error('❌ 保存失败:', e);
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
