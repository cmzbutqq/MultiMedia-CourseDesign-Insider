#version 300 es
precision highp float;

in vec2 uv;
out vec4 fragColor;

uniform sampler2D texture0;
uniform vec2 resolution;

/*
 * FXAA (Fast Approximate Anti-Aliasing)
 * Based on NVIDIA's FXAA II algorithm (public domain)
 * https://www.shadertoy.com/view/5dfGDs
 */

#define FXAA_QUALITY_LOW    0
#define FXAA_QUALITY_MEDIUM 1
#define FXAA_QUALITY_HIGH   2

#ifndef FXAA_QUALITY
#define FXAA_QUALITY FXAA_QUALITY_HIGH
#endif

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

#if FXAA_QUALITY == FXAA_QUALITY_LOW
const int FXAA_STEPS = 4;
const float FXAA_STEP_SIZE = 1.5;
#elif FXAA_QUALITY == FXAA_QUALITY_MEDIUM
const int FXAA_STEPS = 8;
const float FXAA_STEP_SIZE = 1.2;
#else
const int FXAA_STEPS = 12;
const float FXAA_STEP_SIZE = 1.0;
#endif

void main() {
  vec2 pp = 1.0 / resolution;
  float px = max(pp.x, pp.y);

  vec3 colCenter = texture(texture0, uv).rgb;
  float lumaCenter = luma(colCenter);

  // Compute contrast (local luminance delta)
  float lumaNorth = luma(texture(texture0, uv + vec2(0.0, pp.y)).rgb);
  float lumaSouth = luma(texture(texture0, uv - vec2(0.0, pp.y)).rgb);
  float lumaWest  = luma(texture(texture0, uv - vec2(pp.x, 0.0)).rgb);
  float lumaEast  = luma(texture(texture0, uv + vec2(pp.x, 0.0)).rgb);

  float lumaMin = min(lumaCenter, min(min(lumaNorth, lumaSouth), min(lumaWest, lumaEast)));
  float lumaMax = max(lumaCenter, max(max(lumaNorth, lumaSouth), max(lumaWest, lumaEast)));
  float contrast = lumaMax - lumaMin;

  // Exit early if contrast is below threshold (not an edge)
  if (contrast < max(0.04, lumaMax * 0.08)) {
    fragColor = vec4(colCenter, 1.0);
    return;
  }

  // Determine edge direction
  float lumaRange = lumaMax - lumaMin;
  bool isHorizontal = abs(lumaNorth - lumaSouth) > abs(lumaEast - lumaWest);

  float sub = isHorizontal ? pp.y : pp.x;
  vec2 dir = isHorizontal ? vec2(0.0, 1.0) : vec2(1.0, 0.0);

  // Blend weight along edge normal
  float lumaAvgN = (lumaNorth + lumaSouth) * 0.5;
  float lumaAvgWE = (lumaWest + lumaEast) * 0.5;
  float gradientN = abs(lumaAvgN - lumaCenter);
  float gradientWE = abs(lumaAvgWE - lumaCenter);
  float blendN = gradientN + gradientWE;
  vec2 edgeNormal = isHorizontal ? vec2(-dir.y, dir.x) : vec2(dir.x, -dir.y);

  // Sample along the edge (low quality = fewer samples)
  vec3 colAlong = colCenter;
  float sumW = 1.0;
  for (int i = 1; i <= FXAA_STEPS; i++) {
    float t = float(i) * FXAA_STEP_SIZE;
    vec2 offset = edgeNormal * t * px * 2.0;
    vec3 s = texture(texture0, uv + offset).rgb;
    float l = luma(s);
    float w = max(0.0, 1.0 - abs(l - lumaCenter) / lumaRange) * (1.0 - float(i) / float(FXAA_STEPS + 1));
    colAlong += s * w;
    sumW += w;
  }
  colAlong /= sumW;

  // Also sample perpendicular to edge (blur across edge)
  vec3 colPerp = colCenter;
  float sumW2 = 1.0;
  for (int i = 1; i <= FXAA_STEPS; i++) {
    float t = float(i) * FXAA_STEP_SIZE * sub * 4.0;
    vec2 offset = dir * t;
    vec3 s0 = texture(texture0, uv + offset).rgb;
    vec3 s1 = texture(texture0, uv - offset).rgb;
    float w = 1.0 - float(i) / float(FXAA_STEPS + 1);
    colPerp += (s0 + s1) * w * 0.5;
    sumW2 += w * 2.0;
  }
  colPerp /= sumW2;

  // Choose blend direction based on which side has less contrast
  float dirblend = abs(lumaAvgN - lumaCenter) / blendN + abs(lumaAvgWE - lumaCenter) / blendN;
  float blendFinal = clamp((dirblend - 1.5) / 7.0, 0.0, 1.0);

  vec3 result = mix(colAlong, colPerp, blendFinal);

  // Clamp to [lumaMin, lumaMax] to avoid over-blurring
  float lumaResult = luma(result);
  result = mix(vec3(lumaMin), result, smoothstep(0.0, 0.5, abs(lumaResult - lumaMin) / max(0.0001, lumaMax - lumaMin)));
  result = clamp(result, vec3(0.0), vec3(1.0));

  fragColor = vec4(result, 1.0);
}
