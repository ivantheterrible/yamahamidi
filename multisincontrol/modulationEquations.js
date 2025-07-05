// Barber Pole Harmonics: creates a continuously rising or falling harmonic pattern (auditory illusion)
export class BarberPoleHarmonicsEquation extends ModulationEquation {
  static get makeupGainDefault() { return 0.0; }
  static get params() {
    return [
      {
        name: "density",
        defaultValue: 6,
        label: "Stripe Spacing",
        min: 1,
        max: 16,
        step: 0.01
      },
      {
        name: "speed",
        defaultValue: 3,
        label: "Rise/Fall Speed",
        min: -20,
        max: 20,
        step: 0.1
      },
      {
        name: "q",
        defaultValue: 2,
        label: "Stripe Q",
        min: 0.1,
        max: 32,
        step: 0.01
      }
    ];
  }
  static get label() { return "Barber Pole Harmonics"; }
  static get description() {
    return "Creates a continuously rising or falling harmonic pattern (barber pole illusion). Density sets the number of stripes; speed controls rise/fall direction and rate. Q controls stripe sharpness.";
  }
  static get id() { return "BarberPoleHarmonics"; }

  evaluate(state, density, speed, q) {
    // Animate phase using speed (speed is in cycles per second, phase in [0,1])
    if (typeof this._phase !== 'number') this._phase = 0;
    // Estimate block size (assume 128 samples per block, 44.1kHz sample rate)
    const blockSize = 128;
    const sampleRate = 44100;
    // Clamp density to avoid division by zero
    density = Math.max(0.01, density);
    // Advance phase
    this._phase += (speed / Math.abs(density)) * (blockSize / sampleRate);
    this._phase = this._phase % 1;
    if (this._phase < 0) this._phase += 1;
    // Stripe pattern: windowed stripes using a raised cosine powered by q
    for (let n = 0; n < 32; n++) {
      const pos = (n / density) + this._phase;
      // Stripe: center at integer values, windowed by Q
      // At q=0.1, stripes are very wide; at q=32, stripes are very sharp (single harmonic)
      const frac = pos - Math.round(pos);
      // Raised cosine window, sharpness controlled by q
      let stripe = Math.cos(Math.PI * frac);
      stripe = Math.max(0, stripe); // Only positive lobe
      stripe = Math.pow(stripe, q); // Q controls sharpness
      state[n] = stripe;
    }
    // Normalize
    let max = 0.001;
    for (let n = 0; n < 32; n++) max = Math.max(max, Math.abs(state[n]));
    for (let n = 0; n < 32; n++) state[n] /= max;
  }
}
// Vowel Morph equation: morphs between vowel formants using base frequency
export class VowelMorphEquation extends ModulationEquation {
  static get makeupGainDefault() { return 0.5; }
  static get params() {
    return [
      {
        name: "morph",
        defaultValue: 0,
        label: "Vowel Morph",
        min: 0,
        max: 1,
        step: 0.01,
        defaultValue: 0.5,
        showLfo: true,
        lfoFreqMin: 0.01,
        lfoFreqMax: 2,
        lfoDepthMin: 0,
        lfoDepthMax: 1,
        lfoFreqInitialValue: 0.1,
        lfoDepthInitialValue: 0.5
      },
      {
        name: "q",
        defaultValue: 12,
        label: "Formant Q",
        min: 2,
        max: 50,
        step: 0.1
      },
      // global_baseFrequency is a special parameter injected by the processor, not for UI
      { name: "global_baseFrequency" }
    ];
  }
  static get label() { return "Vowel Morph"; }
  static get description() {
    return "Morphs between vowel sounds (A, E, I, O, U) using real formant data. Tracks the base oscillator frequency.";
  }
  static get id() { return "VowelMorph"; }

