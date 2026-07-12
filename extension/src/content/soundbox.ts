// Soundbox effects synthesized with the Web Audio API so the MVP ships no
// audio binaries. Each sound plays locally for the triggerer and, via a
// relayed `soundbox` event, for everyone else in the room. Custom user clips
// stored in S3 are a later enhancement (they'd resolve a URL by soundId here).

export interface SoundDef {
  id: string;
  label: string;
  emoji: string;
}

export const SOUNDS: SoundDef[] = [
  { id: "airhorn", label: "Airhorn", emoji: "📢" },
  { id: "ding", label: "Ding", emoji: "🔔" },
  { id: "drumroll", label: "Drumroll", emoji: "🥁" },
  { id: "boo", label: "Boo", emoji: "👎" },
];

let ctx: AudioContext | null = null;
function audio(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType, gain = 0.2): void {
  const ac = audio();
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime + start);
  g.gain.setValueAtTime(0.0001, ac.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, ac.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(ac.currentTime + start);
  osc.stop(ac.currentTime + start + dur + 0.05);
}

function noiseBurst(start: number, dur: number, gain = 0.15): void {
  const ac = audio();
  const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ac.createBufferSource();
  const g = ac.createGain();
  g.gain.value = gain;
  src.buffer = buffer;
  src.connect(g).connect(ac.destination);
  src.start(ac.currentTime + start);
}

export function playSound(soundId: string): void {
  try {
    switch (soundId) {
      case "airhorn":
        tone(220, 0, 0.5, "sawtooth", 0.25);
        tone(277, 0.12, 0.4, "sawtooth", 0.2);
        break;
      case "ding":
        tone(1318, 0, 0.4, "sine", 0.25);
        tone(1975, 0.02, 0.35, "sine", 0.12);
        break;
      case "drumroll":
        for (let i = 0; i < 10; i++) noiseBurst(i * 0.05, 0.05, 0.12);
        noiseBurst(0.55, 0.25, 0.2);
        break;
      case "boo":
        tone(160, 0, 0.6, "square", 0.18);
        tone(120, 0.15, 0.5, "square", 0.15);
        break;
      default:
        tone(440, 0, 0.2, "sine");
    }
  } catch {
    /* Web Audio unavailable — ignore */
  }
}
