import type { SceneState } from './scene.js';

/** lil-gui 可绑定的位置/速度代理（避免直接编辑 tuple） */
export function positionRef(scene: SceneState, index: number) {
  return {
    get x() {
      return scene.bodies[index]!.position[0];
    },
    set x(v: number) {
      scene.bodies[index]!.position[0] = v;
    },
    get y() {
      return scene.bodies[index]!.position[1];
    },
    set y(v: number) {
      scene.bodies[index]!.position[1] = v;
    },
    get z() {
      return scene.bodies[index]!.position[2];
    },
    set z(v: number) {
      scene.bodies[index]!.position[2] = v;
    },
  };
}

export function velocityRef(scene: SceneState, index: number) {
  return {
    get x() {
      return scene.bodies[index]!.velocity[0];
    },
    set x(v: number) {
      scene.bodies[index]!.velocity[0] = v;
    },
    get y() {
      return scene.bodies[index]!.velocity[1];
    },
    set y(v: number) {
      scene.bodies[index]!.velocity[1] = v;
    },
    get z() {
      return scene.bodies[index]!.velocity[2];
    },
    set z(v: number) {
      scene.bodies[index]!.velocity[2] = v;
    },
  };
}

export function visualRef(scene: SceneState, index: number) {
  return {
    get size() {
      return scene.bodies[index]!.visual.size;
    },
    set size(v: number) {
      scene.bodies[index]!.visual.size = v;
    },
    get glowIntensity() {
      return scene.bodies[index]!.visual.glowIntensity;
    },
    set glowIntensity(v: number) {
      scene.bodies[index]!.visual.glowIntensity = v;
    },
    get adiskIntensity() {
      return scene.bodies[index]!.visual.adiskIntensity;
    },
    set adiskIntensity(v: number) {
      scene.bodies[index]!.visual.adiskIntensity = v;
    },
    get distortionStrength() {
      return scene.bodies[index]!.visual.distortionStrength;
    },
    set distortionStrength(v: number) {
      scene.bodies[index]!.visual.distortionStrength = v;
    },
  };
}

export function bodyMassRef(scene: SceneState, index: number) {
  return {
    get mass() {
      return scene.bodies[index]!.mass;
    },
    set mass(v: number) {
      scene.bodies[index]!.mass = v;
    },
  };
}
