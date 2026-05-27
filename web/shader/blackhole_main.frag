#version 300 es
precision highp float;
precision highp int;

const float PI = 3.14159265359;
const float EPSILON = 0.0001;
const float INF_TRACE = 1000000.0;

out vec4 fragColor;

uniform vec2 resolution;
uniform float mouseX;
uniform float mouseY;

uniform float time;
uniform samplerCube galaxy;
uniform sampler2D colorMap;

uniform float frontView;
uniform float topView;
uniform float cameraRoll;
uniform float playbackCamera;
uniform vec3 playbackCameraPos;

uniform float gravatationalLensing;
uniform float renderBlackHole;
uniform float mouseControl;
uniform float fovScale;

uniform float adiskEnabled;
uniform float adiskParticle;
uniform float adiskHeight;
uniform float adiskLit;
uniform float adiskDensityV;
uniform float adiskDensityH;
uniform float adiskNoiseScale;
uniform float adiskNoiseLOD;
uniform float adiskSpeed;

const int MAX_BODIES_I = 5;

uniform float bodyCount;
uniform vec3 bodyCenter[5];
uniform float bodyLensStrength[5];
uniform float bodyKind[5];
uniform float bodySize[5];
uniform vec3 glowColor[5];
uniform float glowIntensity[5];
uniform float adiskGain[5];

uniform vec3 adiskOrigin;
uniform float adiskDiskSize;
uniform float adiskDiskGain;

// === 相对论视觉效应 ===
uniform float dopplerEnabled;
uniform float dopplerStrength;
uniform float dopplerBeta;        // 轨道速度/光速 (0-0.5)

uniform float beamingEnabled;
uniform float beamingPower;       // 聚束指数 (1-6, 物理标准 ~3.5)

uniform float spinEnabled;
uniform float spinA;              // Kerr 自旋参数 (0-0.998)

struct Ring {
  vec3 center;
  vec3 normal;
  float innerRadius;
  float outerRadius;
  float rotateSpeed;
};

vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;

  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y +
                           vec4(0.0, i1.y, i2.y, 1.0)) +
                   i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 1.0 / 7.0;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm =
      taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m =
      max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 *
         dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float ringDistance(vec3 rayOrigin, vec3 rayDir, Ring ring) {
  float denominator = dot(rayDir, ring.normal);
  float constant = -dot(ring.center, ring.normal);
  if (abs(denominator) < EPSILON) {
    return -1.0;
  }
  float t = -(dot(rayOrigin, ring.normal) + constant) / denominator;
  if (t < 0.0) {
    return -1.0;
  }

  vec3 intersection = rayOrigin + t * rayDir;
  float d = length(intersection - ring.center);
  if (d >= ring.innerRadius && d <= ring.outerRadius) {
    return t;
  }
  return -1.0;
}

vec3 panoramaColor(sampler2D tex, vec3 dir) {
  vec2 puv = vec2(0.5 - atan(dir.z, dir.x) / PI * 0.5, 0.5 - asin(dir.y) / PI);
  return texture(tex, puv).rgb;
}

vec3 accel(float h2, vec3 pos) {
  float r2 = max(dot(pos, pos), EPSILON * EPSILON);
  float r5 = pow(r2, 2.5);
  return -1.5 * h2 * pos / r5 * 1.0;
}

vec4 quadFromAxisAngle(vec3 axis, float angle) {
  vec4 qr;
  float half_angle = (angle * 0.5) * 3.14159 / 180.0;
  qr.x = axis.x * sin(half_angle);
  qr.y = axis.y * sin(half_angle);
  qr.z = axis.z * sin(half_angle);
  qr.w = cos(half_angle);
  return qr;
}

vec4 quadConj(vec4 q) { return vec4(-q.x, -q.y, -q.z, q.w); }

vec4 quat_mult(vec4 q1, vec4 q2) {
  vec4 qr;
  qr.x = (q1.w * q2.x) + (q1.x * q2.w) + (q1.y * q2.z) - (q1.z * q2.y);
  qr.y = (q1.w * q2.y) - (q1.x * q2.z) + (q1.y * q2.w) + (q1.z * q2.x);
  qr.z = (q1.w * q2.z) + (q1.x * q2.y) - (q1.y * q2.x) + (q1.z * q2.w);
  qr.w = (q1.w * q2.w) - (q1.x * q2.x) - (q1.y * q2.y) - (q1.z * q2.z);
  return qr;
}

