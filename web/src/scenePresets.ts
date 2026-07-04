import {
  type BodyKind,
  type SceneBody,
  type SceneState,
  cloneSceneState,
  defaultBodyParams,
  MAX_BODIES,
} from './scene.js';

function makeBody(
  position: [number, number, number],
  velocity: [number, number, number],
  mass: number,
  kind: BodyKind,
): SceneBody {
  return {
    position: [...position],
    velocity: [...velocity],
    mass,
    kind,
    visual: defaultBodyParams(kind),
  };
}

/** 默认：单黑洞 + 吸积盘（与原 demo 接近） */
export function createDefaultScene(): SceneState {
  const bodies: SceneBody[] = [];
  bodies.push(makeBody([0, 0, 0], [0, 0, 0], 10, 'blackHole'));
  for (let i = 1; i < MAX_BODIES; i++) {
    bodies.push(
      makeBody([6 + i * 0.1, 0, 0], [0, 0.2, 0], 0.1, 'neutronStar'),
    );
  }
  return {
    bodyCount: 1,
    bodies,
    dynamics: 'static',
    gmCentral: 80,
    nbodyG: 2,
    softening: 0.15,
    dt: 0.02,
    showTrails: true,
    timeWarp: {
      enabled: false,
      intensity: 0.5,
      potentialScale: 1.0,
      distanceScale: 5.0,
    },
  };
}

const presetSingle = cloneSceneState(createDefaultScene());

const presetBinary: SceneState = (() => {
  const s = createDefaultScene();
  s.bodyCount = 2;
  s.bodies[0] = makeBody([0, 0, 0], [0, 0, 0], 12, 'blackHole');
  s.dynamics = 'kepler';
  s.gmCentral = 80;
  s.bodies[1] = makeBody(
    [8, 0, 0],
    [0, 0, 3.1614],
    2,
    'whiteHole',
  );
  return s;
})();

const presetKepler: SceneState = (() => {
  const s = createDefaultScene();
  s.bodyCount = 3;
  s.bodies[0] = makeBody([0, 0, 0], [0, 0, 0], 20, 'blackHole');
  s.dynamics = 'kepler';
  s.gmCentral = 120;
  s.dt = 0.02;
  s.bodies[1] = makeBody(
    [10, 0, 0],
    [0, 0, 3.4635],
    0.5,
    'whiteHole',
  );
  s.bodies[2] = makeBody(
    [-14, 0, 0],
    [0, 0, -2.9274],
    0.5,
    'neutronStar',
  );
  return s;
})();

const presetNBody: SceneState = (() => {
  const s = createDefaultScene();
  s.bodyCount = 4;
  s.bodies[0] = makeBody([0, 0, 0], [0, 0, 0], 25, 'blackHole');
  s.dynamics = 'nbody';
  s.nbodyG = 3;
  s.softening = 0.4;
  s.dt = 0.012;
  s.bodies[1] = makeBody(
    [8, 2, 0],
    [0, 0.0395, -3.0102],
    3,
    'whiteHole',
  );
  s.bodies[2] = makeBody(
    [-6, -1, 3],
    [1.4832, 0.0307, 2.9664],
    2,
    'neutronStar',
  );
  s.bodies[3] = makeBody(
    [4, -8, -2],
    [-1.2563, -0.0419, -2.5650],
    2,
    'neutronStar',
  );
  return s;
})();

export const SCENE_PRESETS: Record<string, SceneState> = {
  单天体: presetSingle,
  双天体: presetBinary,
  开普勒演示: presetKepler,
  N体演示: presetNBody,
};
