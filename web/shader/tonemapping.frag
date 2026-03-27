#version 300 es
precision highp float;

in vec2 uv;

out vec4 fragColor;

uniform float gamma;
uniform float tonemappingEnabled;
uniform sampler2D texture0;
uniform vec2 resolution;

vec3 aces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  fragColor = texture(texture0, uv);
  if (tonemappingEnabled > 0.5) {
    fragColor.rgb = aces(fragColor.rgb);
    fragColor.rgb = pow(fragColor.rgb, vec3(1.0 / gamma));
  }
}