vec3 rotateVector(vec3 position, vec3 axis, float angle) {
  vec4 qr = quadFromAxisAngle(axis, angle);
  vec4 qr_conj = quadConj(qr);
  vec4 q_pos = vec4(position.x, position.y, position.z, 0.0);

  vec4 q_tmp = quat_mult(qr, q_pos);
  qr = quat_mult(q_tmp, qr_conj);

  return vec3(qr.x, qr.y, qr.z);
}

vec3 toSpherical(vec3 p) {
  float rho = sqrt((p.x * p.x) + (p.y * p.y) + (p.z * p.z));
  float theta = atan(p.z, p.x);
  float phi_r = asin(p.y / rho);
  return vec3(rho, theta, phi_r);
}

void ringColor(vec3 rayOrigin, vec3 rayDir, Ring ring, inout float minDistance,
               inout vec3 color) {
  float distance = ringDistance(rayOrigin, normalize(rayDir), ring);
  if (distance >= EPSILON && distance < minDistance &&
      distance <= length(rayDir) + EPSILON) {
    minDistance = distance;

    vec3 intersection = rayOrigin + normalize(rayDir) * minDistance;
    vec3 ringCol;

    {
      vec3 base = cross(ring.normal, vec3(0.0, 0.0, 1.0));
      float angle = acos(dot(normalize(base), normalize(intersection)));
      if (dot(cross(base, intersection), ring.normal) < 0.0)
        angle = -angle;

      float u = 0.5 - 0.5 * angle / PI;
      u += time * ring.rotateSpeed;

      vec3 col_inner = vec3(0.0, 0.5, 0.0);
      ringCol = vec3(col_inner);
    }

    color += ringCol;
  }
}

