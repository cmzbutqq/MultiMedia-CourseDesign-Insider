import GUI from 'lil-gui';
import {
  type ColorRT,
  type ColorRTFormat,
  compileProgram,
  createColorRT,
  createMSAART,
  createQuadVAO,
  destroyColorRT,
  destroyMSAART,
  detectRTFormat,
  resolveMSAA,
  type MSAART,
} from './gl.js';
import { loadCubemap, loadTexture2D } from './resources.js';
import {
  HandGestureController,
} from './handGesture.js';
import { ServerGestureClient } from './serverGestureClient.js';
import {
  MAX_BODIES,
  type BodyKind,
  type SceneState,
  applySceneState,
  cloneSceneState,
} from './scene.js';
import { stepScene, calculateTimeWarp } from './physics.js';
import { createDefaultScene, SCENE_PRESETS } from './scenePresets.js';
import { getCameraLookBasis, worldToScreenPx } from './camera.js';
import { TrailBuffer, TRAIL_COLORS } from './trails.js';
import {
  bodyMassRef,
  positionRef,
  velocityRef,
  visualRef,
} from './bodyBindings.js';
import { MAX_RECORDING_JSON_BYTES, recordingManager } from './recordingManager.js';
import { ambientAudio } from './ambientAudio.js';

function showStartupError(message: string): void {
  document.body.innerHTML = '';
  const pre = document.createElement('pre');
  pre.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:10000',
    'margin:0',
    'padding:1rem',
    'overflow:auto',
    'color:#faa',
    'background:#050508',
    'font:14px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace',
    'white-space:pre-wrap',
  ].join(';');
  pre.textContent = message;
  document.body.appendChild(pre);
}

import simpleVert from '../shader/simple.vert?raw';
import blackholeMainFrag from '../shader/blackhole_main.frag?raw';
import bloomBrightnessFrag from '../shader/bloom_brightness_pass.frag?raw';
import bloomDownFrag from '../shader/bloom_downsample.frag?raw';
import bloomUpFrag from '../shader/bloom_upsample.frag?raw';
import bloomCompositeFrag from '../shader/bloom_composite.frag?raw';
import tonemappingFrag from '../shader/tonemapping.frag?raw';
import passthroughFrag from '../shader/passthrough.frag?raw';
import fxaaFrag from '../shader/fxaa.frag?raw';
import taaBlendFrag from '../shader/taa_blend.frag?raw';

const MAX_BLOOM_ITER = 8;
const MAX_DPR = 2;
const LENS_MASS_REF = 10;

type AntialiasMode = 'off' | 'fxaa' | 'taa';
type GestureMode = 'off' | 'local' | 'server';

interface PipelineAllocResult {
  pipeline: PipelineRTs;
  format: ColorRTFormat;
  effectiveAaMode: AntialiasMode;
}

function bodyKindShaderValue(k: BodyKind): number {
  if (k === 'blackHole') return 0;
  if (k === 'whiteHole') return 1;
  return 2;
}

function parseHexColorRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  if (h.length !== 6) return [0, 0, 0];
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [r, g, b];
}

interface Params {
  antialias: AntialiasMode;
  fxaaQuality: 0 | 1 | 2; // 0=Low, 1=Medium, 2=High
  msaaSamples: 0 | 2 | 4 | 8;
  taaFeedback: number;
  gravatationalLensing: boolean;
  renderBlackHole: boolean;
  mouseControl: boolean;
  gestureMode: 'off' | 'local' | 'server';
  cameraRoll: number;
  frontView: boolean;
  topView: boolean;
  adiskEnabled: boolean;
  adiskParticle: boolean;
  adiskDensityV: number;
  adiskDensityH: number;
  adiskHeight: number;
  adiskLit: number;
  adiskNoiseLOD: number;
  adiskNoiseScale: number;
  adiskSpeed: number;
  // 相对论视觉效应
  dopplerEnabled: boolean;
  dopplerStrength: number;
  dopplerBeta: number;
  beamingEnabled: boolean;
  beamingPower: number;
  spinEnabled: boolean;
  spinA: number;
  bloomIterations: number;
  bloomStrength: number;
  tonemappingEnabled: boolean;
  gamma: number;
}

const params: Params = {
  antialias: 'fxaa',
  fxaaQuality: 2,
  msaaSamples: 4,
  taaFeedback: 8,
  gravatationalLensing: true,
  renderBlackHole: true,
  mouseControl: true,
  gestureMode: 'off',
  cameraRoll: 0,
  frontView: false,
  topView: false,
  adiskEnabled: true,
  adiskParticle: true,
  adiskDensityV: 2,
  adiskDensityH: 4,
  adiskHeight: 0.55,
  adiskLit: 0.25,
  adiskNoiseLOD: 5,
  adiskNoiseScale: 0.8,
  adiskSpeed: 0.5,
  dopplerEnabled: false,
  dopplerStrength: 1.0,
  dopplerBeta: 0.35,
  beamingEnabled: false,
  beamingPower: 3.5,
  spinEnabled: false,
  spinA: 0.7,
  bloomIterations: MAX_BLOOM_ITER,
  bloomStrength: 0.1,
  tonemappingEnabled: true,
  gamma: 2.5,
};

interface PipelineRTs {
  main: ColorRT;
  mainMsaa: MSAART | null;
  mainResolved: ColorRT | null;
  brightness: ColorRT;
  down: ColorRT[];
  up: ColorRT[];
  bloomFinal: ColorRT;
  taaBuffers: [ColorRT, ColorRT] | null;
  tonemapped: ColorRT;
  output: ColorRT;
  width: number;
  height: number;
  format: ColorRTFormat;
}

function destroyPipeline(gl: WebGL2RenderingContext, p: PipelineRTs | null): void {
  if (!p) return;
  destroyColorRT(gl, p.main);
  if (p.mainMsaa) destroyMSAART(gl, p.mainMsaa);
  if (p.mainResolved) destroyColorRT(gl, p.mainResolved);
  destroyColorRT(gl, p.brightness);
  destroyColorRT(gl, p.bloomFinal);
  if (p.taaBuffers) {
    destroyColorRT(gl, p.taaBuffers[0]);
    destroyColorRT(gl, p.taaBuffers[1]);
  }
  destroyColorRT(gl, p.tonemapped);
  destroyColorRT(gl, p.output);
  for (const rt of p.down) destroyColorRT(gl, rt);
  for (const rt of p.up) destroyColorRT(gl, rt);
}

