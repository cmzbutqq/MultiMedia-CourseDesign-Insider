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
import { listSkyboxSources, loadSkyboxAsset, loadTexture2D } from './resources.js';
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
  getBodySurfaceRadius,
  normalizeSceneForNBody,
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
import upscaleFrag from '../shader/upscale.frag?raw';
import fsr1EasuFrag from '../shader/fsr1_easu.frag?raw';
import fsr1RcasFrag from '../shader/fsr1_rcas.frag?raw';
import fxaaFrag from '../shader/fxaa.frag?raw';
import taaBlendFrag from '../shader/taa_blend.frag?raw';

const MAX_BLOOM_ITER = 8;
const MAX_DPR = 2;
const LENS_MASS_REF = 10;
const DEFAULT_CAMERA_DISTANCE = 15;
const MIN_CAMERA_DISTANCE = 0.2;
const MAX_CAMERA_DISTANCE = 50;
const DEFAULT_CAMERA_FOV_DEG = 100;
const MIN_CAMERA_FOV_DEG = 15;
const MAX_CAMERA_FOV_DEG = 140;
const TRACE_FIXED_STEP_SIZE = 0.1;
const TRACE_STOP_DISTANCE_MIN = TRACE_FIXED_STEP_SIZE * 2;
const DISTANCE_WHEEL_SENSITIVITY = 0.0015;
const ORBIT_YAW_RANGE = Math.PI * 2.0;
const ORBIT_PITCH_RANGE = Math.PI * 0.75;
const ORBIT_PITCH_MIN = -ORBIT_PITCH_RANGE * 0.5;
const ORBIT_PITCH_MAX = ORBIT_PITCH_RANGE * 0.5;
const MIN_RENDER_SCALE = 0.35;
const MAX_RENDER_SCALE = 1.5;
const DEFAULT_FRAME_RATE_LIMIT = 60;
const MAX_FRAME_RATE_LIMIT = 240;

type AntialiasMode = 'off' | 'fxaa' | 'taa';
type GestureMode = 'off' | 'local' | 'server';
type UpscaleMode = 'bicubic' | 'lanczos' | 'fsr1';
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
  cameraDistance: number;
  cameraFovDeg: number;
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
  renderScale: number;
  upscaleMode: UpscaleMode;
  fsrSharpness: number;
  frameRateLimit: number;
  skyboxPreset: string;
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
  cameraDistance: DEFAULT_CAMERA_DISTANCE,
  cameraFovDeg: DEFAULT_CAMERA_FOV_DEG,
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
  dopplerEnabled: true,
  dopplerStrength: 1.0,
  dopplerBeta: 0.35,
  beamingEnabled: true,
  beamingPower: 3.5,
  spinEnabled: false,
  spinA: 0.7,
  bloomIterations: MAX_BLOOM_ITER,
  bloomStrength: 0.1,
  tonemappingEnabled: true,
  gamma: 2.5,
  renderScale: 0.6,
  upscaleMode: 'fsr1',
  fsrSharpness: 0.2,
  frameRateLimit: DEFAULT_FRAME_RATE_LIMIT,
  skyboxPreset: 'skybox_nebula_dark',
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
  fsrEasu: ColorRT;
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
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
  destroyColorRT(gl, p.fsrEasu);
  for (const rt of p.down) destroyColorRT(gl, rt);
  for (const rt of p.up) destroyColorRT(gl, rt);
}

function allocPipeline(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  displayWidth: number,
  displayHeight: number,
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
  const fsrEasu = createColorRT(gl, displayWidth, displayHeight, format);
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
  return {
    main,
    mainMsaa,
    mainResolved,
    brightness,
    down,
    up,
    bloomFinal,
    taaBuffers,
    tonemapped,
    output,
    fsrEasu,
    width,
    height,
    displayWidth,
    displayHeight,
    format,
  };
}

