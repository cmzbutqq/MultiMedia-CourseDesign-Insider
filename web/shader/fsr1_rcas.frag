#version 300 es
precision highp float;

out vec4 fragColor;

uniform sampler2D texture0;
uniform float sharpnessStops;

float fsrLuma(vec3 c) {
  return c.b * 0.5 + (c.r * 0.5 + c.g);
}

vec3 fsrLoad(ivec2 p, ivec2 size) {
  ivec2 clamped = clamp(p, ivec2(0), size - ivec2(1));
  return texelFetch(texture0, clamped, 0).rgb;
}

float max3(float a, float b, float c) {
  return max(max(a, b), c);
}

float min3(float a, float b, float c) {
  return min(min(a, b), c);
}

void main() {
  ivec2 size = textureSize(texture0, 0);
  ivec2 ip = ivec2(gl_FragCoord.xy);

  vec3 b = fsrLoad(ip + ivec2( 0, -1), size);
  vec3 d = fsrLoad(ip + ivec2(-1,  0), size);
  vec3 e = fsrLoad(ip, size);
  vec3 f = fsrLoad(ip + ivec2( 1,  0), size);
  vec3 h = fsrLoad(ip + ivec2( 0,  1), size);

  float bL = fsrLuma(b);
  float dL = fsrLuma(d);
  float eL = fsrLuma(e);
  float fL = fsrLuma(f);
  float hL = fsrLuma(h);

  float nz = 0.25 * bL + 0.25 * dL + 0.25 * fL + 0.25 * hL - eL;
  float nzRange = max(max3(max3(bL, dL, eL), fL, hL) - min3(min3(bL, dL, eL), fL, hL), 1e-4);
  nz = clamp(abs(nz) / nzRange, 0.0, 1.0);
  nz = -0.5 * nz + 1.0;

  vec3 mn4 = min(min(min(b, d), f), h);
  vec3 mx4 = max(max(max(b, d), f), h);

  vec3 hitMin = min(mn4, e) / max(4.0 * mx4, vec3(1e-4));
  vec3 hitMax = (vec3(1.0) - max(mx4, e)) / max(4.0 * mn4 - 4.0, vec3(-0.9999));

  vec3 lobeRGB = max(-hitMin, hitMax);
  float lobe = max(-0.1875, min(max3(lobeRGB.r, lobeRGB.g, lobeRGB.b), 0.0));
  lobe *= exp2(-sharpnessStops);
  lobe *= nz;

  float rcpL = 1.0 / (4.0 * lobe + 1.0);
  vec3 color = (lobe * (b + d + f + h) + e) * rcpL;
  fragColor = vec4(color, 1.0);
}
