/**
 * Level shown on the settings input meter, next to the activation threshold.
 *
 * The voice-activation gate reports the level it decides on as `inputDb`:
 * after noise suppression in automatic sensitivity, the raw microphone in
 * manual sensitivity. Metering anything else beside the threshold makes room
 * noise look "above threshold" while the gate correctly stays closed.
 */
export function inputMeterLevelDb(input: {
  rawDb: number;
  pushToTalk: boolean;
  gate: { inputDb?: number } | null | undefined;
}): number {
  const gateDb = input.gate?.inputDb;
  if (input.pushToTalk || typeof gateDb !== "number" || !Number.isFinite(gateDb)) return input.rawDb;
  return gateDb;
}
