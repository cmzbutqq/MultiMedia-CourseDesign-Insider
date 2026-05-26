import type { SceneState } from './scene.js';

const SMOOTH = 0.04;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class AmbientAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled = false;
  private volume = 0.5;

  private droneOsc: OscillatorNode | null = null;
  private droneGain: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;

  private shimmerOsc: OscillatorNode | null = null;
  private shimmerGain: GainNode | null = null;

  private pulsarOsc: OscillatorNode | null = null;
  private pulsarGain: GainNode | null = null;
  private pulsarLfo: OscillatorNode | null = null;
  private pulsarLfoGain: GainNode | null = null;

  private noiseSource: AudioBufferSourceNode | null = null;
  private noiseGain: GainNode | null = null;
  private noiseFilter: BiquadFilterNode | null = null;

  private reverbConvolver: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private dryGain: GainNode | null = null;

  private subOsc: OscillatorNode | null = null;
  private subGain: GainNode | null = null;

  private smoothDroneGain = 0;
  private smoothShimmerGain = 0;
  private smoothPulsarGain = 0;
  private smoothNoiseGain = 0;
  private smoothFilterFreq = 200;
  private smoothReverbMix = 0;
  private smoothSubGain = 0;
  private smoothPitch = 1;

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
    this.masterGain.connect(this.ctx.destination);

    this.createDroneLayer();
    this.createShimmerLayer();
    this.createPulsarLayer();
    this.createNoiseLayer();
    this.createSubBassLayer();
    this.createReverb();

    this.initialized = true;
  }

  private createDroneLayer(): void {
    if (!this.ctx || !this.masterGain) return;

    this.droneOsc = this.ctx.createOscillator();
    this.droneOsc.type = 'sawtooth';
    this.droneOsc.frequency.value = 55;

    this.droneFilter = this.ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 200;
    this.droneFilter.Q.value = 2;

    this.droneGain = this.ctx.createGain();
    this.droneGain.gain.value = 0;

    this.droneOsc.connect(this.droneFilter);
    this.droneFilter.connect(this.droneGain);
    this.droneGain.connect(this.masterGain);
    this.droneOsc.start();
  }

  private createShimmerLayer(): void {
    if (!this.ctx || !this.masterGain) return;

    this.shimmerOsc = this.ctx.createOscillator();
    this.shimmerOsc.type = 'sine';
    this.shimmerOsc.frequency.value = 880;

    this.shimmerGain = this.ctx.createGain();
    this.shimmerGain.gain.value = 0;

    this.shimmerOsc.connect(this.shimmerGain);
    this.shimmerGain.connect(this.masterGain);
    this.shimmerOsc.start();
  }

  private createPulsarLayer(): void {
    if (!this.ctx || !this.masterGain) return;

    this.pulsarOsc = this.ctx.createOscillator();
    this.pulsarOsc.type = 'square';
    this.pulsarOsc.frequency.value = 440;

    this.pulsarGain = this.ctx.createGain();
    this.pulsarGain.gain.value = 0;

    this.pulsarLfo = this.ctx.createOscillator();
    this.pulsarLfo.type = 'sine';
    this.pulsarLfo.frequency.value = 3;

    this.pulsarLfoGain = this.ctx.createGain();
    this.pulsarLfoGain.gain.value = 0.5;

    this.pulsarLfo.connect(this.pulsarLfoGain);
    this.pulsarLfoGain.connect(this.pulsarGain.gain);

    this.pulsarOsc.connect(this.pulsarGain);
    this.pulsarGain.connect(this.masterGain);

    this.pulsarOsc.start();
    this.pulsarLfo.start();
  }

  private createNoiseLayer(): void {
    if (!this.ctx || !this.masterGain) return;

    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    this.noiseSource = this.ctx.createBufferSource();
    this.noiseSource.buffer = buffer;
    this.noiseSource.loop = true;

    this.noiseFilter = this.ctx.createBiquadFilter();
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.frequency.value = 800;
    this.noiseFilter.Q.value = 0.5;

    this.noiseGain = this.ctx.createGain();
    this.noiseGain.gain.value = 0;

    this.noiseSource.connect(this.noiseFilter);
    this.noiseFilter.connect(this.noiseGain);
    this.noiseGain.connect(this.masterGain);
    this.noiseSource.start();
  }

  private createSubBassLayer(): void {
    if (!this.ctx || !this.masterGain) return;

    this.subOsc = this.ctx.createOscillator();
    this.subOsc.type = 'sine';
    this.subOsc.frequency.value = 30;

    this.subGain = this.ctx.createGain();
    this.subGain.gain.value = 0;

    this.subOsc.connect(this.subGain);
    this.subGain.connect(this.masterGain);
    this.subOsc.start();
  }

  private createReverb(): void {
    if (!this.ctx || !this.masterGain) return;

    const length = this.ctx.sampleRate * 3;
    const impulse = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
      }
    }

    this.reverbConvolver = this.ctx.createConvolver();
    this.reverbConvolver.buffer = impulse;

    this.dryGain = this.ctx.createGain();
    this.dryGain.gain.value = 1;

    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0;

    this.masterGain.disconnect();
    this.masterGain.connect(this.dryGain);
    this.masterGain.connect(this.reverbConvolver);
    this.reverbConvolver.connect(this.reverbGain);
    this.dryGain.connect(this.ctx.destination);
    this.reverbGain.connect(this.ctx.destination);
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

  update(scene: SceneState): void {
    if (!this.enabled || !this.ctx) return;

    let blackHoleCount = 0;
    let whiteHoleCount = 0;
    let neutronStarCount = 0;
    let totalMass = 0;
    let maxMass = 0;
    let totalAdiskIntensity = 0;

    for (let i = 0; i < scene.bodyCount; i++) {
      const b = scene.bodies[i]!;
      totalMass += b.mass;
      if (b.mass > maxMass) maxMass = b.mass;
      totalAdiskIntensity += b.visual.adiskIntensity;
      if (b.kind === 'blackHole') blackHoleCount++;
      else if (b.kind === 'whiteHole') whiteHoleCount++;
      else neutronStarCount++;
    }

    const targetDroneGain = blackHoleCount > 0 ? 0.12 * Math.min(blackHoleCount, 3) : 0;
    const targetShimmerGain = whiteHoleCount > 0 ? 0.06 * Math.min(whiteHoleCount, 3) : 0;
    const targetPulsarGain = neutronStarCount > 0 ? 0.04 * Math.min(neutronStarCount, 3) : 0;
    const targetNoiseGain = totalAdiskIntensity > 0 ? 0.03 * Math.min(totalAdiskIntensity, 3) : 0;
    const targetSubGain = maxMass > 15 ? 0.08 * Math.min(maxMass / 40, 1) : 0;

    const massNorm = Math.min(maxMass / 50, 1);
    const targetFilterFreq = 120 + massNorm * 600;

    let avgDist = 0;
    let distCount = 0;
    for (let i = 0; i < scene.bodyCount; i++) {
      for (let j = i + 1; j < scene.bodyCount; j++) {
        const dx = scene.bodies[i]!.position[0] - scene.bodies[j]!.position[0];
        const dy = scene.bodies[i]!.position[1] - scene.bodies[j]!.position[1];
        const dz = scene.bodies[i]!.position[2] - scene.bodies[j]!.position[2];
        avgDist += Math.sqrt(dx * dx + dy * dy + dz * dz);
        distCount++;
      }
    }
    avgDist = distCount > 0 ? avgDist / distCount : 15;
    const targetReverbMix = Math.max(0, Math.min(0.6, 1 - avgDist / 30));

    let targetPitch = 1;
    if (scene.timeWarp.enabled && scene.bodyCount >= 1) {
      const b0 = scene.bodies[0]!;
      const refDist = b0.visual.size * 2;
      const refPos: [number, number, number] = [b0.position[0] + refDist, b0.position[1], b0.position[2]];
      const tw = this.calcTimeWarp(refPos, b0.position, b0.mass, scene);
      targetPitch = 0.5 + tw * 0.5;
    }

    this.smoothDroneGain = lerp(this.smoothDroneGain, targetDroneGain, SMOOTH);
    this.smoothShimmerGain = lerp(this.smoothShimmerGain, targetShimmerGain, SMOOTH);
    this.smoothPulsarGain = lerp(this.smoothPulsarGain, targetPulsarGain, SMOOTH);
    this.smoothNoiseGain = lerp(this.smoothNoiseGain, targetNoiseGain, SMOOTH);
    this.smoothSubGain = lerp(this.smoothSubGain, targetSubGain, SMOOTH);
    this.smoothFilterFreq = lerp(this.smoothFilterFreq, targetFilterFreq, SMOOTH);
    this.smoothReverbMix = lerp(this.smoothReverbMix, targetReverbMix, SMOOTH);
    this.smoothPitch = lerp(this.smoothPitch, targetPitch, SMOOTH * 0.5);

    const now = this.ctx.currentTime;

    if (this.droneGain) this.droneGain.gain.setTargetAtTime(this.smoothDroneGain, now, 0.05);
    if (this.droneFilter) this.droneFilter.frequency.setTargetAtTime(this.smoothFilterFreq, now, 0.05);
    if (this.droneOsc) {
      const baseFreq = 55 * this.smoothPitch;
      this.droneOsc.frequency.setTargetAtTime(baseFreq, now, 0.05);
    }

    if (this.shimmerGain) this.shimmerGain.gain.setTargetAtTime(this.smoothShimmerGain, now, 0.05);
    if (this.shimmerOsc) {
      const shimmerFreq = 880 * this.smoothPitch;
      this.shimmerOsc.frequency.setTargetAtTime(shimmerFreq, now, 0.05);
    }

    if (this.pulsarGain) this.pulsarGain.gain.setTargetAtTime(this.smoothPulsarGain, now, 0.05);
    if (this.pulsarOsc) {
      const pulsarFreq = 440 * this.smoothPitch;
      this.pulsarOsc.frequency.setTargetAtTime(pulsarFreq, now, 0.05);
    }
    if (this.pulsarLfo && neutronStarCount > 0) {
      const lfoRate = 2 + neutronStarCount * 1.5;
      this.pulsarLfo.frequency.setTargetAtTime(lfoRate, now, 0.05);
    }

    if (this.noiseGain) this.noiseGain.gain.setTargetAtTime(this.smoothNoiseGain, now, 0.05);
    if (this.noiseFilter) {
      this.noiseFilter.frequency.setTargetAtTime(600 + totalAdiskIntensity * 400, now, 0.05);
    }

    if (this.subGain) this.subGain.gain.setTargetAtTime(this.smoothSubGain, now, 0.05);
    if (this.subOsc) {
      this.subOsc.frequency.setTargetAtTime(30 * this.smoothPitch, now, 0.05);
    }

    if (this.reverbGain) this.reverbGain.gain.setTargetAtTime(this.smoothReverbMix, now, 0.05);
    if (this.dryGain) this.dryGain.gain.setTargetAtTime(1 - this.smoothReverbMix * 0.3, now, 0.05);
  }

  private calcTimeWarp(
    position: [number, number, number],
    centerPos: [number, number, number],
    mass: number,
    state: SceneState,
  ): number {
    if (!state.timeWarp.enabled) return 1.0;
    const dx = position[0] - centerPos[0];
    const dy = position[1] - centerPos[1];
    const dz = position[2] - centerPos[2];
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const potential = (mass * state.timeWarp.potentialScale) / Math.max(r, 0.1);
    const distanceTerm = 1.0 / (1.0 + r / Math.max(state.timeWarp.distanceScale, 0.1));
    const timeFactor = 1.0 / (1.0 + state.timeWarp.intensity * (potential + distanceTerm));
    return Math.max(0.1, Math.min(1.0, timeFactor));
  }

  destroy(): void {
    this.droneOsc?.stop();
    this.shimmerOsc?.stop();
    this.pulsarOsc?.stop();
    this.pulsarLfo?.stop();
    this.noiseSource?.stop();
    this.subOsc?.stop();
    this.ctx?.close();
    this.ctx = null;
    this.initialized = false;
    this.enabled = false;
  }
}

export const ambientAudio = new AmbientAudioEngine();