  evaluate(state, morph, q, global_baseFrequency) {
    // Formant frequencies for A, E, I, O, U (Hz)
    const vowels = [
      { f: [730, 1090, 2440] }, // A
      { f: [660, 1700, 2400] }, // E
      { f: [440, 1220, 2600] }, // I
      { f: [400, 800, 2600] },  // O
      { f: [350, 600, 2700] }   // U
    ];
    // Clamp morph to [0, 1]
    morph = Math.max(0, Math.min(1, morph));
    // Morph between vowels
    const idx = morph * (vowels.length - 1);
    const idxA = Math.floor(idx);
    const idxB = Math.min(idxA + 1, vowels.length - 1);
    const t = idx - idxA;
    // Interpolate formants
    const formants = [0, 1, 2].map(i =>
      vowels[idxA].f[i] * (1 - t) + vowels[idxB].f[i] * t
    );
    // For each harmonic, calculate its frequency and apply formant peaks
    for (let n = 0; n < 32; n++) {
      const harmonicFreq = global_baseFrequency * (n + 1);
      let amp = 0;
      for (let f of formants) {
        const dist = Math.log2(harmonicFreq / f);
        amp += Math.exp(-q * dist * dist);
      }
      state[n] = amp;
    }
    // Normalize
    const max = Math.max(...state, 0.001);
    for (let n = 0; n < 32; n++) state[n] /= max;
  }
}
// Falling Harmonics equation: harmonics 'fall' from 32 to 1, stacking up, then reset
export class FallingHarmonicsEquation extends ModulationEquation {
  static get makeupGainDefault() { return 0.0; }
  static get params() {
    return [
      {
        name: "probability",
        defaultValue: 0.1,
        label: "Fall Probability",
        min: 0.01,
        max: 1.0,
        step: 0.01
      }
    ];
  }
  static get label() { return "Falling Harmonics"; }
  static get description() {
    return "Harmonics 'fall' from 32 to 1, stacking up. When the stack is full, it resets. Probability controls fall speed.";
  }
  static get id() { return "FallingHarmonics"; }
  evaluate(state, probability) {
    // Defensive: ensure state is initialized
    if (!Array.isArray(this.falling) || !this.landed) {
      this.falling = [{pos: 31}];
      this.landed = new Set();
    }
    // Clear state
    for (let n = 0; n < 32; n++) state[n] = 0;

    // Only one falling harmonic at a time
    if (this.falling.length === 0 && this.landed.size < 32) {
      this.falling.push({pos: 31});
    }

    // Move the single falling harmonic
    if (this.falling.length > 0) {
      let h = this.falling[0];
      if (h.pos > 0 && Math.random() < probability) {
        h.pos -= 1;
      }
      // If landed, add to landed set and remove from falling
      if (h.pos === 0) {
        // Landed harmonics fill from the bottom up: 0, 1, 2, ...
        // Use landed.size to determine the next available slot from the bottom
        const landedIdx = this.landed.size;
        this.landed.add(landedIdx);
        this.falling = [];
      }
    }

    // If all slots filled, reset
    if (this.landed.size >= 32) {
      this.falling = [{pos: 31}];
      this.landed = new Set();
    }

    // Mark all landed harmonics
    for (let idx of this.landed) {
      state[idx] = 1;
    }
    // Mark the falling harmonic
    if (this.falling.length > 0) {
      state[this.falling[0].pos] = 1;
    }
  }
}
import { ModulationEquation } from './modulationEquationBase.js';

// Three Harmonics equation: enables exactly three harmonics, each LFO-controllable
export class ThreeHarmonicsEquation extends ModulationEquation {
  static get makeupGainDefault() { return 0.0; }
  static get params() {
    return [
      {
        name: "harm1",
        defaultValue: 1,
        label: "Harmonic 1 (LFO)",
        min: 1,
        max: 32,
        step: 1,
        showLfo: true,
        lfoFreqMin: 0.01,
        lfoFreqMax: 5,
        lfoDepthMin: 0,
        lfoDepthMax: 31,
        lfoFreqInitialValue: 0.2,
        lfoDepthInitialValue: 8
      },
      {
        name: "harm2",
        defaultValue: 2,
        label: "Harmonic 2 (LFO)",
        min: 1,
        max: 32,
        step: 1,
        showLfo: true,
        lfoFreqMin: 0.01,
        lfoFreqMax: 5,
        lfoDepthMin: 0,
        lfoDepthMax: 31,
        lfoFreqInitialValue: 0.3,
        lfoDepthInitialValue: 12
      },
      {
        name: "harm3",
        defaultValue: 3,
        label: "Harmonic 3 (LFO)",
        min: 1,
        max: 32,
        step: 1,
        showLfo: true,
        lfoFreqMin: 0.01,
        lfoFreqMax: 5,
        lfoDepthMin: 0,
        lfoDepthMax: 31,
        lfoFreqInitialValue: 0.4,
        lfoDepthInitialValue: 16
      }
    ];
  }
  static get label() { return "Three Harmonics"; }
  static get description() {
    return "Enables exactly three harmonics, each LFO-controllable. Useful for evolving, sparse spectra.";
  }
  static get id() { return "ThreeHarmonics"; }
  evaluate(state, harm1, harm2, harm3) {
    // Clear all
    for (let n = 0; n < 32; n++) state[n] = 0;
    // Enable the three selected harmonics (1-based)
    const h1 = Math.max(1, Math.min(32, Math.round(harm1)));
    const h2 = Math.max(1, Math.min(32, Math.round(harm2)));
    const h3 = Math.max(1, Math.min(32, Math.round(harm3)));
    state[h1 - 1] = 1;
    state[h2 - 1] = 1;
    state[h3 - 1] = 1;
  }
}

