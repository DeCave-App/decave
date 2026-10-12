# DeepFilterNet3 (vendored build)

`df.js`, `df.d.ts` and `df_bg.wasm` are the `libDF` crate from
[Rikorose/DeepFilterNet](https://github.com/Rikorose/DeepFilterNet), compiled to
WebAssembly. `DeepFilterNet3_onnx.dfnmodel` is the upstream
`models/DeepFilterNet3_onnx.tar.gz` unchanged. It was renamed so web servers do
not send it with `Content-Encoding: gzip`, because the browser would then hand
the worker an already-unpacked tar. Both are dual-licensed MIT / Apache-2.0
(`LICENSE-MIT`, `LICENSE-APACHE`).

Built from upstream commit `d375b2d8309e0935d165700c91da9de862a99c31` with
`libdf-wasm.patch` applied. The patch:

- drops `default-model` from the `wasm` feature, so the model is not embedded a
  second time (the worker passes it in)
- adds `df_process_frame_into`, which writes into a caller-owned buffer and
  returns the frame's local SNR instead of allocating a JS array per 10 ms hop
- adds `df_free`
- includes the `Cargo.lock` that the toolchain below resolved to

## Rebuild

```bash
git clone https://github.com/Rikorose/DeepFilterNet.git && cd DeepFilterNet
git checkout d375b2d8309e0935d165700c91da9de862a99c31
git apply <this dir>/libdf-wasm.patch
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.92 --locked
RUSTFLAGS="-C target-feature=+simd128" cargo build --release -p deep_filter --lib \
  --target wasm32-unknown-unknown --no-default-features --features wasm
wasm-bindgen --target web --out-dir <this dir> --out-name df \
  target/wasm32-unknown-unknown/release/df.wasm
```

Toolchain: rustc/cargo 1.98.0, wasm-bindgen 0.2.92.

SHA-256:

- `df_bg.wasm` `46575ab7723958137f90ff6b893302f133b3ceac134e9d67c63fe228188eae06`
- `DeepFilterNet3_onnx.dfnmodel` `c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616`
