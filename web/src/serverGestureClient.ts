export interface ServerConfig {
  host: string;
  port: number;
  useSSL: boolean;
}

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

type GestureCallback = (event: GestureEvent) => void;

export class ServerGestureClient {
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private canvasCtx: CanvasRenderingContext2D | null = null;
  private callbacks: GestureCallback[] = [];
  private enabled: boolean = false;
  private isInitialized: boolean = false;
  private frameInterval: number | null = null;
  private lastFrameTime: number = 0;
  private frameCount: number = 0;
  private fps: number = 0;
  private config: ServerConfig;
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

  constructor(config?: Partial<ServerConfig>) {
    this.config = {
      host: config?.host || 'localhost',
      port: config?.port || 5000,
      useSSL: false,
    };
  }

  public setSmoothingFactor(factor: number): void {
    this.smoothingFactor = Math.max(0.05, Math.min(0.5, factor));
  }

  public setDeadzone(deadzone: number): void {
    this.palmDeadzone = Math.max(0, Math.min(0.1, deadzone));
  }

  public getSmoothedPosition(): { x: number; y: number } {
    return { x: this.smoothedPalmX, y: this.smoothedPalmY };
  }

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

      console.log('[ServerGesture] 正在连接到手势识别服务器...');
      const connected = await this.checkServerConnection();
      if (!connected) {
        console.error('[ServerGesture] 无法连接到服务器');
        return false;
      }

      console.log('[ServerGesture] 正在初始化摄像头...');
      const cameraReady = await this.initializeCamera();
      if (!cameraReady) {
        console.error('[ServerGesture] 摄像头初始化失败');
        return false;
      }