mat3 lookAt(vec3 origin, vec3 target, float roll) {
  vec3 rr = vec3(sin(roll), cos(roll), 0.0);
  vec3 forward = target - origin;
  float forwardLen = length(forward);
  vec3 ww = forwardLen > EPSILON ? forward / forwardLen : vec3(0.0, 0.0, 1.0);
  vec3 uuRaw = cross(ww, rr);
  if (length(uuRaw) <= EPSILON) {
    rr = abs(ww.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    uuRaw = cross(ww, rr);
  }
  vec3 uu = normalize(uuRaw);
  vec3 vv = normalize(cross(uu, ww));

  return mat3(uu, vv, ww);
}

void adiskColor(vec3 posWorld, inout vec3 color, inout float alpha) {
  vec3 pos = posWorld - adiskOrigin;

  // === 黑洞自旋：ISCO 半径随 a 收缩（a=0 时 6M，a=1 时 ~1M，近似 Kerr 顺旋 ISCO）===
  float innerScale = 2.6;
  if (spinEnabled > 0.5) {
    innerScale = mix(2.6, 1.0, clamp(spinA, 0.0, 0.998));
  }
  float innerRadius = innerScale * adiskDiskSize;
  float outerRadius = 12.0 * adiskDiskSize;
  float hDisk = max(adiskHeight * adiskDiskSize, EPSILON);

  float density = max(
      0.0, 1.0 - length(pos.xyz / vec3(outerRadius, hDisk, outerRadius)));
  if (density < 0.001) {
    return;
  }

  density *= pow(1.0 - abs(pos.y) / hDisk, adiskDensityV);
  density *= smoothstep(innerRadius, innerRadius * 1.1, length(pos));

  if (density < 0.001) {
    return;
  }

  vec3 sphericalCoord = toSpherical(pos);

  sphericalCoord.y *= 2.0;
  sphericalCoord.z *= 4.0;

  density *= 1.0 / pow(sphericalCoord.x, adiskDensityH);
  density *= 16000.0;

  if (adiskParticle < 0.5) {
    color += vec3(0.0, 1.0, 0.0) * density * 0.02 * adiskDiskGain;
    return;
  }

  float noise = 1.0;
  for (int i = 0; i < 12; i++) {
    if (float(i) >= adiskNoiseLOD) {
      break;
    }
    noise *= 0.5 * snoise(sphericalCoord * pow(float(i), 2.0) * adiskNoiseScale) + 0.5;
    if (i % 2 == 0) {
      sphericalCoord.y += time * adiskSpeed;
    } else {
      sphericalCoord.y -= time * adiskSpeed;
    }
  }

  vec3 dustColor =
      texture(colorMap, vec2(sphericalCoord.x / outerRadius, 0.5)).rgb;

  // === 相对论视觉因子：多普勒色偏 + 束宽增强 ===
  // 吸积盘绕 Y 轴旋转：在盘平面上，半径方向 r̂，轨道速度方向 v̂ = (Y × r̂)
  // 视线方向取相机到采样点的方向（近似），径向速度分量决定红/蓝移
  float dopplerFactor = 1.0;     // 频率比 ν_obs/ν_emit
  float beamingFactor = 1.0;     // 亮度增益 = D^(3+α)
  if ((dopplerEnabled > 0.5 || beamingEnabled > 0.5) && length(pos.xz) > EPSILON) {
    // 盘平面内的半径方向
    vec3 rHat = normalize(vec3(pos.x, 0.0, pos.z));
    // 轨道速度方向（开普勒方向，绕 +Y 旋转 -> v = Y × r）
    vec3 vHat = normalize(cross(vec3(0.0, 1.0, 0.0), rHat));

    // 开普勒速度 ∝ 1/sqrt(r)，归一化到滑条上限 dopplerBeta（β=v/c）
    float rRel = max(length(pos.xz) / max(innerRadius, EPSILON), 1.0);
    float beta = clamp(dopplerBeta, 0.0, 0.5) / sqrt(rRel);

    // 自旋下的 frame-dragging 近似：顺旋方向额外加速、逆旋方向减速
    if (spinEnabled > 0.5) {
      // 简单的拖曳项，幅度 ∝ a / r²
      float drag = 0.15 * clamp(spinA, 0.0, 0.998) / max(rRel * rRel, 1.0);
      beta += drag;
    }
    beta = clamp(beta, 0.0, 0.95);

    // 视线方向（相机 → 采样点 → 我们近似为采样点的视径方向）
    // 注意：traceColor 中是从相机沿 dir 步进，这里没有直接的 viewDir，
    // 用 sample 到 adiskOrigin 的方向作为代理视线（最常用近似）
    vec3 viewDir = normalize(adiskOrigin - posWorld);

    // 径向速度（朝向观察者为正）
    float vDotN = dot(vHat, -viewDir) * beta;        // 取负号让"迎面"为正
    float gamma = 1.0 / sqrt(max(1.0 - beta * beta, EPSILON));
    // 相对论多普勒因子 D = 1 / (γ (1 - v·n̂))
    dopplerFactor = 1.0 / (gamma * max(1.0 - vDotN, EPSILON));

    // 束宽增强：I_obs / I_emit = D^(3+α)，α≈0.5 对热盘
    beamingFactor = pow(dopplerFactor, max(beamingPower, 0.0));
  }

  // 多普勒色偏：把频率比转换为 RGB 通道增益（蓝移 → 加蓝减红，红移 → 反之）
  if (dopplerEnabled > 0.5) {
    float shift = (dopplerFactor - 1.0) * dopplerStrength;
    // 蓝通道随 shift 升，红通道反向，绿基本不变
    vec3 tint = vec3(1.0 - 0.7 * shift, 1.0 - 0.2 * abs(shift), 1.0 + 0.7 * shift);
    tint = clamp(tint, vec3(0.0), vec3(2.0));
    dustColor *= tint;
  }

  // 束宽增强：直接在亮度上乘以 D^p
  if (beamingEnabled > 0.5) {
    dustColor *= clamp(beamingFactor, 0.05, 8.0);
  }

  color += density * adiskLit * adiskDiskGain * dustColor * alpha * abs(noise);
}

vec3 shadeInnerBody(int j, vec3 color, vec3 rel, vec3 dir) {
  float bk = bodyKind[j];
  vec3 gc = glowColor[j];
  float gi = glowIntensity[j];
  if (bk < 0.5) {
    return color;
  } else if (bk < 1.5) {
    return color * 0.12 + gc * gi;
  } else {
    vec3 n = normalize(rel);
    vec3 vdir = normalize(-dir);
    float mu = max(0.0, dot(n, vdir));
    float limb = 0.22 + 0.78 * mu;
    return color + gc * gi * limb;
  }
}

vec3 traceColor(vec3 pos, vec3 dir) {
  vec3 color = vec3(0.0);
  float alpha = 1.0;

  float STEP_SIZE = 0.1;
  dir *= STEP_SIZE;

  float bc = bodyCount;

  for (int i = 0; i < 300; i++) {
    if (renderBlackHole > 0.5) {
      if (gravatationalLensing > 0.5) {
        vec3 acc = vec3(0.0);
        for (int j = 0; j < MAX_BODIES_I; j++) {
          if (float(j) >= bc - 0.5) {
            break;
          }
          vec3 rel = pos - bodyCenter[j];
          vec3 hj = cross(rel, dir);
          float h2j = dot(hj, hj);
          float lensSign = bodyKind[j] > 0.5 && bodyKind[j] < 1.5 ? -1.0 : 1.0;
          acc += accel(h2j, rel) * bodyLensStrength[j] * lensSign;
        }
        dir += acc;
      }

      int hit = -1;
      float bestD = 1.0e30;
      for (int j = 0; j < MAX_BODIES_I; j++) {
        if (float(j) >= bc - 0.5) {
          break;
        }
        vec3 rel = pos - bodyCenter[j];
        float r2 = dot(rel, rel);
        float R = max(bodySize[j], 0.01);
        if (r2 < R * R) {
          float d = length(rel);
          if (d < bestD) {
            bestD = d;
            hit = j;
          }
        }
      }
      if (hit >= 0) {
        vec3 rel = pos - bodyCenter[hit];
        return shadeInnerBody(hit, color, rel, dir);
      }

      float minDistance = INF_TRACE;

      if (false) {
        Ring ring;
        ring.center = vec3(0.0, 0.05, 0.0);
        ring.normal = vec3(0.0, 1.0, 0.0);
        ring.innerRadius = 2.0;
        ring.outerRadius = 6.0;
        ring.rotateSpeed = 0.08;
        ringColor(pos, dir, ring, minDistance, color);
      } else {
        if (adiskEnabled > 0.5 && bc > 0.5) {
          adiskColor(pos, color, alpha);
        }
      }
    }

    pos += dir;
  }

  dir = rotateVector(dir, vec3(0.0, 1.0, 0.0), time);
  color += texture(galaxy, dir).rgb * alpha;
  return color;
}

void main() {
  mat3 view;

  vec3 cameraPos;
  if (playbackCamera > 0.5) {
    cameraPos = playbackCameraPos;
  } else if (mouseControl > 0.5) {
    vec2 mouse = clamp(vec2(mouseX, mouseY) / resolution.xy, 0.0, 1.0) - 0.5;
    cameraPos = vec3(-cos(mouse.x * 10.0) * 15.0, mouse.y * 30.0,
                     sin(mouse.x * 10.0) * 15.0);
  } else if (frontView > 0.5) {
    cameraPos = vec3(10.0, 1.0, 10.0);
  } else if (topView > 0.5) {
    cameraPos = vec3(15.0, 15.0, 0.0);
  } else {
    cameraPos = vec3(-cos(time * 0.1) * 15.0, sin(time * 0.1) * 15.0,
                     sin(time * 0.1) * 15.0);
  }

  vec3 target = vec3(0.0, 0.0, 0.0);
  view = lookAt(cameraPos, target, radians(cameraRoll));

  vec2 puv = gl_FragCoord.xy / resolution.xy - vec2(0.5);
  puv.x *= resolution.x / resolution.y;

  vec3 rayDir = normalize(vec3(-puv.x * fovScale, puv.y * fovScale, 1.0));
  vec3 pos = cameraPos;
  rayDir = view * rayDir;

  fragColor.rgb = traceColor(pos, rayDir);
  fragColor.a = 1.0;
}