// Modulo Pattern equation: enables harmonics where (n+1) % modulus === offset
export class ModuloPatternEquation extends ModulationEquation {
  static get makeupGainDefault() { return 0.0; }
  static get params() {
    return [
      {
        name: "modulus",
        defaultValue: 4,
        label: "Modulus (LFO)",
        min: 1,
        max: 16,
        step: 1,
        showLfo: true,
        lfoFreqMin: 0.01,
        lfoFreqMax: 5,
        lfoDepthMin: 0,
        lfoDepthMax: 15,
        lfoFreqInitialValue: 0.3,
        lfoDepthInitialValue: 4
      },
      {
        name: "offset",
        defaultValue: 0,
        label: "Offset",
        min: 0,
        max: 15,
        step: 1
      }
    ];
  }
  static get label() { return "Modulo Pattern"; }
  static get description() {
    return "Enables harmonics where (n+1) % modulus = offset. Modulus is LFO-controllable, offset is stepped.";
  }
  static get id() { return "ModuloPattern"; }
  evaluate(state, modulus, offset) {
    const m = Math.max(1, Math.round(modulus));
    const o = Math.max(0, Math.round(offset));
    for (let n = 0; n < 32; n++) {
      state[n] = ((n + 1) % m === o) ? 1 : 0;
    }
  }
}

// Bitwise Mask equation: enables harmonics where (n+1) & mask !== 0
export class BitwiseMaskEquation extends ModulationEquation {
  static get makeupGainDefault() { return 0.0; }
  static get params() {
    return [
      {
        name: "mask",
        defaultValue: 15,
        label: "Bitwise Mask (LFO)",
        min: 1,
        max: 31,
        step: 1,
        showLfo: true,
        lfoFreqMin: 0.01,
        lfoFreqMax: 5,
        lfoDepthMin: 0,
        lfoDepthMax: 30,
        lfoFreqInitialValue: 0.2,
        lfoDepthInitialValue: 8
      }
    ];
  }
  static get label() { return "Bitwise Mask"; }
  static get description() {
    return "Enables harmonics where (n+1) & mask ≠ 0. Mask is LFO-controllable for evolving pseudo-random patterns.";
  }
  static get id() { return "BitwiseMask"; }
  evaluate(state, mask) {
    const m = Math.max(1, Math.round(mask));
    for (let n = 0; n < 32; n++) {
      state[n] = ((n + 1) & m) !== 0 ? 1 : 0;
    }
  }
}

// Factors equation: enables harmonics that are factors of the LFO value
export class FactorsEquation extends ModulationEquation {
  static get makeupGainDefault() { return 0.0; }
  static get params() {
    return [
      {
        name: "number",
        defaultValue: 8,
        label: "Number (LFO)",
        min: 1,
        max: 32,
        step: 1,
        showLfo: true,
        lfoFreqMin: 0.01,
        lfoFreqMax: 5,
        lfoDepthMin: 0,
        lfoDepthMax: 31,
        lfoFreqInitialValue: 0.5,
        lfoDepthInitialValue: 10
      }
    ];
  }
  static get label() { return "Factors"; }
  static get description() {
    return "An LFO sweeps a number from 1 to 32. Harmonics that are factors of the rounded value are enabled.";
  }
  static get id() { return "Factors"; }
  evaluate(state, number) {
    const nVal = Math.max(1, Math.round(number));
    for (let n = 0; n < 32; n++) {
      state[n] = (nVal % (n + 1) === 0) ? 1 : 0;
    }
  }
}

