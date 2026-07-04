import { loadHdrTexture2D } from './hdr.js';

const CUBEMAP_FACES = ['right', 'left', 'top', 'bottom', 'front', 'back'] as const;
const SKYBOX_FILE_URLS = import.meta.glob('../public/assets/skybox_*/*.{png,jpg,jpeg,webp,avif,hdr}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export interface SkyboxSource {
  id: string;
  kind: 'cubemap' | 'panorama';
  files: Array<{
    name: string;
    url: string;
  }>;
}

export interface SkyboxAsset {
  kind: 'cubemap' | 'panorama';
  cubemap: WebGLTexture;
  panorama: WebGLTexture;
}

function isHdrFileName(name: string): boolean {
  return /\.hdr$/i.test(name);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Image failed: ${url}`));
    img.src = url;
  });
}

function createSolidTexture2D(
  gl: WebGL2RenderingContext,
  rgba: [number, number, number, number],
): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array(rgba),
  );
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

function createFallbackCubemap(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
  const fallbackPixel = new Uint8Array([48, 24, 72, 255]);
  for (let i = 0; i < CUBEMAP_FACES.length; i++) {
    gl.texImage2D(
      gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      fallbackPixel,
    );
  }
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
  return tex;
}

export function listSkyboxSources(): SkyboxSource[] {
  const groups = new Map<string, Array<{ name: string; url: string }>>();
  for (const [path, url] of Object.entries(SKYBOX_FILE_URLS)) {
    const normalized = path.replace(/\\/g, '/');
    const match = normalized.match(/\/assets\/(skybox_[^/]+)\/[^/]+$/);
    if (!match) continue;
    const id = match[1]!;
    const name = normalized.split('/').pop() ?? '';
    const file = { name, url };
    const group = groups.get(id);
    if (group) {
      group.push(file);
      continue;
    }
    groups.set(id, [file]);
  }

  const sources: SkyboxSource[] = [];
  for (const [id, files] of groups.entries()) {
    const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name));
    if (sortedFiles.length === 1) {
      sources.push({ id, kind: 'panorama', files: sortedFiles });
      continue;
    }
    if (sortedFiles.length === 6) {
      sources.push({ id, kind: 'cubemap', files: sortedFiles });
      continue;
    }
    console.warn(`[resources] Ignoring skybox "${id}" because it has ${sortedFiles.length} images; expected 1 or 6.`);
  }

  return sources.sort((a, b) => a.id.localeCompare(b.id));
}

async function loadCubemapFromUrls(
  gl: WebGL2RenderingContext,
  files: SkyboxSource['files'],
): Promise<WebGLTexture> {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);

  const fallbackPixel = new Uint8Array([48, 24, 72, 255]);
  const faceUrls = new Map<string, string>();
  for (const file of files) {
    const faceName = file.name.replace(/\.[^.]+$/, '');
    faceUrls.set(faceName, file.url);
  }

  await Promise.all(
    CUBEMAP_FACES.map(async (face, i) => {
      const url = faceUrls.get(face);
      try {
        if (!url) throw new Error(`Missing face ${face}`);
        const img = await loadImage(url);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
        gl.texImage2D(
          gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          img,
        );
      } catch {
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
        gl.texImage2D(
          gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
          0,
          gl.RGBA,
          1,
          1,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          fallbackPixel,
        );
      }
    }),
  );

  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
  return tex;
}

/** Cubemap face order matches desktop `loadCubemap`: +X,-X,+Y,-Y,+Z,-Z → right,left,top,bottom,front,back */
export async function loadCubemap(
  gl: WebGL2RenderingContext,
  basePath: string,
): Promise<WebGLTexture> {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);

  const fallbackPixel = new Uint8Array([48, 24, 72, 255]);

  await Promise.all(
    CUBEMAP_FACES.map(async (face, i) => {
      const url = `${basePath}/${face}.png`;
      try {
        const img = await loadImage(url);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
        gl.texImage2D(
          gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          img,
        );
      } catch {
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
        gl.texImage2D(
          gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
          0,
          gl.RGBA,
          1,
          1,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          fallbackPixel,
        );
      }
    }),
  );

  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
  return tex;
}

export async function loadSkyboxAsset(
  gl: WebGL2RenderingContext,
  source: SkyboxSource,
): Promise<SkyboxAsset> {
  if (source.kind === 'cubemap') {
    return {
      kind: 'cubemap',
      cubemap: await loadCubemapFromUrls(gl, source.files),
      panorama: createSolidTexture2D(gl, [48, 24, 72, 255]),
    };
  }
  return {
    kind: 'panorama',
    cubemap: createFallbackCubemap(gl),
    panorama: isHdrFileName(source.files[0]!.name)
      ? await loadHdrTexture2D(gl, source.files[0]!.url)
      : await loadTexture2D(gl, source.files[0]!.url),
  };
}

export async function loadTexture2D(
  gl: WebGL2RenderingContext,
  url: string,
): Promise<WebGLTexture> {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  try {
    const img = await loadImage(url);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  } catch {
    const w = 256;
    const h = 2;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const t = x / (w - 1);
        data[i] = Math.floor(80 + 120 * t);
        data[i + 1] = Math.floor(40 + 40 * t);
        data[i + 2] = Math.floor(20 + 30 * t);
        data[i + 3] = 255;
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}