      this.isInitialized = true;
      console.log('[ServerGesture] 服务器端手势识别初始化成功');
      return true;
    } catch (error) {
      console.error('[ServerGesture] 初始化失败:', error);
      return false;
    }
  }

  private async checkServerConnection(): Promise<boolean> {
    try {
      const protocol = this.config.useSSL ? 'https' : 'http';
      const url = `${protocol}://${this.config.host}:${this.config.port}/health`;
      
      console.log(`[ServerGesture] 检查服务器连接: ${url}`);
      const response = await fetch(url);
      
      if (response.ok) {
        const data = await response.json();
        console.log('[ServerGesture] 服务器连接成功:', data);
        return true;
      }
      
      console.error('[ServerGesture] 服务器响应错误:', response.status);
      return false;
    } catch (error) {
      console.error('[ServerGesture] 服务器连接失败:', error);
      return false;
    }
  }

  private async sendFrameForDetection(imageData: string): Promise<void> {
    try {
      const protocol = this.config.useSSL ? 'https' : 'http';
      const url = `${protocol}://${this.config.host}:${this.config.port}/api/detect`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: imageData }),
      });

      if (!response.ok) {
        console.warn('[ServerGesture] 检测请求失败:', response.status);
        return;
      }

      const result = await response.json();
      this.processServerResults(result);
    } catch (error) {
      console.warn('[ServerGesture] 发送帧失败:', error);
    }
  }

  private processServerResults(data: any): void {
    if (!data.success) {
      this.resetGestureState();
      return;
    }

    const { hand_detected, landmarks, gesture } = data;

    if (landmarks && landmarks.length > 0 && this.canvasCtx && this.canvasElement) {
      this.drawHandLandmarks(landmarks);
    }

    if (hand_detected && gesture) {
      const rawPalmX = gesture.palm_x ?? 0.5;
      const rawPalmY = gesture.palm_y ?? 0.5;

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

      this.gestureState = {
        palmX: this.smoothedPalmX,
        palmY: this.smoothedPalmY,
        isOpenPalm: gesture.is_open_palm || false,
        fingerCount: gesture.finger_count || 0,
        handDetected: true,
        handConfidence: gesture.hand_confidence || 0.8,
      };

      if (!this.wasHandDetected) {
        this.wasHandDetected = true;
        this.emitEvent({ type: 'hand_detected', gestureState: { ...this.gestureState } });
      } else if (this.gestureState.isOpenPalm) {
        this.emitEvent({ type: 'hand_move', gestureState: { ...this.gestureState } });
      }
    } else {
      if (this.wasHandDetected) {
        this.wasHandDetected = false;
        this.emitEvent({ type: 'hand_lost', gestureState: { ...this.gestureState } });
      }
      this.velocityX *= 0.5;
      this.velocityY *= 0.5;
      this.resetGestureState();
    }
  }

  private drawHandLandmarks(landmarks: Array<{ x: number; y: number; z?: number }>): void {
    if (!this.canvasCtx || !this.canvasElement) return;

    this.canvasCtx.save();
    this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);

    this.canvasCtx.translate(this.canvasElement.width, 0);
    this.canvasCtx.scale(-1, 1);

    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [0, 9], [9, 10], [10, 11], [11, 12],
      [0, 13], [13, 14], [14, 15], [15, 16],
      [0, 17], [17, 18], [18, 19], [19, 20],
      [5, 9], [9, 13], [13, 17],
    ];

    this.canvasCtx.strokeStyle = '#00FF00';
    this.canvasCtx.lineWidth = 2;
    this.canvasCtx.lineCap = 'round';

    for (const [start, end] of connections) {
      const startPoint = landmarks[start];
      const endPoint = landmarks[end];
      if (!startPoint || !endPoint) continue;

      this.canvasCtx.beginPath();
      this.canvasCtx.moveTo(
        startPoint.x * this.canvasElement.width,
        startPoint.y * this.canvasElement.height
      );
      this.canvasCtx.lineTo(
        endPoint.x * this.canvasElement.width,
        endPoint.y * this.canvasElement.height
      );
      this.canvasCtx.stroke();
    }

    this.canvasCtx.fillStyle = '#FF0000';
    for (const landmark of landmarks) {
      this.canvasCtx.beginPath();
      this.canvasCtx.arc(
        landmark.x * this.canvasElement.width,
        landmark.y * this.canvasElement.height,
        3,
        0,
        2 * Math.PI
      );
      this.canvasCtx.fill();
    }

    this.canvasCtx.restore();
  }

  private async initializeCamera(): Promise<boolean> {
    const getUserMedia =
      typeof navigator.mediaDevices?.getUserMedia === 'function'
        ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
        : typeof (navigator as any).getUserMedia === 'function'
          ? (navigator as any).getUserMedia.bind(navigator)
          : null;

    if (!getUserMedia) {
      console.error('[ServerGesture] 浏览器不支持 getUserMedia API');
      return false;
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          width: { min: 160, ideal: 240, max: 320 },
          height: { min: 120, ideal: 180, max: 240 },
          frameRate: { ideal: 60, min: 30 },
        },
        audio: false,
      };

      const stream = await getUserMedia(constraints);
      this.videoElement!.srcObject = stream;
      await this.videoElement!.play();
      console.log('[ServerGesture] 摄像头初始化成功');
      return true;
    } catch (error) {
      console.error('[ServerGesture] 摄像头初始化失败:', error);
      return false;
    }
  }

  private startFrameCapture(): void {
    if (this.frameInterval) return;

    const targetFPS = 30;
    const interval = 1000 / targetFPS;

    this.frameInterval = window.setInterval(() => {
      this.captureAndSendFrame();
    }, interval);
  }

  private stopFrameCapture(): void {
    if (this.frameInterval) {
      clearInterval(this.frameInterval);
      this.frameInterval = null;
    }
  }

  private captureAndSendFrame(): void {
    if (!this.videoElement) {
      return;
    }

    const now = performance.now();
    if (now - this.lastFrameTime < 33) {
      return;
    }
    this.lastFrameTime = now;

    const canvas = document.createElement('canvas');
    const targetWidth = 160;
    const targetHeight = 120;
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(this.videoElement, 0, 0, targetWidth, targetHeight);
    ctx.restore();

    const imageData = canvas.toDataURL('image/jpeg', 0.5);
    const base64Data = imageData.split(',')[1];

    this.sendFrameForDetection(base64Data);

    this.frameCount++;
    if (this.frameCount % 30 === 0) {
      this.fps = 30;
    }
  }

  enable(): void {
    if (!this.isInitialized) {
      console.warn('[ServerGesture] 未初始化，无法启用');
      return;
    }
    this.enabled = true;
    this.startFrameCapture();
    console.log('[ServerGesture] 手势识别已启用');
  }

  disable(): void {
    this.enabled = false;
    this.stopFrameCapture();
    this.resetGestureState();
    console.log('[ServerGesture] 手势识别已禁用');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getGestureState(): GestureState {
    return { ...this.gestureState };
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

  destroy(): void {
    this.disable();
    if (this.videoElement?.srcObject) {
      const stream = this.videoElement.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
    }
    this.callbacks = [];
    this.isInitialized = false;
    console.log('[ServerGesture] 已销毁');
  }

  getStats(): { fps: number; framesSent: number } {
    return {
      fps: this.fps,
      framesSent: this.frameCount,
    };
  }
}