// Multiples equation: enables harmonics that are multiples of the LFO value
export class MultiplesEquation extends ModulationEquation {
  static get makeupGainDefault() { return 0.0; }
  static get params() {
    return [
      {
        name: "base",
        defaultValue: 2,
        label: "Base (LFO)",
        min: 1,
        max: 8,
        step: 1,
        showLfo: true,
        lfoFreqMin: 0.01,
        lfoFreqMax: 5,
        lfoDepthMin: 0,
        lfoDepthMax: 7,
        lfoFreqInitialValue: 0.5,
        lfoDepthInitialValue: 3
      }
    ];
  }
  static get label() { return "Multiples"; }
  static get description() {
    return "An LFO sweeps a base from 1 to 8. Harmonics that are multiples of the rounded value are enabled.";
  }
  static get id() { return "Multiples"; }
  evaluate(state, base) {
    const bVal = Math.max(1, Math.round(base));
    for (let n = 0; n < 32; n++) {
      state[n] = ((n + 1) % bVal === 0) ? 1 : 0;
    }
  }
}




export class OffsetSineEquation extends ModulationEquation {
  // Default make-up gain (log10 value)
  static get makeupGainDefault() { return 0.35; }
  static get params() {
    return [
      {
        name: "position",
        defaultValue: 0,
        label: "Position",
        min: 0,
        max: 2 * Math.PI,
        showLfo: true,
        lfoFreqMin: 0.01,
        lfoFreqMax: 10,
        lfoDepthMin: 0,
        lfoDepthMax: 2 * Math.PI,
        lfoFreqInitialValue: 1,
        lfoDepthInitialValue: 0.15
      }
    ];
  }
  static get label() {
    return "Offset Sine";
  }
  static get description() {
    return "Creates a moving sine pattern across the harmonics. Shifting the position animates the harmonic spectrum.";
  }
  static get id() {
    return "OffsetSine";
  }
  evaluate(state, position) {
    // Stateless: set state[n] for all harmonics
    for (let n = 0; n < 32; n++) {
      state[n] = Math.sin(position + (n + 1) * (2 * Math.PI / 32));
    }
  }
}

export class PWMEquation extends ModulationEquation {
  // Default make-up gain (log10 value)
  static get makeupGainDefault() { return 1.61; }
  static get params() {
    return [
      {
        name: "duty",
        defaultValue: 0.32,
        label: "Duty Cycle",
        showLfo: true,
        lfoFreqMin: 0.01,
        lfoFreqMax: 10,
        lfoDepthMin: 0,
        lfoDepthMax: 1,
        lfoFreqInitialValue: 0.7,
        lfoDepthInitialValue: 0.1
      }
    ];
  }
  static get label() {
    return "PWM";
  }
  static get description() {
    return "Simulates the harmonic structure of a pulse wave. Adjust duty cycle for thin to full sounds. LFO provides Pulse Width Modulation.";
  }
  static get id() {
    return "PWM";
  }
  evaluate(state, duty) {
    for (let n = 0; n < 32; n++) {
      let d = duty;
      d = ((d % 1) + 1) % 1;
      state[n] = (2 / ((n + 1) * Math.PI)) * Math.sin((n + 1) * Math.PI * d);
    }
  }
}

export class AnalogLowpassEquation extends ModulationEquation {
  // Default make-up gain (log10 value)
  static get makeupGainDefault() { return 0; }
  static get params() {
    return [
      { name: "cutoff", defaultValue: 10, label: "Cutoff Harmonic", min: 1, max: 32, step: 0.01,
        showLfo: true,
        lfoFreqMin: 0.01,
        lfoFreqMax: 10,
        lfoDepthMin: 0,
        lfoDepthMax: 8, // allow up to 8 harmonics swing
        lfoFreqInitialValue: 0.5,
        lfoDepthInitialValue: 1 },
      { name: "slope", defaultValue: 2, label: "Slope", min: 0.5, max: 6, step: 0.01 },
      { name: "resonance", defaultValue: 0.5, label: "Resonance", min: 0, max: 2, step: 0.01 }
    ];
  }
  static get label() { return "Lowpass"; }
  static get description() {
    return "A resonant lowpass filter. Cutoff, slope, and resonance shape the harmonic rolloff.";
  }
  static get id() { return "AnalogLowpass"; }
  evaluate(state, cutoff, slope, resonance) {
    for (let n = 0; n < 32; n++) {
      const nh = n + 1;
      const lp = 1 / (1 + Math.pow(nh / cutoff, 2 * slope));
      const res = resonance * Math.exp(-0.5 * Math.pow((nh - cutoff) / (cutoff * 0.1), 2));
      state[n] = lp + res;
    }
  }
}

