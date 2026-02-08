/**
 * PhaseAccumulator - Tracks LFO phase with proper accumulation.
 * 
 * Provides continuous phase tracking that handles rate changes smoothly
 * and supports calculating future sin values at sample offsets.
 */
export class PhaseAccumulator {
  /**
   * @param {number} rate - Oscillation rate in Hz (default 1.0)
   */
  constructor(rate = 1.0) {
    this.phase = 0.0;      // Current phase (0-1 range)
    this.rate = rate;      // Rate in Hz
    this.lastSample = 0;   // Last sample position where phase was computed
  }
  
  /**
   * Update the oscillation rate.
   * @param {number} rate - New rate in Hz
   */
  setRate(rate) {
    this.rate = rate;
  }
  
  /**
   * Advance phase to current sample position.
   * Call once per process() block with the current sample position.
   * 
   * @param {number} currentSample - Current sample position
   * @param {number} sampleRate - Sample rate in Hz (e.g., 48000)
   * @returns {number} Current phase (0-1)
   */
  advance(currentSample, sampleRate) {
    const delta = currentSample - this.lastSample;
    if (delta > 0) {
      this.phase = (this.phase + (delta / sampleRate) * this.rate) % 1.0;
    }
    this.lastSample = currentSample;
    return this.phase;
  }
  
  /**
   * Get the sin value at a future sample offset from current position.
   * Does not modify internal state - useful for generating events ahead of time.
   * 
   * @param {number} sampleOffset - Samples ahead of current position
   * @param {number} sampleRate - Sample rate in Hz
   * @param {number} phaseOffset - Additional phase offset (0-1, default 0)
   * @returns {number} Sin value (-1 to 1)
   */
  sinAt(sampleOffset, sampleRate, phaseOffset = 0) {
    const futurePhase = (this.phase + (sampleOffset / sampleRate) * this.rate + phaseOffset) % 1.0;
    return Math.sin(2 * Math.PI * futurePhase);
  }
  
  /**
   * Get the current phase value.
   * @returns {number} Phase (0-1)
   */
  getPhase() {
    return this.phase;
  }
  
  /**
   * Reset phase to a specific value.
   * @param {number} phase - New phase value (0-1)
   */
  resetPhase(phase = 0.0) {
    this.phase = phase % 1.0;
  }
}