function allocPipeline(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  format: ColorRTFormat,
  aaMode: AntialiasMode,
  msaaSamples: number,
): PipelineRTs {
  const main = createColorRT(gl, width, height, format);
  // createMSAART returns null if MSAA is not supported on this device
  // Note: if it returns null with samples > 1 due to MAX_SAMPLES or texImage2DMultisample
  // issues, retrying with 1 sample will also fail - detect that and skip MSAA entirely
  let mainMsaa = aaMode === 'taa' ? createMSAART(gl, width, height, format, msaaSamples) : null;
  let mainResolved = mainMsaa ? createColorRT(gl, width, height, format) : null;
  // If MSAA returned null but we have samples > 1, it means device can't do MSAA
  // (not just that samples were clamped to 1) - don't retry, just run TAA without MSAA
  const brightness = createColorRT(gl, width, height, format);
  const bloomFinal = createColorRT(gl, width, height, format);
  const tonemapped = createColorRT(gl, width, height, format);
  const output = createColorRT(gl, width, height, format);
  const taaBuffers: [ColorRT, ColorRT] | null = aaMode === 'taa'
    ? [createColorRT(gl, width, height, format), createColorRT(gl, width, height, format)]
    : null;
  const down: ColorRT[] = [];
  const up: ColorRT[] = [];
  for (let i = 0; i < MAX_BLOOM_ITER; i++) {
    const dw = Math.max(1, width >> (i + 1));
    const dh = Math.max(1, height >> (i + 1));
    down.push(createColorRT(gl, dw, dh, format));
    const uw = Math.max(1, width >> i);
    const uh = Math.max(1, height >> i);
    up.push(createColorRT(gl, uw, uh, format));
  }
  return { main, mainMsaa, mainResolved, brightness, down, up, bloomFinal, taaBuffers, tonemapped, output, width, height, format };
}

function tryAllocPipeline(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  aaMode: AntialiasMode,
  msaaSamples: number,
): PipelineAllocResult {
  const preferred = detectRTFormat(gl);
  try {
    return {
      pipeline: allocPipeline(gl, width, height, preferred, aaMode, msaaSamples),
      format: preferred,
      effectiveAaMode: aaMode,
    };
  } catch (e) {
    console.warn('[blackhole-web] Pipeline allocation failed, retrying with fallback:', e);
    // Fallback 1: try with rgba8 format
    if (preferred === 'float16') {
      try {
        return {
          pipeline: allocPipeline(gl, width, height, 'rgba8', aaMode, msaaSamples),
          format: 'rgba8',
          effectiveAaMode: aaMode,
        };
      } catch (e2) {
        console.warn('[blackhole-web] Pipeline allocation with rgba8 also failed:', e2);
      }
    }
    // Fallback 2: if TAA failed with MSAA samples > 1, try TAA with samples clamped to 1
    // But skip this if createMSAART was failing due to missing texImage2DMultisample
    // In that case just fall back to FXAA or off directly
    if (aaMode === 'taa' && msaaSamples > 1) {
      // Check if maxSamples is available - if not, MSAA won't work at any sample count
      const maxSamples = gl.getParameter(gl.MAX_SAMPLES);
      if (maxSamples > 0) {
        try {
          console.warn('[blackhole-web] Retrying TAA with reduced MSAA samples');
          const p = allocPipeline(gl, width, height, 'rgba8', 'taa', 1);
          return { pipeline: p, format: 'rgba8', effectiveAaMode: 'taa' };
        } catch (e3) {
          console.warn('[blackhole-web] TAA with 1 sample also failed:', e3);
        }
      } else {
        console.warn('[blackhole-web] MAX_SAMPLES=0, skipping MSAA retry');
      }
      // Fallback 3: try FXAA as last resort for antialiasing
      try {
        console.warn('[blackhole-web] Trying FXAA as final fallback');
        return {
          pipeline: allocPipeline(gl, width, height, 'rgba8', 'fxaa', 0),
          format: 'rgba8',
          effectiveAaMode: 'fxaa',
        };
      } catch (e4) {
        console.warn('[blackhole-web] FXAA also failed:', e4);
      }
    }
    // If we get here with TAA mode, try FXAA or off as last resort
    if (aaMode === 'taa') {
      try {
        return {
          pipeline: allocPipeline(gl, width, height, 'rgba8', 'fxaa', 0),
          format: 'rgba8',
          effectiveAaMode: 'fxaa',
        };
      } catch (e5) {
        console.warn('[blackhole-web] FXAA also failed:', e5);
      }
      try {
        return {
          pipeline: allocPipeline(gl, width, height, 'rgba8', 'off', 0),
          format: 'rgba8',
          effectiveAaMode: 'off',
        };
      } catch (e6) {
        console.error('[blackhole-web] All fallbacks exhausted:', e6);
      }
    }
    throw new Error('无法创建离屏渲染目标');
  }
}

type UniformMap = Map<string, WebGLUniformLocation | null>;

function ulCache(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  cache: UniformMap,
  name: string,
): WebGLUniformLocation | null {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const loc = gl.getUniformLocation(program, name);
  cache.set(name, loc);
  return loc;
}

function setF(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  cache: UniformMap,
  name: string,
  v: number,
): void {
  gl.useProgram(program);
  const loc = ulCache(gl, program, cache, name);
  if (loc) gl.uniform1f(loc, v);
}

function setV2(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  cache: UniformMap,
  name: string,
  x: number,
  y: number,
): void {
  gl.useProgram(program);
  const loc = ulCache(gl, program, cache, name);
  if (loc) gl.uniform2f(loc, x, y);
}

function setI1(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  cache: UniformMap,
  name: string,
  v: number,
): void {
  gl.useProgram(program);
  const loc = ulCache(gl, program, cache, name);
  if (loc) gl.uniform1i(loc, v);
}

interface Pass {
  program: WebGLProgram;
  uniforms: UniformMap;
}

function makePass(
  gl: WebGL2RenderingContext,
  vert: string,
  frag: string,
): Pass {
  return { program: compileProgram(gl, vert, frag), uniforms: new Map() };
}

function drawPass(
  gl: WebGL2RenderingContext,
  vao: WebGLVertexArrayObject,
  pass: Pass,
  targetFbo: WebGLFramebuffer | null,
  width: number,
  height: number,
  time: number,
  setCustom: () => void,
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo);
  gl.viewport(0, 0, width, height);
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(pass.program);
  setV2(gl, pass.program, pass.uniforms, 'resolution', width, height);
  setF(gl, pass.program, pass.uniforms, 'time', time);
  setCustom();
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.bindVertexArray(null);
  gl.useProgram(null);
}

function setV3(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  cache: UniformMap,
  name: string,
  x: number,
  y: number,
  z: number,
): void {
  gl.useProgram(program);
  const loc = ulCache(gl, program, cache, name);
  if (loc) gl.uniform3f(loc, x, y, z);
}

