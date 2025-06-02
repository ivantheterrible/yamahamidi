// ToneProcessor.js

import './textencoder.js';
import initWasm, {
  initSync,
  init as wasmInit,
  start_voice,
  change_freq,
  stop_voice,
  render
} from './project.js';

class ToneProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ready = false;
    this.commandQueue = [];

    try {
      const { wasmModule } = options.processorOptions;
      initSync({ module: wasmModule });
      wasmInit(sampleRate);
      this.ready = true;
      console.log('[Worklet] WASM initialized');
    } catch (err) {
      console.error('[Worklet] WASM init failed:', err);
    }

    this.port.onmessage = (event) => {
      this.commandQueue.push(event.data);
    };
  }

  process(inputs, outputs) {
    const output = outputs[0][0]; // mono

    if (!this.ready) return true;

    while (this.commandQueue.length) {
      const msg = this.commandQueue.shift();
      switch (msg.command) {
        case 'start':
          {
            const freq = msg.freq;
            const id = start_voice(freq);
            // Tell main thread that a voice was started
            this.port.postMessage({ event: 'started', id });
          }
          break;

        case 'stop':
          {
            const id = msg.id;
            stop_voice(id);
            // Main thread will poll voice_status to see when it's truly gone
          }
          break;
      }
    }

    // Mix all active voices into output
    render(output);
    return true;
  }
}

registerProcessor('tone-processor', ToneProcessor);
