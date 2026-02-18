// Simple Additive Synth - Main Thread
// Initializes AudioContext, loads worklet, and wires UI controls

let audioContext = null;
let workletNode = null;
let gainNode = null;
let isRunning = false;

// === MIDI State ===
let midiAccess = null;
let midiNoteStack = [];
let midiConnected = false;
let selectedMidiInputId = 'all'; // 'all' or specific device ID
let selectedMidiChannel = 'all'; // 'all' or 0-15
const BASE_NOTE = 69; // A4 = 440Hz reference

const toggleBtn = document.getElementById('toggleBtn');
const controlsDiv = document.getElementById('controls');
const statusEl = document.getElementById('status');
const masterVolumeSlider = document.getElementById('masterVolume');
const masterVolumeValue = document.getElementById('masterVolumeValue');

// === MIDI Functions ===

function noteToName(note) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(note / 12) - 1;
  return names[note % 12] + octave;
}

function noteToPitchRatio(note) {
  // Ratio relative to A4 (69), so A4 gives ratio 1.0 when baseFreq=440
  return Math.pow(2, (note - BASE_NOTE) / 12);
}

function handleMidiMessage(event) {
  const [status, note, velocity] = event.data;
  const command = status & 0xf0;
  const channel = status & 0x0f;
  
  // Filter by selected channel (unless "all" is selected)
  if (selectedMidiChannel !== 'all' && channel !== parseInt(selectedMidiChannel)) {
    return;
  }
  
  if (command === 0x90 && velocity > 0) {
    // Note on - add to stack
    midiNoteStack.push(note);
    updateFromMidi();
  } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
    // Note off - remove from stack
    midiNoteStack = midiNoteStack.filter(n => n !== note);
    updateFromMidi();
  }
}

function updateFromMidi() {
  const midiNoteEl = document.getElementById('midiNote');
  
  if (midiNoteStack.length > 0) {
    const note = midiNoteStack[midiNoteStack.length - 1];
    const ratio = noteToPitchRatio(note);
    
    // Update display
    if (midiNoteEl) midiNoteEl.textContent = noteToName(note);
    
    // Send to worklet
    if (workletNode) {
      workletNode.port.postMessage({ type: 'set-keyboard-pitch-ratio', value: ratio });
      workletNode.port.postMessage({ type: 'set-keyboard-gate', value: true });
    }
  } else {
    // No notes held - close gate
    if (midiNoteEl) midiNoteEl.textContent = '--';
    if (workletNode) {
      workletNode.port.postMessage({ type: 'set-keyboard-gate', value: false });
    }
  }
}

async function initMidi() {
  const midiAccessStatusEl = document.getElementById('midiAccessStatus');
  const deviceSelect = document.getElementById('midiDeviceSelect');
  const channelSelect = document.getElementById('midiChannelSelect');
  
  if (!navigator.requestMIDIAccess) {
    if (midiAccessStatusEl) {
      midiAccessStatusEl.textContent = 'Not supported by browser';
      midiAccessStatusEl.className = 'value error';
    }
    console.warn('Web MIDI API not supported');
    return;
  }
  
  // Show checking status while we request access
  if (midiAccessStatusEl) {
    midiAccessStatusEl.textContent = 'Requesting access...';
    midiAccessStatusEl.className = 'value';
  }
  
  try {
    midiAccess = await navigator.requestMIDIAccess();
    
    if (midiAccessStatusEl) {
      midiAccessStatusEl.textContent = 'Access granted';
      midiAccessStatusEl.className = 'value success';
    }
    
    // Enable the selects now that we have MIDI access
    if (deviceSelect) deviceSelect.disabled = false;
    if (channelSelect) channelSelect.disabled = false;
    
    // Populate device dropdown and attach handlers
    populateMidiDevices();
    attachMidiHandlers();
    
    // Set up channel select handler
    if (channelSelect) {
      channelSelect.addEventListener('change', () => {
        selectedMidiChannel = channelSelect.value;
        console.log(`MIDI channel set to: ${selectedMidiChannel === 'all' ? 'All' : parseInt(selectedMidiChannel) + 1}`);
      });
    }
    
    // Set up device select handler
    if (deviceSelect) {
      deviceSelect.addEventListener('change', () => {
        selectedMidiInputId = deviceSelect.value;
        console.log(`MIDI device set to: ${selectedMidiInputId === 'all' ? 'All devices' : selectedMidiInputId}`);
        attachMidiHandlers();
      });
    }
    
    // Listen for device hot-plug events
    midiAccess.onstatechange = (e) => {
      console.log(`MIDI state change: ${e.port.name} ${e.port.state}`);
      populateMidiDevices();
      attachMidiHandlers();
    };
    
  } catch (err) {
    console.error('MIDI access failed:', err);
    if (midiAccessStatusEl) {
      midiAccessStatusEl.textContent = 'Access denied - check browser permissions';
      midiAccessStatusEl.className = 'value error';
    }
  }
}

