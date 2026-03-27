#version 300 es
precision highp float;

uniform vec2 resolution;
uniform sampler2D texture0;

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  fragColor = texture(texture0, uv);
}
