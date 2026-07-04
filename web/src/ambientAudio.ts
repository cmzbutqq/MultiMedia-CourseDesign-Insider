import { MAX_BODIES, type SceneBody, type SceneState } from './scene.js';

const DEFAULT_CAMERA_POS: [number, number, number] = [0, 0, 18];

const DISTANCE_REF_NEAR = 8;
const DISTANCE_REF_FAR = 72;
const MAX_DISTANCE_ATTENUATION_DB = 10;

const MASS_REF_MIN = 0.5;
const MASS_REF_MAX = 25;
const BASE_FREQ_MIN_HZ = 100;
const BASE_FREQ_MAX_HZ = 400;

const RADIAL_SPEED_REF = 4;
const MAX_PITCH_BEND_HZ = 50;

const SPEED_REF = 4;
const VIBRATO_RATE_MIN_HZ = 1.4;
const VIBRATO_RATE_MAX_HZ = 8.2;
const VIBRATO_DEPTH_MAX_CENTS = 22;

const MAX_OCTAVE_RATIO = Math.pow(10, -4 / 20);
const VOICE_GAIN = 0.065;
const EVENT_GAIN = 0.1;
const GAIN_RESPONSE = 0.08;
const FREQ_RESPONSE = 0.06;
const REVERB_MAX = 0.18;

const ENCOUNTER_COOLDOWN_SECONDS = 0.28;
const ENCOUNTER_RESET_MULTIPLIER = 1.45;
const MIN_ENCOUNTER_RELATIVE_SPEED = 0.35;

interface BodyVoice {
  mainOsc: OscillatorNode;
  octaveOsc: OscillatorNode;
  mainGain: GainNode;
  octaveGain: GainNode;
  vibratoOsc: OscillatorNode;
  vibratoDetuneGain: GainNode;
}