export class HarmonicHighpassEquation extends ModulationEquation {
  // Default make-up gain (log10 value)
  static get makeupGainDefault() { return 0; }
  static get params() {
    return [
      { 
        name: "cutoff", 
        defaultValue: 8, 
        label: "Cutoff Harmonic", 
        min: 1, 
        max: 32, 
        step: 0.01,
        showLfo: true,
        lfoFreqMin: 0.01,
        lfoFreqMax: 10,
        lfoDepthMin: 0,
        lfoDepthMax: 8, // allow up to 8 harmonics swing
        lfoFreqInitialValue: 0.5,
        lfoDepthInitialValue: 1 
      },
      { 
        name: "slope", 
        defaultValue: 2, 
        label: "Slope", 
        min: 0.5, 
        max: 6, 
        step: 0.01 
      },
      { 
        name: "resonance", 
        defaultValue: 0.5, 
        label: "Resonance", 
        min: 0, 
        max: 2, 
        step: 0.01 
      }
    ];
  }
  static get label() { return "Highpass"; }
  static get description() {
    return "A resonant highpass filter. Cutoff, slope, and resonance shape the harmonic rolloff. Higher harmonics pass through while lower ones are attenuated.";
  }
  static get id() { return "AnalogHighpass"; }
  evaluate(state, cutoff, slope, resonance) {
    for (let n = 0; n < 32; n++) {
      const nh = n + 1;
      // Invert the lowpass response to create highpass
      const hp = Math.pow(nh / cutoff, 2 * slope) / (1 + Math.pow(nh / cutoff, 2 * slope));
      // Resonance peak at cutoff frequency
      const res = resonance * Math.exp(-0.5 * Math.pow((nh - cutoff) / (cutoff * 0.1), 2));
      state[n] = hp + res;
    }
  }
}

export class PerHarmonicSampleHoldEquation extends ModulationEquation {
  // Default make-up gain (log10 value)
  static get makeupGainDefault() { return 0; }
  static get params() {
    return [
      { name: "probability", defaultValue: 0.05, min: 0.01, max: 0.25, step: 0.01, label: "Change Probability" }
    ];
  }
  static get label() { return "Per-Harmonic S&H"; }
  static get description() {
    return "Randomizes each harmonic independently for evolving spectra. Probability controls change rate.";
  }
  static get id() { return "PerHarmonicSampleHold"; }

  evaluate(state, probability) {
    if (!this._snhValues) this._snhValues = new Float32Array(32);
    for (let n = 0; n < 32; n++) {
      if (typeof this._snhValues[n] === "undefined") {
        this._snhValues[n] = 0;
      }
      if (Math.random() < (probability/100)) {
        const sign = Math.random() < 0.5 ? -1 : 1;
        const mag = Math.pow(10, Math.random() * 2 - 1); // Log-random between 0.1 and 10
        this._snhValues[n] = sign * Math.min(mag, 1);
      }
      state[n] = this._snhValues[n];
    }
  }
}

