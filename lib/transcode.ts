/**
 * Browser only. Re-encodes an audio file to a 128 kbps, 44.1 kHz MP3, so only
 * that streaming copy is ever uploaded and the original never leaves the
 * artist's machine. Import it dynamically: the encoder is a WASM module that
 * should stay out of the main bundle.
 */

const SAMPLE_RATE = 44100;
/** Frames handed to the encoder per call, so memory stays flat on long songs. */
const CHUNK = 1152 * 64;

/** Longest song accepted, in seconds. 128 kbps for this long stays under 5 MB. */
export const MAX_SONG_SECONDS = 327;
export const TOO_LONG = "That song is too long. Songs can be about 5 minutes.";
export const NOT_PLAYABLE = "That file isn't a playable MP3";

export async function transcodeToMp3_128(file: File): Promise<File> {
  // An OfflineAudioContext decodes and resamples to 44.1 kHz without needing
  // an audio output device or a user gesture.
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  let audio: AudioBuffer;
  try {
    audio = await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error(NOT_PLAYABLE);
  }
  // Checked before encoding, so a long song fails fast.
  if (audio.duration > MAX_SONG_SECONDS) throw new Error(TOO_LONG);
  const channels: 1 | 2 = audio.numberOfChannels >= 2 ? 2 : 1;
  const pcm = Array.from({ length: channels }, (_, c) => audio.getChannelData(c));

  const { createMp3Encoder } = await import("wasm-media-encoders");
  const encoder = await createMp3Encoder();
  encoder.configure({ channels, sampleRate: SAMPLE_RATE, bitrate: 128, outputSampleRate: SAMPLE_RATE });

  const parts: Uint8Array<ArrayBuffer>[] = [];
  for (let i = 0; i < audio.length; i += CHUNK) {
    // The encoder reuses its output buffer, so copy each result out.
    parts.push(encoder.encode(pcm.map((ch) => ch.subarray(i, i + CHUNK))).slice());
  }
  parts.push(encoder.finalize().slice());

  const name = file.name.replace(/\.[^.]*$/, "") + ".mp3";
  return new File(parts, name, { type: "audio/mpeg" });
}
