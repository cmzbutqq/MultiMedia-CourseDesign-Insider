#version 300 es
precision highp float;

in vec2 uv;
out vec4 fragColor;

uniform sampler2D texture0;
uniform vec2 resolution;
uniform int upscaleMode; // 0=bicubic, 1=lanczos2

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

float cubicWeight(float x) {
  float ax = abs(x);
  if (ax <= 1.0) {
    return 1.5 * ax * ax * ax - 2.5 * ax * ax + 1.0;
  }
  if (ax < 2.0) {
    return -0.5 * ax * ax * ax + 2.5 * ax * ax - 4.0 * ax + 2.0;
  }
  return 0.0;
}

float sinc(float x) {
  float ax = abs(x);
  if (ax < 1e-4) {
    return 1.0;
  }
  float pix = 3.141592653589793 * ax;
  return sin(pix) / pix;
}

float lanczosWeight(float x, float a) {
  float ax = abs(x);
  if (ax >= a) {
    return 0.0;
  }
  return sinc(ax) * sinc(ax / a);
}

vec3 samplePixel(vec2 pixelPos, vec2 sourceResolution) {
  vec2 uvPos = clamp((pixelPos + 0.5) / sourceResolution, vec2(0.0), vec2(1.0));
  return texture(texture0, uvPos).rgb;
}

vec3 sampleBicubic(vec2 targetUv, vec2 sourceResolution) {
  vec2 samplePos = targetUv * sourceResolution - 0.5;
  vec2 base = floor(samplePos);
  vec2 frac = samplePos - base;

  vec3 accum = vec3(0.0);
  float weightSum = 0.0;
  for (int y = -1; y <= 2; y++) {
    float wy = cubicWeight(float(y) - frac.y);
    for (int x = -1; x <= 2; x++) {
      float wx = cubicWeight(float(x) - frac.x);
      float w = wx * wy;
      accum += samplePixel(base + vec2(float(x), float(y)), sourceResolution) * w;
      weightSum += w;
    }
  }
  return accum / max(weightSum, 1e-5);
}

vec3 sampleLanczos2(vec2 targetUv, vec2 sourceResolution) {
  vec2 samplePos = targetUv * sourceResolution - 0.5;
  vec2 base = floor(samplePos);
  vec2 frac = samplePos - base;

  vec3 accum = vec3(0.0);
  float weightSum = 0.0;
  for (int y = -1; y <= 2; y++) {
    float wy = lanczosWeight(float(y) - frac.y, 2.0);
    for (int x = -1; x <= 2; x++) {
      float wx = lanczosWeight(float(x) - frac.x, 2.0);
      float w = wx * wy;
      accum += samplePixel(base + vec2(float(x), float(y)), sourceResolution) * w;
      weightSum += w;
    }
  }
  return accum / max(weightSum, 1e-5);
}

void main() {
  vec2 sourceResolution = vec2(textureSize(texture0, 0));
  vec3 color;
  if (upscaleMode == 0) {
    color = sampleBicubic(uv, sourceResolution);
  } else {
    color = sampleLanczos2(uv, sourceResolution);
  }
  fragColor = vec4(color, 1.0);
}