function populateMidiDevices() {
  const deviceSelect = document.getElementById('midiDeviceSelect');
  if (!deviceSelect || !midiAccess) return;
  
  const currentValue = deviceSelect.value;
  
  // Clear existing options except "All devices"
  deviceSelect.innerHTML = '<option value="all">All devices</option>';
  
  const inputs = Array.from(midiAccess.inputs.values());
  inputs.forEach(input => {
    const option = document.createElement('option');
    option.value = input.id;
    option.textContent = input.name || `Device ${input.id}`;
    deviceSelect.appendChild(option);
  });
  
  // Restore selection if device still exists, otherwise default to 'all'
  if (currentValue !== 'all' && inputs.some(i => i.id === currentValue)) {
    deviceSelect.value = currentValue;
    selectedMidiInputId = currentValue;
  } else if (currentValue !== 'all') {
    deviceSelect.value = 'all';
    selectedMidiInputId = 'all';
  }
  
  // Update connected state
  midiConnected = inputs.length > 0;
  
  // Enable keyboard modulators if we have devices
  if (midiConnected && workletNode) {
    workletNode.port.postMessage({ type: 'set-keyboard-pitch-enabled', value: true });
    workletNode.port.postMessage({ type: 'set-keyboard-gate-enabled', value: true });
  }
}

function attachMidiHandlers() {
  if (!midiAccess) return;
  
  const inputs = Array.from(midiAccess.inputs.values());
  
  // Detach all handlers first
  inputs.forEach(input => {
    input.onmidimessage = null;
  });
  
  // Attach handlers based on selection
  if (selectedMidiInputId === 'all') {
    inputs.forEach(input => {
      input.onmidimessage = handleMidiMessage;
    });
  } else {
    const selectedInput = inputs.find(i => i.id === selectedMidiInputId);
    if (selectedInput) {
      selectedInput.onmidimessage = handleMidiMessage;
    }
  }
}

// === Binding Helpers ===

function bindSlider(sliderId, displayId, messageType, formatter = (v) => v.toFixed(2)) {
  const slider = document.getElementById(sliderId);
  const display = document.getElementById(displayId);
  slider.addEventListener('input', () => {
    const value = parseFloat(slider.value);
    display.textContent = formatter(value);
    if (workletNode) {
      workletNode.port.postMessage({ type: messageType, value });
    }
  });
  // Initialize display
  display.textContent = formatter(parseFloat(slider.value));
}

function bindToggle(toggleId, controlsId, messageType, initialState = false) {
  const toggle = document.getElementById(toggleId);
  const controls = document.getElementById(controlsId);
  let enabled = initialState;
  
  // Set initial visual state
  toggle.textContent = enabled ? 'ON' : 'OFF';
  toggle.classList.toggle('off', !enabled);
  controls.classList.toggle('disabled', !enabled);
  
  toggle.addEventListener('click', () => {
    enabled = !enabled;
    toggle.textContent = enabled ? 'ON' : 'OFF';
    toggle.classList.toggle('off', !enabled);
    controls.classList.toggle('disabled', !enabled);
    if (workletNode) {
      workletNode.port.postMessage({ type: messageType, value: enabled });
    }
  });
  
  return () => enabled;
}

// === Visualization ===

const NUM_PARTIALS = 32;

// Bar visualization data structure
const visualizations = {
  lfo: { container: 'barsLfo', bars: [] },
  random: { container: 'barsRandom', bars: [] },
  lowpass: { container: 'barsLowpass', bars: [] },
  highpass: { container: 'barsHighpass', bars: [] },
  comb: { container: 'barsComb', bars: [] },
  pwm: { container: 'barsPwm', bars: [] },
  wavefolder: { container: 'barsWavefolder', bars: [] },
  barberPole: { container: 'barsBarberPole', bars: [] },
  falling: { container: 'barsFalling', bars: [] },
  vowel: { container: 'barsVowel', bars: [] },
  keyboardGate: { container: 'barsKeyboard', bars: [] },
  combined: { container: 'barsCombined', bars: [] }
};

