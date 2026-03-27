#version 300 es
precision highp float;

uniform sampler2D texture0;
uniform vec2 resolution;

const float brightPassThreshold = 1.0;
const vec3 luminanceVector = vec3(0.2125, 0.7154, 0.0721);

out vec4 fragColor;

void main() {
  vec2 texCoord = gl_FragCoord.xy / resolution.xy;
  vec4 c = texture(texture0, texCoord);
  float luminance = dot(luminanceVector, c.xyz);
  luminance = max(0.0, luminance - brightPassThreshold);
  c.xyz *= sign(luminance);
  c.a = 1.0;
  fragColor = c;
}