// Wavefolder equation: adds rich, complex harmonics by folding
export class WavefolderEquation extends ModulationEquation {
  static get makeupGainDefault() { return 0.5; }
  static get params() {
    return [
      {
        name: "fold",
        defaultValue: 2.5,
        label: "Fold Amount",
        min: 1,
        max: 10,
        step: 0.1,
        showLfo: true,
        lfoFreqMin: 0.01,
        lfoFreqMax: 8,
        lfoDepthMin: 0,
        lfoDepthMax: 4,
        lfoFreqInitialValue: 0.3,
        lfoDepthInitialValue: 1
      },
      {
        name: "asymmetry",
        defaultValue: 0,
        label: "Asymmetry",
        min: -1,
        max: 1,
        step: 0.01
      }
    ];
  }
  static get label() { return "Wavefolder"; }
  static get description() {
    return "Simulates analog wavefolder circuits for rich, complex harmonics. Higher fold values create more harmonic complexity.";
  }
  static get id() { return "Wavefolder"; }
  evaluate(state, fold, asymmetry) {
    for (let n = 0; n < 32; n++) {
      const harmonic = n + 1;
      const normalizedHarmonic = harmonic / 32;
      const foldAmount = fold * (1 + normalizedHarmonic * asymmetry);
      const foldPattern = Math.sin(harmonic * foldAmount) * Math.cos(harmonic / foldAmount);
      const emphasis = 0.5 + 0.5 * Math.sin(harmonic * Math.PI / foldAmount);
      state[n] = foldPattern * emphasis;
    }
  }
}

// Odd/Even Balance equation: morphs between odd and even harmonics
export class OddEvenBalanceEquation extends ModulationEquation {
  static get makeupGainDefault() { return 0.3; }
  static get params() {
    return [
      {
        name: "balance",
        defaultValue: 0,
        label: "Odd/Even Balance",
        min: -1,
        max: 1,
        step: 0.01,
        showLfo: true,
        lfoFreqMin: 0.01,
        lfoFreqMax: 5,
        lfoDepthMin: 0,
        lfoDepthMax: 1,
        lfoFreqInitialValue: 0.15,
        lfoDepthInitialValue: 0.5
      },
      {
        name: "shift",
        defaultValue: 0,
        label: "Harmonic Shift",
        min: 0,
        max: 1,
        step: 0.01
      }
    ];
  }
  static get label() { return "Odd/Even Balance"; }
  static get description() {
    return "Controls the balance between odd and even harmonics. Negative values emphasize odd harmonics (square-like), positive values emphasize even harmonics. Shift morphs the definition of odd/even.";
  }
  static get id() { return "OddEvenBalance"; }
  evaluate(state, balance, shift) {
    for (let n = 0; n < 32; n++) {
      const harmonic = n + 1;
      // Shift determines which harmonics are considered 'odd' or 'even'
      const shifted = (harmonic + Math.floor(shift * 32));
      const isOdd = (shifted % 2) === 1;
      let multiplier;
      if (isOdd) {
        multiplier = balance <= 0 ? 1 : 1 - Math.abs(balance);
      } else {
        multiplier = balance >= 0 ? 1 : 1 - Math.abs(balance);
      }
      state[n] = multiplier;
    }
  }
}

// Harmonic Comb Filter equation: creates notches/peaks in the harmonic spectrum
export class HarmonicCombEquation extends ModulationEquation {
  static get makeupGainDefault() { return 0.2; }
  static get params() {
    return [
      {
        name: "spacing",
        defaultValue: 4,
        label: "Comb Spacing",
        min: 1,
        max: 16,
        step: 0.1,
        showLfo: true,
        lfoFreqMin: 0.01,
        lfoFreqMax: 5,
        lfoDepthMin: 0,
        lfoDepthMax: 8,
        lfoFreqInitialValue: 0.2,
        lfoDepthInitialValue: 2
      },
      {
        name: "phase",
        defaultValue: 0,
        label: "Comb Phase",
        min: 0,
        max: 2 * Math.PI,
        step: 0.01,
        showLfo: true,
        lfoFreqMin: 0.01,
        lfoFreqMax: 5,
        lfoDepthMin: 0,
        lfoDepthMax: 2 * Math.PI,
        lfoFreqInitialValue: 0.1,
        lfoDepthInitialValue: 0.5
      }
    ];
  }
  static get label() { return "Harmonic Comb"; }
  static get description() {
    return "Creates a comb filter effect in the harmonic spectrum. Spacing and phase control the notches/peaks.";
  }
  static get id() { return "HarmonicComb"; }
  evaluate(state, spacing, phase) {
    for (let n = 0; n < 32; n++) {
      state[n] = 0.5 + 0.5 * Math.cos((n + 1) * Math.PI / spacing + phase);
    }
  }
}

