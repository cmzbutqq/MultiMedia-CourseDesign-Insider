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

  private smoothedPalmX: number = 0.5;
  private smoothedPalmY: number = 0.5;
  private smoothingFactor: number = 0.08;
  private palmDeadzone: number = 0.04;
  private velocityX: number = 0;
  private velocityY: number = 0;
  private velocityDamping: number = 0.85;

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
        runningMode: 'VIDEO',
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
        video: {
          width: { min: 160, ideal: 320, max: 640 },
          height: { min: 120, ideal: 240, max: 480 },
          frameRate: { ideal: 15, min: 10 },
        },
        audio: false,
      };

      try {
        const stream = await getUserMedia(constraints);
        this.videoElement!.srcObject = stream;
        await this.videoElement!.play();
      } catch (err) {
        console.error('[HandGesture] 摄像头初始化失败');
        return false;
      }

      this.isInitialized = true;
      console.log('[HandGesture] 手势控制初始化成功');
      return true;
    } catch (error) {
      console.error('[HandGesture] 初始化失败:', error);
      return false;
    }
  }

  private onResults(results: Results): void {
    if (!this.enabled) return;

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
    this.velocityX *= 0.5;
    this.velocityY *= 0.5;
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
      this.velocityX = this.velocityX * this.velocityDamping + deltaX * this.smoothingFactor;
      this.velocityY = this.velocityY * this.velocityDamping + deltaY * this.smoothingFactor;

      this.smoothedPalmX += this.velocityX;
      this.smoothedPalmY += this.velocityY;
    } else {
      this.velocityX *= 0.7;
      this.velocityY *= 0.7;
    }

    this.smoothedPalmX = Math.max(0, Math.min(1, this.smoothedPalmX));
    this.smoothedPalmY = Math.max(0, Math.min(1, this.smoothedPalmY));

    const fingerCount = this.countExtendedFingers(landmarks);
    const isOpenPalm = fingerCount >= 4;

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
      this.emitEvent({ type: 'hand_detected', gestureState: { ...this.gestureState } });
    } else if (isOpenPalm) {
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
      console.warn('[HandGesture] 处理帧失败');
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.resetGestureState();
      this.wasHandDetected = false;
    }
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
