export const MSAASAMPLES = 4;

export type AntialiasMode = 'off' | 'fxaa' | 'taa';

export function compileProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
): WebGLProgram {
  const vs = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vs, vertSrc);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
    throw new Error(`vertex: ${gl.getShaderInfoLog(vs)}`);
  }

  const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fs, fragSrc);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    throw new Error(`fragment: ${gl.getShaderInfoLog(fs)}`);
  }

  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
  }
  return prog;
}

export type ColorRTFormat = 'float16' | 'rgba8';

export function detectRTFormat(gl: WebGL2RenderingContext): ColorRTFormat {
  return gl.getExtension('EXT_color_buffer_float') ? 'float16' : 'rgba8';
}

export interface ColorRT {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
}

export function createColorRT(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  format: ColorRTFormat,
): ColorRT {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  if (format === 'float16') {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA16F,
      width,
      height,
      0,
      gl.RGBA,
      gl.HALF_FLOAT,
      null,
    );
  } else {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
  }

  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(texture);
    throw new Error(`FBO incomplete (${status}), format=${format}`);
  }

  return { texture, fbo };
}

export function destroyColorRT(gl: WebGL2RenderingContext, rt: ColorRT): void {
  gl.deleteFramebuffer(rt.fbo);
  gl.deleteTexture(rt.texture);
}

export interface MSAART {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
}

// Cache whether texImage2DMultisample is available - only warn once
let _msaaSupported: boolean | null = null;

export function createMSAART(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  _format: ColorRTFormat,
  samples: number,
): MSAART | null {
  // Check texImage2DMultisample availability first - only warn once
  if (_msaaSupported === null) {
    const texFn = (gl as unknown as { texImage2DMultisample?: Function }).texImage2DMultisample;
    _msaaSupported = typeof texFn === 'function';
    if (!_msaaSupported) {
      console.warn('[gl] texImage2DMultisample not available - MSAA disabled');
    }
  }
  if (!_msaaSupported) {
    return null;
  }

  // Guard: check WebGL2 context capabilities
  const maxSamples = gl.getParameter(gl.MAX_SAMPLES);
  if (!maxSamples) {
    return null;
  }
  const actualSamples = Math.max(1, Math.min(samples, maxSamples));
  if (actualSamples <= 1) {
    return null;
  }
  if (actualSamples < samples) {
    console.warn(`[gl] MSAA requested ${samples}x but limited to ${actualSamples}x (MAX_SAMPLES=${maxSamples})`);
  }

  const texFn = (gl as unknown as { texImage2DMultisample: Function }).texImage2DMultisample;

  // Now allocate resources with full error recovery
  const texture = gl.createTexture()!;
  const fbo = gl.createFramebuffer()!;

  // Unbind any previously bound textures on all targets to avoid state pollution
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
  gl.bindTexture(gl.TEXTURE_2D_MULTISAMPLE, texture);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

  texFn.call(gl, gl.TEXTURE_2D_MULTISAMPLE, actualSamples, gl.RGBA8, width, height, true);

  gl.framebufferTexture2D(
    gl.DRAW_FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D_MULTISAMPLE,
    texture,
    0,
  );
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D_MULTISAMPLE, null);

  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(texture);
    console.warn('[gl] MSAA FBO incomplete (status=' + status + ')');
    return null;
  }

  return { texture, fbo };
}

export function destroyMSAART(gl: WebGL2RenderingContext, rt: MSAART): void {
  gl.deleteFramebuffer(rt.fbo);
  gl.deleteTexture(rt.texture);
}

export function resolveMSAA(
  gl: WebGL2RenderingContext,
  msaa: MSAART,
  target: ColorRT,
  width: number,
  height: number,
): void {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msaa.fbo);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.fbo);
  gl.blitFramebuffer(
    0, 0, width, height,
    0, 0, width, height,
    gl.COLOR_BUFFER_BIT,
    gl.LINEAR,
  );
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
}

export function createQuadVAO(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const verts = new Float32Array([
    -1, -1, 0, -1, 1, 0, 1, 1, 0, 1, 1, 0, 1, -1, 0, -1, -1, 0,
  ]);
  const vao = gl.createVertexArray()!;
  const vbo = gl.createBuffer()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return vao;
}
