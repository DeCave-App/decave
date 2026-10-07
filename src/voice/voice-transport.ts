/**
 * Voice-only WebRTC transport tuning shared by channel voice and direct calls.
 * These helpers only adjust negotiation and sender settings; every one of them
 * fails soft so an unsupported browser keeps its default Opus behavior.
 */

type RtpPriority = "very-low" | "low" | "medium" | "high";
type VoiceEncoding = RTCRtpEncodingParameters & {
  priority?: RtpPriority;
  networkPriority?: RtpPriority;
};

type SessionDescription = { type?: string; sdp?: string };
type CodecLike = { mimeType: string };

/** Opus target for one listener; browsers default to about 32 kbps. */
export const VOICE_OPUS_BITRATE = 64_000;

// Measured in Chromium: when a sender's maxBitrate changes mid-call, the Opus
// target becomes the cap minus IPv4/UDP headers (28 bytes x 50 packets/s), and
// the negotiated maxaveragebitrate no longer bounds it. Caps carry this overhead
// so the encoder lands on the intended voice rate.
const VOICE_PACKET_OVERHEAD_BPS = 11_200;

/**
 * Per-listener Opus bitrate. Voice channels are a mesh, so every listener
 * receives a separate copy of the microphone; large rooms step down to keep
 * the sender's total upload reasonable (RED roughly doubles each copy).
 */
export function voiceBitrateForListeners(listeners: number): number {
  if (listeners <= 4) return VOICE_OPUS_BITRATE;
  if (listeners <= 8) return 48_000;
  return 32_000;
}

function withOpusParameters(parameters: string, bitrate: number): string {
  let hasBitrate = false;
  let hasFec = false;
  const entries = parameters
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const name = entry.split("=")[0].trim().toLowerCase();
      if (name === "maxaveragebitrate") {
        hasBitrate = true;
        return `maxaveragebitrate=${bitrate}`;
      }
      if (name === "useinbandfec") hasFec = true;
      return entry;
    });
  if (!hasBitrate) entries.push(`maxaveragebitrate=${bitrate}`);
  if (!hasFec) entries.push("useinbandfec=1");
  return entries.join(";");
}

function withAudioSectionBitrate(lines: string[], bitrate: number): string[] {
  const opusPayloads = new Set<string>();
  for (const line of lines) {
    const match = /^a=rtpmap:(\d+) opus\/48000/i.exec(line);
    if (match) opusPayloads.add(match[1]);
  }
  if (opusPayloads.size === 0) return lines;
  const configured = new Set<string>();
  const updated = lines.map((line) => {
    const match = /^a=fmtp:(\d+) (.*)$/.exec(line);
    if (!match || !opusPayloads.has(match[1])) return line;
    configured.add(match[1]);
    return `a=fmtp:${match[1]} ${withOpusParameters(match[2], bitrate)}`;
  });
  const result: string[] = [];
  for (const line of updated) {
    result.push(line);
    const match = /^a=rtpmap:(\d+) opus\/48000/i.exec(line);
    if (match && !configured.has(match[1])) {
      result.push(`a=fmtp:${match[1]} maxaveragebitrate=${bitrate};useinbandfec=1`);
    }
  }
  return result;
}

/**
 * Opus `maxaveragebitrate` in a remote description tells this client's
 * encoder how much the remote decoder accepts. Rewriting it before
 * setRemoteDescription raises the bitrate this client sends at, without
 * touching what the remote side sends. Without it browsers use about 32 kbps.
 */
export function withVoiceOpusBitrate<T extends SessionDescription>(description: T, bitrate: number): T {
  if (!description.sdp) return description;
  const eol = description.sdp.includes("\r\n") ? "\r\n" : "\n";
  const sections: string[][] = [[]];
  for (const line of description.sdp.split(eol)) {
    if (line.startsWith("m=")) sections.push([]);
    sections[sections.length - 1].push(line);
  }
  const sdp = sections
    .map((section) => (section[0]?.startsWith("m=audio") ? withAudioSectionBitrate(section, bitrate) : section))
    .flat()
    .join(eol);
  return { ...description, sdp };
}

/**
 * RED (RFC 2198) repeats the previous voice frame in each packet, so a single
 * lost packet costs no audio. Keep plain Opus right behind it for peers that
 * cannot negotiate RED.
 */
export function preferRedundantVoiceCodecs<T extends CodecLike>(codecs: readonly T[]): T[] {
  const kind = (codec: T) => codec.mimeType.toLowerCase();
  const red = codecs.filter((codec) => kind(codec) === "audio/red");
  const opus = codecs.filter((codec) => kind(codec) === "audio/opus");
  const rest = codecs.filter((codec) => kind(codec) !== "audio/red" && kind(codec) !== "audio/opus");
  return [...red, ...opus, ...rest];
}

/** Must run before the transceiver is negotiated. Returns whether it applied. */
export function applyVoiceCodecPreferences(
  transceiver: Partial<Pick<RTCRtpTransceiver, "setCodecPreferences">> | null | undefined,
  capabilities: { codecs: readonly RTCRtpCodec[] } | null | undefined,
): boolean {
  if (!transceiver?.setCodecPreferences || !capabilities?.codecs?.length) return false;
  try {
    transceiver.setCodecPreferences(preferRedundantVoiceCodecs(capabilities.codecs));
    return true;
  } catch (error) {
    console.warn("Could not prefer redundant voice audio:", error);
    return false;
  }
}

type VoiceSender = Pick<RTCRtpSender, "getParameters" | "setParameters"> & {
  readonly transport?: { readonly state: string } | null;
};

// setParameters must carry the transactionId of the sender's most recent
// getParameters call, so overlapping updates would reject each other.
const pendingSenderUpdates = new WeakMap<VoiceSender, Promise<boolean>>();

/**
 * Give the microphone priority over camera and screen share on the same
 * connection, and cap its bitrate for the current listener count.
 *
 * Call it when the sender is bound (priority only: the negotiated
 * maxaveragebitrate sets the starting rate exactly) and again whenever the
 * listener count changes. The cap is only applied to a connected transport:
 * before that Chromium uses a cap as the Opus target as-is, and a cap applied
 * at connect time lands 6.4 kbps under the negotiated rate.
 */
export function applyVoiceSenderParameters(sender: VoiceSender, listeners: number): Promise<boolean> {
  const previous = pendingSenderUpdates.get(sender) ?? Promise.resolve(true);
  const next = previous.then(() => applyVoiceSenderParametersNow(sender, listeners));
  pendingSenderUpdates.set(sender, next);
  return next;
}

async function applyVoiceSenderParametersNow(sender: VoiceSender, listeners: number): Promise<boolean> {
  try {
    const parameters = sender.getParameters();
    const encoding = parameters.encodings?.[0] as VoiceEncoding | undefined;
    if (!encoding) return false;
    encoding.priority = "high";
    encoding.networkPriority = "high";
    if (sender.transport?.state === "connected") {
      encoding.maxBitrate = voiceBitrateForListeners(listeners) + VOICE_PACKET_OVERHEAD_BPS;
    }
    await sender.setParameters(parameters);
    return true;
  } catch (error) {
    console.warn("Could not apply voice sender priority and bitrate:", error);
    return false;
  }
}
