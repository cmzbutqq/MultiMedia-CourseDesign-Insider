import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const shader = readFileSync(new URL('../shader/blackhole_main.frag', import.meta.url), 'utf8');
const mainTs = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const cameraTs = readFileSync(new URL('../src/camera.ts', import.meta.url), 'utf8');
const recordingManagerTs = readFileSync(new URL('../src/recordingManager.ts', import.meta.url), 'utf8');
const handGestureTs = readFileSync(new URL('../src/handGesture.ts', import.meta.url), 'utf8');
const sceneTs = readFileSync(new URL('../src/scene.ts', import.meta.url), 'utf8');

const relativisticFields = [
  'dopplerEnabled',
  'dopplerStrength',
  'dopplerBeta',
  'beamingEnabled',
  'beamingPower',
  'spinEnabled',
  'spinA',
];

test('relativistic Doppler uses camera-to-sample sightline, not radial disk direction', () => {
  assert.match(shader, /uniform\s+vec3\s+cameraWorld\s*;/);
  assert.match(shader, /observerOffset\s*=\s*cameraWorld\s*-\s*posWorld\s*;/);
  assert.doesNotMatch(shader, /normalize\(\s*adiskOrigin\s*-\s*posWorld\s*\)/);
  assert.match(mainTs, /['"]cameraWorld['"]/);
});

test('explicit front and top view controls take precedence over orbit camera input', () => {
  assert.match(
    cameraTs,
    /else\s+if\s*\(frontView\)\s*{\s*cameraPos\s*=\s*addVec3\(target,\s*scaleDirection\(normalizeVec3\(10,\s*1,\s*10\),\s*distance\)\)/,
  );
  assert.match(
    cameraTs,
    /else\s+if\s*\(topView\)\s*{\s*cameraPos\s*=\s*addVec3\(target,\s*scaleDirection\(normalizeVec3\(15,\s*15,\s*0\),\s*distance\)\)/,
  );
  assert.match(cameraTs, /cameraPosOverride[\s\S]*?frontView[\s\S]*?topView[\s\S]*?mouseControl/);
  assert.match(shader, /uniform\s+vec3\s+cameraRight\s*;/);
  assert.match(shader, /uniform\s+vec3\s+cameraUp\s*;/);
  assert.match(shader, /uniform\s+vec3\s+cameraForward\s*;/);
  assert.match(mainTs, /['"]cameraRight['"]/);
  assert.match(mainTs, /['"]cameraUp['"]/);
  assert.match(mainTs, /['"]cameraForward['"]/);
  assert.match(mainTs, /add\(uiView,\s*['"]cameraMode['"]/);
});

test('recording render state preserves relativistic visual parameters', () => {
  for (const field of relativisticFields) {
    assert.match(recordingManagerTs, new RegExp(`['"]${field}['"]`));
    assert.match(recordingManagerTs, new RegExp(`${field}:\\s*params\\.${field}`));
    assert.match(recordingManagerTs, new RegExp(`${field}:\\s*frame\\.render\\.${field}`));
  }
  assert.match(recordingManagerTs, /cameraDistance:\s*params\.cameraDistance/);
  assert.match(recordingManagerTs, /cameraFovDeg:\s*params\.cameraFovDeg/);
  assert.match(recordingManagerTs, /cameraDistance:\s*frame\.render\.cameraDistance/);
  assert.match(recordingManagerTs, /cameraFovDeg:\s*frame\.render\.cameraFovDeg/);
  assert.match(recordingManagerTs, /legacyZoomToFovDeg/);
});

test('gesture init failure rolls GUI state back to off', () => {
  assert.match(mainTs, /const\s+gestureModeCtrl\s*=\s*(?:commonFolder|interactionFolder)\s*[\s\S]*?\.add\(params,\s*['"]gestureMode['"]/);
  assert.match(mainTs, /if\s*\(!success\)\s*{[\s\S]*?params\.gestureMode\s*=\s*['"]off['"][\s\S]*?refreshGuiDisplays\(\)/);
  assert.match(mainTs, /if\s*\(!success\)\s*{[\s\S]*?showGestureStatusMessage\([\s\S]*?,\s*true\s*\)/);
  assert.match(mainTs, /function\s+updateViewControlDisplays\(\)/);
});

test('local gesture teardown stops camera tracks', () => {
  assert.match(handGestureTs, /private\s+stopVideoStream\(\)/);
  assert.match(handGestureTs, /stream\.getTracks\(\)\.forEach\(\(track\)\s*=>\s*track\.stop\(\)\)/);
  assert.match(handGestureTs, /this\.videoElement\.srcObject\s*=\s*null/);
  assert.match(handGestureTs, /destroy\(\):\s*void\s*{[\s\S]*?this\.stopVideoStream\(\)/);
});

test('dynamic ray marching keys off body surfaces and farthest-surface early stop', () => {
  assert.match(sceneTs, /export\s+function\s+getBodySurfaceRadius\(body:\s*SceneBody\)/);
  assert.match(sceneTs, /body\.kind\s*===\s*'blackHole'\s*\?\s*baseRadius\s*\*\s*12\s*:\s*baseRadius/);
  assert.match(shader, /uniform\s+float\s+bodySurfaceRadius\[5\]\s*;/);
  assert.match(shader, /nearestSurfaceDistance\s*=\s*min\(nearestSurfaceDistance,\s*d\s*-\s*max\(bodySurfaceRadius\[j\],\s*0\.01\)\)/);
  assert.match(shader, /if\s*\(nearestSurfaceDistance\s*<\s*INF_TRACE\s*\*\s*0\.5\)\s*{\s*stepSize\s*=\s*max\(FIXED_STEP_SIZE,\s*nearestSurfaceDistance\s*\*\s*0\.5\)\s*;/);
  assert.match(shader, /vec3\s+acc\s*=\s*totalLensingAccel\(lensSamplePos,\s*baseDir,\s*bc\)\s*\*\s*stepScale/);
  assert.match(shader, /if\s*\(length\(pos\s*-\s*cameraWorld\)\s*>\s*traceMaxDistance\)\s*{/);
  assert.match(mainTs, /const\s+surfacePointDistance\s*=\s*bodyDistance\s*\+\s*getBodySurfaceRadius\(body\)/);
  assert.match(mainTs, /return\s+Math\.max\(TRACE_STOP_DISTANCE_MIN,\s*farthestSurfacePointDistance\s*\*\s*2\)/);
});
