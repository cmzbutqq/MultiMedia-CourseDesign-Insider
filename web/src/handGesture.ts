import {
  Hands,
  Results,
  HAND_CONNECTIONS,
  NormalizedLandmark,
} from '@mediapipe/hands';

export interface GestureState {
  isPinching: boolean;
  pinchStrength: number;
  isDragging: boolean;
  dragDeltaX: number;
  dragDeltaY: number;
  isRotating: boolean;
  rotationAngle: number;
  handDetected: boolean;
  handConfidence: number;
  gestureType: 'none' | 'pinch' | 'drag' | 'rotate';
}

export interface GestureEvent {
  type: 'pinch_start' | 'pinch_end' | 'drag_start' | 'drag_end' | 'rotate' | 'calibrate';
  gestureState: GestureState;
}

type GestureCallback = (event: GestureEvent) => void;

const PINCH_THRESHOLD = 0.07;
const DRAG_THRESHOLD = 0.03;
const ROTATE_THRESHOLD = 0.05;

export class HandGestureController {
  private hands: Hands | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private canvasCtx: CanvasRenderingContext2D | null = null;
  private callbacks: GestureCallback[] = [];
  private enabled: boolean = false;
  private isInitialized: boolean = false;

  private isPinching: boolean = false;
  private prevPalmCenter: { x: number; y: number } | null = null;
  private isDragging: boolean = false;
  private prevThumbAngle: number = 0;
  private isRotating: boolean = false;
  private lastResults: Results | null = null;

