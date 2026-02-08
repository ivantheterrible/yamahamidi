// Minimal TextEncoder/TextDecoder polyfill for AudioWorkletGlobalScope environments
const g = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : {});
if (typeof g.TextEncoder === 'undefined') {
  g.TextEncoder = class {
    encode(str) {
      const arr = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i);
      return arr;
    }
  };
}
if (typeof g.TextDecoder === 'undefined') {
  g.TextDecoder = class {
    decode(bytes) {
      // Be tolerant of various buffer-like inputs used by wasm-bindgen glue.
      if (bytes == null) return '';
      // If a string is passed, return it directly.
      if (typeof bytes === 'string') return bytes;
      // If ArrayBuffer is passed, wrap it.
      if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
      // If it has a .buffer (TypedArray), normalize to Uint8Array.
      if (bytes && bytes.buffer instanceof ArrayBuffer && !(bytes instanceof Uint8Array)) {
        bytes = new Uint8Array(bytes.buffer);
      }
      const len = bytes.length >>> 0; // coerce length safely
      let str = '';
      for (let i = 0; i < len; i++) str += String.fromCharCode(bytes[i] & 0xFF);
      return str;
    }
  };
}
