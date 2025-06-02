// ToneProcessor.js

// 1) Polyfill TextDecoder/TextEncoder in the AudioWorkletGlobalScope
import './textencoder.js';

// 2) Import the wasm loader and your exports
import initWasm, {
  initSync,
  init as wasmInit,
  start_voice,
  stop_voice,
  render
} from './project.js';

class ToneProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);

    this.ready = false;
    this.commandQueue = [];
    this.voiceId = null;

    try {
      // 3) Synchronously initialize Wasm with the module passed from main
      const { wasmModule } = options.processorOptions;
      initSync({ module: wasmModule });
      wasmInit(sampleRate, 1024);
      this.ready = true;
      console.log('WASM sync-initialized in Worklet');
    } catch (err) {
      console.error('WASM sync init failed:', err);
    }

    // 4) Queue up start/stop commands from the main thread
    this.port.onmessage = event => {
      this.commandQueue.push(event.data);
    };
  }

  process(inputs, outputs) {
    const output = outputs[0][0]; // mono

    if (!this.ready) return true;

    // 5) Handle queued start/stop commands
    for (const msg of this.commandQueue) {
      if (msg.command === 'start' && this.voiceId === null) {
        this.voiceId = msg.id ?? 0;
        start_voice(this.voiceId, msg.freq ?? 440);
      } else if (msg.command === 'stop' && this.voiceId !== null) {
        stop_voice(this.voiceId);
        this.voiceId = null;
      }
    }
    this.commandQueue.length = 0;

    // 6) Fill the buffer with your generated tone
    render(output);

    return true;
  }
}

registerProcessor('tone-processor', ToneProcessor);
