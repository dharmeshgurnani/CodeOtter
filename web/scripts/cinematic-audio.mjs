// Original procedural instrumental bed: no downloaded music or third-party audio.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const dir = resolve('.flute/exports');
const input = resolve(dir, 'codeotter-cinematic-silent.mp4');
const output = resolve(dir, 'codeotter-cinematic.mp4');
if (!existsSync(input)) throw new Error('Run pnpm cinematic:export first.');
if (existsSync(output)) throw new Error('Move the previous codeotter-cinematic.mp4 before composing again.');
mkdirSync(dir, { recursive: true });
const rate = 48000, duration = 30, frames = rate * duration;
const wav = Buffer.alloc(44 + frames * 4);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28);
wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(frames * 4, 40);
const chords = [[50, 53, 57, 60], [46, 50, 53, 57], [53, 57, 60, 65], [48, 52, 55, 62]];
const hz = midi => 440 * 2 ** ((midi - 69) / 12);
const sine = (frequency, time) => Math.sin(2 * Math.PI * frequency * time);
for (let i = 0; i < frames; i++) {
  const t = i / rate;
  const fade = Math.min(1, t / 1.2, (duration - t) / 2.3);
  let left = 0, right = 0;
  chords.forEach((chord, c) => {
    const start = c * 7.5, local = t - start;
    const envelope = Math.max(0, Math.min(1, local / 1.2, (9 - local) / 1.5));
    chord.forEach((note, n) => {
      const f = hz(note);
      const pad = .027 * envelope * (sine(f, t) + .16 * sine(f * 2, t));
      left += pad * (.8 + .2 * Math.sin(n * 2));
      right += pad * (.8 - .2 * Math.sin(n * 2));
    });
  });
  const chord = chords[Math.min(3, Math.floor(t / 7.5))];
  const beat = t % .6, count = Math.floor(t / .6);
  const pluck = .045 * Math.exp(-beat * 12) * Math.min(1, beat * 180) * sine(hz(chord[count % 4] + 12), beat);
  const pulse = .045 * Math.exp(-beat * 15) * sine(55, beat);
  left += pluck * .75 + pulse; right += pluck + pulse;
  for (const boundary of [3, 12, 26]) {
    const x = t - boundary;
    if (x > -.4 && x < .65) {
      const env = Math.sin(Math.PI * (x + .4) / 1.05) ** 2;
      const shimmer = .018 * env * (sine(880 + x * 160, t) + .3 * sine(1320, t));
      left += shimmer; right += shimmer;
    }
  }
  wav.writeInt16LE(Math.round(Math.tanh(left * fade) * 32767), 44 + i * 4);
  wav.writeInt16LE(Math.round(Math.tanh(right * fade) * 32767), 46 + i * 4);
}
const audio = resolve(dir, 'codeotter-original-score.wav');
writeFileSync(audio, wav);
const ff = spawnSync('ffmpeg', ['-n', '-hide_banner', '-loglevel', 'error', '-i', input, '-i', audio,
  '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
  '-af', 'loudnorm=I=-20:TP=-2:LRA=7', '-ar', '48000', '-t', '30', '-movflags', '+faststart', output], { stdio: 'inherit', windowsHide: true });
if (ff.error) throw ff.error;
if (ff.status !== 0) throw new Error(`FFmpeg exited ${ff.status}`);
console.log(output);
