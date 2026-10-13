// Processed audio the DeepFilterNet worklet holds back before playback starts
// (and again after a miss), so normal model-worker timing jitter doesn't chop
// the voice. The voice-activation sidechain is delayed by the same amount so
// the gate stays aligned with the delayed processed audio.
export const DEEP_FILTER_JITTER_CUSHION_SAMPLES = 960;
export const DEEP_FILTER_JITTER_CUSHION_SECONDS = DEEP_FILTER_JITTER_CUSHION_SAMPLES / 48_000;
