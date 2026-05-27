import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCameraLookBasis } from '../src/camera.ts';

const shader = readFileSync(new URL('../shader/blackhole_main.frag', import.meta.url), 'utf8');
const mainTs = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const cameraTs = readFileSync(new URL('../src/camera.ts', import.meta.url), 'utf8');
const recordingManagerTs = readFileSync(new URL('../src/recordingManager.ts', import.meta.url), 'utf8');

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

test('explicit front and top view controls take precedence over mouse camera control', () => {
  assert.deepEqual(
    getCameraLookBasis(0, 0, 0, 100, 100, true, true, false, 0).cameraPos,
    [10, 1, 10],
  );
  assert.deepEqual(
    getCameraLookBasis(0, 0, 0, 100, 100, true, false, true, 0).cameraPos,
    [15, 15, 0],
  );
  assert.match(
    cameraTs,
    /cameraPosOverride[\s\S]*?frontView[\s\S]*?topView[\s\S]*?mouseControl/,
  );
  assert.match(
    shader,
    /playbackCamera[\s\S]*?frontView[\s\S]*?topView[\s\S]*?mouseControl/,
  );
  assert.match(mainTs, /frontViewCtrl\.onChange/);
  assert.match(mainTs, /topViewCtrl\.onChange/);
});

test('recording render state preserves relativistic visual parameters', () => {
  for (const field of relativisticFields) {
    assert.match(recordingManagerTs, new RegExp(`['"]${field}['"]`));
    assert.match(recordingManagerTs, new RegExp(`${field}:\\s*params\\.${field}`));
    assert.match(recordingManagerTs, new RegExp(`${field}:\\s*frame\\.render\\.${field}`));
  }
});