function createBars(containerId, barsArray) {
  const container = document.getElementById(containerId);
  for (let i = 0; i < NUM_PARTIALS; i++) {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = '0%';
    bar.style.top = '50%';
    bar.style.left = `${(i / NUM_PARTIALS) * 100}%`;
    bar.style.width = `${(1 / NUM_PARTIALS) * 100 - 0.5}%`;
    container.appendChild(bar);
    barsArray.push(bar);
  }
}

// Create all visualization bars
for (const viz of Object.values(visualizations)) {
  createBars(viz.container, viz.bars);
}

function updateStatus(text) {
  statusEl.textContent = text;
}

function updateBars(barsArray, amplitudes) {
  for (let i = 0; i < NUM_PARTIALS && i < amplitudes.length; i++) {
    const amp = amplitudes[i];
    const absAmp = Math.abs(amp);
    const heightPercent = Math.min(absAmp, 1) * 50;
    
    if (amp >= 0) {
      barsArray[i].style.top = `${50 - heightPercent}%`;
      barsArray[i].style.height = `${heightPercent}%`;
      barsArray[i].classList.remove('negative');
    } else {
      barsArray[i].style.top = '50%';
      barsArray[i].style.height = `${heightPercent}%`;
      barsArray[i].classList.add('negative');
    }
  }
}

function resetBars(barsArray) {
  barsArray.forEach(bar => {
    bar.style.height = '0%';
    bar.style.top = '50%';
    bar.classList.remove('negative');
  });
}

function resetAllVisualizations() {
  for (const viz of Object.values(visualizations)) {
    resetBars(viz.bars);
  }
}

// === Audio Control ===

async function startAudio() {
  toggleBtn.disabled = true;
  updateStatus('Initializing...');
  
  try {
    audioContext = new AudioContext({ latencyHint: 'interactive' });
    updateStatus(`AudioContext created (${audioContext.sampleRate} Hz, interactive latency)`);
    
    const wasmResponse = await fetch('../wasm/pkg/sin_wave_renderer_wasm_bg.wasm');
    const wasmBytes = await wasmResponse.arrayBuffer();
    updateStatus('WASM loaded');
    
    await audioContext.audioWorklet.addModule('processor.js');
    updateStatus('Worklet registered');
    
    gainNode = audioContext.createGain();
    gainNode.gain.value = parseFloat(masterVolumeSlider.value);
    gainNode.connect(audioContext.destination);
    
    workletNode = new AudioWorkletNode(audioContext, 'additive-synth-processor', {
      processorOptions: { wasmBytes }
    });
    workletNode.connect(gainNode);
    
    workletNode.port.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'ready') {
        updateStatus(`WASM ready (${msg.sampleRate} Hz), starting synth...`);
        workletNode.port.postMessage({ type: 'start' });
      } else if (msg.type === 'started') {
        isRunning = true;
        updateStatus(`Running: ${msg.partials} partials`);
        controlsDiv.classList.add('enabled');
        toggleBtn.textContent = 'Stop Audio';
        toggleBtn.classList.add('running');
        toggleBtn.disabled = false;
        // Initialize MIDI after synth is running
        initMidi();
      } else if (msg.type === 'error') {
        updateStatus(`Error: ${msg.message}`);
        console.error('Worklet error:', msg.message);
        toggleBtn.disabled = false;
      } else if (msg.type === 'modulator-values') {
        updateBars(visualizations.lfo.bars, msg.lfo);
        updateBars(visualizations.random.bars, msg.random);
        updateBars(visualizations.lowpass.bars, msg.lowpass);
        updateBars(visualizations.highpass.bars, msg.highpass);
        updateBars(visualizations.comb.bars, msg.comb);
        updateBars(visualizations.pwm.bars, msg.pwm);
        updateBars(visualizations.wavefolder.bars, msg.wavefolder);
        updateBars(visualizations.barberPole.bars, msg.barberPole);
        updateBars(visualizations.falling.bars, msg.falling);
        updateBars(visualizations.vowel.bars, msg.vowel);
        updateBars(visualizations.keyboardGate.bars, msg.keyboardGate);
        updateBars(visualizations.combined.bars, msg.combined);
      }
    };
    
  } catch (e) {
    console.error('Failed to start audio:', e);
    updateStatus(`Error: ${e.message}`);
    toggleBtn.disabled = false;
  }
}

function stopAudio() {
  if (audioContext) {
    audioContext.close();
    audioContext = null;
    workletNode = null;
    gainNode = null;
  }
  isRunning = false;
  toggleBtn.textContent = 'Start Audio';
  toggleBtn.classList.remove('running');
  controlsDiv.classList.remove('enabled');
  updateStatus('Stopped');
  resetAllVisualizations();
}

