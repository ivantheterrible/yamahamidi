/**
 * EventTimestampTracker - Tracks event generation timestamps per sine.
 * 
 * Handles the common pattern of generating events at regular intervals,
 * remembering where we left off, and continuing from there on next call.
 */
export class EventTimestampTracker {
  /**
   * @param {number} eventInterval - Samples between events (default 128)
   */
  constructor(eventInterval = 128) {
    this.lastSample = null;
    this.interval = eventInterval;
  }
  
  /**
   * Set the event interval.
   * @param {number} interval - Samples between events
   */
  setInterval(interval) {
    this.interval = interval;
  }
  
  /**
   * Get the event interval.
   * @returns {number}
   */
  getInterval() {
    return this.interval;
  }
  
  /**
   * Generate sample timestamps from last event to target.
   * Updates internal state to track the last generated sample.
   * 
   * @param {number} blockStart - Start of current block (used if no previous events)
   * @param {number} targetSample - Generate events up to and including this sample
   * @yields {number} Sample timestamps
   */
  *generateSamples(blockStart, targetSample) {
    let sample = (this.lastSample === null)
      ? blockStart
      : this.lastSample + this.interval;
    
    let lastGenerated = this.lastSample;
    
    while (sample <= targetSample) {
      yield sample;
      lastGenerated = sample;
      sample += this.interval;
    }
    
    // Update lastSample if we generated any events
    if (lastGenerated !== this.lastSample) {
      this.lastSample = lastGenerated;
    }
  }
  
  /**
   * Get sample timestamps as an array instead of generator.
   * Useful when you need to know the count upfront.
   * 
   * @param {number} blockStart - Start of current block
   * @param {number} targetSample - Generate events up to this sample
   * @returns {number[]} Array of sample timestamps
   */
  getSamples(blockStart, targetSample) {
    return [...this.generateSamples(blockStart, targetSample)];
  }
  
  /**
   * Calculate how many events would be generated without actually generating them.
   * Does not modify internal state.
   * 
   * @param {number} blockStart - Start of current block
   * @param {number} targetSample - Target sample
   * @returns {number} Number of events that would be generated
   */
  countEvents(blockStart, targetSample) {
    const startSample = (this.lastSample === null)
      ? blockStart
      : this.lastSample + this.interval;
    
    if (startSample > targetSample) {
      return 0;
    }
    
    return Math.floor((targetSample - startSample) / this.interval) + 1;
  }
  
  /**
   * Reset the tracker (e.g., when a sine is removed and re-added).
   */
  reset() {
    this.lastSample = null;
  }
  
  /**
   * Get the last generated sample timestamp.
   * @returns {number|null}
   */
  getLastSample() {
    return this.lastSample;
  }
}