  private gestureState: GestureState = {
    isPinching: false,
    pinchStrength: 0,
    isDragging: false,
    dragDeltaX: 0,
    dragDeltaY: 0,
    isRotating: false,
    rotationAngle: 0,
    handDetected: false,
    handConfidence: 0,
    gestureType: 'none',
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
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      this.hands.onResults((results: Results) => this.onResults(results));

      let stream: MediaStream | null = null;

      const mediaDevices = navigator.mediaDevices || (navigator as any);
      const getUserMedia = mediaDevices?.getUserMedia?.bind(mediaDevices)
        || (navigator as any).getUserMedia?.bind(navigator)
        || (navigator as any).webkitGetUserMedia?.bind(navigator)
        || (navigator as any).mozGetUserMedia?.bind(navigator);

      console.log('[HandGesture] navigator.mediaDevices 存在:', !!navigator.mediaDevices);
      console.log('[HandGesture] getUserMedia 可用:', !!getUserMedia);

      if (!getUserMedia) {
        const errMsg = '浏览器不支持 getUserMedia API (可能在 Docker/无头浏览器环境中运行)';
        console.error('[HandGesture]', errMsg);
        alert(`${errMsg}\n\n手势控制功能需要访问摄像头，但在当前环境中不可用。\n\n解决方案：\n1. 在宿主机浏览器中直接访问页面\n2. 确保页面通过非 HTTPS 的 localhost 访问\n3. 确保浏览器允许摄像头权限`);
        throw new Error(errMsg);
      }

      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 320 },
          height: { ideal: 240 },
          facingMode: 'user',
        },
        audio: false,
      };

      try {
        console.log('[HandGesture] 正在请求摄像头权限...');
        stream = await getUserMedia(constraints);
        console.log('[HandGesture] 摄像头权限已获得');
      } catch (err) {
        console.warn('[HandGesture] 前置摄像头失败，尝试后置摄像头...', err);
        constraints.video = {
          width: { ideal: 320 },
          height: { ideal: 240 },
          facingMode: 'environment',
        };
        try {
          stream = await getUserMedia(constraints);
          console.log('[HandGesture] 后置摄像头权限已获得');
        } catch (err2) {
          console.warn('[HandGesture] 后置摄像头也失败，尝试任意摄像头...', err2);
          constraints.video = true;
          stream = await getUserMedia(constraints);
          console.log('[HandGesture] 任意摄像头权限已获得');
        }
      }

      this.videoElement.srcObject = stream;
      await this.videoElement.play();

      this.isInitialized = true;
      console.log('[HandGesture] 手势控制初始化成功');
      return true;
    } catch (error) {
      console.error('[HandGesture] 初始化失败:', error);
      if (error instanceof Error) {
        console.error('[HandGesture] 错误详情:', error.message);
      }
      return false;
    }
  }

  private async onResults(results: Results): Promise<void> {
    this.lastResults = results;

    if (this.canvasCtx && this.canvasElement) {
      this.drawHandLandmarks(results);
    }

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const landmarks = results.multiHandLandmarks[0];
      this.processGestures(landmarks);
    } else {
      this.resetGestureState();
    }
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
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const palmCenter = landmarks[9];

    const pinchDist = this.getDistance(thumbTip, indexTip);

    if (pinchDist < PINCH_THRESHOLD && !this.isPinching) {
      this.isPinching = true;
      this.emitEvent({ type: 'pinch_start', gestureState: { ...this.gestureState } });
    } else if (pinchDist >= PINCH_THRESHOLD && this.isPinching) {
      this.isPinching = false;
      this.emitEvent({ type: 'pinch_end', gestureState: { ...this.gestureState } });
    }

    if (this.prevPalmCenter && this.isPinching) {
      const dx = palmCenter.x - this.prevPalmCenter.x;
      const dy = palmCenter.y - this.prevPalmCenter.y;

      if (!this.isDragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        this.isDragging = true;
        this.emitEvent({ type: 'drag_start', gestureState: { ...this.gestureState } });
      }

      if (this.isDragging) {
        this.gestureState.dragDeltaX = dx * 100;
        this.gestureState.dragDeltaY = dy * 100;
      }
    }

    if (this.isDragging && !this.isPinching) {
      this.isDragging = false;
      this.emitEvent({ type: 'drag_end', gestureState: { ...this.gestureState } });
      this.gestureState.dragDeltaX = 0;
      this.gestureState.dragDeltaY = 0;
    }

    const thumbAngle = Math.atan2(
      landmarks[4].y - landmarks[3].y,
      landmarks[4].x - landmarks[3].x,
    );
    if (this.prevThumbAngle !== null) {
      let angleDiff = thumbAngle - this.prevThumbAngle;
      if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

      if (Math.abs(angleDiff) > ROTATE_THRESHOLD) {
        if (!this.isRotating) {
          this.isRotating = true;
        }
        this.gestureState.rotationAngle = angleDiff * 50;
        this.emitEvent({ type: 'rotate', gestureState: { ...this.gestureState } });
      } else if (this.isRotating) {
        this.isRotating = false;
        this.gestureState.rotationAngle = 0;
      }
    }

    this.prevPalmCenter = { x: palmCenter.x, y: palmCenter.y };
    this.prevThumbAngle = thumbAngle;

    this.gestureState.isPinching = this.isPinching;
    this.gestureState.pinchStrength = 1 - Math.min(pinchDist / PINCH_THRESHOLD, 1);
    this.gestureState.isDragging = this.isDragging;
    this.gestureState.isRotating = this.isRotating;
    this.gestureState.handDetected = true;

    if (this.isPinching) {
      this.gestureState.gestureType = this.isDragging ? 'drag' : 'pinch';
    } else if (this.isRotating) {
      this.gestureState.gestureType = 'rotate';
    } else {
      this.gestureState.gestureType = 'none';
    }

    this.update();
  }

  private getDistance(a: NormalizedLandmark, b: NormalizedLandmark): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = (a.z || 0) - (b.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private resetGestureState(): void {
    const wasHandDetected = this.gestureState.handDetected;

    this.gestureState = {
      isPinching: false,
      pinchStrength: 0,
      isDragging: false,
      dragDeltaX: 0,
      dragDeltaY: 0,
      isRotating: false,
      rotationAngle: 0,
      handDetected: false,
      handConfidence: 0,
      gestureType: 'none',
    };

    this.isPinching = false;
    this.isDragging = false;
    this.isRotating = false;
    this.prevPalmCenter = null;
    this.prevThumbAngle = 0;

    if (wasHandDetected) {
      this.emitEvent({ type: 'drag_end', gestureState: { ...this.gestureState } });
    }
  }

  private update(): void {
    if (this.hands && this.videoElement && this.enabled) {
      this.hands.send({ image: this.videoElement });
    }
  }

  async processFrame(): Promise<void> {
    if (this.hands && this.videoElement && this.enabled) {
      await this.hands.send({ image: this.videoElement });
    }
  }

  private emitEvent(event: GestureEvent): void {
    for (const callback of this.callbacks) {
      callback(event);
    }
  }

  onGesture(callback: GestureCallback): void {
    this.callbacks.push(callback);
  }

  offGesture(callback: GestureCallback): void {
    const index = this.callbacks.indexOf(callback);
    if (index > -1) {
      this.callbacks.splice(index, 1);
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled && this.isInitialized) {
      this.update();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getState(): GestureState {
    return { ...this.gestureState };
  }

  getResults(): Results | null {
    return this.lastResults;
  }

  destroy(): void {
    this.enabled = false;
    this.callbacks = [];

    if (this.videoElement?.srcObject) {
      const stream = this.videoElement.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      this.videoElement.srcObject = null;
    }

    this.hands?.close();
    this.hands = null;
    this.isInitialized = false;
  }
}

export function createHandGestureController(): HandGestureController {
  return new HandGestureController();
}