function bindSceneUniforms(
  gl: WebGL2RenderingContext,
  p: Pass,
  scene: SceneState,
): void {
  setF(gl, p.program, p.uniforms, 'bodyCount', scene.bodyCount);
  for (let i = 0; i < MAX_BODIES; i++) {
    const b = scene.bodies[i]!;
    const active = i < scene.bodyCount;
    const nameC = `bodyCenter[${i}]`;
    const nameL = `bodyLensStrength[${i}]`;
    const nameK = `bodyKind[${i}]`;
    const nameS = `bodySize[${i}]`;
    const nameG = `glowColor[${i}]`;
    const nameGi = `glowIntensity[${i}]`;
    const nameA = `adiskGain[${i}]`;
    if (active) {
      setV3(gl, p.program, p.uniforms, nameC, b.position[0], b.position[1], b.position[2]);
      const lens = b.visual.distortionStrength * (b.mass / LENS_MASS_REF);
      setF(gl, p.program, p.uniforms, nameL, lens);
      setF(gl, p.program, p.uniforms, nameK, bodyKindShaderValue(b.kind));
      setF(gl, p.program, p.uniforms, nameS, b.visual.size);
      const [cr, cg, cb] = parseHexColorRgb(b.visual.glowColor);
      setV3(gl, p.program, p.uniforms, nameG, cr, cg, cb);
      setF(gl, p.program, p.uniforms, nameGi, b.visual.glowIntensity);
      setF(gl, p.program, p.uniforms, nameA, b.visual.adiskIntensity);
    } else {
      setV3(gl, p.program, p.uniforms, nameC, 0, 0, 0);
      setF(gl, p.program, p.uniforms, nameL, 0);
      setF(gl, p.program, p.uniforms, nameK, 0);
      setF(gl, p.program, p.uniforms, nameS, 0.001);
      setV3(gl, p.program, p.uniforms, nameG, 0, 0, 0);
      setF(gl, p.program, p.uniforms, nameGi, 0);
      setF(gl, p.program, p.uniforms, nameA, 0);
    }
  }
  if (scene.bodyCount >= 1) {
    const b0 = scene.bodies[0]!;
    setV3(gl, p.program, p.uniforms, 'adiskOrigin', b0.position[0], b0.position[1], b0.position[2]);
    setF(gl, p.program, p.uniforms, 'adiskDiskSize', b0.visual.size);
    setF(gl, p.program, p.uniforms, 'adiskDiskGain', b0.visual.adiskIntensity);
  } else {
    setV3(gl, p.program, p.uniforms, 'adiskOrigin', 0, 0, 0);
    setF(gl, p.program, p.uniforms, 'adiskDiskSize', 1);
    setF(gl, p.program, p.uniforms, 'adiskDiskGain', 0);
  }
}

function syncUiSceneFromScene(
  uiScene: {
    dynamics: SceneState['dynamics'];
    bodyCount: number;
    gmCentral: number;
    nbodyG: number;
    softening: number;
    dt: number;
    showTrails: boolean;
    timeWarpEnabled: boolean;
    timeWarpIntensity: number;
    timeWarpPotentialScale: number;
    timeWarpDistanceScale: number;
  },
  scene: SceneState,
): void {
  uiScene.bodyCount = scene.bodyCount;
  uiScene.dynamics = scene.dynamics;
  uiScene.gmCentral = scene.gmCentral;
  uiScene.nbodyG = scene.nbodyG;
  uiScene.softening = scene.softening;
  uiScene.dt = scene.dt;
  uiScene.showTrails = scene.showTrails;
  uiScene.timeWarpEnabled = scene.timeWarp.enabled;
  uiScene.timeWarpIntensity = scene.timeWarp.intensity;
  uiScene.timeWarpPotentialScale = scene.timeWarp.potentialScale;
  uiScene.timeWarpDistanceScale = scene.timeWarp.distanceScale;
}

