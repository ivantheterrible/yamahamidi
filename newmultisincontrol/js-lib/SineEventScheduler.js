/**
 * SineEventScheduler - Pre-allocated buffer management for bulk sine events.
 * 
 * Eliminates per-frame allocations by maintaining reusable Float32Array buffers.
 * Events are accumulated in bulk format: [sine_id, count, override_flag, sample, value, ...]
 * 
 * Usage:
 *   scheduler.beginFrame();
 *   for (each sine) {
 *     scheduler.beginSine(sineId);           // normal mode
 *     scheduler.beginSine(sineId, true);     // override mode (clears pending events)
 *     scheduler.addAmplitudeEvent(sample, value);
 *     scheduler.addFrequencyEvent(sample, freq);
 *     scheduler.endSine();
 *   }
 *   add_amplitude_events(scheduler.getAmplitudeBuffer());
 *   add_frequency_events(scheduler.getFrequencyBuffer());
 */
export class SineEventScheduler {
  /**
   * @param {number} maxSines - Maximum number of sines to handle per frame
   * @param {number} maxEventsPerSine - Maximum events per sine per frame (default 8)
   */
  constructor(maxSines, maxEventsPerSine = 8) {
    // Buffer size: per sine = 3 (header: id + count + override_flag) + maxEvents * 2 (sample + value pairs)
    const bufferSize = maxSines * (3 + maxEventsPerSine * 2);
    
    this.ampBuffer = new Float32Array(bufferSize);
    this.freqBuffer = new Float32Array(bufferSize);
    
    // Current write positions
    this.ampOffset = 0;
    this.freqOffset = 0;
    
    // State for current sine being built
    this.currentSineId = null;
    this.ampCountIdx = 0;      // Index where amp event count is stored
    this.freqCountIdx = 0;     // Index where freq event count is stored
    this.currentAmpCount = 0;  // Number of amp events for current sine
    this.currentFreqCount = 0; // Number of freq events for current sine
    
    this.maxEventsPerSine = maxEventsPerSine;
  }
  
  /**
   * Begin a new frame. Resets all buffer offsets.
   * Call at the start of each process() callback.
   */
  beginFrame() {
    this.ampOffset = 0;
    this.freqOffset = 0;
    this.currentSineId = null;
  }
  
  /**
   * Begin adding events for a specific sine.
   * Writes the header (sine_id, placeholder for count, override_flag).
   * 
   * @param {number} sineId - The sine ID
   * @param {boolean} override - If true, clears pending events at or after first new event's sample
   */
  beginSine(sineId, override = false) {
    this.currentSineId = sineId;
    
    // Write amplitude header: [sine_id, count_placeholder, override_flag]
    this.ampBuffer[this.ampOffset++] = sineId;
    this.ampCountIdx = this.ampOffset++;  // Store index for count, will fill in later
    this.ampBuffer[this.ampOffset++] = override ? 1.0 : 0.0;
    this.currentAmpCount = 0;
    
    // Write frequency header: [sine_id, count_placeholder, override_flag]
    this.freqBuffer[this.freqOffset++] = sineId;
    this.freqCountIdx = this.freqOffset++; // Store index for count, will fill in later
    this.freqBuffer[this.freqOffset++] = override ? 1.0 : 0.0;
    this.currentFreqCount = 0;
  }
  
  /**
   * Add an amplitude event for the current sine.
   * 
   * @param {number} sample - Sample index for this event
   * @param {number} value - Amplitude value
   * @returns {boolean} True if event was added, false if buffer full
   */
  addAmplitudeEvent(sample, value) {
    if (this.currentAmpCount >= this.maxEventsPerSine) {
      return false;
    }
    this.ampBuffer[this.ampOffset++] = sample;
    this.ampBuffer[this.ampOffset++] = value;
    this.currentAmpCount++;
    return true;
  }
  
  /**
   * Add a frequency event for the current sine.
   * 
   * @param {number} sample - Sample index for this event
   * @param {number} freqHz - Frequency in Hz
   * @returns {boolean} True if event was added, false if buffer full
   */
  addFrequencyEvent(sample, freqHz) {
    if (this.currentFreqCount >= this.maxEventsPerSine) {
      return false;
    }
    this.freqBuffer[this.freqOffset++] = sample;
    this.freqBuffer[this.freqOffset++] = freqHz;
    this.currentFreqCount++;
    return true;
  }
  
  /**
   * Finish adding events for the current sine.
   * Writes the event counts back to the header positions.
   */
  endSine() {
    // Write the actual counts back to header positions
    this.ampBuffer[this.ampCountIdx] = this.currentAmpCount;
    this.freqBuffer[this.freqCountIdx] = this.currentFreqCount;
    this.currentSineId = null;
  }
  
  /**
   * Get the amplitude buffer slice containing all accumulated events.
   * Pass this directly to add_amplitude_events().
   * 
   * @returns {Float32Array} Subarray view (no allocation)
   */
  getAmplitudeBuffer() {
    return this.ampBuffer.subarray(0, this.ampOffset);
  }
  
  /**
   * Get the frequency buffer slice containing all accumulated events.
   * Pass this directly to add_frequency_events().
   * 
   * @returns {Float32Array} Subarray view (no allocation)
   */
  getFrequencyBuffer() {
    return this.freqBuffer.subarray(0, this.freqOffset);
  }
  
  /**
   * Check if amplitude buffer has any events.
   * @returns {boolean}
   */
  hasAmplitudeEvents() {
    return this.ampOffset > 0;
  }
  
  /**
   * Check if frequency buffer has any events.
   * @returns {boolean}
   */
  hasFrequencyEvents() {
    return this.freqOffset > 0;
  }
}
