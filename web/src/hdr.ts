export interface HdrImageData {
  width: number;
  height: number;
  data: Float32Array;
}

function readAsciiLine(
  bytes: Uint8Array,
  decoder: TextDecoder,
  offset: number,
): { line: string; nextOffset: number } {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0x0a) {
    end += 1;
  }
  const lineBytes = end > offset && bytes[end - 1] === 0x0d
    ? bytes.subarray(offset, end - 1)
    : bytes.subarray(offset, end);
  return {
    line: decoder.decode(lineBytes),
    nextOffset: end < bytes.length ? end + 1 : end,
  };
}

export function parseRadianceHdr(buffer: ArrayBuffer): HdrImageData {
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder('ascii');

  let offset = 0;
  let width = 0;
  let height = 0;
  let xAxisSign: '+' | '-' = '+';
  let yAxisSign: '+' | '-' = '-';
  let formatFound = false;

  while (offset < bytes.length) {
    const { line, nextOffset } = readAsciiLine(bytes, decoder, offset);
    offset = nextOffset;
    if (line.startsWith('FORMAT=')) {
      formatFound = line.includes('32-bit_rle_rgbe');
      continue;
    }
    const resolutionMatch = line.match(/^([+-])Y\s+(\d+)\s+([+-])X\s+(\d+)$/);
    if (resolutionMatch) {
      yAxisSign = resolutionMatch[1] as '+' | '-';
      height = Number.parseInt(resolutionMatch[2]!, 10);
      xAxisSign = resolutionMatch[3] as '+' | '-';
      width = Number.parseInt(resolutionMatch[4]!, 10);
      break;
    }
  }

  if (!formatFound) {
    throw new Error('Unsupported HDR format; expected Radiance RGBE.');
  }
  if (width <= 0 || height <= 0) {
    throw new Error('Invalid HDR dimensions.');
  }

  const data = new Float32Array(width * height * 4);
  const scanline = new Uint8Array(width * 4);

  for (let y = 0; y < height; y += 1) {
    if (offset + 4 > bytes.length) {
      throw new Error('Unexpected end of HDR data.');
    }

    const rleMarker0 = bytes[offset]!;
    const rleMarker1 = bytes[offset + 1]!;
    const scanlineWidth = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (rleMarker0 !== 2 || rleMarker1 !== 2 || scanlineWidth !== width) {
      throw new Error('Unsupported HDR scanline encoding.');
    }
    offset += 4;

    for (let channel = 0; channel < 4; channel += 1) {
      let x = 0;
      while (x < width) {
        if (offset >= bytes.length) {
          throw new Error('Unexpected end of HDR RLE stream.');
        }
        const count = bytes[offset]!;
        offset += 1;
        if (count > 128) {
          const runLength = count - 128;
          if (runLength <= 0 || x + runLength > width || offset >= bytes.length) {
            throw new Error('Invalid HDR RLE run.');
          }
          const value = bytes[offset]!;
          offset += 1;
          scanline.fill(value, channel * width + x, channel * width + x + runLength);
          x += runLength;
          continue;
        }

        if (count === 0 || x + count > width || offset + count > bytes.length) {
          throw new Error('Invalid HDR literal run.');
        }
        scanline.set(bytes.subarray(offset, offset + count), channel * width + x);
        offset += count;
        x += count;
      }
    }

    const destY = yAxisSign === '-' ? y : height - 1 - y;
    for (let x = 0; x < width; x += 1) {
      const destX = xAxisSign === '+' ? x : width - 1 - x;
      const pixelIndex = (destY * width + destX) * 4;
      const exponent = scanline[x + width * 3]!;
      if (exponent === 0) {
        data[pixelIndex] = 0;
        data[pixelIndex + 1] = 0;
        data[pixelIndex + 2] = 0;
        data[pixelIndex + 3] = 1;
        continue;
      }

      const scale = Math.pow(2, exponent - 136);
      data[pixelIndex] = scanline[x] * scale;
      data[pixelIndex + 1] = scanline[x + width] * scale;
      data[pixelIndex + 2] = scanline[x + width * 2] * scale;
      data[pixelIndex + 3] = 1;
    }
  }

  return { width, height, data };
}

function createToneMappedFallback(hdr: HdrImageData): Uint8Array {
  const ldr = new Uint8Array(hdr.width * hdr.height * 4);
  for (let i = 0; i < hdr.data.length; i += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const linear = hdr.data[i + channel]!;
      const mapped = linear / (1 + linear);
      const gamma = Math.pow(Math.max(mapped, 0), 1 / 2.2);
      ldr[i + channel] = Math.round(Math.min(255, gamma * 255));
    }
    ldr[i + 3] = 255;
  }
  return ldr;
}

export async function loadHdrTexture2D(
  gl: WebGL2RenderingContext,
  url: string,
): Promise<WebGLTexture> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HDR fetch failed: ${response.status} ${response.statusText}`);
  }

  const hdr = parseRadianceHdr(await response.arrayBuffer());
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, hdr.width, hdr.height, 0, gl.RGBA, gl.FLOAT, hdr.data);

  const error = gl.getError();
  if (error !== gl.NO_ERROR) {
    const ldr = createToneMappedFallback(hdr);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, hdr.width, hdr.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, ldr);
  }

  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}
