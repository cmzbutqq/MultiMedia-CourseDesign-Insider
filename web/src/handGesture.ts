import {
  Hands,
  Results,
  HAND_CONNECTIONS,
  NormalizedLandmark,
} from '@mediapipe/hands';

export interface GestureState {
  palmX: number;
  palmY: number;
  isOpenPalm: boolean;
  fingerCount: number;
  handDetected: boolean;
  handConfidence: number;
}

export interface GestureEvent {
  type: 'hand_move' | 'hand_detected' | 'hand_lost';
  gestureState: GestureState;
}

export type GestureCallback = (event: GestureEvent) => void;

export class HandGestureController {
  private hands: Hands | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private canvasCtx: CanvasRenderingContext2D | null = null;
  private callbacks: GestureCallback[] = [];
  private enabled: boolean = false;
  private isInitialized: boolean = false;
  private wasHandDetected: boolean = false;
  private lastResults: Results | null = null;

  private smoothedPalmX: number = 0.5;
  private smoothedPalmY: number = 0.5;
  private smoothingFactor: number = 0.1;
  private palmDeadzone: number = 0.1;
  private lastEmitX: number = 0.5;
  private lastEmitY: number = 0.5;
  private emitThreshold: number = 0.005;
  private lastEmitTime: number = 0;

  private gestureState: GestureState = {
    palmX: 0.5,
    palmY: 0.5,
    isOpenPalm: false,
    fingerCount: 0,
    handDetected: false,
    handConfidence: 0,
  };

  constructor() {}

