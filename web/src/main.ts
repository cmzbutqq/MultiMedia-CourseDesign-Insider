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

  function resizeNow(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width === w && canvas.height === h && pipeline) return;
    canvas.width = w;
    canvas.height = h;
    destroyPipeline(gl, pipeline);
    const r = tryAllocPipeline(gl, w, h);
    pipeline = r.pipeline;
    rtFormat = r.format;
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

  function frame(now: number): void {
    requestAnimationFrame(frame);
    const time = now / 1000;
    if (!pipeline) return;

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
      setF(gl, p.program, p.uniforms, 'adiskSpeed', params.adiskSpeed);
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
  }

  requestAnimationFrame(frame);
}

main().catch((e) => {
  console.error(e);
  document.body.innerHTML += `<pre style="color:#faa;padding:1rem">${String(e)}</pre>`;
});
