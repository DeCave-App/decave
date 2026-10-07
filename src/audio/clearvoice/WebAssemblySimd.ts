// Keep the capability probe local so a CPU without WebAssembly SIMD goes
// directly to the scalar V6 runtime instead of spawning a worker that can only
// fail during WASM compilation.
//
// The module is the wasm-feature-detect SIMD probe: one function returning
// i8x16.splat(i32.const 0) followed by i8x16.popcnt. It must stay a valid
// module; an invalid probe reports "no SIMD" everywhere and silently pins
// every browser to the slower scalar runtime.
const SIMD_PROBE = new Uint8Array([
  0,
  97,
  115,
  109,
  1,
  0,
  0,
  0, // "\0asm", version 1
  1,
  5,
  1,
  96,
  0,
  1,
  123, // type section: () -> v128
  3,
  2,
  1,
  0, // function section
  10,
  10,
  1,
  8,
  0, // code section, one 8-byte body, no locals
  65,
  0, // i32.const 0
  253,
  15, // i8x16.splat
  253,
  98, // i8x16.popcnt
  11, // end
]);

export function supportsWebAssemblySimd(): boolean {
  try {
    return typeof WebAssembly !== "undefined" && WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}