toggleBtn.addEventListener('click', () => {
  if (isRunning) {
    stopAudio();
  } else {
    startAudio();
  }
});

// === Master Volume (special case - controls gainNode directly) ===

masterVolumeSlider.addEventListener('input', () => {
  const value = parseFloat(masterVolumeSlider.value);
  masterVolumeValue.textContent = `${Math.round(value * 100)}%`;
  if (gainNode) {
    gainNode.gain.value = value;
  }
});
masterVolumeValue.textContent = `${Math.round(parseFloat(masterVolumeSlider.value) * 100)}%`;

// === Bind All Controls ===

// Global
bindSlider('baseFreq', 'baseFreqValue', 'set-base-freq', v => `${v} Hz`);

// LFO Modulator
bindToggle('lfoToggle', 'lfoControls', 'set-lfo-enabled', true);
bindSlider('lfoRate', 'lfoRateValue', 'set-lfo-rate', v => `${v.toFixed(1)} Hz`);
bindSlider('lfoAmount', 'lfoAmountValue', 'set-lfo-amount', v => v.toFixed(2));
bindSlider('lfoOffset', 'lfoOffsetValue', 'set-lfo-offset', v => v.toFixed(2));

// Random Step Modulator
bindToggle('randomToggle', 'randomControls', 'set-random-enabled', true);
bindSlider('randomRate', 'randomRateValue', 'set-random-change-rate', v => `${v.toFixed(1)} /s`);

// Lowpass Filter
bindToggle('lowpassToggle', 'lowpassControls', 'set-lowpass-enabled', false);
bindSlider('lowpassCutoff', 'lowpassCutoffValue', 'set-lowpass-cutoff', v => v.toFixed(1));
bindSlider('lowpassSlope', 'lowpassSlopeValue', 'set-lowpass-slope', v => v.toFixed(1));
bindSlider('lowpassResonance', 'lowpassResonanceValue', 'set-lowpass-resonance', v => v.toFixed(2));

// Highpass Filter
bindToggle('highpassToggle', 'highpassControls', 'set-highpass-enabled', false);
bindSlider('highpassCutoff', 'highpassCutoffValue', 'set-highpass-cutoff', v => v.toFixed(1));
bindSlider('highpassSlope', 'highpassSlopeValue', 'set-highpass-slope', v => v.toFixed(1));
bindSlider('highpassResonance', 'highpassResonanceValue', 'set-highpass-resonance', v => v.toFixed(2));

// Harmonic Comb
bindToggle('combToggle', 'combControls', 'set-comb-enabled', false);
bindSlider('combSpacing', 'combSpacingValue', 'set-comb-spacing', v => v.toFixed(1));
bindSlider('combPhase', 'combPhaseValue', 'set-comb-phase', v => v.toFixed(2));

// PWM
bindToggle('pwmToggle', 'pwmControls', 'set-pwm-enabled', false);
bindSlider('pwmDuty', 'pwmDutyValue', 'set-pwm-duty', v => v.toFixed(2));

// Wavefolder
bindToggle('wavefolderToggle', 'wavefolderControls', 'set-wavefolder-enabled', false);
bindSlider('wavefolderFold', 'wavefolderFoldValue', 'set-wavefolder-fold', v => v.toFixed(1));
bindSlider('wavefolderAsymmetry', 'wavefolderAsymmetryValue', 'set-wavefolder-asymmetry', v => v.toFixed(2));

// Barber Pole
bindToggle('barberPoleToggle', 'barberPoleControls', 'set-barberpole-enabled', false);
bindSlider('barberPoleDensity', 'barberPoleDensityValue', 'set-barberpole-density', v => v.toFixed(1));
bindSlider('barberPoleSpeed', 'barberPoleSpeedValue', 'set-barberpole-speed', v => v.toFixed(1));
bindSlider('barberPoleQ', 'barberPoleQValue', 'set-barberpole-q', v => v.toFixed(1));

// Falling Harmonics
bindToggle('fallingToggle', 'fallingControls', 'set-falling-enabled', false);
bindSlider('fallingProbability', 'fallingProbabilityValue', 'set-falling-probability', v => v.toFixed(2));

// Vowel Morph
bindToggle('vowelToggle', 'vowelControls', 'set-vowel-enabled', false);
bindSlider('vowelMorph', 'vowelMorphValue', 'set-vowel-morph', v => v.toFixed(2));
bindSlider('vowelQ', 'vowelQValue', 'set-vowel-q', v => v.toFixed(1));
