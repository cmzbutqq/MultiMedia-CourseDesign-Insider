#version 300 es
precision highp float;

out vec4 fragColor;

uniform sampler2D texture0;
uniform vec2 resolution;

float fsrLuma(vec3 c) {
  return c.b * 0.5 + (c.r * 0.5 + c.g);
}

vec3 fsrLoad(ivec2 p, ivec2 size) {
  ivec2 clamped = clamp(p, ivec2(0), size - ivec2(1));
  return texelFetch(texture0, clamped, 0).rgb;
}

void fsrSet(
  inout vec2 dir,
  inout float len,
  float w,
  float lA,
  float lB,
  float lC,
  float lD,
  float lE
) {
  float dc = lD - lC;
  float cb = lC - lB;
  float lenX = max(abs(dc), abs(cb));
  lenX = 1.0 / max(lenX, 1e-6);
  float dirX = lD - lB;
  dir.x += dirX * w;
  lenX = clamp(abs(dirX) * lenX, 0.0, 1.0);
  lenX *= lenX;
  len += lenX * w;

  float ec = lE - lC;
  float ca = lC - lA;
  float lenY = max(abs(ec), abs(ca));
  lenY = 1.0 / max(lenY, 1e-6);
  float dirY = lE - lA;
  dir.y += dirY * w;
  lenY = clamp(abs(dirY) * lenY, 0.0, 1.0);
  lenY *= lenY;
  len += lenY * w;
}

void fsrTap(
  inout vec3 accumColor,
  inout float accumWeight,
  vec2 off,
  vec2 dir,
  vec2 len,
  float lob,
  float clp,
  vec3 c
) {
  vec2 v;
  v.x = off.x * dir.x + off.y * dir.y;
  v.y = off.x * -dir.y + off.y * dir.x;
  v *= len;

  float d2 = min(dot(v, v), clp);
  float wB = 0.4 * d2 - 1.0;
  float wA = lob * d2 - 1.0;
  wB *= wB;
  wA *= wA;
  wB = 1.5625 * wB - 0.5625;
  float w = wB * wA;

  accumColor += c * w;
  accumWeight += w;
}

void main() {
  vec2 sourceSize = vec2(textureSize(texture0, 0));
  ivec2 sourceSizeI = textureSize(texture0, 0);

  vec2 pp = gl_FragCoord.xy * sourceSize / resolution - 0.5;
  vec2 fp = floor(pp);
  vec2 frac = pp - fp;
  ivec2 base = ivec2(fp);

  vec3 b = fsrLoad(base + ivec2( 0, -1), sourceSizeI);
  vec3 c = fsrLoad(base + ivec2( 1, -1), sourceSizeI);
  vec3 e = fsrLoad(base + ivec2(-1,  0), sourceSizeI);
  vec3 f = fsrLoad(base + ivec2( 0,  0), sourceSizeI);
  vec3 g = fsrLoad(base + ivec2( 1,  0), sourceSizeI);
  vec3 h = fsrLoad(base + ivec2( 2,  0), sourceSizeI);
  vec3 i = fsrLoad(base + ivec2(-1,  1), sourceSizeI);
  vec3 j = fsrLoad(base + ivec2( 0,  1), sourceSizeI);
  vec3 k = fsrLoad(base + ivec2( 1,  1), sourceSizeI);
  vec3 l = fsrLoad(base + ivec2( 2,  1), sourceSizeI);
  vec3 n = fsrLoad(base + ivec2(-1,  2), sourceSizeI);
  vec3 o = fsrLoad(base + ivec2( 0,  2), sourceSizeI);

  float bL = fsrLuma(b);
  float cL = fsrLuma(c);
  float eL = fsrLuma(e);
  float fL = fsrLuma(f);
  float gL = fsrLuma(g);
  float hL = fsrLuma(h);
  float iL = fsrLuma(i);
  float jL = fsrLuma(j);
  float kL = fsrLuma(k);
  float lL = fsrLuma(l);
  float nL = fsrLuma(n);
  float oL = fsrLuma(o);

  float w0 = (1.0 - frac.x) * (1.0 - frac.y);
  float w1 = frac.x * (1.0 - frac.y);
  float w2 = (1.0 - frac.x) * frac.y;
  float w3 = frac.x * frac.y;

  vec2 dir = vec2(0.0);
  float len = 0.0;
  fsrSet(dir, len, w0, bL, eL, fL, gL, jL);
  fsrSet(dir, len, w1, cL, fL, gL, hL, kL);
  fsrSet(dir, len, w2, fL, iL, jL, kL, nL);
  fsrSet(dir, len, w3, gL, jL, kL, lL, oL);

  float dirR = dot(dir, dir);
  if (dirR < (1.0 / 32768.0)) {
    dir = vec2(1.0, 0.0);
  } else {
    dir *= inversesqrt(dirR);
  }

  len *= 0.5;
  len *= len;

  float stretch = dot(dir, dir) / max(max(abs(dir.x), abs(dir.y)), 1e-6);
  vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
  float lob = mix(0.5, 0.21, len);
  float clp = 1.0 / lob;

  vec3 min4 = min(min(f, g), min(j, k));
  vec3 max4 = max(max(f, g), max(j, k));

  vec3 accumColor = vec3(0.0);
  float accumWeight = 0.0;
  fsrTap(accumColor, accumWeight, vec2( 0.0, -1.0) - frac, dir, len2, lob, clp, b);
  fsrTap(accumColor, accumWeight, vec2( 1.0, -1.0) - frac, dir, len2, lob, clp, c);
  fsrTap(accumColor, accumWeight, vec2(-1.0,  0.0) - frac, dir, len2, lob, clp, e);
  fsrTap(accumColor, accumWeight, vec2( 0.0,  0.0) - frac, dir, len2, lob, clp, f);
  fsrTap(accumColor, accumWeight, vec2( 1.0,  0.0) - frac, dir, len2, lob, clp, g);
  fsrTap(accumColor, accumWeight, vec2( 2.0,  0.0) - frac, dir, len2, lob, clp, h);
  fsrTap(accumColor, accumWeight, vec2(-1.0,  1.0) - frac, dir, len2, lob, clp, i);
  fsrTap(accumColor, accumWeight, vec2( 0.0,  1.0) - frac, dir, len2, lob, clp, j);
  fsrTap(accumColor, accumWeight, vec2( 1.0,  1.0) - frac, dir, len2, lob, clp, k);
  fsrTap(accumColor, accumWeight, vec2( 2.0,  1.0) - frac, dir, len2, lob, clp, l);
  fsrTap(accumColor, accumWeight, vec2(-1.0,  2.0) - frac, dir, len2, lob, clp, n);
  fsrTap(accumColor, accumWeight, vec2( 0.0,  2.0) - frac, dir, len2, lob, clp, o);

  vec3 color = accumColor / max(accumWeight, 1e-6);
  fragColor = vec4(clamp(color, min4, max4), 1.0);
}