interface EncounterState {
  engaged: boolean;
  cooldownUntil: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(min: number, max: number, value: number): number {
  const t = clamp((value - min) / Math.max(max - min, 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

function length3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

function distanceBetween(a: [number, number, number], b: [number, number, number]): number {
  return length3(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export class AmbientAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled = false;
  private volume = 0.5;

  private voices: BodyVoice[] = [];
  private encounterStates = new Map<string, EncounterState>();

  private reverbConvolver: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private dryGain: GainNode | null = null;

  private initialized = false;

  isEnabled(): boolean {
    return this.enabled;
  }

  getVolume(): number {
    return this.volume;
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.volume;

    this.createReverb();
    this.createBodyVoices();

    this.initialized = true;
  }

  private createReverb(): void {
    if (!this.ctx || !this.masterGain) return;

    const length = this.ctx.sampleRate * 2;
    const impulse = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const envelope = Math.pow(1 - i / length, 2.8);
        data[i] = (Math.random() * 2 - 1) * envelope * 0.18;
      }
    }

    this.reverbConvolver = this.ctx.createConvolver();
    this.reverbConvolver.buffer = impulse;

    this.dryGain = this.ctx.createGain();
    this.dryGain.gain.value = 1;

    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.06;

    this.masterGain.connect(this.dryGain);
    this.masterGain.connect(this.reverbConvolver);
    this.reverbConvolver.connect(this.reverbGain);
    this.dryGain.connect(this.ctx.destination);
    this.reverbGain.connect(this.ctx.destination);
  }

  private createBodyVoices(): void {
    if (!this.ctx || !this.masterGain) return;

    for (let i = 0; i < MAX_BODIES; i++) {
      const mainOsc = this.ctx.createOscillator();
      mainOsc.type = 'sine';
      mainOsc.frequency.value = 220;

      const octaveOsc = this.ctx.createOscillator();
      octaveOsc.type = 'sine';
      octaveOsc.frequency.value = 440;

      const mainGain = this.ctx.createGain();
      mainGain.gain.value = 0;

      const octaveGain = this.ctx.createGain();
      octaveGain.gain.value = 0;

      const vibratoOsc = this.ctx.createOscillator();
      vibratoOsc.type = 'sine';
      vibratoOsc.frequency.value = VIBRATO_RATE_MIN_HZ;

      const vibratoDetuneGain = this.ctx.createGain();
      vibratoDetuneGain.gain.value = 0;

      vibratoOsc.connect(vibratoDetuneGain);
      vibratoDetuneGain.connect(mainOsc.detune);
      vibratoDetuneGain.connect(octaveOsc.detune);

      mainOsc.connect(mainGain);
      octaveOsc.connect(octaveGain);
      mainGain.connect(this.masterGain);
      octaveGain.connect(this.masterGain);

      mainOsc.start();
      octaveOsc.start();
      vibratoOsc.start();

      this.voices.push({
        mainOsc,
        octaveOsc,
        mainGain,
        octaveGain,
        vibratoOsc,
        vibratoDetuneGain,
      });
    }
  }

  async toggle(on?: boolean): Promise<void> {
    const next = on ?? !this.enabled;
    if (next === this.enabled) return;

    if (next) {
      if (!this.initialized) await this.init();
      if (this.ctx?.state === 'suspended') await this.ctx.resume();
      this.enabled = true;
    } else {
      this.enabled = false;
      if (this.ctx?.state === 'running') await this.ctx.suspend();
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(v, this.masterGain.context.currentTime, 0.05);
    }
  }

  update(scene: SceneState, cameraPos: [number, number, number] = DEFAULT_CAMERA_POS): void {
    if (!this.enabled || !this.ctx) return;

    const now = this.ctx.currentTime;
    const activeBodyCount = Math.max(scene.bodyCount, 1);

    let sceneCenterX = 0;
    let sceneCenterY = 0;
    let sceneCenterZ = 0;
    for (let i = 0; i < scene.bodyCount; i++) {
      const body = scene.bodies[i]!;
      sceneCenterX += body.position[0];
      sceneCenterY += body.position[1];
      sceneCenterZ += body.position[2];
    }
    if (scene.bodyCount > 0) {
      sceneCenterX /= scene.bodyCount;
      sceneCenterY /= scene.bodyCount;
      sceneCenterZ /= scene.bodyCount;
    }

    let sceneSpread = 0;
    for (let i = 0; i < scene.bodyCount; i++) {
      const body = scene.bodies[i]!;
      const spread = length3(
        body.position[0] - sceneCenterX,
        body.position[1] - sceneCenterY,
        body.position[2] - sceneCenterZ,
      );
      if (spread > sceneSpread) sceneSpread = spread;
    }

    const targetReverbMix = clamp(
      0.04 + sceneSpread / 120 + (scene.timeWarp.enabled ? scene.timeWarp.intensity * 0.08 : 0),
      0.04,
      REVERB_MAX,
    );
    this.reverbGain?.gain.setTargetAtTime(targetReverbMix, now, 0.2);
    this.dryGain?.gain.setTargetAtTime(1 - targetReverbMix * 0.3, now, 0.2);

    for (let i = 0; i < this.voices.length; i++) {
      const voice = this.voices[i]!;
      if (i >= scene.bodyCount) {
        voice.mainGain.gain.setTargetAtTime(0, now, GAIN_RESPONSE);
        voice.octaveGain.gain.setTargetAtTime(0, now, GAIN_RESPONSE);
        voice.vibratoDetuneGain.gain.setTargetAtTime(0, now, GAIN_RESPONSE);
        continue;
      }

      const body = scene.bodies[i]!;
      const distance = distanceBetween(body.position, cameraPos);
      const distanceGain = this.distanceGain(distance);

      const speed = length3(body.velocity[0], body.velocity[1], body.velocity[2]);
      const speedNorm = clamp(speed / SPEED_REF, 0, 1);
      const vibratoRate = lerp(VIBRATO_RATE_MIN_HZ, VIBRATO_RATE_MAX_HZ, speedNorm);
      const vibratoDepth = VIBRATO_DEPTH_MAX_CENTS * speedNorm;

      const baseFreq = this.frequencyFromMass(body.mass);
      const pitchBendHz = this.pitchBendFromRadialVelocity(body, cameraPos);
      const pitchRatio = clamp(1 + pitchBendHz / Math.max(baseFreq, 1), 0.25, 2.0);

      const mainFreq = baseFreq * pitchRatio;
      const octaveFreq = baseFreq * 2 * pitchRatio;

      const mainGain = (VOICE_GAIN / Math.sqrt(activeBodyCount)) * distanceGain;
      const octaveMix = clamp(body.visual.adiskIntensity / 3, 0, 1) * MAX_OCTAVE_RATIO;
      const octaveGain = mainGain * octaveMix;

      voice.mainOsc.frequency.setTargetAtTime(mainFreq, now, FREQ_RESPONSE);
      voice.octaveOsc.frequency.setTargetAtTime(octaveFreq, now, FREQ_RESPONSE);
      voice.mainGain.gain.setTargetAtTime(mainGain, now, GAIN_RESPONSE);
      voice.octaveGain.gain.setTargetAtTime(octaveGain, now, GAIN_RESPONSE);
      voice.vibratoOsc.frequency.setTargetAtTime(vibratoRate, now, 0.12);
      voice.vibratoDetuneGain.gain.setTargetAtTime(vibratoDepth, now, 0.12);
    }

    this.updateEncounterBursts(scene, cameraPos, now, activeBodyCount);
  }

  private distanceGain(distance: number): number {
    const falloff = smoothstep(DISTANCE_REF_NEAR, DISTANCE_REF_FAR, distance);
    return dbToGain(-MAX_DISTANCE_ATTENUATION_DB * falloff);
  }

  private frequencyFromMass(mass: number): number {
    const minLog = Math.log(MASS_REF_MIN);
    const maxLog = Math.log(MASS_REF_MAX);
    const safeMass = clamp(mass, MASS_REF_MIN, MASS_REF_MAX);
    const massNorm = clamp((Math.log(safeMass) - minLog) / (maxLog - minLog), 0, 1);
    return lerp(BASE_FREQ_MAX_HZ, BASE_FREQ_MIN_HZ, massNorm);
  }

  private pitchBendFromRadialVelocity(body: SceneBody, cameraPos: [number, number, number]): number {
    const dirX = body.position[0] - cameraPos[0];
    const dirY = body.position[1] - cameraPos[1];
    const dirZ = body.position[2] - cameraPos[2];
    const dirLen = length3(dirX, dirY, dirZ);
    if (dirLen < 1e-6) return 0;

    const radialVelocity =
      (body.velocity[0] * dirX + body.velocity[1] * dirY + body.velocity[2] * dirZ) / dirLen;
    return MAX_PITCH_BEND_HZ * Math.tanh(-radialVelocity / RADIAL_SPEED_REF);
  }

  private updateEncounterBursts(
    scene: SceneState,
    cameraPos: [number, number, number],
    now: number,
    activeBodyCount: number,
  ): void {
    for (let i = 0; i < scene.bodyCount; i++) {
      const bodyA = scene.bodies[i]!;
      for (let j = i + 1; j < scene.bodyCount; j++) {
        const bodyB = scene.bodies[j]!;
        const key = `${i}-${j}`;
        const state = this.getEncounterState(key);
        const distance = distanceBetween(bodyA.position, bodyB.position);
        const threshold = Math.max(
          1.4,
          (bodyA.visual.size + bodyB.visual.size) * 2.5 + scene.softening * 2,
        );

        if (distance > threshold * ENCOUNTER_RESET_MULTIPLIER) {
          state.engaged = false;
        }

        if (state.engaged || now < state.cooldownUntil || distance > threshold) {
          continue;
        }

        const relativeSpeed = length3(
          bodyA.velocity[0] - bodyB.velocity[0],
          bodyA.velocity[1] - bodyB.velocity[1],
          bodyA.velocity[2] - bodyB.velocity[2],
        );
        if (relativeSpeed < MIN_ENCOUNTER_RELATIVE_SPEED) {
          continue;
        }

        this.triggerEncounterBurst(bodyA, bodyB, relativeSpeed, cameraPos, activeBodyCount, now);
        state.engaged = true;
        state.cooldownUntil = now + ENCOUNTER_COOLDOWN_SECONDS;
      }
    }
  }

  private getEncounterState(key: string): EncounterState {
    const existing = this.encounterStates.get(key);
    if (existing) return existing;
    const created: EncounterState = { engaged: false, cooldownUntil: 0 };
    this.encounterStates.set(key, created);
    return created;
  }

  private triggerEncounterBurst(
    bodyA: SceneBody,
    bodyB: SceneBody,
    relativeSpeed: number,
    cameraPos: [number, number, number],
    activeBodyCount: number,
    now: number,
  ): void {
    if (!this.ctx || !this.masterGain) return;

    const midpoint: [number, number, number] = [
      (bodyA.position[0] + bodyB.position[0]) * 0.5,
      (bodyA.position[1] + bodyB.position[1]) * 0.5,
      (bodyA.position[2] + bodyB.position[2]) * 0.5,
    ];
    const midpointDistance = distanceBetween(midpoint, cameraPos);
    const distanceGain = this.distanceGain(midpointDistance);
    const eventStrength = clamp(relativeSpeed / (SPEED_REF * 1.2), 0.35, 1);
    const bodyMass = (bodyA.mass + bodyB.mass) * 0.5;
    const eventFreq = clamp(this.frequencyFromMass(bodyMass) * 1.6 + relativeSpeed * 10, 180, 720);
    const gainAmount = (EVENT_GAIN / Math.sqrt(activeBodyCount)) * distanceGain * eventStrength;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(eventFreq * 1.12, now);
    osc.frequency.exponentialRampToValueAtTime(eventFreq, now + 0.16);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(gainAmount, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.2);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  destroy(): void {
    for (const voice of this.voices) {
      voice.mainOsc.stop();
      voice.octaveOsc.stop();
      voice.vibratoOsc.stop();
    }
    this.voices = [];
    this.encounterStates.clear();
    this.ctx?.close();
    this.ctx = null;
    this.masterGain = null;
    this.reverbConvolver = null;
    this.reverbGain = null;
    this.dryGain = null;
    this.initialized = false;
    this.enabled = false;
  }
}

export const ambientAudio = new AmbientAudioEngine();
