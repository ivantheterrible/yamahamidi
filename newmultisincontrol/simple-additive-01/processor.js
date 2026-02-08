// Additive Synth AudioWorklet Processor
// 32-partial harmonic series with stackable modulators

import './textencoder.js';
import { initSync, init as wasmInit, render, add_sines, add_amplitude_events, add_frequency_events, get_current_sample_position } from '../wasm/pkg/sin_wave_renderer_wasm.js';
import { PhaseAccumulator, SineEventScheduler } from '../js-lib/index.js';

const NUM_PARTIALS = 32;
const EVENT_INTERVAL = 128;
const MAX_EVENTS_PER_SINE = 8;

class AdditiveSynthProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ready = false;
    this.started = false;
    
    // Synth state
    this.sineIds = [];
    this.baseFreq = 110;      // Hz
    
    // === LFO Modulator ===
    this.lfoEnabled = true;
    this.lfoAmount = 0.5;     // Modulation amount (0-1)
    this.lfoOffset = 0.0;     // Center amplitude (-1 to 1)
    this.lfo = new PhaseAccumulator(1.0);
    
    // === Random Step Modulator ===
    this.randomEnabled = true;
    this.randomChangeRate = 2.0;  // Expected changes per second per partial
    this.randomValues = new Float32Array(NUM_PARTIALS);
    this.randomValues.fill(1.0);
    
    // === Lowpass Filter Modulator ===
    this.lowpassEnabled = false;
    this.lowpassCutoff = 10;
    this.lowpassSlope = 2;
    this.lowpassResonance = 0.5;
    this.lowpassValuesViz = new Float32Array(NUM_PARTIALS);
    
    // === Highpass Filter Modulator ===
    this.highpassEnabled = false;
    this.highpassCutoff = 8;
    this.highpassSlope = 2;
    this.highpassResonance = 0.5;
    this.highpassValuesViz = new Float32Array(NUM_PARTIALS);
    
    // === Harmonic Comb Modulator ===
    this.combEnabled = false;
    this.combSpacing = 4;
    this.combPhase = 0;
    this.combValuesViz = new Float32Array(NUM_PARTIALS);
    
    // === PWM Modulator ===
    this.pwmEnabled = false;
    this.pwmDuty = 0.32;
    this.pwmValuesViz = new Float32Array(NUM_PARTIALS);
    
    // === Wavefolder Modulator ===
    this.wavefolderEnabled = false;
    this.wavefolderFold = 2.5;
    this.wavefolderAsymmetry = 0;
    this.wavefolderValuesViz = new Float32Array(NUM_PARTIALS);
    
    // === Barber Pole Modulator ===
    this.barberPoleEnabled = false;
    this.barberPoleDensity = 6;
    this.barberPoleSpeed = 3;
    this.barberPoleQ = 2;
    this.barberPolePhase = 0;
    this.barberPoleValuesViz = new Float32Array(NUM_PARTIALS);
    
    // === Falling Harmonics Modulator ===
    this.fallingEnabled = false;
    this.fallingProbability = 0.1;
    this.fallingHarmonic = { pos: 31 };
    this.fallingLanded = new Set();
    this.fallingValuesViz = new Float32Array(NUM_PARTIALS);
    
    // === Vowel Morph Modulator ===
    this.vowelEnabled = false;
    this.vowelMorph = 0.5;
    this.vowelQ = 12;
    this.vowelValuesViz = new Float32Array(NUM_PARTIALS);
    this.vowelFormants = [
      { f: [730, 1090, 2440] },  // A
      { f: [660, 1700, 2400] },  // E
      { f: [440, 1220, 2600] },  // I
      { f: [400, 800, 2600] },   // O
      { f: [350, 600, 2700] }    // U
    ];
    
    // === Keyboard Pitch Modulator (frequency multiplier) ===
    this.keyboardPitchEnabled = false;
    this.keyboardPitchRatio = 1.0;
    this.prevKeyboardPitchRatio = 1.0;  // Previous value for smooth ramps
    
    // === Keyboard Gate Modulator (amplitude) ===
    this.keyboardGateEnabled = false;
    this.keyboardGateOpen = true;
    this.prevKeyboardGateOpen = true;   // Previous value for smooth ramps
    this.keyboardGateValuesViz = new Float32Array(NUM_PARTIALS);
    
    // Flag for immediate event injection (low-latency keyboard response)
    this.needsImmediateEvent = false;
    
    // Samples for the smooth ramp on keyboard changes
    this.KEYBOARD_RAMP_SAMPLES = 8;
    
    // Use shared library classes
    this.scheduler = new SineEventScheduler(NUM_PARTIALS, MAX_EVENTS_PER_SINE);
    
    // Per-partial timestamp tracking
    this.lastAmpEventSample = [];
    this.lastFreqEventSample = [];
    
    // Visualization arrays (per-modulator and combined)
    this.lfoValuesViz = new Float32Array(NUM_PARTIALS);
    this.combinedValuesViz = new Float32Array(NUM_PARTIALS);
    
    // Visualization update throttling
    this.vizUpdateCounter = 0;
    this.vizUpdateInterval = 8;
    
    // Message handler dispatch map
    this.messageHandlers = {
      'start': () => { if (!this.started && this.ready) this.startSynth(); },
      'set-base-freq': (v) => { this.baseFreq = Number(v) || 110; },
      
      // LFO
      'set-lfo-enabled': (v) => { this.lfoEnabled = Boolean(v); },
      'set-lfo-rate': (v) => { this.lfo.setRate(Number(v) || 1.0); },
      'set-lfo-amount': (v) => { this.lfoAmount = Number(v) || 0.0; },
      'set-lfo-offset': (v) => { this.lfoOffset = Number(v) || 0.0; },
      
      // Random
      'set-random-enabled': (v) => {
        this.randomEnabled = Boolean(v);
        if (!this.randomEnabled) this.randomValues.fill(1.0);
      },
      'set-random-change-rate': (v) => { this.randomChangeRate = Number(v) || 2.0; },
      
      // Lowpass
      'set-lowpass-enabled': (v) => { this.lowpassEnabled = Boolean(v); },
      'set-lowpass-cutoff': (v) => { this.lowpassCutoff = Number(v) || 10; },
      'set-lowpass-slope': (v) => { this.lowpassSlope = Number(v) || 2; },
      'set-lowpass-resonance': (v) => { this.lowpassResonance = Number(v) || 0.5; },
      
      // Highpass
      'set-highpass-enabled': (v) => { this.highpassEnabled = Boolean(v); },
      'set-highpass-cutoff': (v) => { this.highpassCutoff = Number(v) || 8; },
      'set-highpass-slope': (v) => { this.highpassSlope = Number(v) || 2; },
      'set-highpass-resonance': (v) => { this.highpassResonance = Number(v) || 0.5; },
      
      // Comb
      'set-comb-enabled': (v) => { this.combEnabled = Boolean(v); },
      'set-comb-spacing': (v) => { this.combSpacing = Number(v) || 4; },
      'set-comb-phase': (v) => { this.combPhase = Number(v) || 0; },
      
      // PWM
      'set-pwm-enabled': (v) => { this.pwmEnabled = Boolean(v); },
      'set-pwm-duty': (v) => { this.pwmDuty = Number(v) || 0.32; },
      
      // Wavefolder
      'set-wavefolder-enabled': (v) => { this.wavefolderEnabled = Boolean(v); },
      'set-wavefolder-fold': (v) => { this.wavefolderFold = Number(v) || 2.5; },
      'set-wavefolder-asymmetry': (v) => { this.wavefolderAsymmetry = Number(v) || 0; },
      
      // Barber Pole
      'set-barberpole-enabled': (v) => { this.barberPoleEnabled = Boolean(v); },
      'set-barberpole-density': (v) => { this.barberPoleDensity = Number(v) || 6; },
      'set-barberpole-speed': (v) => { this.barberPoleSpeed = Number(v) || 3; },
      'set-barberpole-q': (v) => { this.barberPoleQ = Number(v) || 2; },
      
      // Falling
      'set-falling-enabled': (v) => {
        this.fallingEnabled = Boolean(v);
        if (this.fallingEnabled) {
          this.fallingHarmonic = { pos: 31 };
          this.fallingLanded = new Set();
        }
      },
      'set-falling-probability': (v) => { this.fallingProbability = Number(v) || 0.1; },
      
      // Vowel
      'set-vowel-enabled': (v) => { this.vowelEnabled = Boolean(v); },
      'set-vowel-morph': (v) => { this.vowelMorph = Number(v) || 0.5; },
      'set-vowel-q': (v) => { this.vowelQ = Number(v) || 12; },
      
      // Keyboard Pitch (frequency multiplier)
      'set-keyboard-pitch-enabled': (v) => { this.keyboardPitchEnabled = Boolean(v); },
      'set-keyboard-pitch-ratio': (v) => { 
        this.prevKeyboardPitchRatio = this.keyboardPitchRatio;
        this.keyboardPitchRatio = Number(v) || 1.0;
        this.needsImmediateEvent = true;
      },
      
      // Keyboard Gate (amplitude)
      'set-keyboard-gate-enabled': (v) => { this.keyboardGateEnabled = Boolean(v); },
      'set-keyboard-gate': (v) => { 
        this.prevKeyboardGateOpen = this.keyboardGateOpen;
        this.keyboardGateOpen = Boolean(v);
        this.needsImmediateEvent = true;
      }
    };
    
    this.port.onmessage = (event) => {
      const msg = event.data;
      if (msg && msg.type && this.messageHandlers[msg.type]) {
        this.messageHandlers[msg.type](msg.value);
      }
    };
    
    // Initialize WASM synchronously from processorOptions
    try {
      const { wasmBytes } = options.processorOptions;
      initSync({ module: wasmBytes });
      wasmInit(sampleRate);
      this.ready = true;
      this.port.postMessage({ type: 'ready', sampleRate });
    } catch (err) {
      this.port.postMessage({ type: 'error', message: String(err) });
    }
  }
  
  startSynth() {
    const phases = new Float32Array(NUM_PARTIALS).fill(0.0);
    const ids = add_sines(phases);
    this.sineIds = Array.from(ids);
    
    for (let i = 0; i < NUM_PARTIALS; i++) {
      this.lastAmpEventSample[i] = null;
      this.lastFreqEventSample[i] = null;
    }
    
    for (let i = 0; i < NUM_PARTIALS; i++) {
      this.randomValues[i] = Math.random() * 2 - 1;
    }
    
    this.started = true;
    this.port.postMessage({ type: 'started', partials: NUM_PARTIALS });
  }
  
  // === Modulator Evaluation Methods ===
  
  evaluateLfo(sampleOffset, phaseOffset) {
    if (!this.lfoEnabled) return 1.0;
    const lfoSin = this.lfo.sinAt(sampleOffset, sampleRate, phaseOffset);
    return this.lfoOffset + this.lfoAmount * lfoSin;
  }
  
  evaluateRandom(partialIndex) {
    return this.randomEnabled ? this.randomValues[partialIndex] : 1.0;
  }
  
  evaluateLowpass(partialNum) {
    if (!this.lowpassEnabled) return 1.0;
    const lp = 1 / (1 + Math.pow(partialNum / this.lowpassCutoff, 2 * this.lowpassSlope));
    const res = this.lowpassResonance * Math.exp(-0.5 * Math.pow((partialNum - this.lowpassCutoff) / (this.lowpassCutoff * 0.1), 2));
    return lp + res;
  }
  
  evaluateHighpass(partialNum) {
    if (!this.highpassEnabled) return 1.0;
    const hp = Math.pow(partialNum / this.highpassCutoff, 2 * this.highpassSlope) / (1 + Math.pow(partialNum / this.highpassCutoff, 2 * this.highpassSlope));
    const res = this.highpassResonance * Math.exp(-0.5 * Math.pow((partialNum - this.highpassCutoff) / (this.highpassCutoff * 0.1), 2));
    return hp + res;
  }
  
  evaluateComb(partialNum) {
    if (!this.combEnabled) return 1.0;
    return 0.5 + 0.5 * Math.cos(partialNum * Math.PI / this.combSpacing + this.combPhase);
  }
  
  evaluatePwm(partialNum) {
    if (!this.pwmEnabled) return 1.0;
    let d = this.pwmDuty;
    d = ((d % 1) + 1) % 1;
    return (2 / (partialNum * Math.PI)) * Math.sin(partialNum * Math.PI * d);
  }
  
  evaluateWavefolder(partialNum) {
    if (!this.wavefolderEnabled) return 1.0;
    const normalizedHarmonic = partialNum / 32;
    const foldAmount = this.wavefolderFold * (1 + normalizedHarmonic * this.wavefolderAsymmetry);
    const foldPattern = Math.sin(partialNum * foldAmount) * Math.cos(partialNum / foldAmount);
    const emphasis = 0.5 + 0.5 * Math.sin(partialNum * Math.PI / foldAmount);
    return foldPattern * emphasis;
  }
  
  evaluateBarberPole(partialIndex) {
    if (!this.barberPoleEnabled) return 1.0;
    const pos = (partialIndex / this.barberPoleDensity) + this.barberPolePhase;
    const frac = pos - Math.round(pos);
    let stripe = Math.cos(Math.PI * frac);
    stripe = Math.max(0, stripe);
    stripe = Math.pow(stripe, this.barberPoleQ);
    return stripe;
  }
  
  evaluateFalling(partialIndex) {
    if (!this.fallingEnabled) return 1.0;
    if (this.fallingLanded.has(partialIndex) || this.fallingHarmonic.pos === partialIndex) {
      return 1.0;
    }
    return 0.0;
  }
  
  evaluateVowel(partialNum) {
    if (!this.vowelEnabled) return 1.0;
    const morph = Math.max(0, Math.min(1, this.vowelMorph));
    const idx = morph * (this.vowelFormants.length - 1);
    const idxA = Math.floor(idx);
    const idxB = Math.min(idxA + 1, this.vowelFormants.length - 1);
    const t = idx - idxA;
    
    const formants = [0, 1, 2].map(fi =>
      this.vowelFormants[idxA].f[fi] * (1 - t) + this.vowelFormants[idxB].f[fi] * t
    );
    
    const harmonicFreq = this.baseFreq * partialNum;
    let amp = 0;
    for (const f of formants) {
      const dist = Math.log2(harmonicFreq / f);
      amp += Math.exp(-this.vowelQ * dist * dist);
    }
    return amp;
  }
  
  evaluateKeyboardGate() {
    if (!this.keyboardGateEnabled) return 1.0;
    return this.keyboardGateOpen ? 1.0 : 0.0;
  }
  
  evaluateKeyboardPitch() {
    if (!this.keyboardPitchEnabled) return 1.0;
    return this.keyboardPitchRatio;
  }
  
  // === Per-frame modulator updates ===
  
  updateRandomModulator(blockSize) {
    if (!this.randomEnabled) return;
    const callsPerSecond = sampleRate / blockSize;
    const changeProb = this.randomChangeRate / callsPerSecond;
    for (let i = 0; i < NUM_PARTIALS; i++) {
      if (Math.random() < changeProb) {
        this.randomValues[i] = Math.random() * 2 - 1;
      }
    }
  }
  
  updateBarberPolePhase(blockSize) {
    if (!this.barberPoleEnabled) return;
    const density = Math.max(0.01, this.barberPoleDensity);
    this.barberPolePhase += (this.barberPoleSpeed / Math.abs(density)) * (blockSize / sampleRate);
    this.barberPolePhase = this.barberPolePhase % 1;
    if (this.barberPolePhase < 0) this.barberPolePhase += 1;
  }
  
  updateFallingHarmonics() {
    if (!this.fallingEnabled) return;
    if (this.fallingHarmonic.pos > 0 && Math.random() < this.fallingProbability) {
      this.fallingHarmonic.pos -= 1;
    }
    if (this.fallingHarmonic.pos === 0) {
      const landedIdx = this.fallingLanded.size;
      this.fallingLanded.add(landedIdx);
      this.fallingHarmonic = { pos: 31 };
    }
    if (this.fallingLanded.size >= 32) {
      this.fallingHarmonic = { pos: 31 };
      this.fallingLanded = new Set();
    }
  }
  
  process(inputs, outputs, parameters) {
    if (!this.ready) return true;
    
    const output = outputs[0];
    if (!output || !output[0]) return true;
    
    const buffer = output[0];
    const blockSize = buffer.length;
    
    if (!this.started) {
      buffer.fill(0);
      return true;
    }
    
    const currentSample = get_current_sample_position();
    const blockEnd = currentSample + blockSize;
    const targetSample = blockEnd + EVENT_INTERVAL;
    
    // Advance LFO phase
    this.lfo.advance(currentSample, sampleRate);
    
    // Update animated modulators
    this.updateRandomModulator(blockSize);
    this.updateBarberPolePhase(blockSize);
    this.updateFallingHarmonics();
    
    // Begin building event buffers
    this.scheduler.beginFrame();
    
    // Inject immediate events for low-latency keyboard response
    // Uses override flag to clear pending events and inject a smooth ramp:
    // 1) At currentSample: the value BEFORE keyboard change (avoids jump)
    // 2) At currentSample + KEYBOARD_RAMP_SAMPLES: the NEW value
    if (this.needsImmediateEvent) {
      // Compute pitch modifiers for both old and new states
      const prevPitchMod = this.keyboardPitchEnabled ? this.prevKeyboardPitchRatio : 1.0;
      const newPitchMod = this.evaluateKeyboardPitch();
      
      // Compute gate values for both old and new states
      const prevGateValue = this.keyboardGateEnabled ? (this.prevKeyboardGateOpen ? 1.0 : 0.0) : 1.0;
      const newGateValue = this.evaluateKeyboardGate();
      
      for (let i = 0; i < NUM_PARTIALS; i++) {
        const sineId = this.sineIds[i];
        const partialNum = i + 1;
        const phaseOffset = i / NUM_PARTIALS;
        
        // Use override=true to clear pending events from currentSample onwards
        this.scheduler.beginSine(sineId, true);
        
        // Evaluate all non-keyboard amplitude modulators (common to both before/after)
        const lfoValue = this.evaluateLfo(0, phaseOffset);
        const randomValue = this.evaluateRandom(i);
        const lowpassValue = this.evaluateLowpass(partialNum);
        const highpassValue = this.evaluateHighpass(partialNum);
        const combValue = this.evaluateComb(partialNum);
        const pwmValue = this.evaluatePwm(partialNum);
        const wavefolderValue = this.evaluateWavefolder(partialNum);
        const barberPoleValue = this.evaluateBarberPole(i);
        const fallingValue = this.evaluateFalling(i);
        const vowelValue = this.evaluateVowel(partialNum);
        
        const baseAmplitude = lfoValue * randomValue * lowpassValue * highpassValue * combValue * pwmValue * wavefolderValue * barberPoleValue * fallingValue * vowelValue;
        
        // Event 1: Value BEFORE keyboard change (at currentSample)
        const prevAmplitude = (baseAmplitude * prevGateValue) / 16;
        this.scheduler.addAmplitudeEvent(currentSample, prevAmplitude);
        
        // Event 2: Value AFTER keyboard change (at currentSample + ramp)
        const rampSample = currentSample + this.KEYBOARD_RAMP_SAMPLES;
        const newAmplitude = (baseAmplitude * newGateValue) / 16;
        this.scheduler.addAmplitudeEvent(rampSample, newAmplitude);
        
        // Frequency events with same pattern
        const prevFreq = this.baseFreq * prevPitchMod * partialNum;
        this.scheduler.addFrequencyEvent(currentSample, prevFreq);
        
        const newFreq = this.baseFreq * newPitchMod * partialNum;
        this.scheduler.addFrequencyEvent(rampSample, newFreq);
        
        this.scheduler.endSine();
        
        // Update lastEventSample to rampSample so main loop schedules from there
        this.lastAmpEventSample[i] = rampSample;
        this.lastFreqEventSample[i] = rampSample;
      }
      
      // Clear previous state after processing (ready for next keyboard event)
      this.prevKeyboardPitchRatio = this.keyboardPitchRatio;
      this.prevKeyboardGateOpen = this.keyboardGateOpen;
      
      this.needsImmediateEvent = false;
    }
    
    for (let i = 0; i < NUM_PARTIALS; i++) {
      const sineId = this.sineIds[i];
      const partialNum = i + 1;
      const phaseOffset = i / NUM_PARTIALS;
      
      this.scheduler.beginSine(sineId);
      
      // --- Amplitude events ---
      let ampSample = (this.lastAmpEventSample[i] === null)
        ? currentSample
        : this.lastAmpEventSample[i] + EVENT_INTERVAL;
      
      let firstLfoForViz = null;
      let firstCombinedForViz = null;
      let lastAmpGenerated = this.lastAmpEventSample[i];
      
      while (ampSample <= targetSample) {
        const sampleOffset = ampSample - currentSample;
        
        // Evaluate all amplitude modulators
        const lfoValue = this.evaluateLfo(sampleOffset, phaseOffset);
        const randomValue = this.evaluateRandom(i);
        const lowpassValue = this.evaluateLowpass(partialNum);
        const highpassValue = this.evaluateHighpass(partialNum);
        const combValue = this.evaluateComb(partialNum);
        const pwmValue = this.evaluatePwm(partialNum);
        const wavefolderValue = this.evaluateWavefolder(partialNum);
        const barberPoleValue = this.evaluateBarberPole(i);
        const fallingValue = this.evaluateFalling(i);
        const vowelValue = this.evaluateVowel(partialNum);
        const keyboardGateValue = this.evaluateKeyboardGate();
        
        // Combined amplitude (product of all modulators)
        const combinedAmplitude = lfoValue * randomValue * lowpassValue * highpassValue * combValue * pwmValue * wavefolderValue * barberPoleValue * fallingValue * vowelValue * keyboardGateValue;
        
        // Scale for output
        const scaledAmp = combinedAmplitude / 16;
        
        // Store first values for visualization
        if (firstLfoForViz === null) {
          firstLfoForViz = lfoValue;
          firstCombinedForViz = combinedAmplitude;
          this.lowpassValuesViz[i] = lowpassValue;
          this.highpassValuesViz[i] = highpassValue;
          this.combValuesViz[i] = combValue;
          this.pwmValuesViz[i] = pwmValue;
          this.wavefolderValuesViz[i] = wavefolderValue;
          this.barberPoleValuesViz[i] = barberPoleValue;
          this.fallingValuesViz[i] = fallingValue;
          this.vowelValuesViz[i] = vowelValue;
          this.keyboardGateValuesViz[i] = keyboardGateValue;
        }
        
        this.scheduler.addAmplitudeEvent(ampSample, scaledAmp);
        lastAmpGenerated = ampSample;
        ampSample += EVENT_INTERVAL;
      }
      
      if (lastAmpGenerated !== this.lastAmpEventSample[i]) {
        this.lastAmpEventSample[i] = lastAmpGenerated;
        this.lfoValuesViz[i] = firstLfoForViz;
        this.combinedValuesViz[i] = firstCombinedForViz;
      }
      
      // --- Frequency events ---
      let freqSample = (this.lastFreqEventSample[i] === null)
        ? currentSample
        : this.lastFreqEventSample[i] + EVENT_INTERVAL;
      
      let lastFreqGenerated = this.lastFreqEventSample[i];
      
      // Evaluate pitch modulators
      const pitchMod = this.evaluateKeyboardPitch();
      
      while (freqSample <= targetSample) {
        const freq = this.baseFreq * pitchMod * partialNum;
        this.scheduler.addFrequencyEvent(freqSample, freq);
        lastFreqGenerated = freqSample;
        freqSample += EVENT_INTERVAL;
      }
      
      if (lastFreqGenerated !== this.lastFreqEventSample[i]) {
        this.lastFreqEventSample[i] = lastFreqGenerated;
      }
      
      this.scheduler.endSine();
    }
    
    // Send events to WASM
    if (this.scheduler.hasAmplitudeEvents()) {
      try {
        add_amplitude_events(this.scheduler.getAmplitudeBuffer());
      } catch (e) {
        console.error('[Processor] Error adding bulk amp events:', e);
      }
    }
    
    if (this.scheduler.hasFrequencyEvents()) {
      try {
        add_frequency_events(this.scheduler.getFrequencyBuffer());
      } catch (e) {
        console.error('[Processor] Error adding bulk freq events:', e);
      }
    }
    
    // Render audio
    try {
      render(buffer);
    } catch (e) {
      console.error('[Processor] Render error:', e);
      buffer.fill(0);
    }
    
    // Send modulator data for visualization (throttled)
    this.vizUpdateCounter++;
    if (this.vizUpdateCounter >= this.vizUpdateInterval) {
      this.vizUpdateCounter = 0;
      this.port.postMessage({ 
        type: 'modulator-values',
        lfo: Array.from(this.lfoValuesViz),
        random: Array.from(this.randomValues),
        lowpass: Array.from(this.lowpassValuesViz),
        highpass: Array.from(this.highpassValuesViz),
        comb: Array.from(this.combValuesViz),
        pwm: Array.from(this.pwmValuesViz),
        wavefolder: Array.from(this.wavefolderValuesViz),
        barberPole: Array.from(this.barberPoleValuesViz),
        falling: Array.from(this.fallingValuesViz),
        vowel: Array.from(this.vowelValuesViz),
        keyboardGate: Array.from(this.keyboardGateValuesViz),
        combined: Array.from(this.combinedValuesViz)
      });
    }
    
    return true;
  }
}

registerProcessor('additive-synth-processor', AdditiveSynthProcessor);
