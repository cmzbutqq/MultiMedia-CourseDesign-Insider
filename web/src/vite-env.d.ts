/// <reference types="vite/client" />

declare module '*?raw' {
  const src: string;
  export default src;
}

interface WebGL2RenderingContext {
  TEXTURE_2D_MULTISAMPLE: number;
  texImage2DMultisample(target: number, samples: number, internalformat: number, width: number, height: number, fixedsamplelocations: boolean): void;
}

declare module '@mediapipe/hands' {
  export interface Results {
    multiHandLandmarks?: NormalizedLandmark[][];
    multiHandedness?: Array<{ index: number; score: number; label: string }>;
  }

  export interface NormalizedLandmark {
    x: number;
    y: number;
    z: number;
  }

  export interface Landmark {
    x: number;
    y: number;
    z: number;
    visibility?: number;
    presence?: number;
  }

  export const HAND_CONNECTIONS: readonly [number, number][];

  export class Hands {
    constructor(options?: {
      locateFile?: (file: string) => string;
    });

    setOptions(options: {
      maxNumHands?: number;
      modelComplexity?: number;
      minDetectionConfidence?: number;
      minTrackingConfidence?: number;
      runningMode?: string;
    }): void;

    onResults(callback: (results: Results) => void): void;

    send(input: { image: HTMLVideoElement | HTMLCanvasElement | ImageBitmap }): Promise<void>;

    close(): void;
  }
}

declare module '@mediapipe/camera_utils' {
  export class Camera {
    constructor(videoElement: HTMLVideoElement, options?: {
      onFrame?: () => Promise<void>;
      width?: number;
      height?: number;
    });

    start(): Promise<void>;
    stop(): void;
  }
}