// Registry of available equations
export class OscSyncEquation extends ModulationEquation {
  static get makeupGainDefault() { return 0.4; }
  static get params() {
    return [
      {
        name: "syncRatio",
        defaultValue: 2,
        label: "Sync Ratio",
        min: 1,
        max: 8,
        step: 0.01,
        showLfo: true,
        lfoFreqMin: 0.01,
        lfoFreqMax: 5,
        lfoDepthMin: 0,
        lfoDepthMax: 2,
        lfoFreqInitialValue: 0.2,
        lfoDepthInitialValue: 0.5
      },
      {
        name: "shape",
        defaultValue: 0,
        label: "Shape",
        min: -1,
        max: 1,
        step: 0.01
      }
    ];
  }
  static get label() { return "Oscillator Sync"; }
  static get description() {
    return "Simulates hard oscillator sync by folding harmonics at a sync ratio. Shape morphs between saw, triangle, and square-like sync timbres.";
  }
  static get id() { return "OscSync"; }
  evaluate(state, syncRatio, shape) {
    // For each harmonic, simulate the effect of sync by folding at the sync point
    for (let n = 0; n < 32; n++) {
      const harmonic = n + 1;
      // The sync point is at 1/syncRatio of the period
      // We'll simulate by boosting harmonics that are multiples of the sync ratio, and folding others
      const folded = Math.abs(Math.sin(Math.PI * harmonic / syncRatio));
      // Shape morphs between saw (0), triangle (-1), and square (+1) sync
      let base = folded;
      if (shape < 0) {
        // Triangle-like: emphasize lower harmonics
        base = folded * (1 - (harmonic / 32) * Math.abs(shape));
      } else if (shape > 0) {
        // Square-like: emphasize even harmonics
        base = folded * (1 + Math.sin(Math.PI * harmonic) * shape * 0.7);
      }
      state[n] = base;
    }
  }
}

// Harmonic Pinball equation: harmonics bounce with physics
export class HarmonicPinballEquation extends ModulationEquation {
  static get makeupGainDefault() { return 0.5; }
  static get params() {
    return [
      {
        name: "gravity",
        defaultValue: 0.2,
        label: "Gravity",
        min: 0,
        max: 1,
        step: 0.01
      },
      {
        name: "bounce",
        defaultValue: 0.8,
        label: "Bounce Energy",
        min: 0.1,
        max: 0.99,
        step: 0.01
      },
      {
        name: "chaos",
        defaultValue: 0.1,
        label: "Chaos",
        min: 0,
        max: 1,
        step: 0.01
      }
    ];
  }
  static get label() { return "Harmonic Pinball"; }
  static get description() {
    return "Harmonics bounce around like pinballs with physics! Gravity pulls them down, they bounce off walls with energy loss, and chaos adds random impulses.";
  }
  static get id() { return "HarmonicPinball"; }

  evaluate(state, gravity, bounce, chaos) {
    // Initialize state if needed
    if (!this.balls) {
      this.balls = [];
      // Create 8 balls with random positions and velocities
      for (let i = 0; i < 8; i++) {
        this.balls.push({
          pos: Math.random() * 31,  // Position (0-31)
          vel: (Math.random() - 0.5) * 2,  // Initial velocity
          size: Math.random() * 0.5 + 0.5  // Ball size affects amplitude
        });
      }
    }

    // Clear state
    for (let n = 0; n < 32; n++) state[n] = 0;

    // Update each ball's physics
    for (let ball of this.balls) {
      // Apply gravity
      ball.vel -= gravity * 0.1;
      
      // Apply position change
      ball.pos += ball.vel;

      // Bounce off walls with energy loss
      if (ball.pos < 0) {
        ball.pos = 0;
        ball.vel = -ball.vel * bounce;
      }
      if (ball.pos > 31) {
        ball.pos = 31;
        ball.vel = -ball.vel * bounce;
      }

      // Add chaos/random impulses
      if (Math.random() < chaos * 0.1) {
        ball.vel += (Math.random() - 0.5) * chaos;
      }

      // Calculate influence on harmonics (gaussian distribution around position)
      const centerPos = Math.floor(ball.pos);
      for (let n = Math.max(0, centerPos - 2); n < Math.min(32, centerPos + 3); n++) {
        const distance = Math.abs(ball.pos - n);
        const influence = Math.exp(-distance * distance * 2) * ball.size;
        state[n] += influence;
      }
    }

    // Normalize output
    let max = 0.001;
    for (let n = 0; n < 32; n++) {
      max = Math.max(max, Math.abs(state[n]));
    }
    for (let n = 0; n < 32; n++) {
      state[n] /= max;
    }
  }
}

