// --- Constants ---
const NUM_HARMONICS = 32;

class ParameterRealtimeState {
  constructor({ phase = 0, freq = 0.25, depth = 0 } = {}) {
    this.phase = phase;
    this.freq = freq;
    this.depth = depth;
  }
}

class EquationRealtimeState {
  constructor(eqId) {
    this.eqId = eqId;
    this.harmonicState = new Float32Array(NUM_HARMONICS);
    this.parameterStates = {}; // paramName -> ParameterRealtimeState
    this.makeupGain = 1;
  }
}


const DEBUG_MESSAGES = false;

class CyclicModulationProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // --- Object state declarations ---
    this.equationStates = {}; // eqId -> EquationRealtimeState
    this.equationFuncs = [];
    this.paramNamesArr = [];
    this.userParams = {};
    this.equationLabels = [];
    this.timesProcessCalledThisCycle = [];
    this.equationIds = [];
    this.overallVolume = 1;
    this.globalParams = {}; // For global parameters like base frequency
    // --- End object state declarations ---
    if (DEBUG_MESSAGES) this.port.postMessage({ type: 'debug', message: 'CyclicModulationProcessor constructed' });

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data.type === 'setEquation') {
        if (DEBUG_MESSAGES) this.port.postMessage({ type: 'debug', message: '[Processor] setEquation received', data });
        const eqs = Array.isArray(data.equation) ? data.equation : [data.equation];
        const paramsArr = Array.isArray(data.paramsArr) ? data.paramsArr : [data.params];

        this.equationFuncs = [];
        this.paramNamesArr = [];
        this.equationStates = {};
        this.equationLabels = paramsArr.map((p, i) => p && p._label ? p._label : `Equation${i+1}`);
        this.timesProcessCalledThisCycle = new Array(eqs.length).fill(0);
        this.equationIds = paramsArr.map((p, i) => p && p._id ? p._id : `eq${i}`);

        eqs.forEach((eq, i) => {
          const params = paramsArr[i] || {};
          const paramNames = Object.keys(params).filter(name => !name.endsWith('_lfoFreq') && !name.endsWith('_lfoDepth'));
          const funcArgs = ['state', ...paramNames];
          this.paramNamesArr[i] = paramNames;
          this.equationFuncs[i] = new Function(...funcArgs, eq);

          // --- Per-equation state ---
          const eqId = this.equationIds[i];
          const eqState = new EquationRealtimeState(eqId);

          // Initialize per-parameter LFO state
          for (const name of paramNames) {
            eqState.parameterStates[name] = new ParameterRealtimeState({
              phase: 0,
              freq: params[name + '_lfoFreq'] || 0.25,
              depth: params[name + '_lfoDepth'] || 0
            });
          }
          // Set makeup gain if present
          if (typeof params._makeupGain !== "undefined") {
            eqState.makeupGain = params._makeupGain;
          }
          this.equationStates[eqId] = eqState;
        });

        // Merge all params for UI
        this.userParams = Object.assign({}, ...(paramsArr || []));
      }

      if (data.type === 'setParam') {
        if (DEBUG_MESSAGES) this.port.postMessage({ type: 'debug', message: '[Processor] setParam received', data });
        this.userParams[data.param] = data.value;
        // Update the relevant equationStates as well (if needed)
      }

      if (data.type === 'setLfoParam') {
        if (DEBUG_MESSAGES) this.port.postMessage({ type: 'debug', message: '[Processor] setLfoParam received', data });
        // data.eqId, data.param, data.lfoType ('rate'|'depth'), data.value
        const eqId = data.eqId;
        const param = data.param;
        if (this.equationStates[eqId]?.parameterStates[param]) {
          if (data.lfoType === 'rate') this.equationStates[eqId].parameterStates[param].freq = data.value;
          if (data.lfoType === 'depth') this.equationStates[eqId].parameterStates[param].depth = data.value;
        }
      }

      if (data.type === 'setMakeupGain') {
        if (DEBUG_MESSAGES) this.port.postMessage({ type: 'debug', message: '[Processor] setMakeupGain received', data });
        if (this.equationStates[data.eqId]) {
          this.equationStates[data.eqId].makeupGain = data.value;
        }
      }

      if (data.type === 'setOverallVolume') {
        if (DEBUG_MESSAGES) this.port.postMessage({ type: 'debug', message: '[Processor] setOverallVolume received', data });
        this.overallVolume = data.value;
      }

      // Handle global parameter updates
      if (data.type === 'setGlobalParam') {
        this.globalParams[data.param] = data.value;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const blockSize = outputs[0][0].length;

    // Advance LFO phases and compute LFO values for enabled params (per equation)
    const lfoValues = {};
    for (const eqId of this.equationIds) {
      const eqState = this.equationStates[eqId];
      if (!eqState) continue;
      lfoValues[eqId] = {};
      for (const param in eqState.parameterStates) {
        const lfo = eqState.parameterStates[param];
        lfo.phase += 2 * Math.PI * (lfo.freq || 0) * blockSize / sampleRate;
        if (lfo.phase >= 2 * Math.PI) lfo.phase -= 2 * Math.PI;
        lfoValues[eqId][param] = (lfo.depth || 0) * Math.sin(lfo.phase);
      }
    }

    // --- Send LFO values to UI at a throttled rate (e.g., every 20 blocks) ---
    this._lfoDebugCounter = (this._lfoDebugCounter || 0) + 1;
    if (this._lfoDebugCounter % 20 === 0) {
      this.port.postMessage({
        type: 'lfoValues',
        lfoValues
      });
    }

    // --- Send harmonicState arrays to UI at a throttled rate (e.g., every 20 blocks) ---
    this._harmonicDebugCounter = (this._harmonicDebugCounter || 0) + 1;
    if (this._harmonicDebugCounter % 20 === 0) {
      const harmonicStates = {};
      for (const eqId of this.equationIds) {
        const eqState = this.equationStates[eqId];
        if (eqState) {
          // Apply makeup gain to each harmonic for the UI
          const gain = eqState.makeupGain ?? 1;
          harmonicStates[eqId] = Array.from(eqState.harmonicState, v => v * gain);
        }
      }
      this.port.postMessage({
        type: 'harmonicStates',
        harmonicStates
      });
    }

    if (this.equationFuncs.length) {
      for (let i = 0; i < this.equationFuncs.length; i++) {
        const paramNames = this.paramNamesArr[i] || [];
        const eqId = this.equationIds[i] || `eq${i}`;
        const eqState = this.equationStates[eqId];
        // Gather param values (with LFO if present)
        const paramValues = paramNames.map(name => {
          if (name.startsWith('global_')) {
            return this.globalParams[name];
          }
          let val = this.userParams[name];
          if (eqState.parameterStates[name]) {
            val += lfoValues[eqId][name] || 0;
          }
          return val;
        });
        // Call equation with (stateArray, ...params)
        this.equationFuncs[i](eqState.harmonicState, ...paramValues);
      }
      // Now combine all equations' state[n] for each harmonic
      for (let ch = 0; ch < outputs.length; ch++) {
        let value = 1;
        for (let i = 0; i < this.equationFuncs.length; i++) {
          const eqId = this.equationIds[i] || `eq${i}`;
          const eqState = this.equationStates[eqId];
          const eqVal = (eqState && typeof eqState.harmonicState[ch] === 'number') ? eqState.harmonicState[ch] : 1;
          value *= eqVal * (eqState?.makeupGain ?? 1);
        }
        outputs[ch][0].fill(value * (this.overallVolume ?? 1));
      }
    } else {
      for (let ch = 0; ch < outputs.length; ch++) {
        outputs[ch][0].fill(1);
      }
    }
    return true;
  }
}

registerProcessor('cyclic-modulation-processor', CyclicModulationProcessor);
