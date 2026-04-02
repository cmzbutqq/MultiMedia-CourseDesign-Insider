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
  MSAASAMPLES,
  type MSAART,
} from './gl.js';
import { loadCubemap, loadTexture2D } from './resources.js';
import {
  HandGestureController,
  type GestureEvent,
} from './handGesture.js';

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

type AntialiasMode = 'off' | 'fxaa' | 'taa';

interface Params {
  antialias: AntialiasMode;
  gravatationalLensing: boolean;
  renderBlackHole: boolean;
  mouseControl: boolean;
  handControl: boolean;
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
  bloomIterations: number;
  bloomStrength: number;
  tonemappingEnabled: boolean;
  gamma: number;
}

const params: Params = {
  antialias: 'fxaa',
  gravatationalLensing: true,
  renderBlackHole: true,
  mouseControl: true,
  handControl: false,
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
): PipelineRTs {
  const main = createColorRT(gl, width, height, format);
  const mainMsaa = aaMode === 'taa' ? createMSAART(gl, width, height, format, MSAASAMPLES) : null;
  const mainResolved = mainMsaa ? createColorRT(gl, width, height, format) : null;
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
): { pipeline: PipelineRTs; format: ColorRTFormat } {
  const preferred = detectRTFormat(gl);
  try {
    return { pipeline: allocPipeline(gl, width, height, preferred, aaMode), format: preferred };
  } catch {
    if (preferred === 'float16') {
      return { pipeline: allocPipeline(gl, width, height, 'rgba8', aaMode), format: 'rgba8' };
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
  if (!cache.has(name)) {
    cache.set(name, gl.getUniformLocation(program, name));
  }
  return cache.get(name)!;
}

function setF(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  cache: UniformMap,
  name: string,
  v: number,
): void {
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

async function main(): Promise<void> {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const glCtx = canvas.getContext('webgl2', {
    antialias: false,
    depth: false,
    stencil: false,
    alpha: false,
    premultipliedAlpha: false,
  });
  if (!glCtx) {
    throw new Error('需要支持 WebGL2 的浏览器');
  }
  const gl: WebGL2RenderingContext = glCtx;

  const [galaxy, colorMap, vao, passes] = await Promise.all([
    loadCubemap(gl, '/assets/skybox_nebula_dark'),
    loadTexture2D(gl, '/assets/color_map.png'),
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
  let handVideo: HTMLVideoElement | null = null;
  let handCanvas: HTMLCanvasElement | null = null;
  let handOverlay: HTMLDivElement | null = null;
  let handX = 0.5;
  let handY = 0.5;

  async function initHandGesture(): Promise<boolean> {
    try {
      handVideo = document.createElement('video');
      handVideo.style.cssText = 'position:fixed;bottom:10px;left:10px;width:160px;height:120px;border:2px solid #00ff00;border-radius:8px;opacity:0.8;z-index:1000;transform:scaleX(-1);';
      handVideo.playsInline = true;
      handVideo.muted = true;

      handCanvas = document.createElement('canvas');
      handCanvas.width = 160;
      handCanvas.height = 120;
      handCanvas.style.cssText = 'position:fixed;bottom:135px;left:10px;border:2px solid #00ff00;border-radius:8px;opacity:0.8;z-index:1000;transform:scaleX(-1);';

      handOverlay = document.createElement('div');
      handOverlay.style.cssText = 'position:fixed;bottom:260px;left:10px;padding:8px 12px;background:rgba(0,0,0,0.7);color:#00ff00;border-radius:4px;font-size:12px;font-family:monospace;z-index:1000;';
      handOverlay.textContent = '手势: 正在初始化摄像头...';

      document.body.appendChild(handVideo);
      document.body.appendChild(handCanvas);
      document.body.appendChild(handOverlay);

      handGestureController = new HandGestureController();
      const success = await handGestureController.initialize(handVideo, handCanvas);

      if (success) {
        handGestureController.onGesture((event: GestureEvent) => {
          if (event.type === 'pinch_start') {
            handOverlay!.textContent = '手势: 捏合 (选中)';
          } else if (event.type === 'pinch_end') {
            handOverlay!.textContent = '手势: 捏合结束';
          } else if (event.type === 'drag_start') {
            handOverlay!.textContent = '手势: 拖动 (平移)';
          } else if (event.type === 'drag_end') {
            handOverlay!.textContent = '手势: 拖动结束';
          } else if (event.type === 'rotate') {
            handOverlay!.textContent = `手势: 旋转 (${(event.gestureState.rotationAngle).toFixed(1)}°)`;
          }
        });

        console.log('[blackhole-web] 手势控制初始化成功');
        return true;
      } else {
        handOverlay!.textContent = '手势: 摄像头不可用';
        handOverlay!.style.color = '#ff4444';
        console.error('[blackhole-web] 手势控制初始化失败');
        return false;
      }
    } catch (error) {
      handOverlay!.textContent = '手势: 初始化错误';
      handOverlay!.style.color = '#ff4444';
      console.error('[blackhole-web] 手势控制初始化错误:', error);
      return false;
    }
  }

  let lastFrameTime = 0;
  const frameInterval = 100;

  async function updateHandGesture(): Promise<void> {
    if (!handGestureController || !params.handControl) return;

    const now = performance.now();
    if (now - lastFrameTime < frameInterval) return;
    lastFrameTime = now;

    try {
      await handGestureController.processFrame();
    } catch (err) {
      console.warn('[HandGesture] 处理帧失败:', err);
      return;
    }

    const state = handGestureController.getState();

    if (state.handDetected) {
      const results = handGestureController.getResults();
      if (results?.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        const palmCenter = landmarks[9];
        handX = palmCenter.x;
        handY = palmCenter.y;

        if (state.isPinching && state.isDragging) {
          mouseX = handX * canvas.width;
          mouseY = (1 - handY) * canvas.height;
        }

        if (state.isRotating) {
          params.cameraRoll += state.rotationAngle;
          params.cameraRoll = Math.max(-180, Math.min(180, params.cameraRoll));
        }
      }

      const gestureName = state.gestureType === 'none' ? '追踪中' :
                         state.gestureType === 'pinch' ? '捏合' :
                         state.gestureType === 'drag' ? '拖动' : '旋转';
      if (handOverlay) {
        handOverlay.textContent = `手势: ${gestureName}`;
      }
    } else {
      if (handOverlay) {
        handOverlay.textContent = '手势: 未检测到手';
      }
    }
  }

  let pipeline: PipelineRTs | null = null;
  let rtFormat: ColorRTFormat = 'rgba8';

  function resizeNow(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width === w && canvas.height === h && pipeline) return;
    canvas.width = w;
    canvas.height = h;
    destroyPipeline(gl, pipeline);
    const r = tryAllocPipeline(gl, w, h, params.antialias);
    pipeline = r.pipeline;
    rtFormat = r.format;
    if (rtFormat === 'rgba8') {
      console.warn(
        '[blackhole-web] 使用 RGBA8 离屏目标（无 EXT_color_buffer_float 或 RGBA16F 不完整）。高亮/Bloom 可能被裁切。',
      );
    }
  }

  let firstFrame = true;
  let taaIdx = 0;

  const ro = new ResizeObserver(() => resizeNow());
  ro.observe(canvas);
  resizeNow();

  const gui = new GUI({ title: '参数' });

  gui.add(params, 'antialias', {
    '关闭 (Off)': 'off',
    '快速边缘平滑 (FXAA)': 'fxaa',
    '时序抗锯齿 (TAA)': 'taa',
  }).name('抗锯齿');

  gui.add(params, 'gravatationalLensing');
  gui.add(params, 'renderBlackHole');
  gui.add(params, 'mouseControl');
  gui.add(params, 'handControl').name('手势控制').onChange(async (enabled: boolean) => {
    if (enabled) {
      if (!handGestureController) {
        const success = await initHandGesture();
        if (!success) {
          params.handControl = false;
        }
      } else {
        handGestureController.setEnabled(true);
      }
    } else {
      handGestureController?.setEnabled(false);
    }
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
  gui.add(params, 'bloomIterations', 1, MAX_BLOOM_ITER, 1);
  gui.add(params, 'bloomStrength', 0, 1);
  gui.add(params, 'tonemappingEnabled');
  gui.add(params, 'gamma', 1, 4);

  async function frame(now: number): Promise<void> {
    requestAnimationFrame(frame);
    const time = now / 1000;
    if (!pipeline) return;

    await updateHandGesture();

    const { width: rw, height: rh, main, mainMsaa, mainResolved, brightness, down, up, bloomFinal, taaBuffers, tonemapped, output } =
      pipeline;
    const n = params.bloomIterations;
    const aaMode = params.antialias;

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
      setF(gl, p.program, p.uniforms, 'adiskEnabled', params.adiskEnabled ? 1 : 0);
      setF(gl, p.program, p.uniforms, 'adiskParticle', params.adiskParticle ? 1 : 0);
      setF(gl, p.program, p.uniforms, 'adiskDensityV', params.adiskDensityV);
      setF(gl, p.program, p.uniforms, 'adiskDensityH', params.adiskDensityH);
      setF(gl, p.program, p.uniforms, 'adiskHeight', params.adiskHeight);
      setF(gl, p.program, p.uniforms, 'adiskLit', params.adiskLit);
      setF(gl, p.program, p.uniforms, 'adiskNoiseLOD', params.adiskNoiseLOD);
      setF(gl, p.program, p.uniforms, 'adiskNoiseScale', params.adiskNoiseScale);
      setF(gl, p.program, p.uniforms, 'adiskSpeed', params.adiskSpeed);
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

    firstFrame = false;
  }

  requestAnimationFrame(frame);
}

main().catch((e) => {
  console.error(e);
  document.body.innerHTML += `<pre style="color:#faa;padding:1rem">${String(e)}</pre>`;
});
