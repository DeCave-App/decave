import { useCallback, useEffect, useState } from "react";
import { AudioRouting, type AudioRoute } from "../../modules/decave-audio-route";

/**
 * Live speaker / earpiece state for the voice room controls. The route is
 * read from iOS, so plugging in headphones or connecting AirPods updates it.
 */
export function useSpeakerRoute() {
  const [route, setRoute] = useState<AudioRoute | null>(() => AudioRouting.getRoute());

  useEffect(() => {
    if (!AudioRouting.available) return;
    setRoute(AudioRouting.getRoute());
    const sub = AudioRouting.addRouteListener(setRoute);
    return () => sub.remove();
  }, []);

  const toggleSpeaker = useCallback(() => {
    const next = !(route?.wantsSpeaker ?? route?.speaker ?? false);
    void AudioRouting.setSpeaker(next)
      .then((updated) => updated && setRoute(updated))
      .catch((error) => console.warn("[audio-route] could not change output", error));
  }, [route]);

  return {
    available: AudioRouting.available,
    speakerOn: route?.speaker ?? false,
    external: route?.external ?? false,
    outputName: route?.outputName ?? "",
    toggleSpeaker,
  };
}
