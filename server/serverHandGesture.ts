/**
 * 服务端手势识别客户端
 * 连接到 Python Flask + SocketIO 服务器
 * 使用 GPU 进行手势检测
 */

import { io, Socket } from 'socket.io-client';

export interface ServerGestureState {
  is_pinching: boolean;
  pinch_strength: number;
  is_dragging: boolean;
  drag_delta_x: number;
  drag_delta_y: number;
  is_rotating: boolean;
  rotation_angle: number;
  gesture_type: string;
  hand_detected: boolean;
  hand_confidence: number;
}

export interface ServerHandResults {
  success: boolean;
  hand_detected: boolean;
  landmarks: Array<{ x: number; y: number; z: number }>;
  gesture: ServerGestureState;
  num_landmarks?: number;
  error?: string;
}

export type ServerGestureCallback = (results: ServerHandResults) => void;

export class ServerHandGestureController {
  private socket: Socket | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private canvasCtx: CanvasRenderingContext2D | null = null;
  private enabled: boolean = false;
  private connected: boolean = false;
  private callbacks: ServerGestureCallback[] = [];
  private lastResults: ServerHandResults | null = null;
  private gestureState: ServerGestureState = {
    is_pinching: false,
    pinch_strength: 0,
    is_dragging: false,
    drag_delta_x: 0,
    drag_delta_y: 0,
    is_rotating: false,
    rotation_angle: 0,
    gesture_type: 'none',
    hand_detected: false,
    hand_confidence: 0,
  };

  private serverUrl: string;
  private frameInterval: number = 100;
  private lastFrameTime: number = 0;
  private frameCounter: number = 0;

  constructor(serverUrl: string = 'http://localhost:5000') {
    this.serverUrl = serverUrl;
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

      console.log('[ServerHandGesture] 连接到服务器:', this.serverUrl);
      
      this.socket = io(this.serverUrl, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
      });

      return new Promise((resolve) => {
        if (!this.socket) {
          console.error('[ServerHandGesture] Socket 未创建');
          resolve(false);
          return;
        }

        this.socket.on('connect', () => {
          console.log('[ServerHandGesture] 已连接到服务器');
          this.connected = true;
          console.log('[ServerHandGesture] 服务器手势识别系统已就绪');
          resolve(true);
        });

        this.socket.on('connected', (data: any) => {
          console.log('[ServerHandGesture] 服务器响应:', data.message);
        });

        this.socket.on('hand_results', (results: ServerHandResults) => {
          this.handleResults(results);
        });

        this.socket.on('frame_error', (error: any) => {
          console.warn('[ServerHandGesture] 帧处理错误:', error.error);
        });

        this.socket.on('disconnect', () => {
          console.log('[ServerHandGesture] 与服务器断开连接');
          this.connected = false;
        });

        this.socket.on('connect_error', (error: any) => {
          console.error('[ServerHandGesture] 连接错误:', error.message);
          resolve(false);
        });

        setTimeout(() => {
          if (!this.connected) {
            console.error('[ServerHandGesture] 连接超时');
            resolve(false);
          }
        }, 10000);
      });
    } catch (error) {
      console.error('[ServerHandGesture] 初始化失败:', error);
      return false;
    }
  }

  private handleResults(results: ServerHandResults): void {
    this.lastResults = results;

    if (this.canvasCtx && this.canvasElement && results.hand_detected && results.landmarks.length > 0) {
      this.drawHandLandmarks(results.landmarks);
    }

    if (results.hand_detected) {
      this.gestureState = results.gesture;
    } else {
      this.gestureState = {
        is_pinching: false,
        pinch_strength: 0,
        is_dragging: false,
        drag_delta_x: 0,
        drag_delta_y: 0,
        is_rotating: false,
        rotation_angle: 0,
        gesture_type: 'none',
        hand_detected: false,
        hand_confidence: 0,
      };
    }

    for (const callback of this.callbacks) {
      callback(results);
    }
  }

  private drawHandLandmarks(landmarks: Array<{ x: number; y: number; z: number }>): void {
    if (!this.canvasCtx || !this.canvasElement) return;

    this.canvasCtx.save();
    this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);

    this.canvasCtx.translate(this.canvasElement.width, 0);
    this.canvasCtx.scale(-1, 1);

    this.canvasCtx.fillStyle = '#00FF00';
    this.canvasCtx.strokeStyle = '#00FF00';
    this.canvasCtx.lineWidth = 2;

    for (const landmark of landmarks) {
      const x = landmark.x * this.canvasElement.width;
      const y = landmark.y * this.canvasElement.height;

      this.canvasCtx.beginPath();
      this.canvasCtx.arc(x, y, 3, 0, 2 * Math.PI);
      this.canvasCtx.fill();
    }

    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [5, 9], [9, 10], [10, 11], [11, 12],
      [9, 13], [13, 14], [14, 15], [15, 16],
      [13, 17], [0, 17], [5, 9], [9, 17], [17, 18], [18, 19], [19, 20],
    ];

    this.canvasCtx.beginPath();
    for (const [start, end] of connections) {
      if (start < landmarks.length && end < landmarks.length) {
        const startX = landmarks[start].x * this.canvasElement.width;
        const startY = landmarks[start].y * this.canvasElement.height;
        const endX = landmarks[end].x * this.canvasElement.width;
        const endY = landmarks[end].y * this.canvasElement.height;

        this.canvasCtx.moveTo(startX, startY);
        this.canvasCtx.lineTo(endX, endY);
      }
    }
    this.canvasCtx.stroke();

    this.canvasCtx.restore();
  }

  async processFrame(): Promise<void> {
    if (!this.socket || !this.videoElement || !this.enabled || !this.connected) {
      return;
    }

    if (this.videoElement.readyState < 2) {
      console.warn('[ServerHandGesture] 视频尚未准备好');
      return;
    }

    const now = performance.now();
    if (now - this.lastFrameTime < this.frameInterval) {
      return;
    }
    this.lastFrameTime = now;
    this.frameCounter++;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        console.error('[ServerHandGesture] 无法创建画布上下文');
        return;
      }

      ctx.drawImage(this.videoElement, 0, 0, canvas.width, canvas.height);
      const imageData = canvas.toDataURL('image/jpeg', 0.5);
      
      this.socket.emit('video_frame', {
        image: imageData.replace('data:image/jpeg;base64,', ''),
        timestamp: Date.now(),
      });

    } catch (error) {
      console.warn('[ServerHandGesture] 处理帧失败:', error);
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    console.log('[ServerHandGesture] 手势控制:', enabled ? '启用' : '禁用');
  }

  onGesture(callback: ServerGestureCallback): void {
    this.callbacks.push(callback);
  }

  offGesture(callback: ServerGestureCallback): void {
    const index = this.callbacks.indexOf(callback);
    if (index > -1) {
      this.callbacks.splice(index, 1);
    }
  }

  getState(): ServerGestureState {
    return this.gestureState;
  }

  getResults(): ServerHandResults | null {
    return this.lastResults;
  }

  isConnected(): boolean {
    return this.connected;
  }

  destroy(): void {
    this.enabled = false;
    this.callbacks = [];

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.connected = false;
    console.log('[ServerHandGesture] 销毁完成');
  }
}
