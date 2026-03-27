#version 300 es
precision highp float;

in vec2 uv;

out vec4 fragColor;

uniform float tone;
uniform float bloomStrength;
uniform sampler2D texture0;
uniform sampler2D texture1;
uniform vec2 resolution;

void main() {
  fragColor = texture(texture0, uv) * tone + texture(texture1, uv) * bloomStrength;
}
