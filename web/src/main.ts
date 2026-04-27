import GUI from 'lil-gui';
import {
  type ColorRT,
  type ColorRTFormat,
  compileProgram,
  createColorRT,
  createQuadVAO,
  destroyColorRT,
  detectRTFormat,
} from './gl.js';
import { loadCubemap, loadTexture2D } from './resources.js';
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

import simpleVert from '../shader/simple.vert?raw';
import blackholeMainFrag from '../shader/blackhole_main.frag?raw';
import bloomBrightnessFrag from '../shader/bloom_brightness_pass.frag?raw';
import bloomDownFrag from '../shader/bloom_downsample.frag?raw';
import bloomUpFrag from '../shader/bloom_upsample.frag?raw';
import bloomCompositeFrag from '../shader/bloom_composite.frag?raw';
import tonemappingFrag from '../shader/tonemapping.frag?raw';
import passthroughFrag from '../shader/passthrough.frag?raw';

const MAX_BLOOM_ITER = 8;
const MAX_DPR = 2;
const LENS_MASS_REF = 10;

interface Params {
  gravatationalLensing: boolean;
  renderBlackHole: boolean;
  mouseControl: boolean;
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
  gravatationalLensing: true,
  renderBlackHole: true,
  mouseControl: true,
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

interface PipelineRTs {
  main: ColorRT;
  brightness: ColorRT;
  down: ColorRT[];
  up: ColorRT[];
  bloomFinal: ColorRT;
  tonemapped: ColorRT;
  width: number;
  height: number;
  format: ColorRTFormat;
}

function destroyPipeline(gl: WebGL2RenderingContext, p: PipelineRTs | null): void {
  if (!p) return;
  destroyColorRT(gl, p.main);
  destroyColorRT(gl, p.brightness);
  destroyColorRT(gl, p.bloomFinal);
  destroyColorRT(gl, p.tonemapped);
  for (const rt of p.down) destroyColorRT(gl, rt);
  for (const rt of p.up) destroyColorRT(gl, rt);
}

function allocPipeline(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  format: ColorRTFormat,
): PipelineRTs {
  const main = createColorRT(gl, width, height, format);
  const brightness = createColorRT(gl, width, height, format);
  const bloomFinal = createColorRT(gl, width, height, format);
  const tonemapped = createColorRT(gl, width, height, format);
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
  return { main, brightness, down, up, bloomFinal, tonemapped, width, height, format };
}

function tryAllocPipeline(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): { pipeline: PipelineRTs; format: ColorRTFormat } {
  const preferred = detectRTFormat(gl);
  try {
    return { pipeline: allocPipeline(gl, width, height, preferred), format: preferred };
  } catch {
    if (preferred === 'float16') {
      return { pipeline: allocPipeline(gl, width, height, 'rgba8'), format: 'rgba8' };
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

function setV3(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  cache: UniformMap,
  name: string,
  x: number,
  y: number,
  z: number,
): void {
  const loc = ulCache(gl, program, cache, name);
  if (loc) gl.uniform3f(loc, x, y, z);
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
    throw new Error('需要支持 WebGL2 的浏览器');
  }
  const gl: WebGL2RenderingContext = glCtx;

  const scene: SceneState = createDefaultScene();
  let initialSnapshot = cloneSceneState(scene);
  const trails = new TrailBuffer();

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
      passthrough: makePass(gl, simpleVert, passthroughFrag),
    }),
  ]);

  setI1(gl, passes.passthrough.program, passes.passthrough.uniforms, 'texture0', 0);

  let mouseX = 0;
  let mouseY = 0;

  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    mouseX = (e.clientX - rect.left) * sx;
    mouseY = (e.clientY - rect.top) * sy;
  });

  let pipeline: PipelineRTs | null = null;
  let rtFormat: ColorRTFormat = 'rgba8';

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
    if (canvas.width === w && canvas.height === h && pipeline) {
      resizeTrailCanvas();
      return;
    }
    canvas.width = w;
    canvas.height = h;
    destroyPipeline(gl, pipeline);
    const r = tryAllocPipeline(gl, w, h);
    pipeline = r.pipeline;
    rtFormat = r.format;
    resizeTrailCanvas();
    if (rtFormat === 'rgba8') {
      console.warn(
        '[blackhole-web] 使用 RGBA8 离屏目标（无 EXT_color_buffer_float 或 RGBA16F 不完整）。高亮/Bloom 可能被裁切。',
      );
    }
  }

  const ro = new ResizeObserver(() => resizeNow());
  ro.observe(canvas);
  resizeNow();

  const gui = new GUI({ title: '参数' });

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

  function drawTrails(time: number): void {
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

  function frame(now: number): void {
    requestAnimationFrame(frame);
    const time = now / 1000;
    if (!pipeline) return;

    stepScene(scene);

    if (scene.showTrails) {
      for (let bi = 0; bi < scene.bodyCount; bi++) {
        const b = scene.bodies[bi]!;
        trails.push(bi, b.position[0], b.position[1], b.position[2]);
      }
    }

    const { width: rw, height: rh, main, brightness, down, up, bloomFinal, tonemapped } =
      pipeline;
    const n = params.bloomIterations;

    drawPass(gl, vao, passes.blackhole, main.fbo, rw, rh, time, () => {
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
      
      // 应用时间缩放到吸积盘流动速度
      let effectiveAdiskSpeed = params.adiskSpeed;
      if (scene.timeWarp.enabled && scene.bodyCount >= 1) {
        const b0 = scene.bodies[0]!;
        // 计算吸积盘中心附近的时间缩放因子（距离为黑洞半径的2倍处）
        const refDist = b0.visual.size * 2;
        const refPos: [number, number, number] = [b0.position[0] + refDist, b0.position[1], b0.position[2]];
        const timeWarpFactor = calculateTimeWarp(refPos, b0.position, b0.mass, scene);
        effectiveAdiskSpeed *= timeWarpFactor;
      }
      setF(gl, p.program, p.uniforms, 'adiskSpeed', effectiveAdiskSpeed);

      bindSceneUniforms(gl, p, scene);
    });

    drawPass(gl, vao, passes.bloomBright, brightness.fbo, rw, rh, time, () => {
      const p = passes.bloomBright;
      setI1(gl, p.program, p.uniforms, 'texture0', 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, main.texture);
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
      gl.bindTexture(gl.TEXTURE_2D, main.texture);
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

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    drawPass(gl, vao, passes.passthrough, null, canvas.width, canvas.height, time, () => {
      setI1(gl, passes.passthrough.program, passes.passthrough.uniforms, 'texture0', 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tonemapped.texture);
    });

    drawTrails(time);
  }

  requestAnimationFrame(frame);
}

main().catch((e) => {
  console.error(e);
  document.body.innerHTML += `<pre style="color:#faa;padding:1rem">${String(e)}</pre>`;
});
