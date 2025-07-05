// Base class for modulation equations
export class ModulationEquation {
  constructor() {
    if (this.constructor === ModulationEquation) {
      throw new Error("Abstract class can't be instantiated.");
    }
  }
  // Should return an array of {name, defaultValue, label}
  static get params() {
    return [];
  }
  // Should return a human-readable label
  static get label() {
    return "Unnamed";
  }
  // Should return a unique, space-free id
  static get id() {
    return this.label.replace(/\s+/g, '_');
  }
  // Should return a short description for UI
  static get description() {
    return "No description provided.";
  }
  // The actual equation: override in subclass
  // state: Array of 32 per-harmonic state objects, params: parameter values (including LFO-modulated)
  evaluate(state, ...params) {
    throw new Error("evaluate() must be implemented by subclass");
  }
  // Helper to get all param names (including LFOs)
  static getAllParamNames() {
    const names = this.params.map(p => p.name);
    this.params.forEach(p => {
      if (p.showLfo) {
        names.push(`${p.name}_lfoFreq`, `${p.name}_lfoDepth`);
      }
    });
    return names;
  }
}
