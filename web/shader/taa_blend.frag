#version 300 es
precision highp float;

in vec2 uv;
out vec4 fragColor;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform float firstFrame;

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 texelSize = 1.0 / vec2(textureSize(texture0, 0));

  vec3 current = texture(texture0, uv).rgb;
  vec3 history = texture(texture1, uv).rgb;

  if (firstFrame > 0.5) {
    fragColor = vec4(current, 1.0);
    return;
  }

  float lumaCurrent = luma(current);
  float lumaHistory = luma(history);

  float weight = 1.0 / (1.0 + abs(lumaCurrent - lumaHistory) * 8.0);
  weight = clamp(weight, 0.05, 0.95);

  vec3 blended = mix(current, history, weight);

  float n = 3.0;
  vec3 cMin = vec3(1e10);
  vec3 cMax = vec3(-1e10);
  for (float dx = -1.0; dx <= 1.0; dx += 1.0) {
    for (float dy = -1.0; dy <= 1.0; dy += 1.0) {
      vec3 s = texture(texture0, uv + vec2(dx, dy) * texelSize).rgb;
      cMin = min(cMin, s);
      cMax = max(cMax, s);
    }
  }
  blended = clamp(blended, cMin * 0.5, cMax * 1.5);

  fragColor = vec4(blended, 1.0);
}
