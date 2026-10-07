export function createPeriodicHannWindow(size: number): Float32Array {
  const safeSize = Math.max(1, Math.floor(size));
  const window = new Float32Array(safeSize);
  // torch.hann_window defaults to periodic=True. Matching that definition is
  // important because V6 was trained and evaluated with PyTorch STFT/ISTFT.
  for (let index = 0; index < safeSize; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / safeSize);
  }
  return window;
}

/** In-place radix-2 FFT/IFFT used by the real-time ClearVoice adapter. */
export function transformInPlace(real: Float32Array, imaginary: Float32Array, inverse = false): void {
  const size = real.length;
  if (imaginary.length !== size || size < 1 || (size & (size - 1)) !== 0) {
    throw new Error("ClearVoice FFT expects equally sized power-of-two buffers.");
  }

  for (let target = 1, source = 0; target < size; target += 1) {
    let bit = size >> 1;
    for (; source & bit; bit >>= 1) source ^= bit;
    source ^= bit;
    if (target < source) {
      const realValue = real[target];
      real[target] = real[source];
      real[source] = realValue;
      const imaginaryValue = imaginary[target];
      imaginary[target] = imaginary[source];
      imaginary[source] = imaginaryValue;
    }
  }

  for (let length = 2; length <= size; length <<= 1) {
    const half = length >> 1;
    const angle = ((inverse ? 2 : -2) * Math.PI) / length;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let currentCosine = 1;
      let currentSine = 0;
      for (let offset = 0; offset < half; offset += 1) {
        const left = start + offset;
        const right = left + half;
        const rightReal = real[right] * currentCosine - imaginary[right] * currentSine;
        const rightImaginary = real[right] * currentSine + imaginary[right] * currentCosine;
        const leftReal = real[left];
        const leftImaginary = imaginary[left];
        real[left] = leftReal + rightReal;
        imaginary[left] = leftImaginary + rightImaginary;
        real[right] = leftReal - rightReal;
        imaginary[right] = leftImaginary - rightImaginary;
        const nextCosine = currentCosine * cosine - currentSine * sine;
        currentSine = currentSine * cosine + currentCosine * sine;
        currentCosine = nextCosine;
      }
    }
  }

  if (inverse) {
    for (let index = 0; index < size; index += 1) {
      real[index] /= size;
      imaginary[index] /= size;
    }
  }
}