function tryAllocPipeline(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  displayWidth: number,
  displayHeight: number,
  aaMode: AntialiasMode,
  msaaSamples: number,
): PipelineAllocResult {
  const preferred = detectRTFormat(gl);
  try {
    return {
      pipeline: allocPipeline(gl, width, height, displayWidth, displayHeight, preferred, aaMode, msaaSamples),
      format: preferred,
      effectiveAaMode: aaMode,
    };
  } catch (e) {
    console.warn('[blackhole-web] Pipeline allocation failed, retrying with fallback:', e);
    // Fallback 1: try with rgba8 format
    if (preferred === 'float16') {
      try {
        return {
          pipeline: allocPipeline(gl, width, height, displayWidth, displayHeight, 'rgba8', aaMode, msaaSamples),
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
          const p = allocPipeline(gl, width, height, displayWidth, displayHeight, 'rgba8', 'taa', 1);
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
          pipeline: allocPipeline(gl, width, height, displayWidth, displayHeight, 'rgba8', 'fxaa', 0),
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
          pipeline: allocPipeline(gl, width, height, displayWidth, displayHeight, 'rgba8', 'fxaa', 0),
          format: 'rgba8',
          effectiveAaMode: 'fxaa',
        };
      } catch (e5) {
        console.warn('[blackhole-web] FXAA also failed:', e5);
      }
      try {
        return {
          pipeline: allocPipeline(gl, width, height, displayWidth, displayHeight, 'rgba8', 'off', 0),
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
    const nameSr = `bodySurfaceRadius[${i}]`;
    const nameG = `glowColor[${i}]`;
    const nameGi = `glowIntensity[${i}]`;
    const nameA = `adiskGain[${i}]`;
    if (active) {
      setV3(gl, p.program, p.uniforms, nameC, b.position[0], b.position[1], b.position[2]);
      const lens = b.visual.distortionStrength * (b.mass / LENS_MASS_REF);
      setF(gl, p.program, p.uniforms, nameL, lens);
      setF(gl, p.program, p.uniforms, nameK, bodyKindShaderValue(b.kind));
      setF(gl, p.program, p.uniforms, nameS, b.visual.size);
      setF(gl, p.program, p.uniforms, nameSr, getBodySurfaceRadius(b));
      const [cr, cg, cb] = parseHexColorRgb(b.visual.glowColor);
      setV3(gl, p.program, p.uniforms, nameG, cr, cg, cb);
      setF(gl, p.program, p.uniforms, nameGi, b.visual.glowIntensity);
      setF(gl, p.program, p.uniforms, nameA, b.visual.adiskIntensity);
    } else {
      setV3(gl, p.program, p.uniforms, nameC, 0, 0, 0);
      setF(gl, p.program, p.uniforms, nameL, 0);
      setF(gl, p.program, p.uniforms, nameK, 0);
      setF(gl, p.program, p.uniforms, nameS, 0.001);
      setF(gl, p.program, p.uniforms, nameSr, 0.001);
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

type GuiDomTarget = {
  domElement: HTMLElement;
};

function setGuiVisible(target: GuiDomTarget, visible: boolean): void {
  target.domElement.style.display = visible ? '' : 'none';
}

function addGuiClass(target: GuiDomTarget, className: string): void {
  target.domElement.classList.add(className);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function wrapUnitInterval(value: number): number {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

function formatSkyboxLabel(id: string, kind: 'cubemap' | 'panorama'): string {
  const words = id
    .replace(/^skybox_/, '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));
  const name = words.length > 0 ? words.join(' ') : id;
  return `${name} (${kind === 'cubemap' ? 'Cubemap' : 'Panorama'})`;
}

function deriveNBodyGFromCentralMu(gmCentral: number, centralMass: number): number {
  return clampNumber(gmCentral / Math.max(centralMass, 1e-6), 0.1, 20);
}

function deriveCentralMuFromNBodyG(nbodyG: number, centralMass: number): number {
  return clampNumber(nbodyG * Math.max(centralMass, 1e-6), 1, 500);
}

function adaptSceneForDynamicsSwitch(scene: SceneState, previous: SceneState['dynamics'], next: SceneState['dynamics']): void {
  if (previous === next) return;

  if (next === 'nbody') {
    if (previous === 'kepler') {
      scene.nbodyG = deriveNBodyGFromCentralMu(scene.gmCentral, scene.bodies[0]!.mass);
    }
    normalizeSceneForNBody(scene);
    return;
  }

  if (previous === 'nbody' && next === 'kepler') {
    scene.gmCentral = deriveCentralMuFromNBodyG(scene.nbodyG, scene.bodies[0]!.mass);
    scene.bodies[0]!.velocity[0] = 0;
    scene.bodies[0]!.velocity[1] = 0;
    scene.bodies[0]!.velocity[2] = 0;
  }
}

function installGuiStyles(): void {
  if (document.getElementById('blackhole-gui-styles')) return;

  const style = document.createElement('style');
  style.id = 'blackhole-gui-styles';
  style.textContent = `
    .lil-gui.root.blackhole-gui {
      --width: min(408px, calc(100vw - 24px));
      --name-width: 43%;
      --input-width: 57%;
      --background-color: rgba(8, 12, 18, 0.88);
      --title-background-color: rgba(16, 23, 35, 0.96);
      --text-color: #dbe9ff;
      --widget-color: #3ac7ff;
      --focus-color: #8ee6ff;
      --number-color: #91d8ff;
      --string-color: #dbe9ff;
      top: 12px;
      right: 12px;
      max-height: calc(100vh - 24px);
      overflow: hidden;
      border: 1px solid rgba(138, 196, 255, 0.18);
      border-radius: 16px;
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.42);
      backdrop-filter: blur(14px);
      font-size: 13px;
    }

    .lil-gui.root.blackhole-gui > .title {
      min-height: 40px;
      padding: 0 12px;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }

    .lil-gui.root.blackhole-gui > .children {
      max-height: calc(100vh - 72px);
      overflow-y: auto;
      padding: 6px 8px 10px;
      scrollbar-width: thin;
    }

    .lil-gui.blackhole-gui .controller {
      border: none;
      padding: 3px 0;
    }

    .lil-gui.blackhole-gui .controller .name {
      opacity: 0.94;
    }

    .lil-gui.blackhole-gui .folder > .title {
      min-height: 36px;
      margin-top: 8px;
      padding: 0 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      font-weight: 600;
    }

    .lil-gui.blackhole-gui .folder:first-child > .title {
      border-top: none;
    }

    .lil-gui.blackhole-gui .blackhole-gui-primary-folder > .title {
      background: linear-gradient(90deg, rgba(20, 53, 84, 0.96), rgba(15, 24, 38, 0.96));
      color: #f3fbff;
      border-top: none;
    }

    .lil-gui.blackhole-gui .blackhole-gui-tip-card {
      margin: 6px 0 10px;
      padding: 10px 12px;
      border: 1px solid rgba(142, 230, 255, 0.12);
      border-radius: 12px;
      background: linear-gradient(180deg, rgba(18, 31, 48, 0.9), rgba(11, 18, 28, 0.84));
    }

    .lil-gui.blackhole-gui .blackhole-gui-tip-title {
      margin-bottom: 8px;
      color: #eef8ff;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }

    .lil-gui.blackhole-gui .blackhole-gui-tip-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 6px;
    }

    .lil-gui.blackhole-gui .blackhole-gui-tip-row:first-of-type {
      margin-top: 0;
    }

    .lil-gui.blackhole-gui .blackhole-gui-tip-key {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 44px;
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(58, 199, 255, 0.14);
      color: #9fe7ff;
      font-size: 11px;
      font-weight: 700;
    }

    .lil-gui.blackhole-gui .blackhole-gui-tip-value {
      flex: 1;
      color: rgba(219, 233, 255, 0.9);
      font-size: 12px;
    }

    .lil-gui.blackhole-gui input,
    .lil-gui.blackhole-gui select,
    .lil-gui.blackhole-gui button {
      border: 1px solid rgba(142, 230, 255, 0.08);
      border-radius: 10px;
    }

    .lil-gui.blackhole-gui input,
    .lil-gui.blackhole-gui select {
      background: rgba(255, 255, 255, 0.08);
    }

    .lil-gui.blackhole-gui button {
      min-height: 30px;
      background: rgba(62, 126, 183, 0.22);
    }

    .lil-gui.blackhole-gui .blackhole-gui-accent-action button {
      min-height: 34px;
      background: linear-gradient(135deg, rgba(58, 126, 191, 0.82), rgba(32, 78, 135, 0.96));
      color: #eff9ff;
      font-weight: 700;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
    }

    @media (max-width: 900px) {
      .lil-gui.root.blackhole-gui {
        --width: auto;
        left: 12px;
        right: 12px;
        top: auto;
        bottom: 12px;
        max-height: min(58vh, 560px);
      }

      .lil-gui.root.blackhole-gui > .children {
        max-height: calc(min(58vh, 560px) - 48px);
      }
    }
  `;

  document.head.appendChild(style);
}

function installQuickViewTips(folder: GUI): void {
  const children = folder.domElement.querySelector('.children');
  if (!(children instanceof HTMLElement) || children.querySelector('.blackhole-gui-tip-card')) return;

  const card = document.createElement('div');
  card.className = 'blackhole-gui-tip-card';
  card.innerHTML = `
    <div class="blackhole-gui-tip-title">默认视角</div>
    <div class="blackhole-gui-tip-row">
      <span class="blackhole-gui-tip-key">拖拽</span>
      <span class="blackhole-gui-tip-value">旋转观察</span>
    </div>
    <div class="blackhole-gui-tip-row">
      <span class="blackhole-gui-tip-key">滚轮</span>
      <span class="blackhole-gui-tip-value">缩放画面</span>
    </div>
    <div class="blackhole-gui-tip-row">
      <span class="blackhole-gui-tip-key">双击</span>
      <span class="blackhole-gui-tip-value">恢复默认视角</span>
    </div>
  `;
  children.prepend(card);
}

async function main(): Promise<void> {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const trailCanvas = document.getElementById('trail') as HTMLCanvasElement | null;
  const trailCtx = trailCanvas?.getContext('2d');
  const fpsOverlay = document.getElementById('fps') as HTMLDivElement | null;
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

  const skyboxSources = listSkyboxSources();
  if (skyboxSources.length === 0) {
    throw new Error('No skybox sources found under public/assets/skybox_*');
  }
  if (!skyboxSources.some((source) => source.id === params.skyboxPreset)) {
    params.skyboxPreset = skyboxSources[0]!.id;
  }
  const skyboxOptions = Object.fromEntries(
    skyboxSources.map((source) => [formatSkyboxLabel(source.id, source.kind), source.id] as const),
  );

  const [skyboxAssets, colorMap, vao, passes] = await Promise.all([
    Promise.all(
      skyboxSources.map(async (source) => [source.id, await loadSkyboxAsset(gl, source)] as const),
    ).then((entries) => Object.fromEntries(entries) as Record<string, Awaited<ReturnType<typeof loadSkyboxAsset>>>),
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
      upscale: makePass(gl, simpleVert, upscaleFrag),
      fsrEasu: makePass(gl, simpleVert, fsr1EasuFrag),
      fsrRcas: makePass(gl, simpleVert, fsr1RcasFrag),
    }),
  ]);

  setI1(gl, passes.upscale.program, passes.upscale.uniforms, 'texture0', 0);
  setI1(gl, passes.blackhole.program, passes.blackhole.uniforms, 'galaxyPanorama', 2);
  setI1(gl, passes.fsrEasu.program, passes.fsrEasu.uniforms, 'texture0', 0);
  setI1(gl, passes.fsrRcas.program, passes.fsrRcas.uniforms, 'texture0', 0);
  setF(gl, passes.fsrRcas.program, passes.fsrRcas.uniforms, 'sharpnessStops', params.fsrSharpness);
  setI1(gl, passes.fxaa.program, passes.fxaa.uniforms, 'texture0', 0);
  setI1(gl, passes.fxaa.program, passes.fxaa.uniforms, 'fxaaQuality', params.fxaaQuality);
  setF(gl, passes.taaBlend.program, passes.taaBlend.uniforms, 'taaFeedback', params.taaFeedback);
  setF(gl, passes.taaBlend.program, passes.taaBlend.uniforms, 'firstFrame', 1.0);
  let skybox = skyboxAssets[params.skyboxPreset]!;

  let mouseX = 0;
  let mouseY = 0;
  let orbitPointerX = 0.5;
  let orbitPointerY = 0.5;
  let orbitYaw = 0;
  let orbitPitch = 0;
  let cameraTarget: [number, number, number] = [0, 0, 0];
  let activeDragMode: 'orbit' | 'pan' | null = null;
  let activePointerId: number | null = null;
  let lastPointerClientX = 0;
  let lastPointerClientY = 0;
  let cameraModeCtrl: { updateDisplay(): void } | null = null;
  let cameraDistanceCtrl: { updateDisplay(): void } | null = null;
  let cameraFovCtrl: { updateDisplay(): void } | null = null;
  let cameraRollCtrl: { updateDisplay(): void } | null = null;
  let fpsFrameCounter = 0;
  let fpsAccumulatedSeconds = 0;
  let fpsLastFrameTime = performance.now();
  let frameLimiterDeadlineMs = 0;
  let appliedFrameRateLimit = params.frameRateLimit;

  canvas.style.touchAction = 'none';

  function syncSkyboxTexture(): void {
    if (!(params.skyboxPreset in skyboxAssets)) {
      params.skyboxPreset = skyboxSources[0]!.id;
    }
    skybox = skyboxAssets[params.skyboxPreset]!;
  }

  function syncMouseFromOrbitState(): void {
    orbitPointerX = wrapUnitInterval(orbitYaw / ORBIT_YAW_RANGE + 0.5);
    orbitPointerY = clampNumber(0.5 - orbitPitch / ORBIT_PITCH_RANGE, 0, 1);
    mouseX = orbitPointerX * Math.max(canvas.width, 1);
    mouseY = orbitPointerY * Math.max(canvas.height, 1);
  }

  function captureOrbitStateFromMouse(): void {
    const width = Math.max(canvas.width, 1);
    const height = Math.max(canvas.height, 1);
    const normalizedX = mouseX / width;
    const normalizedY = mouseY / height;
    orbitYaw = (normalizedX - 0.5) * ORBIT_YAW_RANGE;
    orbitPitch = clampNumber((0.5 - normalizedY) * ORBIT_PITCH_RANGE, ORBIT_PITCH_MIN, ORBIT_PITCH_MAX);
    syncMouseFromOrbitState();
  }

  function setOrbitPointer(normalizedX: number, normalizedY: number): void {
    orbitYaw = (normalizedX - 0.5) * ORBIT_YAW_RANGE;
    orbitPitch = clampNumber((0.5 - normalizedY) * ORBIT_PITCH_RANGE, ORBIT_PITCH_MIN, ORBIT_PITCH_MAX);
    syncMouseFromOrbitState();
  }

  function nudgeOrbit(deltaX: number, deltaY: number): void {
    orbitYaw += deltaX * ORBIT_YAW_RANGE;
    orbitPitch = clampNumber(orbitPitch + deltaY * ORBIT_PITCH_RANGE, ORBIT_PITCH_MIN, ORBIT_PITCH_MAX);
    syncMouseFromOrbitState();
  }

  function getPanScale(rectWidth: number, rectHeight: number): { x: number; y: number } {
    const safeWidth = Math.max(rectWidth, 1);
    const safeHeight = Math.max(rectHeight, 1);
    const fovScale = getViewFovScale();
    const verticalWorldSpan = Math.max(params.cameraDistance, MIN_CAMERA_DISTANCE) * fovScale;
    const horizontalWorldSpan = verticalWorldSpan * (safeWidth / safeHeight);
    return {
      x: horizontalWorldSpan,
      y: verticalWorldSpan,
    };
  }

  function nudgePan(deltaX: number, deltaY: number): void {
    const cam = getCameraLookBasis(
      0,
      orbitYaw,
      orbitPitch,
      params.cameraDistance,
      cameraTarget,
      params.mouseControl,
      params.frontView,
      params.topView,
      params.cameraRoll,
    );
    const rect = canvas.getBoundingClientRect();
    const panScale = getPanScale(rect.width, rect.height);
    const moveRight = deltaX * panScale.x;
    const moveUp = deltaY * panScale.y;
    cameraTarget = [
      cameraTarget[0] + cam.uu[0] * moveRight + cam.vv[0] * moveUp,
      cameraTarget[1] + cam.uu[1] * moveRight + cam.vv[1] * moveUp,
      cameraTarget[2] + cam.uu[2] * moveRight + cam.vv[2] * moveUp,
    ];
  }

  function updateViewControlDisplays(): void {
    cameraModeCtrl?.updateDisplay();
    cameraDistanceCtrl?.updateDisplay();
    cameraFovCtrl?.updateDisplay();
    cameraRollCtrl?.updateDisplay();
  }

  function syncCanvasCursor(): void {
    if (activeDragMode === 'pan') {
      canvas.style.cursor = 'move';
      return;
    }
    if (!params.mouseControl) {
      canvas.style.cursor = 'default';
      return;
    }
    canvas.style.cursor = activeDragMode === 'orbit' ? 'grabbing' : 'grab';
  }

  function finishPointerDrag(pointerId?: number): void {
    if (pointerId !== undefined && activePointerId !== pointerId) return;
    if (activePointerId !== null && canvas.hasPointerCapture(activePointerId)) {
      canvas.releasePointerCapture(activePointerId);
    }
    activeDragMode = null;
    activePointerId = null;
    syncCanvasCursor();
  }

  function resetOrbitView(): void {
    setOrbitPointer(0.5, 0.5);
    cameraTarget = [0, 0, 0];
    params.cameraDistance = DEFAULT_CAMERA_DISTANCE;
    params.cameraFovDeg = DEFAULT_CAMERA_FOV_DEG;
    params.cameraRoll = 0;
    applyCameraMode('orbit');
  }

  setOrbitPointer(0.5, 0.5);
  syncCanvasCursor();

  canvas.addEventListener('pointerdown', (event) => {
    const wantsOrbit = event.button === 0 && params.mouseControl;
    const wantsPan = event.button === 2;
    if (!wantsOrbit && !wantsPan) return;
    activeDragMode = wantsPan ? 'pan' : 'orbit';
    activePointerId = event.pointerId;
    lastPointerClientX = event.clientX;
    lastPointerClientY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
    syncCanvasCursor();
    event.preventDefault();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!activeDragMode || activePointerId !== event.pointerId) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const deltaX = (event.clientX - lastPointerClientX) / rect.width;
    const deltaY = (event.clientY - lastPointerClientY) / rect.height;
    lastPointerClientX = event.clientX;
    lastPointerClientY = event.clientY;
    if (activeDragMode === 'orbit') {
      nudgeOrbit(deltaX, deltaY);
    } else {
      nudgePan(deltaX, deltaY);
    }
  });

  canvas.addEventListener('pointerup', (event) => {
    finishPointerDrag(event.pointerId);
  });
  canvas.addEventListener('pointercancel', (event) => {
    finishPointerDrag(event.pointerId);
  });
  canvas.addEventListener('lostpointercapture', () => {
    finishPointerDrag();
  });
  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!params.mouseControl && !params.frontView && !params.topView) return;
      params.cameraDistance = clampNumber(
        params.cameraDistance * Math.exp(event.deltaY * DISTANCE_WHEEL_SENSITIVITY),
        MIN_CAMERA_DISTANCE,
        MAX_CAMERA_DISTANCE,
      );
      cameraDistanceCtrl?.updateDisplay();
      event.preventDefault();
    },
    { passive: false },
  );
  canvas.addEventListener('dblclick', (event) => {
    resetOrbitView();
    updateViewControlDisplays();
    event.preventDefault();
  });

  let handGestureController: HandGestureController | null = null;
  let serverGestureClient: ServerGestureClient | null = null;
  let handVideo: HTMLVideoElement | null = null;
  let handCanvas: HTMLCanvasElement | null = null;
  let handOverlay: HTMLDivElement | null = null;
  let gestureStatusOverlay: HTMLDivElement | null = null;
  let gestureStatusTimer: number | null = null;
  let previousGestureMode: 'off' | 'local' | 'server' = 'off';
  let gestureInitToken = 0;
  let gestureSwitchQueue: Promise<void> = Promise.resolve();

  function clearGestureStatusMessage(): void {
    if (gestureStatusTimer !== null) {
      window.clearTimeout(gestureStatusTimer);
      gestureStatusTimer = null;
    }
    gestureStatusOverlay?.remove();
    gestureStatusOverlay = null;
  }

  function showGestureStatusMessage(message: string, isError = false): void {
    clearGestureStatusMessage();
    gestureStatusOverlay = document.createElement('div');
    gestureStatusOverlay.style.cssText = [
      'position:fixed',
      'bottom:260px',
      'left:10px',
      'padding:8px 12px',
      'background:rgba(0,0,0,0.8)',
      `color:${isError ? '#ff6666' : '#00ff00'}`,
      'border-radius:4px',
      'font-size:12px',
      'font-family:monospace',
      'z-index:1000',
    ].join(';');
    gestureStatusOverlay.textContent = message;
    document.body.appendChild(gestureStatusOverlay);
    gestureStatusTimer = window.setTimeout(clearGestureStatusMessage, 5000);
  }

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
            setOrbitPointer(state.palmX, 1 - state.palmY);
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
            setOrbitPointer(state.palmX, 1 - state.palmY);
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
    | 'gui-render-scale'
    | 'playback-render-scale'
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

  function getDisplaySize(): { width: number; height: number } {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    return {
      width: Math.max(1, Math.floor(canvas.clientWidth * dpr)),
      height: Math.max(1, Math.floor(canvas.clientHeight * dpr)),
    };
  }

  function getRenderTargetSize(displayWidth: number, displayHeight: number): { width: number; height: number } {
    return {
      width: Math.max(1, Math.round(displayWidth * params.renderScale)),
      height: Math.max(1, Math.round(displayHeight * params.renderScale)),
    };
  }

  function resizeNow(): void {
    const { width: w, height: h } = getDisplaySize();
    const { width: renderW, height: renderH } = getRenderTargetSize(w, h);
    const needsMsaaRebuild = pipeline && params.msaaSamples !== lastMsaaSamples;
    const needsAaModeRebuild = pipeline && params.antialias !== lastAntialiasMode;
    const needsRenderScaleRebuild = !pipeline || pipeline.width !== renderW || pipeline.height !== renderH;
    if (
      canvas.width === w &&
      canvas.height === h &&
      pipeline &&
      !needsMsaaRebuild &&
      !needsAaModeRebuild &&
      !needsRenderScaleRebuild
    ) {
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
    syncMouseFromOrbitState();
    destroyPipeline(gl, pipeline);
    const r = tryAllocPipeline(gl, renderW, renderH, w, h, params.antialias, params.msaaSamples);
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

  function scheduleResizeNow(
    source: 'resize-observer' | 'gui-antialias' | 'gui-msaa' | 'gui-render-scale' | 'playback-render-scale' | 'startup',
  ): void {
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

  installGuiStyles();
  const gui = new GUI({ title: '控制台' });
  gui.domElement.classList.add('blackhole-gui');

  type CameraMode = 'orbit' | 'front' | 'top';

  const bodyFolders: GUI[] = [];
  function syncBodyFolders(): void {
    for (let i = 0; i < MAX_BODIES; i++) {
      const folder = bodyFolders[i];
      if (folder) setGuiVisible(folder, i < scene.bodyCount);
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
    timeWarpEnabled: scene.timeWarp.enabled,
    timeWarpIntensity: scene.timeWarp.intensity,
    timeWarpPotentialScale: scene.timeWarp.potentialScale,
    timeWarpDistanceScale: scene.timeWarp.distanceScale,
  };
  const uiView = {
    cameraMode: 'orbit' as CameraMode,
  };
  const recordingState = {
    status: '就绪',
    frameCount: 0,
    durationLabel: '0.0s',
    playbackProgress: 0,
  };
  const audioState = {
    enabled: true,
    volume: 0.5,
  };
  const renderState = {
    internalResolution: '',
    displayResolution: '',
  };
  const presetNames = Object.keys(SCENE_PRESETS) as (keyof typeof SCENE_PRESETS)[];

  function getActiveCameraMode(): CameraMode {
    if (params.topView) return 'top';
    if (params.frontView) return 'front';
    return 'orbit';
  }

  function getViewFovScale(): number {
    const fovRadians = (clampNumber(params.cameraFovDeg, MIN_CAMERA_FOV_DEG, MAX_CAMERA_FOV_DEG) * Math.PI) / 180;
    return 2 * Math.tan(fovRadians * 0.5);
  }

  function applyCameraMode(mode: CameraMode): void {
    if (mode !== 'orbit') finishPointerDrag();
    params.mouseControl = mode === 'orbit';
    params.frontView = mode === 'front';
    params.topView = mode === 'top';
    uiView.cameraMode = mode;
    syncCanvasCursor();
  }

  function syncRecordingSummary(): void {
    const status = recordingManager.getStatus();
    recordingState.frameCount = status.frameCount;
    recordingState.durationLabel = `${status.duration.toFixed(1)}s`;
    recordingState.playbackProgress = status.playbackProgress;
  }

  function computeTraceMaxDistance(cameraPos: [number, number, number]): number {
    let farthestSurfacePointDistance = -Infinity;
    for (let i = 0; i < scene.bodyCount; i++) {
      const body = scene.bodies[i]!;
      const dx = body.position[0] - cameraPos[0];
      const dy = body.position[1] - cameraPos[1];
      const dz = body.position[2] - cameraPos[2];
      const bodyDistance = Math.hypot(dx, dy, dz);
      const surfacePointDistance = bodyDistance + getBodySurfaceRadius(body);
      farthestSurfacePointDistance = Math.max(farthestSurfacePointDistance, surfacePointDistance);
    }
    return Math.max(TRACE_STOP_DISTANCE_MIN, farthestSurfacePointDistance * 2);
  }

  function syncRenderSummary(): void {
    const { width: displayWidth, height: displayHeight } = getDisplaySize();
    const { width: renderWidth, height: renderHeight } = getRenderTargetSize(displayWidth, displayHeight);
    renderState.displayResolution = `${displayWidth} × ${displayHeight}`;
    renderState.internalResolution = `${renderWidth} × ${renderHeight}`;
  }

  async function setAmbientAudioPreference(enabled: boolean): Promise<void> {
    audioState.enabled = enabled;
    ambientAudio.setVolume(audioState.volume);
    if (!enabled) {
      await ambientAudio.toggle(false);
      refreshGuiDisplays();
      return;
    }
    try {
      await ambientAudio.toggle(true);
    } catch (error) {
      console.warn('[blackhole-web] Ambient audio enable deferred until the next user interaction.', error);
    }
    refreshGuiDisplays();
  }

  async function ensureAmbientAudioActive(): Promise<void> {
    if (!audioState.enabled || ambientAudio.isEnabled()) return;
    ambientAudio.setVolume(audioState.volume);
    try {
      await ambientAudio.toggle(true);
      refreshGuiDisplays();
    } catch {
      // Browser autoplay policies can delay audio resume until a later interaction.
    }
  }

  function refreshGuiDisplays(): void {
    refreshGuiLayout();
    gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
  }

  function loadPreset(name: keyof typeof SCENE_PRESETS): void {
    const snap = SCENE_PRESETS[name];
    if (!snap) return;
    const nextScene = cloneSceneState(snap);
    if (nextScene.dynamics === 'nbody') {
      normalizeSceneForNBody(nextScene);
    }
    applySceneState(scene, nextScene);
    initialSnapshot = cloneSceneState(scene);
    syncUiSceneFromScene(uiScene, scene);
    refreshGuiDisplays();
    trails.reset();
  }

  function resetSceneToSnapshot(): void {
    applySceneState(scene, cloneSceneState(initialSnapshot));
    syncUiSceneFromScene(uiScene, scene);
    refreshGuiDisplays();
    trails.reset();
  }

  uiView.cameraMode = getActiveCameraMode();

  const commonFolder = gui.addFolder('常用操作');
  window.addEventListener(
    'pointerdown',
    () => {
      void ensureAmbientAudioActive();
    },
    { passive: true },
  );
  window.addEventListener('keydown', () => {
    void ensureAmbientAudioActive();
  });

  addGuiClass(commonFolder, 'blackhole-gui-primary-folder');
  commonFolder
    .add(uiScene, 'presetName', presetNames)
    .name('场景预设')
    .onChange((name: keyof typeof SCENE_PRESETS) => {
      loadPreset(name);
    });
  const resetSceneCtrl = commonFolder
    .add({ resetScene: resetSceneToSnapshot }, 'resetScene')
    .name('恢复当前场景');
  addGuiClass(resetSceneCtrl, 'blackhole-gui-accent-action');
  cameraModeCtrl = commonFolder
    .add(uiView, 'cameraMode', { 自由观察: 'orbit', 正视图: 'front', 俯视图: 'top' })
    .name('观察方式')
    .onChange((mode: CameraMode) => {
      applyCameraMode(mode);
    });
  cameraDistanceCtrl = commonFolder
    .add(params, 'cameraDistance', MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE, 0.1)
    .name('相机距离');
  cameraFovCtrl = commonFolder
    .add(params, 'cameraFovDeg', MIN_CAMERA_FOV_DEG, MAX_CAMERA_FOV_DEG, 1)
    .name('FOV (°)');
  const resetViewCtrl = commonFolder
    .add(
      {
        resetView() {
          resetOrbitView();
          updateViewControlDisplays();
        },
      },
      'resetView',
    )
    .name('恢复默认视角');
  addGuiClass(resetViewCtrl, 'blackhole-gui-accent-action');
  commonFolder
    .add(uiScene, 'showTrails')
    .name('显示轨迹')
    .onChange((v: boolean) => {
      scene.showTrails = v;
    });
  installQuickViewTips(commonFolder);

  const sceneFolder = gui.addFolder('场景与物理');
  sceneFolder
    .add(uiScene, 'bodyCount', 1, MAX_BODIES, 1)
    .name('活跃天体')
    .onChange((v: number) => {
      scene.bodyCount = Math.round(v);
      uiScene.bodyCount = scene.bodyCount;
      syncBodyFolders();
    });

  const simulationFolder = sceneFolder.addFolder('物理参数');
  const dynamicsCtrl = simulationFolder
    .add(uiScene, 'dynamics', { 静态: 'static', 开普勒: 'kepler', 'N 体': 'nbody' })
    .name('动力学')
    .onChange((v: SceneState['dynamics']) => {
      const previous = scene.dynamics;
      scene.dynamics = v;
      adaptSceneForDynamicsSwitch(scene, previous, v);
      syncUiSceneFromScene(uiScene, scene);
      trails.reset();
      refreshGuiDisplays();
    });
  const gmCentralCtrl = simulationFolder
    .add(uiScene, 'gmCentral', 1, 500)
    .name('中心 GM')
    .onChange((v: number) => {
      scene.gmCentral = v;
    });
  const nbodyGCtrl = simulationFolder
    .add(uiScene, 'nbodyG', 0.1, 20)
    .name('N 体引力')
    .onChange((v: number) => {
      scene.nbodyG = v;
    });
  const softeningCtrl = simulationFolder
    .add(uiScene, 'softening', 0.01, 2)
    .name('软化半径')
    .onChange((v: number) => {
      scene.softening = v;
    });
  simulationFolder
    .add(uiScene, 'dt', 0.001, 0.1, 0.001)
    .name('时间步长')
    .onChange((v: number) => {
      scene.dt = v;
    });

  const timeWarpFolder = simulationFolder.addFolder('时间扭曲');
  const timeWarpEnabledCtrl = timeWarpFolder
    .add(uiScene, 'timeWarpEnabled')
    .name('启用')
    .onChange((v: boolean) => {
      scene.timeWarp.enabled = v;
      refreshGuiLayout();
    });
  const timeWarpIntensityCtrl = timeWarpFolder
    .add(uiScene, 'timeWarpIntensity', 0, 1, 0.01)
    .name('强度')
    .onChange((v: number) => {
      scene.timeWarp.intensity = v;
    });
  const timeWarpPotentialScaleCtrl = timeWarpFolder
    .add(uiScene, 'timeWarpPotentialScale', 0.1, 5, 0.1)
    .name('势阱强度')
    .onChange((v: number) => {
      scene.timeWarp.potentialScale = v;
    });
  const timeWarpDistanceScaleCtrl = timeWarpFolder
    .add(uiScene, 'timeWarpDistanceScale', 0.5, 20, 0.5)
    .name('距离参考')
    .onChange((v: number) => {
      scene.timeWarp.distanceScale = v;
    });

  const interactionFolder = gui.addFolder('高级交互');
  const gestureModeCtrl = interactionFolder
    .add(params, 'gestureMode', {
      关闭: 'off',
      本地识别: 'local',
      服务器识别: 'server',
    })
    .name('手势识别');
  gestureModeCtrl.onChange(() => {
    const modeSwitchToken = ++gestureInitToken;
    gestureSwitchQueue = gestureSwitchQueue
      .then(async () => {
        if (modeSwitchToken !== gestureInitToken) return;
        const targetMode = params.gestureMode;
        if (targetMode === previousGestureMode && targetMode !== 'off') return;

        if (targetMode === 'off') {
          cleanupGestureResources(true);
          clearGestureStatusMessage();
          previousGestureMode = 'off';
          return;
        }

        cleanupGestureResources(true);
        clearGestureStatusMessage();
        const success = await initHandGesture(targetMode);
        const isStaleSwitch = modeSwitchToken !== gestureInitToken || params.gestureMode !== targetMode;
        if (isStaleSwitch) {
          cleanupGestureResources(true);
          return;
        }

        if (!success) {
          cleanupGestureResources(true);
          showGestureStatusMessage('手势: 初始化失败，已恢复为关闭', true);
          params.gestureMode = 'off';
          previousGestureMode = 'off';
          refreshGuiDisplays();
          return;
        }

        applyCameraMode('orbit');
        clearGestureStatusMessage();
        previousGestureMode = targetMode;
        if (targetMode === 'server' && serverGestureClient) {
          serverGestureClient.enable();
        } else if (targetMode === 'local' && handGestureController) {
          handGestureController.setEnabled(true);
        }
        refreshGuiDisplays();
      })
      .catch((error) => {
        console.error('[blackhole-web] 手势模式切换错误:', error);
      });
  });
  cameraRollCtrl = interactionFolder
    .add(params, 'cameraRoll', -180, 180, 1)
    .name('画面滚转');

  const renderFolder = gui.addFolder('画面与特效');

  const resolutionFolder = renderFolder.addFolder('渲染分辨率');
  resolutionFolder
    .add(params, 'renderScale', MIN_RENDER_SCALE, MAX_RENDER_SCALE, 0.05)
    .name('渲染倍率')
    .onChange(() => {
      scheduleResizeNow('gui-render-scale');
      refreshGuiDisplays();
    });
  const upscaleModeCtrl = resolutionFolder
    .add(params, 'upscaleMode', {
      FSR1: 'fsr1',
      Lanczos: 'lanczos',
      Bicubic: 'bicubic',
    })
    .name('上采样')
    .onChange(() => {
      refreshGuiLayout();
    });
  const fsrSharpnessCtrl = resolutionFolder
    .add(params, 'fsrSharpness', 0, 2, 0.05)
    .name('FSR 锐化')
    .onChange(() => {
      setF(gl, passes.fsrRcas.program, passes.fsrRcas.uniforms, 'sharpnessStops', params.fsrSharpness);
    });
  resolutionFolder
    .add(renderState, 'internalResolution')
    .name('内部尺寸')
    .listen();
  resolutionFolder
    .add(renderState, 'displayResolution')
    .name('画布尺寸')
    .listen();

  const antiAliasFolder = renderFolder.addFolder('抗锯齿');
  resolutionFolder
    .add(params, 'frameRateLimit', 0, MAX_FRAME_RATE_LIMIT, 1)
    .name('FPS Cap')
    .onChange((value: number) => {
      params.frameRateLimit = Math.max(0, Math.round(value));
    });

  const backgroundFolder = renderFolder.addFolder('Background');
  backgroundFolder
    .add(params, 'skyboxPreset', skyboxOptions)
    .name('Skybox')
    .onChange(() => {
      syncSkyboxTexture();
    });

  const antialiasCtrl = antiAliasFolder
    .add(params, 'antialias', {
      关闭: 'off',
      '快速平滑 (FXAA)': 'fxaa',
      '时序抗锯齿 (TAA)': 'taa',
    })
    .name('模式')
    .onChange((v: AntialiasMode) => {
      updateAAUIControls(v);
      scheduleResizeNow('gui-antialias');
    });
  const fxaaQualityCtrl = antiAliasFolder
    .add(params, 'fxaaQuality', {
      低: 0,
      中: 1,
      高: 2,
    })
    .name('FXAA 质量')
    .onChange(() => {
      if (passes.fxaa) {
        setI1(gl, passes.fxaa.program, passes.fxaa.uniforms, 'fxaaQuality', params.fxaaQuality);
      }
    });
  const msaaSamplesCtrl = antiAliasFolder
    .add(params, 'msaaSamples', {
      '2x': 2,
      '4x': 4,
      '8x': 8,
    })
    .name('MSAA 采样')
    .onChange(() => {
      scheduleResizeNow('gui-msaa');
    });
  const taaFeedbackCtrl = antiAliasFolder
    .add(params, 'taaFeedback', 1, 20, 0.5)
    .name('TAA 反馈')
    .onChange(() => {
      if (passes.taaBlend) {
        setF(gl, passes.taaBlend.program, passes.taaBlend.uniforms, 'taaFeedback', params.taaFeedback);
      }
    });
  const updateAAUIControls = (mode: AntialiasMode): void => {
    setGuiVisible(fxaaQualityCtrl, mode === 'fxaa');
    setGuiVisible(msaaSamplesCtrl, mode === 'taa');
    setGuiVisible(taaFeedbackCtrl, mode === 'taa');
  };

  const lensFolder = renderFolder.addFolder('黑洞主体');
  lensFolder.add(params, 'gravatationalLensing').name('引力透镜');
  lensFolder.add(params, 'renderBlackHole').name('显示黑洞');

  const diskFolder = renderFolder.addFolder('吸积盘');
  const adiskEnabledCtrl = diskFolder
    .add(params, 'adiskEnabled')
    .name('启用');
  const adiskParticleCtrl = diskFolder
    .add(params, 'adiskParticle')
    .name('粒子细节');
  const adiskDensityVCtrl = diskFolder
    .add(params, 'adiskDensityV', 0, 10, 0.1)
    .name('垂直密度');
  const adiskDensityHCtrl = diskFolder
    .add(params, 'adiskDensityH', 0, 10, 0.1)
    .name('水平密度');
  const adiskHeightCtrl = diskFolder
    .add(params, 'adiskHeight', 0, 1, 0.01)
    .name('厚度');
  const adiskLitCtrl = diskFolder
    .add(params, 'adiskLit', 0, 4, 0.01)
    .name('受光强度');
  const adiskNoiseLODCtrl = diskFolder
    .add(params, 'adiskNoiseLOD', 1, 12, 1)
    .name('噪声层级');
  const adiskNoiseScaleCtrl = diskFolder
    .add(params, 'adiskNoiseScale', 0, 10, 0.1)
    .name('噪声尺度');
  const adiskSpeedCtrl = diskFolder
    .add(params, 'adiskSpeed', 0, 1, 0.01)
    .name('旋转速度');
  adiskEnabledCtrl.onChange(() => {
    refreshGuiLayout();
  });

  const relativisticFolder = renderFolder.addFolder('相对论效果');
  const dopplerEnabledCtrl = relativisticFolder
    .add(params, 'dopplerEnabled')
    .name('多普勒偏移')
    .onChange(() => {
      refreshGuiLayout();
    });
  const dopplerStrengthCtrl = relativisticFolder
    .add(params, 'dopplerStrength', 0, 2, 0.01)
    .name('偏移强度');
  const dopplerBetaCtrl = relativisticFolder
    .add(params, 'dopplerBeta', 0, 0.5, 0.01)
    .name('盘面速度 (v/c)');
  const beamingEnabledCtrl = relativisticFolder
    .add(params, 'beamingEnabled')
    .name('束射增强')
    .onChange(() => {
      refreshGuiLayout();
    });
  const beamingPowerCtrl = relativisticFolder
    .add(params, 'beamingPower', 1, 6, 0.1)
    .name('聚束指数');
  const spinEnabledCtrl = relativisticFolder
    .add(params, 'spinEnabled')
    .name('黑洞自旋')
    .onChange(() => {
      refreshGuiLayout();
    });
  const spinACtrl = relativisticFolder
    .add(params, 'spinA', 0, 0.998, 0.001)
    .name('自旋参数 a');

  const postFolder = renderFolder.addFolder('后期处理');
  postFolder
    .add(params, 'bloomIterations', 1, MAX_BLOOM_ITER, 1)
    .name('Bloom 层数');
  postFolder
    .add(params, 'bloomStrength', 0, 1, 0.01)
    .name('Bloom 强度');
  postFolder
    .add(params, 'tonemappingEnabled')
    .name('色调映射');
  postFolder
    .add(params, 'gamma', 1, 4, 0.05)
    .name('Gamma');

  const recordingFolder = gui.addFolder('录制与回放');
  recordingFolder.add(recordingState, 'status').name('状态').listen();
  recordingFolder.add(recordingState, 'frameCount').name('帧数').listen();
  recordingFolder.add(recordingState, 'durationLabel').name('时长').listen();

  const recordingCaptureFolder = recordingFolder.addFolder('录制');
  const startRecordingCtrl = recordingCaptureFolder
    .add(
      {
        startRecording() {
          recordingManager.startRecording();
          recordingState.status = '录制中...';
          syncRecordingSummary();
          refreshGuiLayout();
        },
      },
      'startRecording',
    )
    .name('开始录制');
  const stopRecordingCtrl = recordingCaptureFolder
    .add(
      {
        stopRecording() {
          recordingManager.stopRecording();
          syncRecordingSummary();
          recordingState.status = `录制结束 (${recordingState.frameCount} 帧)`;
          refreshGuiLayout();
        },
      },
      'stopRecording',
    )
    .name('停止录制');
  addGuiClass(startRecordingCtrl, 'blackhole-gui-accent-action');

  const recordingPlaybackFolder = recordingFolder.addFolder('回放');
  const startPlaybackCtrl = recordingPlaybackFolder
    .add(
      {
        startPlayback() {
          if (recordingManager.frames.length > 0) {
            applySceneState(scene, cloneSceneState(initialSnapshot));
            trails.reset();
          }
          recordingState.status = recordingManager.startPlayback() ? '回放中...' : '没有可回放数据';
          syncRecordingSummary();
          refreshGuiLayout();
        },
      },
      'startPlayback',
    )
    .name('开始回放');
  const stopPlaybackCtrl = recordingPlaybackFolder
    .add(
      {
        stopPlayback() {
          recordingManager.stopPlayback();
          syncRecordingSummary();
          recordingState.status = '回放已停止';
          refreshGuiLayout();
        },
      },
      'stopPlayback',
    )
    .name('停止回放');
  const playbackProgressCtrl = recordingPlaybackFolder
    .add(recordingState, 'playbackProgress', 0, 1, 0.01)
    .name('回放进度')
    .listen()
    .onChange((v: number) => {
      recordingManager.setPlaybackProgress(v);
    });

  const recordingFileFolder = recordingFolder.addFolder('导入 / 导出');
  const exportJsonCtrl = recordingFileFolder
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
          recordingState.status = '已导出 JSON';
          syncRecordingSummary();
          refreshGuiLayout();
        },
      },
      'exportJSON',
    )
    .name('导出 JSON');
  recordingFileFolder
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
                syncRecordingSummary();
                recordingState.status = imported ? `已导入 (${recordingState.frameCount} 帧)` : '导入失败';
                refreshGuiLayout();
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
    .name('导入 JSON');

  const recordingStorageFolder = recordingFolder.addFolder('本地保存');
  const saveLocalCtrl = recordingStorageFolder
    .add(
      {
        saveToLocalStorage() {
          recordingState.status = recordingManager.saveToLocalStorage('recording')
            ? '已保存到本地'
            : '本地保存失败';
          syncRecordingSummary();
          refreshGuiLayout();
        },
      },
      'saveToLocalStorage',
    )
    .name('保存到本地');
  recordingStorageFolder
    .add(
      {
        loadFromLocalStorage() {
          const loaded = recordingManager.loadFromLocalStorage('recording');
          syncRecordingSummary();
          recordingState.status = loaded ? `已加载 (${recordingState.frameCount} 帧)` : '本地加载失败';
          refreshGuiLayout();
        },
      },
      'loadFromLocalStorage',
    )
    .name('从本地加载');

  const audioFolder = gui.addFolder('音频');
  const audioEnabledCtrl = audioFolder
    .add(audioState, 'enabled')
    .name('启用氛围音频')
    .onChange(async (v: boolean) => {
      await setAmbientAudioPreference(v);
    });
  const audioVolumeCtrl = audioFolder
    .add(audioState, 'volume', 0, 1, 0.01)
    .name('音量')
    .onChange((v: number) => {
      ambientAudio.setVolume(v);
    });

  const bodyEditorFolder = gui.addFolder('天体编辑');
  const kindOptions = { 黑洞: 'blackHole', 白洞: 'whiteHole', 中子星: 'neutronStar' } as const;

  for (let bi = 0; bi < MAX_BODIES; bi++) {
    const bodyFolder = bodyEditorFolder.addFolder(`天体 ${bi + 1}`);
    bodyFolders.push(bodyFolder);

    const positionFolder = bodyFolder.addFolder('位置');
    positionFolder.add(positionRef(scene, bi), 'x', -40, 40, 0.05).name('X');
    positionFolder.add(positionRef(scene, bi), 'y', -40, 40, 0.05).name('Y');
    positionFolder.add(positionRef(scene, bi), 'z', -40, 40, 0.05).name('Z');

    const velocityFolder = bodyFolder.addFolder('速度');
    velocityFolder.add(velocityRef(scene, bi), 'x', -20, 20, 0.02).name('X');
    velocityFolder.add(velocityRef(scene, bi), 'y', -20, 20, 0.02).name('Y');
    velocityFolder.add(velocityRef(scene, bi), 'z', -20, 20, 0.02).name('Z');

    bodyFolder.add(bodyMassRef(scene, bi), 'mass', 0.01, 80, 0.01).name('质量');
    bodyFolder.add(scene.bodies[bi]!, 'kind', kindOptions).name('类型');

    const appearanceFolder = bodyFolder.addFolder('外观');
    appearanceFolder.addColor(scene.bodies[bi]!.visual, 'glowColor').name('发光色');
    appearanceFolder.add(visualRef(scene, bi), 'size', 0.05, 4, 0.01).name('尺寸');
    appearanceFolder.add(visualRef(scene, bi), 'glowIntensity', 0, 8, 0.05).name('发光强度');
    appearanceFolder.add(visualRef(scene, bi), 'adiskIntensity', 0, 3, 0.01).name('吸积盘增益');
    appearanceFolder.add(visualRef(scene, bi), 'distortionStrength', 0, 3, 0.01).name('畸变强度');

    velocityFolder.close();
    appearanceFolder.close();
    bodyFolder.close();
  }

  function refreshDynamicsControls(): void {
    setGuiVisible(gmCentralCtrl, uiScene.dynamics === 'kepler');
    const showNBodyControls = uiScene.dynamics === 'nbody';
    setGuiVisible(nbodyGCtrl, showNBodyControls);
    setGuiVisible(softeningCtrl, showNBodyControls);
  }

  function refreshTimeWarpControls(): void {
    const enabled = uiScene.timeWarpEnabled;
    setGuiVisible(timeWarpIntensityCtrl, enabled);
    setGuiVisible(timeWarpPotentialScaleCtrl, enabled);
    setGuiVisible(timeWarpDistanceScaleCtrl, enabled);
  }

  function refreshResolutionControls(): void {
    setGuiVisible(fsrSharpnessCtrl, params.upscaleMode === 'fsr1');
  }

  function refreshAccretionDiskControls(): void {
    const enabled = params.adiskEnabled;
    setGuiVisible(adiskParticleCtrl, enabled);
    setGuiVisible(adiskDensityVCtrl, enabled);
    setGuiVisible(adiskDensityHCtrl, enabled);
    setGuiVisible(adiskHeightCtrl, enabled);
    setGuiVisible(adiskLitCtrl, enabled);
    setGuiVisible(adiskNoiseLODCtrl, enabled);
    setGuiVisible(adiskNoiseScaleCtrl, enabled);
    setGuiVisible(adiskSpeedCtrl, enabled);
  }

  function refreshRelativisticControls(): void {
    setGuiVisible(dopplerStrengthCtrl, params.dopplerEnabled);
    setGuiVisible(dopplerBetaCtrl, params.dopplerEnabled);
    setGuiVisible(beamingPowerCtrl, params.beamingEnabled);
    setGuiVisible(spinACtrl, params.spinEnabled);
  }

  function refreshAudioControls(): void {
    setGuiVisible(audioVolumeCtrl, audioState.enabled);
  }

  function refreshRecordingControls(): void {
    const status = recordingManager.getStatus();
    const hasFrames = status.frameCount > 0;
    setGuiVisible(startRecordingCtrl, !status.isRecording);
    setGuiVisible(stopRecordingCtrl, status.isRecording);
    setGuiVisible(startPlaybackCtrl, hasFrames && !status.isRecording && !status.isPlayback);
    setGuiVisible(stopPlaybackCtrl, status.isPlayback);
    setGuiVisible(playbackProgressCtrl, hasFrames);
    setGuiVisible(exportJsonCtrl, hasFrames);
    setGuiVisible(saveLocalCtrl, hasFrames);
  }

  function refreshGuiLayout(): void {
    uiView.cameraMode = getActiveCameraMode();
    syncCanvasCursor();
    syncRenderSummary();
    refreshResolutionControls();
    updateAAUIControls(params.antialias);
    refreshDynamicsControls();
    refreshTimeWarpControls();
    refreshAccretionDiskControls();
    refreshRelativisticControls();
    refreshAudioControls();
    syncRecordingSummary();
    refreshRecordingControls();
    syncBodyFolders();
  }

  dynamicsCtrl.updateDisplay();
  cameraModeCtrl?.updateDisplay();
  antialiasCtrl.updateDisplay();
  audioEnabledCtrl.updateDisplay();
  sceneFolder.close();
  interactionFolder.close();
  renderFolder.close();
  resolutionFolder.close();
  backgroundFolder.close();
  recordingFolder.close();
  timeWarpFolder.close();
  diskFolder.close();
  relativisticFolder.close();
  postFolder.close();
  recordingPlaybackFolder.close();
  recordingFileFolder.close();
  recordingStorageFolder.close();
  audioFolder.close();
  bodyEditorFolder.close();

  refreshGuiLayout();
  ambientAudio.setVolume(audioState.volume);
  void ensureAmbientAudioActive();

  function drawTrails(
    time: number,
    cameraPosOverride?: [number, number, number],
    cameraTargetOverride?: [number, number, number],
  ): void {
    if (!trailCanvas || !trailCtx) return;
    const w = trailCanvas.width;
    const h = trailCanvas.height;
    const fovScale = getViewFovScale();
    trailCtx.clearRect(0, 0, w, h);
    if (!scene.showTrails) return;

    const cam = getCameraLookBasis(
      time,
      orbitYaw,
      orbitPitch,
      params.cameraDistance,
      cameraTarget,
      params.mouseControl,
      params.frontView,
      params.topView,
      params.cameraRoll,
      cameraPosOverride,
      cameraTargetOverride,
    );

    for (let bi = 0; bi < scene.bodyCount; bi++) {
      const b = scene.bodies[bi]!;
      trailCtx.strokeStyle = TRAIL_COLORS[bi] ?? 'rgba(255,255,255,0.6)';
      trailCtx.lineWidth = 1.5;
      trailCtx.beginPath();
      let first = true;
      trails.iterateOrdered(bi, (x, y, z) => {
        const p = worldToScreenPx([x, y, z], cam, fovScale, w, h);
        if (!p) return;
        if (first) {
          trailCtx.moveTo(p.x, p.y);
          first = false;
        } else {
          trailCtx.lineTo(p.x, p.y);
        }
      });
      trailCtx.stroke();

      const cur = worldToScreenPx(b.position, cam, fovScale, w, h);
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
      if (params.frameRateLimit !== appliedFrameRateLimit) {
        appliedFrameRateLimit = params.frameRateLimit;
        frameLimiterDeadlineMs = now;
      }
      if (params.frameRateLimit > 0) {
        if (frameLimiterDeadlineMs === 0) {
          frameLimiterDeadlineMs = now;
        }
        if (now + 0.25 < frameLimiterDeadlineMs) {
          return;
        }
        const minFrameIntervalMs = 1000 / params.frameRateLimit;
        do {
          frameLimiterDeadlineMs += minFrameIntervalMs;
        } while (frameLimiterDeadlineMs <= now);
      } else {
        frameLimiterDeadlineMs = now;
      }

      const time = now / 1000;
      if (!pipeline) return;
      const frameDeltaSeconds = Math.max(0, (now - fpsLastFrameTime) / 1000);
      fpsLastFrameTime = now;
      fpsFrameCounter += 1;
      fpsAccumulatedSeconds += frameDeltaSeconds;
      if (fpsOverlay && fpsAccumulatedSeconds >= 0.25) {
        fpsOverlay.textContent = String(Math.max(0, Math.round(fpsFrameCounter / fpsAccumulatedSeconds)));
        fpsFrameCounter = 0;
        fpsAccumulatedSeconds = 0;
      }

      const playbackFrame = recordingManager.getPlaybackFrame();
      if (playbackFrame) {
        const previousRenderScale = params.renderScale;
        Object.assign(params, {
          cameraDistance: playbackFrame.render.cameraDistance,
          cameraFovDeg: playbackFrame.render.cameraFovDeg,
          cameraRoll: playbackFrame.camera.roll,
          mouseControl: playbackFrame.camera.mouseControl,
          frontView: playbackFrame.camera.frontView,
          topView: playbackFrame.camera.topView,
        });
        mouseX = playbackFrame.camera.mouseX ?? 0;
        mouseY = playbackFrame.camera.mouseY ?? 0;
        cameraTarget = [...playbackFrame.camera.target];
        captureOrbitStateFromMouse();
        applySceneState(scene, playbackFrame.scene);
        syncUiSceneFromScene(uiScene, scene);
        Object.assign(params, playbackFrame.render);
        syncSkyboxTexture();
        if (Math.abs(params.renderScale - previousRenderScale) > 1e-6) {
          scheduleResizeNow('playback-render-scale');
        }
        refreshGuiLayout();
        gui.controllersRecursive().forEach((c) => c.updateDisplay());
      } else {
        await updateHandGesture();
        stepScene(scene);
      }

      const cam = getCameraLookBasis(
        time,
        orbitYaw,
        orbitPitch,
        params.cameraDistance,
        cameraTarget,
        params.mouseControl,
        params.frontView,
        params.topView,
        params.cameraRoll,
        playbackFrame?.camera.position,
        playbackFrame?.camera.target,
      );
      recordingManager.recordFrame(
        time,
        cam.cameraPos,
        cam.cameraTarget,
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
      recordingState.durationLabel = `${recStatus.duration.toFixed(1)}s`;
      if (recStatus.isRecording) {
        recordingState.status = `录制中... ${recStatus.frameCount}帧 / ${recStatus.duration.toFixed(1)}s`;
      } else if (recStatus.isPlayback) {
        recordingState.status = `回放中... ${(recStatus.playbackProgress * 100).toFixed(0)}%`;
      }
      refreshRecordingControls();

      ambientAudio.update(scene, cam.cameraPos);

      if (scene.showTrails) {
        for (let bi = 0; bi < scene.bodyCount; bi++) {
          const b = scene.bodies[bi]!;
          trails.push(bi, b.position[0], b.position[1], b.position[2]);
        }
      }

      const { width: rw, height: rh, main, mainMsaa, mainResolved, brightness, down, up, bloomFinal, taaBuffers, tonemapped, output, fsrEasu } =
        pipeline;
      const n = params.bloomIterations;
      const aaMode = activeAntialiasMode;
      const renderMouseX = canvas.width > 0 ? mouseX * (rw / canvas.width) : 0;
      const renderMouseY = canvas.height > 0 ? mouseY * (rh / canvas.height) : 0;
      const traceMaxDistance = computeTraceMaxDistance(cam.cameraPos);

      const sceneTargetFbo = mainMsaa ? mainMsaa.fbo : main.fbo;
      drawPass(gl, vao, passes.blackhole, sceneTargetFbo, rw, rh, time, () => {
        const p = passes.blackhole;
        setF(gl, p.program, p.uniforms, 'mouseX', renderMouseX);
        setF(gl, p.program, p.uniforms, 'mouseY', renderMouseY);
        setI1(gl, p.program, p.uniforms, 'colorMap', 0);
        setI1(gl, p.program, p.uniforms, 'galaxy', 1);
        setI1(gl, p.program, p.uniforms, 'galaxyPanorama', 2);
        setF(gl, p.program, p.uniforms, 'galaxyMode', skybox.kind === 'panorama' ? 1 : 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, colorMap);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, skybox.cubemap);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, skybox.panorama);

        setF(gl, p.program, p.uniforms, 'fovScale', getViewFovScale());
        setF(gl, p.program, p.uniforms, 'gravatationalLensing', params.gravatationalLensing ? 1 : 0);
        setF(gl, p.program, p.uniforms, 'renderBlackHole', params.renderBlackHole ? 1 : 0);
        setF(gl, p.program, p.uniforms, 'mouseControl', params.mouseControl ? 1 : 0);
        setF(gl, p.program, p.uniforms, 'cameraRoll', params.cameraRoll);
        setF(gl, p.program, p.uniforms, 'frontView', params.frontView ? 1 : 0);
        setF(gl, p.program, p.uniforms, 'topView', params.topView ? 1 : 0);
        setF(gl, p.program, p.uniforms, 'playbackCamera', playbackFrame ? 1 : 0);
        setF(gl, p.program, p.uniforms, 'traceMaxDistance', traceMaxDistance);
        setV3(gl, p.program, p.uniforms, 'cameraWorld', cam.cameraPos[0], cam.cameraPos[1], cam.cameraPos[2]);
        setV3(gl, p.program, p.uniforms, 'cameraRight', cam.uu[0], cam.uu[1], cam.uu[2]);
        setV3(gl, p.program, p.uniforms, 'cameraUp', cam.vv[0], cam.vv[1], cam.vv[2]);
        setV3(gl, p.program, p.uniforms, 'cameraForward', cam.ww[0], cam.ww[1], cam.ww[2]);
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
    const canUseFsr1 = params.upscaleMode === 'fsr1' && rw <= canvas.width && rh <= canvas.height;
    if (canUseFsr1) {
      drawPass(gl, vao, passes.fsrEasu, fsrEasu.fbo, canvas.width, canvas.height, time, () => {
        setI1(gl, passes.fsrEasu.program, passes.fsrEasu.uniforms, 'texture0', 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, output.texture);
      });

      drawPass(gl, vao, passes.fsrRcas, null, canvas.width, canvas.height, time, () => {
        setI1(gl, passes.fsrRcas.program, passes.fsrRcas.uniforms, 'texture0', 0);
        setF(gl, passes.fsrRcas.program, passes.fsrRcas.uniforms, 'sharpnessStops', params.fsrSharpness);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fsrEasu.texture);
      });
    } else {
      drawPass(gl, vao, passes.upscale, null, canvas.width, canvas.height, time, () => {
        setI1(gl, passes.upscale.program, passes.upscale.uniforms, 'texture0', 0);
        setI1(
          gl,
          passes.upscale.program,
          passes.upscale.uniforms,
          'upscaleMode',
          params.upscaleMode === 'bicubic' ? 0 : 1,
        );
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, output.texture);
      });
    }

    drawTrails(time, playbackFrame?.camera.position, playbackFrame?.camera.target);
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