  async initialize(
    videoElement: HTMLVideoElement,
    canvasElement?: HTMLCanvasElement,
  ): Promise<boolean> {
    try {
      this.videoElement = videoElement;
      this.canvasElement = canvasElement || null;

      if (this.canvasElement) {
        this.canvasCtx = this.canvasElement.getContext('2d');
      }

      this.hands = new Hands({
        locateFile: (file: string) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        },
      });

      this.hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 0,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
        selfieMode: true,
        runningMode: 'VIDEO',
        fps: 30,
      } as any);

      this.hands.onResults((results: Results) => this.onResults(results));

      await new Promise<void>((resolve) => {
        if ((this.hands as any).initialize) {
          (this.hands as any).initialize().then(() => {
            resolve();
          }).catch(() => {
            resolve();
          });
        } else {
          resolve();
        }
      });

      const getUserMedia =
        typeof navigator.mediaDevices?.getUserMedia === 'function'
          ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
          : typeof (navigator as any).getUserMedia === 'function'
            ? (navigator as any).getUserMedia.bind(navigator)
            : null;

      if (!getUserMedia) {
        console.error('[HandGesture] 浏览器不支持 getUserMedia API');
        return false;
      }

      const constraints: MediaStreamConstraints = {
        video: true,
        audio: false,
      };

      try {
        console.log('[HandGesture] 请求摄像头访问...');
        const stream = await getUserMedia(constraints);
        console.log('[HandGesture] 摄像头流已获取, track数量:', stream.getVideoTracks().length);

        this.videoElement!.srcObject = stream;

        // 等待视频加载
        await new Promise<void>((resolve, reject) => {
          if (this.videoElement!.readyState >= 2) {
            resolve();
            return;
          }
          const timeout = setTimeout(() => reject(new Error('视频加载超时')), 10000);
          this.videoElement!.onloadedmetadata = () => {
            clearTimeout(timeout);
            console.log('[HandGesture] 元数据加载完成，视频尺寸:', this.videoElement!.videoWidth, 'x', this.videoElement!.videoHeight);
            resolve();
          };
          this.videoElement!.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('视频加载错误'));
          };
        });

        // 尝试播放，忽略自动播放被阻止的错误
        try {
          await this.videoElement!.play();
          console.log('[HandGesture] 视频播放成功');
        } catch (playErr) {
          console.warn('[HandGesture] play()被阻止或失败:', playErr);
          // 继续，因为流已经获取到了
        }
      } catch (err) {
        console.error('[HandGesture] 摄像头初始化失败:', err);
        return false;
      }

      this.isInitialized = true;
      console.log('[HandGesture] 摄像头初始化成功');
      console.log('[HandGesture] 手势控制初始化成功');
      return true;
    } catch (error) {
      console.error('[HandGesture] 初始化失败:', error);
      return false;
    }
  }

  private onResults(results: Results): void {
    if (!this.enabled) return;

    this.lastResults = results;

    if (this.canvasCtx && this.canvasElement) {
      this.drawHandLandmarks(results);
    }

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const landmarks = results.multiHandLandmarks[0];

      if (landmarks.length >= 21) {
        this.processGestures(landmarks);
      } else {
        this.handleHandLost();
      }
    } else {
      this.handleHandLost();
    }
  }

  private handleHandLost(): void {
    if (this.wasHandDetected) {
      this.wasHandDetected = false;
      this.emitEvent({ type: 'hand_lost', gestureState: { ...this.gestureState } });
    }
    this.resetGestureState();
  }

  private drawHandLandmarks(results: Results): void {
    if (!this.canvasCtx || !this.canvasElement) return;

    this.canvasCtx.save();
    this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);

    this.canvasCtx.translate(this.canvasElement.width, 0);
    this.canvasCtx.scale(-1, 1);

    if (results.multiHandLandmarks) {
      for (const landmarks of results.multiHandLandmarks) {
        this.drawConnectors(this.canvasCtx, landmarks, HAND_CONNECTIONS, {
          color: '#00FF00',
          lineWidth: 2,
        });
        this.drawLandmarks(this.canvasCtx, landmarks, {
          color: '#FF0000',
          lineWidth: 1,
          radius: 3,
        });
      }
    }

    this.canvasCtx.restore();
  }

  private drawConnectors(
    ctx: CanvasRenderingContext2D,
    landmarks: NormalizedLandmark[],
    connections: readonly [number, number][],
    style: { color: string; lineWidth: number },
  ): void {
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.lineWidth;
    ctx.lineCap = 'round';

    for (const [start, end] of connections) {
      const startPoint = landmarks[start];
      const endPoint = landmarks[end];
      if (!startPoint || !endPoint) continue;

      ctx.beginPath();
      ctx.moveTo(startPoint.x * ctx.canvas.width, startPoint.y * ctx.canvas.height);
      ctx.lineTo(endPoint.x * ctx.canvas.width, endPoint.y * ctx.canvas.height);
      ctx.stroke();
    }
  }

  private drawLandmarks(
    ctx: CanvasRenderingContext2D,
    landmarks: NormalizedLandmark[],
    style: { color: string; lineWidth: number; radius: number },
  ): void {
    ctx.fillStyle = style.color;

    for (const landmark of landmarks) {
      ctx.beginPath();
      ctx.arc(
        landmark.x * ctx.canvas.width,
        landmark.y * ctx.canvas.height,
        style.radius,
        0,
        2 * Math.PI,
      );
      ctx.fill();
    }
  }

  private processGestures(landmarks: NormalizedLandmark[]): void {
    const palmCenter = landmarks[9];

    const rawPalmX = palmCenter.x;
    const rawPalmY = palmCenter.y;

    const deltaX = rawPalmX - this.smoothedPalmX;
    const deltaY = rawPalmY - this.smoothedPalmY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    if (distance > this.palmDeadzone) {
      this.smoothedPalmX += deltaX * this.smoothingFactor;
      this.smoothedPalmY += deltaY * this.smoothingFactor;
    }

    this.smoothedPalmX = Math.max(0, Math.min(1, this.smoothedPalmX));
    this.smoothedPalmY = Math.max(0, Math.min(1, this.smoothedPalmY));

    const fingerCount = this.countExtendedFingers(landmarks);
    const isOpenPalm = fingerCount >= 4;

    const emitDeltaX = Math.abs(this.smoothedPalmX - this.lastEmitX);
    const emitDeltaY = Math.abs(this.smoothedPalmY - this.lastEmitY);
    const shouldEmit = emitDeltaX > this.emitThreshold || emitDeltaY > this.emitThreshold;

    this.gestureState = {
      palmX: this.smoothedPalmX,
      palmY: this.smoothedPalmY,
      isOpenPalm,
      fingerCount,
      handDetected: true,
      handConfidence: 0.8,
    };

    if (!this.wasHandDetected) {
      this.wasHandDetected = true;
      this.lastEmitX = this.smoothedPalmX;
      this.lastEmitY = this.smoothedPalmY;
      this.emitEvent({ type: 'hand_detected', gestureState: { ...this.gestureState } });
    } else if (shouldEmit && isOpenPalm) {
      this.lastEmitX = this.smoothedPalmX;
      this.lastEmitY = this.smoothedPalmY;
      this.emitEvent({ type: 'hand_move', gestureState: { ...this.gestureState } });
    }
  }

  private countExtendedFingers(landmarks: NormalizedLandmark[]): number {
    const fingerTips = [8, 12, 16, 20];
    const fingerMids = [6, 10, 14, 18];

    let extendedCount = 0;

    for (let i = 0; i < fingerTips.length; i++) {
      const tip = landmarks[fingerTips[i]];
      const mid = landmarks[fingerMids[i]];
      const pip = landmarks[fingerMids[i] - 1];

      if (tip.y < mid.y && tip.y < pip.y) {
        extendedCount++;
      }
    }

    const thumbTip = landmarks[4];
    const thumbIp = landmarks[3];
    const wrist = landmarks[0];

    const thumbExtended = Math.abs(thumbTip.x - wrist.x) > Math.abs(thumbIp.x - wrist.x);
    if (thumbExtended) {
      extendedCount++;
    }

    return extendedCount;
  }

  private resetGestureState(): void {
    this.gestureState = {
      palmX: 0.5,
      palmY: 0.5,
      isOpenPalm: false,
      fingerCount: 0,
      handDetected: false,
      handConfidence: 0,
    };
  }

  async processFrame(): Promise<void> {
    if (!this.enabled || !this.hands || !this.videoElement) return;

    try {
      await this.hands.send({ image: this.videoElement });
    } catch (err) {
      // Silently ignore errors when disabled or during shutdown
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.resetGestureState();
      this.wasHandDetected = false;
    }
  }

  destroy(): void {
    this.enabled = false;
    if (this.hands) {
      try {
        this.hands.close();
      } catch (e) {
        // Ignore close errors
      }
      this.hands = null;
    }
    this.resetGestureState();
    this.wasHandDetected = false;
    this.callbacks = [];
    this.isInitialized = false;
    console.log('[HandGesture] 已销毁');
  }

  onGesture(callback: GestureCallback): void {
    this.callbacks.push(callback);
  }

  removeCallback(callback: GestureCallback): void {
    const index = this.callbacks.indexOf(callback);
    if (index !== -1) {
      this.callbacks.splice(index, 1);
    }
  }

  private emitEvent(event: GestureEvent): void {
    for (const callback of this.callbacks) {
      callback(event);
    }
  }

  getState(): GestureState {
    return { ...this.gestureState };
  }

  getResults(): Results | null {
    return this.lastResults;
  }
}