async function main(): Promise<void> {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const trailCanvas = document.getElementById('trail') as HTMLCanvasElement | null;
  const trailCtx = trailCanvas?.getContext('2d');
  const glCtx = canvas.getContext('webgl2', {
    antialias: false,
    depth: false,
    stencil: false,
    alpha: false,
    premultipliedAlpha: false,
  });
  if (!glCtx) {
    const message = '需要支持 WebGL2 的浏览器。请检查浏览器硬件加速、GPU 黑名单、远程/虚拟环境 WebGL 支持，或使用支持 WebGL2 的浏览器。';
    showStartupError(message);
    return;
  }
  const gl: WebGL2RenderingContext = glCtx;

  const scene: SceneState = createDefaultScene();
  let initialSnapshot = cloneSceneState(scene);
  const trails = new TrailBuffer();
  const assetPath = (path: string): string => `${import.meta.env.BASE_URL}${path}`;

  const [galaxy, colorMap, vao, passes] = await Promise.all([
    loadCubemap(gl, assetPath('assets/skybox_nebula_dark')),
    loadTexture2D(gl, assetPath('assets/color_map.png')),
    Promise.resolve(createQuadVAO(gl)),
    Promise.resolve({
      blackhole: makePass(gl, simpleVert, blackholeMainFrag),
      bloomBright: makePass(gl, simpleVert, bloomBrightnessFrag),
      bloomDown: makePass(gl, simpleVert, bloomDownFrag),
      bloomUp: makePass(gl, simpleVert, bloomUpFrag),
      bloomComposite: makePass(gl, simpleVert, bloomCompositeFrag),
      tonemap: makePass(gl, simpleVert, tonemappingFrag),
      fxaa: makePass(gl, simpleVert, fxaaFrag),
      taaBlend: makePass(gl, simpleVert, taaBlendFrag),
      passthrough: makePass(gl, simpleVert, passthroughFrag),
    }),
  ]);

  setI1(gl, passes.passthrough.program, passes.passthrough.uniforms, 'texture0', 0);
  setI1(gl, passes.fxaa.program, passes.fxaa.uniforms, 'texture0', 0);
  setI1(gl, passes.fxaa.program, passes.fxaa.uniforms, 'fxaaQuality', params.fxaaQuality);
  setF(gl, passes.taaBlend.program, passes.taaBlend.uniforms, 'taaFeedback', params.taaFeedback);
  setF(gl, passes.taaBlend.program, passes.taaBlend.uniforms, 'firstFrame', 1.0);

  let mouseX = 0;
  let mouseY = 0;

  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    mouseX = (e.clientX - rect.left) * sx;
    mouseY = (e.clientY - rect.top) * sy;
  });

  let handGestureController: HandGestureController | null = null;
  let serverGestureClient: ServerGestureClient | null = null;
  let handVideo: HTMLVideoElement | null = null;
  let handCanvas: HTMLCanvasElement | null = null;
  let handOverlay: HTMLDivElement | null = null;
  let previousGestureMode: 'off' | 'local' | 'server' = 'off';
  let gestureInitToken = 0;
  let gestureSwitchQueue: Promise<void> = Promise.resolve();

  function cleanupGestureResources(removeDom = true): void {
    if (handGestureController) {
      handGestureController.destroy();
      handGestureController = null;
    }
    if (serverGestureClient) {
      serverGestureClient.destroy();
      serverGestureClient = null;
    }
    if (removeDom) {
      const v = handVideo;
      const c = handCanvas;
      const o = handOverlay;
      handVideo = null;
      handCanvas = null;
      handOverlay = null;
      v?.remove();
      c?.remove();
      o?.remove();
    }
  }

  async function initHandGesture(targetMode: Exclude<GestureMode, 'off'>): Promise<boolean> {
    try {
      handVideo = document.createElement('video');
      handVideo.style.cssText = 'position:fixed;bottom:10px;left:10px;width:160px;height:120px;border:2px solid #00ff00;border-radius:8px;opacity:0.8;z-index:1000;transform:scaleX(-1);';
      handVideo.playsInline = true;
      handVideo.muted = true;
      handVideo.autoplay = true;

      handCanvas = document.createElement('canvas');
      handCanvas.width = 160;
      handCanvas.height = 120;
      handCanvas.style.cssText = 'position:fixed;bottom:135px;left:10px;border:2px solid #00ff00;border-radius:8px;opacity:0.8;z-index:1000;transform:scaleX(-1);';

      handOverlay = document.createElement('div');
      handOverlay.style.cssText = 'position:fixed;bottom:260px;left:10px;padding:8px 12px;background:rgba(0,0,0,0.7);color:#00ff00;border-radius:4px;font-size:12px;font-family:monospace;z-index:1000;';
      handOverlay.textContent = `手势: 正在初始化 (${targetMode === 'server' ? '服务器模式' : '本地模式'})...`;

      document.body.appendChild(handVideo);
      document.body.appendChild(handCanvas);
      document.body.appendChild(handOverlay);

      // 等待DOM完全渲染
      await new Promise(resolve => setTimeout(resolve, 100));

      if (targetMode === 'server') {
        return await initServerGesture();
      } else {
        return await initLocalGesture();
      }
    } catch (error) {
      if (handOverlay?.isConnected) {
        handOverlay.textContent = '手势: 初始化错误';
        handOverlay.style.color = '#ff4444';
      }
      console.error('[blackhole-web] 手势控制初始化错误:', error);
      cleanupGestureResources(false);
      return false;
    }
  }

  async function initLocalGesture(): Promise<boolean> {
    handGestureController = new HandGestureController();
    const success = await handGestureController.initialize(handVideo!, handCanvas!);

    if (success) {
      handGestureController.onGesture((event) => {
        updateGestureOverlay(event);
        
        if (event.type === 'hand_move' || event.type === 'hand_detected') {
          const state = event.gestureState;
          if (state.handDetected && state.isOpenPalm) {
            mouseX = state.palmX * canvas.width;
            mouseY = (1 - state.palmY) * canvas.height;
          }
        }
      });

      handGestureController.setEnabled(true);
      console.log('[blackhole-web] 本地手势控制初始化成功');
      return true;
    } else {
      if (handOverlay?.isConnected) {
        handOverlay.textContent = '手势: 摄像头不可用';
        handOverlay.style.color = '#ff4444';
      }
      console.error('[blackhole-web] 本地手势控制初始化失败');
      handGestureController.destroy();
      handGestureController = null;
      return false;
    }
  }

  async function initServerGesture(): Promise<boolean> {
    console.log('[ServerGesture] window.location.protocol:', window.location.protocol);
    serverGestureClient = new ServerGestureClient();

    const success = await serverGestureClient.initialize(handVideo!, handCanvas!);

    if (success) {
      serverGestureClient.onGesture((event) => {
        updateGestureOverlay(event);
        
        if (event.type === 'hand_move' || event.type === 'hand_detected') {
          const state = event.gestureState;
          if (state.handDetected && state.isOpenPalm) {
            mouseX = state.palmX * canvas.width;
            mouseY = (1 - state.palmY) * canvas.height;
          }
        }
      });

      serverGestureClient.enable();
      if (handOverlay?.isConnected) {
        handOverlay.textContent = '手势: 服务器模式已连接';
      }
      console.log('[blackhole-web] 服务器端手势控制初始化成功');
      return true;
    } else {
      if (handOverlay?.isConnected) {
        handOverlay.textContent = '手势: 初始化失败';
        handOverlay.style.color = '#ff4444';
      }
      console.error('[blackhole-web] 服务器端手势控制初始化失败');
      serverGestureClient.destroy();
      serverGestureClient = null;
      return false;
    }
  }

  function updateGestureOverlay(event: any): void {
    if (!handOverlay) return;
    
    if (event.type === 'hand_detected') {
      handOverlay.textContent = `手势: 检测到手部`;
    } else if (event.type === 'hand_lost') {
      handOverlay.textContent = `手势: 未检测到手`;
    } else if (event.type === 'hand_move') {
      const state = event.gestureState;
      handOverlay.textContent = `手势: 张开手掌 (${state.fingerCount}指) [${(state.palmX * 100).toFixed(0)}%, ${(state.palmY * 100).toFixed(0)}%]`;
    }
  }

  let lastFrameTime = 0;
  const frameInterval = 100;

  async function updateHandGesture(): Promise<void> {
    if (params.gestureMode === 'off') return;

    if (params.gestureMode === 'server') {
      return;
    }

    if (!handGestureController) return;

    const now = performance.now();
    if (now - lastFrameTime < frameInterval) return;
    lastFrameTime = now;

    try {
      await handGestureController.processFrame();
    } catch (err) {
      return;
    }

    const state = handGestureController.getState();

    if (!state.handDetected) {
      if (handOverlay) {
        handOverlay.textContent = `手势: 正在初始化（本地模式）`;
      }
    }
  }

  let pipeline: PipelineRTs | null = null;
  let rtFormat: ColorRTFormat = 'rgba8';
  let lastMsaaSamples = params.msaaSamples;
  let lastAntialiasMode: AntialiasMode = params.antialias;
  let activeAntialiasMode: AntialiasMode = params.antialias;
  let firstFrame = true;
  let taaIdx = 0;
  let rebuildScheduled = false;
  let pendingResizeSource:
    | 'resize-observer'
    | 'gui-antialias'
    | 'gui-msaa'
    | 'startup'
    | null = 'startup';

  function resetTaaHistory(): void {
    firstFrame = true;
    taaIdx = 0;
  }

  function resizeTrailCanvas(): void {
    if (!trailCanvas || !trailCtx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (trailCanvas.width !== w || trailCanvas.height !== h) {
      trailCanvas.width = w;
      trailCanvas.height = h;
    }
    trailCanvas.style.width = `${canvas.clientWidth}px`;
    trailCanvas.style.height = `${canvas.clientHeight}px`;
  }

  function resizeNow(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    const needsMsaaRebuild = pipeline && params.msaaSamples !== lastMsaaSamples;
    const needsAaModeRebuild = pipeline && params.antialias !== lastAntialiasMode;
    if (canvas.width === w && canvas.height === h && pipeline && !needsMsaaRebuild && !needsAaModeRebuild) {
      resizeTrailCanvas();
      return;
    }
    if (needsMsaaRebuild) {
      lastMsaaSamples = params.msaaSamples;
    }
    if (needsAaModeRebuild) {
      lastAntialiasMode = params.antialias;
    }
    canvas.width = w;
    canvas.height = h;
    destroyPipeline(gl, pipeline);
    const r = tryAllocPipeline(gl, w, h, params.antialias, params.msaaSamples);
    pipeline = r.pipeline;
    rtFormat = r.format;
    activeAntialiasMode = r.effectiveAaMode;
    resetTaaHistory();
    resizeTrailCanvas();
    if (rtFormat === 'rgba8') {
      console.warn(
        '[blackhole-web] 使用 RGBA8 离屏目标（无 EXT_color_buffer_float 或 RGBA16F 不完整）。高亮/Bloom 可能被裁切。',
      );
    }
  }

  function scheduleResizeNow(source: 'resize-observer' | 'gui-antialias' | 'gui-msaa' | 'startup'): void {
    pendingResizeSource = source;
    if (rebuildScheduled) return;
    rebuildScheduled = true;
    requestAnimationFrame(() => {
      rebuildScheduled = false;
      if (!pendingResizeSource) return;
      pendingResizeSource = null;
      resizeNow();
    });
  }

  const ro = new ResizeObserver(() => {
    scheduleResizeNow('resize-observer');
  });
  ro.observe(canvas);
  scheduleResizeNow('startup');

  const gui = new GUI({ title: '参数' });

  gui.add(params, 'antialias', {
    '关闭 (Off)': 'off',
    '快速边缘平滑 (FXAA)': 'fxaa',
    '时序抗锯齿 (TAA)': 'taa',
  }).name('抗锯齿').onChange((v: AntialiasMode) => {
    fxaaQualityCtrl.domElement.style.display = v === 'fxaa' ? '' : 'none';
    msaaSamplesCtrl.domElement.style.display = v === 'taa' ? '' : 'none';
    taaFeedbackCtrl.domElement.style.display = v === 'taa' ? '' : 'none';
    scheduleResizeNow('gui-antialias');
  });

  const fxaaQualityCtrl = gui.add(params, 'fxaaQuality', {
    '低 (Low)': 0,
    '中 (Medium)': 1,
    '高 (High)': 2,
  }).name('FXAA质量').onChange(() => {
    if (passes.fxaa) {
      setI1(gl, passes.fxaa.program, passes.fxaa.uniforms, 'fxaaQuality', params.fxaaQuality);
    }
  });

  const msaaSamplesCtrl = gui.add(params, 'msaaSamples', {
    '2x': 2,
    '4x': 4,
    '8x': 8,
  }).name('MSAA采样').onChange(() => {
    scheduleResizeNow('gui-msaa');
  });

  const taaFeedbackCtrl = gui.add(params, 'taaFeedback', 1, 20, 0.5).name('TAA反馈').onChange(() => {
    if (passes.taaBlend) {
      setF(gl, passes.taaBlend.program, passes.taaBlend.uniforms, 'taaFeedback', params.taaFeedback);
    }
  });
  // Set initial visibility based on default antialias mode
  const updateAAUIControls = (mode: AntialiasMode) => {
    fxaaQualityCtrl.domElement.style.display = mode === 'fxaa' ? '' : 'none';
    msaaSamplesCtrl.domElement.style.display = mode === 'taa' ? '' : 'none';
    taaFeedbackCtrl.domElement.style.display = mode === 'taa' ? '' : 'none';
  };
  updateAAUIControls(params.antialias);

  const bodyFolders: GUI[] = [];
  function syncBodyFolders(): void {
    for (let i = 0; i < MAX_BODIES; i++) {
      const f = bodyFolders[i];
      if (f) f.domElement.style.display = i < scene.bodyCount ? '' : 'none';
    }
  }

  const uiScene = {
    dynamics: scene.dynamics,
    bodyCount: scene.bodyCount,
    gmCentral: scene.gmCentral,
    nbodyG: scene.nbodyG,
    softening: scene.softening,
    dt: scene.dt,
    showTrails: scene.showTrails,
    presetName: '单天体' as keyof typeof SCENE_PRESETS,
    // 时间缩放参数
    timeWarpEnabled: scene.timeWarp.enabled,
    timeWarpIntensity: scene.timeWarp.intensity,
    timeWarpPotentialScale: scene.timeWarp.potentialScale,
    timeWarpDistanceScale: scene.timeWarp.distanceScale,
  };

  const sceneFolder = gui.addFolder('场景');
  sceneFolder
    .add(uiScene, 'dynamics', { 静态: 'static', 开普勒: 'kepler', N体: 'nbody' })
    .name('动力学')
    .onChange((v: SceneState['dynamics']) => {
      scene.dynamics = v;
    });
  sceneFolder
    .add(uiScene, 'bodyCount', 1, MAX_BODIES, 1)
    .name('天体数量')
    .onChange((v: number) => {
      scene.bodyCount = Math.round(v);
      uiScene.bodyCount = scene.bodyCount;
      syncBodyFolders();
    });
  sceneFolder
    .add(uiScene, 'gmCentral', 1, 500)
    .name('中心GM(开普勒)')
    .onChange((v: number) => {
      scene.gmCentral = v;
    });
  sceneFolder
    .add(uiScene, 'nbodyG', 0.1, 20)
    .name('G(N体)')
    .onChange((v: number) => {
      scene.nbodyG = v;
    });
  sceneFolder
    .add(uiScene, 'softening', 0.01, 2)
    .name('软化')
    .onChange((v: number) => {
      scene.softening = v;
    });
  sceneFolder
    .add(uiScene, 'dt', 0.001, 0.1, 0.001)
    .name('步长')
    .onChange((v: number) => {
      scene.dt = v;
    });
  sceneFolder
    .add(uiScene, 'showTrails')
    .name('轨迹')
    .onChange((v: boolean) => {
      scene.showTrails = v;
    });

  // 局部时间缩放控制
  const timeWarpFolder = sceneFolder.addFolder('时间缩放(仿真效果)');
  timeWarpFolder
    .add(uiScene, 'timeWarpEnabled')
    .name('启用')
    .onChange((v: boolean) => {
      scene.timeWarp.enabled = v;
    });
  timeWarpFolder
    .add(uiScene, 'timeWarpIntensity', 0, 1, 0.01)
    .name('强度')
    .onChange((v: number) => {
      scene.timeWarp.intensity = v;
    });
  timeWarpFolder
    .add(uiScene, 'timeWarpPotentialScale', 0.1, 5, 0.1)
    .name('势阱强度')
    .onChange((v: number) => {
      scene.timeWarp.potentialScale = v;
    });
  timeWarpFolder
    .add(uiScene, 'timeWarpDistanceScale', 0.5, 20, 0.5)
    .name('距离参考')
    .onChange((v: number) => {
      scene.timeWarp.distanceScale = v;
    });

  function loadPreset(name: keyof typeof SCENE_PRESETS): void {
    const snap = SCENE_PRESETS[name];
    if (!snap) return;
    applySceneState(scene, cloneSceneState(snap));
    initialSnapshot = cloneSceneState(scene);
    syncUiSceneFromScene(uiScene, scene);
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    syncBodyFolders();
    trails.reset();
  }

  sceneFolder
    .add(uiScene, 'presetName', Object.keys(SCENE_PRESETS) as (keyof typeof SCENE_PRESETS)[])
    .name('预设')
    .onChange((name: keyof typeof SCENE_PRESETS) => {
      loadPreset(name);
    });
  sceneFolder.add(
    {
      reset() {
        applySceneState(scene, cloneSceneState(initialSnapshot));
        syncUiSceneFromScene(uiScene, scene);
        gui.controllersRecursive().forEach((c) => c.updateDisplay());
        syncBodyFolders();
        trails.reset();
      },
    },
    'reset',
  ).name('重置');

  const kindOptions = { 黑洞: 'blackHole', 白洞: 'whiteHole', 中子星: 'neutronStar' } as const;

  for (let bi = 0; bi < MAX_BODIES; bi++) {
    const bf = gui.addFolder(`天体 ${bi}`);
    bodyFolders.push(bf);
    bf.add(positionRef(scene, bi), 'x', -40, 40, 0.05).name('px');
    bf.add(positionRef(scene, bi), 'y', -40, 40, 0.05).name('py');
    bf.add(positionRef(scene, bi), 'z', -40, 40, 0.05).name('pz');
    bf.add(velocityRef(scene, bi), 'x', -20, 20, 0.02).name('vx');
    bf.add(velocityRef(scene, bi), 'y', -20, 20, 0.02).name('vy');
    bf.add(velocityRef(scene, bi), 'z', -20, 20, 0.02).name('vz');
    bf.add(bodyMassRef(scene, bi), 'mass', 0.01, 80, 0.01).name('质量');
    bf.add(scene.bodies[bi]!, 'kind', kindOptions).name('类型');
    bf.addColor(scene.bodies[bi]!.visual, 'glowColor').name('发光色');
    bf.add(visualRef(scene, bi), 'size', 0.05, 4, 0.01).name('尺寸');
    bf.add(visualRef(scene, bi), 'glowIntensity', 0, 8, 0.05).name('发光强度');
    bf.add(visualRef(scene, bi), 'adiskIntensity', 0, 3, 0.01).name('吸积盘');
    bf.add(visualRef(scene, bi), 'distortionStrength', 0, 3, 0.01).name('畸变');
  }

  syncBodyFolders();

  gui.add(params, 'gravatationalLensing');
  gui.add(params, 'renderBlackHole');
  gui.add(params, 'mouseControl');
  gui.add(params, 'gestureMode', {
    '关闭': 'off',
    '本地计算': 'local',
    '服务器计算': 'server',
  }).name('手势识别').onChange(() => {
    const modeSwitchToken = ++gestureInitToken;
    gestureSwitchQueue = gestureSwitchQueue
      .then(async () => {
        if (modeSwitchToken !== gestureInitToken) return;
        const targetMode = params.gestureMode;
        if (targetMode === previousGestureMode && targetMode !== 'off') return;

        if (targetMode === 'off') {
          cleanupGestureResources(true);
          previousGestureMode = 'off';
          return;
        }

        cleanupGestureResources(true);
        const success = await initHandGesture(targetMode);
        const isStaleSwitch = modeSwitchToken !== gestureInitToken || params.gestureMode !== targetMode;
        if (isStaleSwitch) {
          cleanupGestureResources(true);
          return;
        }

        if (!success) {
          cleanupGestureResources(true);
          previousGestureMode = 'off';
          return;
        }

        previousGestureMode = targetMode;
        if (targetMode === 'server' && serverGestureClient) {
          serverGestureClient.enable();
        } else if (targetMode === 'local' && handGestureController) {
          handGestureController.setEnabled(true);
        }
      })
      .catch((error) => {
        console.error('[blackhole-web] 手势模式切换错误:', error);
      });
  });
  gui.add(params, 'cameraRoll', -180, 180);
  gui.add(params, 'frontView');
  gui.add(params, 'topView');
  gui.add(params, 'adiskEnabled');
  gui.add(params, 'adiskParticle');
  gui.add(params, 'adiskDensityV', 0, 10);
  gui.add(params, 'adiskDensityH', 0, 10);
  gui.add(params, 'adiskHeight', 0, 1);
  gui.add(params, 'adiskLit', 0, 4);
  gui.add(params, 'adiskNoiseLOD', 1, 12, 1);
  gui.add(params, 'adiskNoiseScale', 0, 10);
  gui.add(params, 'adiskSpeed', 0, 1);

  // === 相对论视觉效应 ===
  const relativisticFolder = gui.addFolder('相对论视觉效应');
  relativisticFolder.add(params, 'dopplerEnabled').name('多普勒色偏 启用');
  relativisticFolder.add(params, 'dopplerStrength', 0, 2, 0.01).name('色偏强度');
  relativisticFolder.add(params, 'dopplerBeta', 0, 0.5, 0.01).name('盘速度 β=v/c');
  relativisticFolder.add(params, 'beamingEnabled').name('束宽增强 启用');
  relativisticFolder.add(params, 'beamingPower', 1, 6, 0.1).name('聚束指数');
  relativisticFolder.add(params, 'spinEnabled').name('黑洞自旋 启用');
  relativisticFolder.add(params, 'spinA', 0, 0.998, 0.001).name('自旋参数 a');

  gui.add(params, 'bloomIterations', 1, MAX_BLOOM_ITER, 1);
  gui.add(params, 'bloomStrength', 0, 1);
  gui.add(params, 'tonemappingEnabled');
  gui.add(params, 'gamma', 1, 4);

  // 录制/回放控制
  const recordingFolder = gui.addFolder('录制/回放');
  const recordingState = {
    status: '就绪',
    frameCount: 0,
    playbackProgress: 0,
  };

  recordingFolder
    .add(
      {
        startRecording() {
          recordingManager.startRecording();
          recordingState.status = '录制中...';
          recordingState.frameCount = 0;
        },
      },
      'startRecording',
    )
    .name('开始录制');

  recordingFolder
    .add(
      {
        stopRecording() {
          recordingManager.stopRecording();
          recordingState.frameCount = recordingManager.frames.length;
          recordingState.status = `已停止 (${recordingState.frameCount}帧)`;
        },
      },
      'stopRecording',
    )
    .name('停止录制');

  recordingFolder
    .add(
      {
        startPlayback() {
          if (recordingManager.frames.length > 0) {
            // 重置到初始快照
            applySceneState(scene, cloneSceneState(initialSnapshot));
            trails.reset();
          }
          recordingState.status = recordingManager.startPlayback()
            ? '回放中...'
            : '没有录制数据';
        },
      },
      'startPlayback',
    )
    .name('开始回放');

  recordingFolder
    .add(
      {
        stopPlayback() {
          recordingManager.stopPlayback();
          recordingState.status = '回放已停止';
        },
      },
      'stopPlayback',
    )
    .name('停止回放');

  recordingFolder
    .add(recordingState, 'playbackProgress', 0, 1, 0.01)
    .name('进度')
    .listen()
    .onChange((v: number) => {
      recordingManager.setPlaybackProgress(v);
    });

  recordingFolder
    .add(
      {
        exportJSON() {
          const json = recordingManager.exportJSON();
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `recording-${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(url);
          recordingState.status = '已导出JSON';
        },
      },
      'exportJSON',
    )
    .name('导出JSON');

  recordingFolder
    .add(
      {
        importJSON() {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.json';
          input.onchange = (e: Event) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            if (file.size > MAX_RECORDING_JSON_BYTES) {
              recordingState.status = '导入失败：文件过大';
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              try {
                const imported =
                  typeof reader.result === 'string' && recordingManager.importJSON(reader.result);
                recordingState.frameCount = recordingManager.frames.length;
                recordingState.status = imported ? `已导入 (${recordingState.frameCount}帧)` : '导入失败';
              } catch (err) {
                recordingState.status = '导入失败';
                console.error(err);
              }
            };
            reader.readAsText(file);
          };
          input.click();
        },
      },
      'importJSON',
    )
    .name('导入JSON');

  recordingFolder
    .add(
      {
        saveToLocalStorage() {
          recordingState.status = recordingManager.saveToLocalStorage('recording')
            ? '已保存到本地存储'
            : '保存失败';
        },
      },
      'saveToLocalStorage',
    )
    .name('保存到本地');

  recordingFolder
    .add(
      {
        loadFromLocalStorage() {
          const loaded = recordingManager.loadFromLocalStorage('recording');
          recordingState.frameCount = recordingManager.frames.length;
          recordingState.status = loaded ? `已加载 (${recordingState.frameCount}帧)` : '加载失败';
        },
      },
      'loadFromLocalStorage',
    )
    .name('从本地加载');

  // 状态显示（必须 listen 才会随对象变化刷新）
  recordingFolder.add(recordingState, 'status').name('状态').listen();
  recordingFolder.add(recordingState, 'frameCount').name('帧数').listen();

  // 氛围音频控制
  const audioFolder = gui.addFolder('氛围音频');
  const audioState = {
    enabled: false,
    volume: 0.5,
  };
  audioFolder
    .add(audioState, 'enabled')
    .name('启用')
    .onChange(async (v: boolean) => {
      await ambientAudio.toggle(v);
      audioState.enabled = ambientAudio.isEnabled();
    });
  audioFolder
    .add(audioState, 'volume', 0, 1, 0.01)
    .name('音量')
    .onChange((v: number) => {
      ambientAudio.setVolume(v);
    });

  function drawTrails(time: number, cameraPosOverride?: [number, number, number]): void {
    if (!trailCanvas || !trailCtx) return;
    const w = trailCanvas.width;
    const h = trailCanvas.height;
    trailCtx.clearRect(0, 0, w, h);
    if (!scene.showTrails) return;

    const cam = getCameraLookBasis(
      time,
      mouseX,
      mouseY,
      w,
      h,
      params.mouseControl,
      params.frontView,
      params.topView,
      params.cameraRoll,
      cameraPosOverride,
    );

    for (let bi = 0; bi < scene.bodyCount; bi++) {
      const b = scene.bodies[bi]!;
      trailCtx.strokeStyle = TRAIL_COLORS[bi] ?? 'rgba(255,255,255,0.6)';
      trailCtx.lineWidth = 1.5;
      trailCtx.beginPath();
      let first = true;
      trails.iterateOrdered(bi, (x, y, z) => {
        const p = worldToScreenPx([x, y, z], cam, 1, w, h);
        if (!p) return;
        if (first) {
          trailCtx.moveTo(p.x, p.y);
          first = false;
        } else {
          trailCtx.lineTo(p.x, p.y);
        }
      });
      trailCtx.stroke();

      const cur = worldToScreenPx(b.position, cam, 1, w, h);
      if (cur) {
        trailCtx.fillStyle = TRAIL_COLORS[bi] ?? '#fff';
        trailCtx.beginPath();
        trailCtx.arc(cur.x, cur.y, 3, 0, Math.PI * 2);
        trailCtx.fill();
      }
    }
  }

  async function frame(now: number): Promise<void> {
    try {
      const time = now / 1000;
      if (!pipeline) return;

      const playbackFrame = recordingManager.getPlaybackFrame();
      if (playbackFrame) {
        Object.assign(params, {
          cameraRoll: playbackFrame.camera.roll,
          mouseControl: playbackFrame.camera.mouseControl,
          frontView: playbackFrame.camera.frontView,
          topView: playbackFrame.camera.topView,
        });
        mouseX = playbackFrame.camera.mouseX ?? 0;
        mouseY = playbackFrame.camera.mouseY ?? 0;
        applySceneState(scene, playbackFrame.scene);
        syncUiSceneFromScene(uiScene, scene);
        syncBodyFolders();
        Object.assign(params, playbackFrame.render);
        gui.controllersRecursive().forEach((c) => c.updateDisplay());
      } else {
        await updateHandGesture();
        stepScene(scene);
      }

      const cam = getCameraLookBasis(
        time,
        mouseX,
        mouseY,
        canvas.width,
        canvas.height,
        params.mouseControl,
        params.frontView,
        params.topView,
        params.cameraRoll,
        playbackFrame?.camera.position,
      );
      recordingManager.recordFrame(
        time,
        cam.cameraPos,
        params.cameraRoll,
        params.mouseControl,
        params.frontView,
        params.topView,
        mouseX,
        mouseY,
        scene,
        params,
      );

      // 每帧同步录制 UI 状态
      const recStatus = recordingManager.getStatus();
      recordingState.frameCount = recStatus.frameCount;
      recordingState.playbackProgress = recStatus.playbackProgress;
      if (recStatus.isRecording) {
        recordingState.status = `录制中... ${recStatus.frameCount}帧 / ${recStatus.duration.toFixed(1)}s`;
      } else if (recStatus.isPlayback) {
        recordingState.status = `回放中... ${(recStatus.playbackProgress * 100).toFixed(0)}%`;
      }

      ambientAudio.update(scene);

      if (scene.showTrails) {
        for (let bi = 0; bi < scene.bodyCount; bi++) {
          const b = scene.bodies[bi]!;
          trails.push(bi, b.position[0], b.position[1], b.position[2]);
        }
      }

      const { width: rw, height: rh, main, mainMsaa, mainResolved, brightness, down, up, bloomFinal, taaBuffers, tonemapped, output } =
        pipeline;
      const n = params.bloomIterations;
      const aaMode = activeAntialiasMode;

      const sceneTargetFbo = mainMsaa ? mainMsaa.fbo : main.fbo;
      drawPass(gl, vao, passes.blackhole, sceneTargetFbo, rw, rh, time, () => {
        const p = passes.blackhole;
        setF(gl, p.program, p.uniforms, 'mouseX', mouseX);
        setF(gl, p.program, p.uniforms, 'mouseY', mouseY);
        setI1(gl, p.program, p.uniforms, 'colorMap', 0);
        setI1(gl, p.program, p.uniforms, 'galaxy', 1);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, colorMap);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, galaxy);

        setF(gl, p.program, p.uniforms, 'fovScale', 1);
        setF(gl, p.program, p.uniforms, 'gravatationalLensing', params.gravatationalLensing ? 1 : 0);
        setF(gl, p.program, p.uniforms, 'renderBlackHole', params.renderBlackHole ? 1 : 0);
        setF(gl, p.program, p.uniforms, 'mouseControl', params.mouseControl ? 1 : 0);
        setF(gl, p.program, p.uniforms, 'cameraRoll', params.cameraRoll);
        setF(gl, p.program, p.uniforms, 'frontView', params.frontView ? 1 : 0);
        setF(gl, p.program, p.uniforms, 'topView', params.topView ? 1 : 0);
        setF(gl, p.program, p.uniforms, 'playbackCamera', playbackFrame ? 1 : 0);
        setV3(
          gl,
          p.program,
          p.uniforms,
          'playbackCameraPos',
          playbackFrame?.camera.position[0] ?? 0,
          playbackFrame?.camera.position[1] ?? 0,
          playbackFrame?.camera.position[2] ?? 0,
        );
        setF(gl, p.program, p.uniforms, 'adiskEnabled', params.adiskEnabled ? 1 : 0);
        setF(gl, p.program, p.uniforms, 'adiskParticle', params.adiskParticle ? 1 : 0);
        setF(gl, p.program, p.uniforms, 'adiskDensityV', params.adiskDensityV);
        setF(gl, p.program, p.uniforms, 'adiskDensityH', params.adiskDensityH);
        setF(gl, p.program, p.uniforms, 'adiskHeight', params.adiskHeight);
        setF(gl, p.program, p.uniforms, 'adiskLit', params.adiskLit);
        setF(gl, p.program, p.uniforms, 'adiskNoiseLOD', params.adiskNoiseLOD);
        setF(gl, p.program, p.uniforms, 'adiskNoiseScale', params.adiskNoiseScale);

        // 相对论视觉效应 uniforms
        setF(gl, p.program, p.uniforms, 'dopplerEnabled', params.dopplerEnabled ? 1 : 0);
        setF(gl, p.program, p.uniforms, 'dopplerStrength', params.dopplerStrength);
        setF(gl, p.program, p.uniforms, 'dopplerBeta', params.dopplerBeta);
        setF(gl, p.program, p.uniforms, 'beamingEnabled', params.beamingEnabled ? 1 : 0);
        setF(gl, p.program, p.uniforms, 'beamingPower', params.beamingPower);
        setF(gl, p.program, p.uniforms, 'spinEnabled', params.spinEnabled ? 1 : 0);
        setF(gl, p.program, p.uniforms, 'spinA', params.spinA);
        let effectiveAdiskSpeed = params.adiskSpeed;
        if (scene.timeWarp.enabled && scene.bodyCount >= 1) {
          const b0 = scene.bodies[0]!;
          const refDist = b0.visual.size * 2;
          const refPos: [number, number, number] = [b0.position[0] + refDist, b0.position[1], b0.position[2]];
          const centralPotentialSource = scene.dynamics === 'kepler' ? scene.gmCentral : b0.mass;
          const timeWarpFactor = calculateTimeWarp(refPos, b0.position, centralPotentialSource, scene);
          effectiveAdiskSpeed *= timeWarpFactor;
        }
        setF(gl, p.program, p.uniforms, 'adiskSpeed', effectiveAdiskSpeed);

        bindSceneUniforms(gl, p, scene);
      });

      let sceneTex = (() => {
      if (mainMsaa && mainResolved) {
        resolveMSAA(gl, mainMsaa, mainResolved, rw, rh);
        return mainResolved.texture;
      }
      return main.texture;
      })();

      if (aaMode === 'taa' && taaBuffers) {
        const readIdx = taaIdx % 2;
        const writeIdx = 1 - readIdx;
        if (firstFrame) {
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, mainMsaa ? mainResolved!.fbo : main.fbo);
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, taaBuffers[0].fbo);
          gl.blitFramebuffer(0, 0, rw, rh, 0, 0, rw, rh, gl.COLOR_BUFFER_BIT, gl.LINEAR);
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, mainMsaa ? mainResolved!.fbo : main.fbo);
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, taaBuffers[1].fbo);
          gl.blitFramebuffer(0, 0, rw, rh, 0, 0, rw, rh, gl.COLOR_BUFFER_BIT, gl.LINEAR);
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
          taaIdx = 1;
        } else {
          drawPass(gl, vao, passes.taaBlend, taaBuffers[writeIdx].fbo, rw, rh, time, () => {
            const p = passes.taaBlend;
            setI1(gl, p.program, p.uniforms, 'texture0', 0);
            setI1(gl, p.program, p.uniforms, 'texture1', 1);
            setF(gl, p.program, p.uniforms, 'firstFrame', 0.0);
            setF(gl, p.program, p.uniforms, 'taaFeedback', params.taaFeedback);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, sceneTex);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, taaBuffers[readIdx].texture);
          });
          taaIdx++;
        }
        sceneTex = taaBuffers[firstFrame ? 0 : ((taaIdx - 1) % 2)].texture;
      }
    drawPass(gl, vao, passes.bloomBright, brightness.fbo, rw, rh, time, () => {
      const p = passes.bloomBright;
      setI1(gl, p.program, p.uniforms, 'texture0', 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    });

    for (let level = 0; level < n; level++) {
      const tw = Math.max(1, rw >> (level + 1));
      const th = Math.max(1, rh >> (level + 1));
      const srcTex = level === 0 ? brightness.texture : down[level - 1].texture;
      drawPass(gl, vao, passes.bloomDown, down[level].fbo, tw, th, time, () => {
        const p = passes.bloomDown;
        setI1(gl, p.program, p.uniforms, 'texture0', 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, srcTex);
      });
    }

    for (let level = n - 1; level >= 0; level--) {
      const tw = Math.max(1, rw >> level);
      const th = Math.max(1, rh >> level);
      const tex0 =
        level === n - 1 ? down[level].texture : up[level + 1].texture;
      const tex1 = level === 0 ? brightness.texture : down[level - 1].texture;
      drawPass(gl, vao, passes.bloomUp, up[level].fbo, tw, th, time, () => {
        const p = passes.bloomUp;
        setI1(gl, p.program, p.uniforms, 'texture0', 0);
        setI1(gl, p.program, p.uniforms, 'texture1', 1);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, tex1);
      });
    }

    drawPass(gl, vao, passes.bloomComposite, bloomFinal.fbo, rw, rh, time, () => {
      const p = passes.bloomComposite;
      setI1(gl, p.program, p.uniforms, 'texture0', 0);
      setI1(gl, p.program, p.uniforms, 'texture1', 1);
      setF(gl, p.program, p.uniforms, 'tone', 1);
      setF(gl, p.program, p.uniforms, 'bloomStrength', params.bloomStrength);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, up[0].texture);
    });

    drawPass(gl, vao, passes.tonemap, tonemapped.fbo, rw, rh, time, () => {
      const p = passes.tonemap;
      setI1(gl, p.program, p.uniforms, 'texture0', 0);
      setF(gl, p.program, p.uniforms, 'gamma', params.gamma);
      setF(gl, p.program, p.uniforms, 'tonemappingEnabled', params.tonemappingEnabled ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, bloomFinal.texture);
    });

    const aaInputTex = tonemapped.texture;
    if (aaMode === 'fxaa') {
      drawPass(gl, vao, passes.fxaa, output.fbo, rw, rh, time, () => {
        setI1(gl, passes.fxaa.program, passes.fxaa.uniforms, 'texture0', 0);
        setI1(gl, passes.fxaa.program, passes.fxaa.uniforms, 'fxaaQuality', params.fxaaQuality);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, aaInputTex);
      });
    } else {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, tonemapped.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, output.fbo);
      gl.blitFramebuffer(0, 0, rw, rh, 0, 0, rw, rh, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    drawPass(gl, vao, passes.passthrough, null, canvas.width, canvas.height, time, () => {
      setI1(gl, passes.passthrough.program, passes.passthrough.uniforms, 'texture0', 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, output.texture);
    });

    drawTrails(time, playbackFrame?.camera.position);
    firstFrame = false;
    } finally {
      requestAnimationFrame(frame);
    }
  }

  requestAnimationFrame(frame);
}

main().catch((e) => {
  console.error(e);
  showStartupError(String(e));
});
