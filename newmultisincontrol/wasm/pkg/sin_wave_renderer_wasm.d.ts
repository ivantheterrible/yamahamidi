/* tslint:disable */
/* eslint-disable */

/**
 * Add amplitude breakpoint events to one or more sines.
 * Format: [sine_id, event_count, override_flag, sample1, amp1, sample2, amp2, ..., sine_id, event_count, override_flag, ...]
 * For a single sine, just provide one section. For multiple sines, concatenate sections.
 *
 * - override_flag: 0.0 = normal mode (events must be in chronological order after existing)
 *                  1.0 = override mode (clears pending events at or after first new event's sample)
 *
 * Returns true if processing completed successfully.
 */
export function add_amplitude_events(data: Float32Array): boolean;

/**
 * Add frequency breakpoint events to one or more sines.
 * Format: [sine_id, event_count, override_flag, sample1, freq_hz1, sample2, freq_hz2, ..., sine_id, event_count, override_flag, ...]
 * For a single sine, just provide one section. For multiple sines, concatenate sections.
 *
 * - override_flag: 0.0 = normal mode (events must be in chronological order after existing)
 *                  1.0 = override mode (clears pending events at or after first new event's sample)
 *
 * Returns true if processing completed successfully.
 */
export function add_frequency_events(data: Float32Array): boolean;

/**
 * Add sines with specified starting phases and return their IDs.
 * `phases` is an array of normalized phase values (0.0 to 1.0, where 1.0 = 2pi).
 * Values outside this range are clamped. Pass 0.0 for default phase.
 * Returns a Vec of the newly created sine IDs.
 *
 * JavaScript must call add_amplitude_events AND add_frequency_events for each sine
 * to provide both amplitude and frequency events before rendering.
 */
export function add_sines(phases: Float32Array): Uint32Array;

export function get_current_sample_position(): number;

export function init(sample_rate: number): void;

export function num_sines(): number;

export function remove_sine(id: number): boolean;

export function render(buffer: Float32Array): void;

export function reset(): void;

export function rms_snapshot_and_reset(): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly add_amplitude_events: (a: number, b: number) => number;
    readonly add_frequency_events: (a: number, b: number) => number;
    readonly add_sines: (a: number, b: number) => [number, number];
    readonly init: (a: number) => void;
    readonly remove_sine: (a: number) => number;
    readonly render: (a: number, b: number, c: any) => void;
    readonly get_current_sample_position: () => number;
    readonly num_sines: () => number;
    readonly rms_snapshot_and_reset: () => number;
    readonly reset: () => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