// Harmonic Life equation: Conway's Game of Life for harmonics
export class HarmonicLifeEquation extends ModulationEquation {
  static get makeupGainDefault() { return 0.0; }
  static get params() {
    return [
      {
        name: "speed",
        defaultValue: 0.1,
        label: "Evolution Speed",
        min: 0.01,
        max: 1,
        step: 0.01
      },
      {
        name: "threshold",
        defaultValue: 0.5,
        label: "Birth Threshold",
        min: 0,
        max: 1,
        step: 0.01
      },
      {
        name: "fade",
        defaultValue: 0.5,
        label: "Fade Rate",
        min: 0,
        max: 1,
        step: 0.01
      }
    ];
  }
  static get label() { return "Harmonic Life"; }
  static get description() {
    return "Applies Conway's Game of Life rules to harmonics. Each harmonic's state evolves based on its neighbors. Creates complex, evolving timbres.";
  }
  static get id() { return "HarmonicLife"; }

  evaluate(state, speed, threshold, fade) {
    // Initialize state if needed
    if (!this.cells || !this.intensities) {
      this.cells = new Float32Array(32);
      this.intensities = new Float32Array(32);
      // Start with random living cells
      for (let n = 0; n < 32; n++) {
        this.cells[n] = Math.random() < 0.3 ? 1 : 0;
        this.intensities[n] = this.cells[n];
      }
    }

    // Only update on some frames based on speed
    if (Math.random() < speed) {
      const newCells = new Float32Array(32);
      
      // Apply Game of Life rules
      for (let n = 0; n < 32; n++) {
        // Count living neighbors (wrap around edges)
        let neighbors = 0;
        for (let offset = -2; offset <= 2; offset++) {
          if (offset === 0) continue;
          const idx = (n + offset + 32) % 32;
          if (this.cells[idx] > threshold) {
            // Weight closer neighbors more
            neighbors += 1 / Math.abs(offset);
          }
        }

        // Modified Game of Life rules for harmonics
        const isAlive = this.cells[n] > threshold;
        if (isAlive) {
          // Survival: need 2-3.5 neighbors
          newCells[n] = (neighbors >= 2 && neighbors <= 3.5) ? 1 : 0;
        } else {
          // Birth: need exactly 2.8-3.2 neighbors
          newCells[n] = (neighbors >= 2.8 && neighbors <= 3.2) ? 1 : 0;
        }
      }

      // Update cells
      this.cells = newCells;
    }

    // Update intensities with fade
    for (let n = 0; n < 32; n++) {
      // Fade current intensity toward target
      const target = this.cells[n];
      const current = this.intensities[n];
      this.intensities[n] += (target - current) * fade;

      // Apply to state
      state[n] = this.intensities[n];
    }

    // Ensure some minimal activity
    let hasLife = false;
    for (let n = 0; n < 32; n++) {
      if (this.cells[n] > 0) {
        hasLife = true;
        break;
      }
    }
    if (!hasLife) {
      // Seed new random cells
      for (let n = 0; n < 32; n++) {
        if (Math.random() < 0.1) {
          this.cells[n] = 1;
        }
      }
    }
  }
}

// List of those that will actually be used in the UI
export const modulationEquationClasses = [
  BarberPoleHarmonicsEquation,
  OffsetSineEquation,
  PWMEquation,
  AnalogLowpassEquation,
  HarmonicHighpassEquation,
  PerHarmonicSampleHoldEquation,
  WavefolderEquation,
  // OddEvenBalanceEquation, //this one is a bit ... odd
  HarmonicCombEquation,
  //OscSyncEquation, //a bit 'wooly' - could do with improvement
  //FactorsEquation, //not much fun
  //MultiplesEquation, //basically the same as ModuloPattern
  ModuloPatternEquation,
  BitwiseMaskEquation,
  ThreeHarmonicsEquation,
  FallingHarmonicsEquation,
  //HarmonicPinballEquation, //needs to be easier to use
  //HarmonicLifeEquation, // not clear how this resembles game of life
  VowelMorphEquation
];
