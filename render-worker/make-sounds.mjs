// Makes the Motion Explainer sounds with ffmpeg (no recordings, so no
// licences): short sound effects for the graphics, and three soft music
// beds that loop seamlessly. Writes them to render-worker/sounds (export)
// and public/sounds (editor preview). Run once after changing a recipe:
//   node make-sounds.mjs
// The file names are listed in src/motion/sounds.ts (SOUND_FILES).

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ffmpegPath from "ffmpeg-static";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDirs = [path.join(here, "sounds"), path.join(here, "..", "public", "sounds")];
for (const d of outDirs) fs.mkdirSync(d, { recursive: true });

const RATE = 48000;

/** Each sound: an aevalsrc expression (time t in seconds), its length, and filters after it. */
const SOUNDS = {
  // Air moving past: pink noise swelling and falling away, bright.
  "whoosh-light": {
    src: `anoisesrc=d=0.55:c=pink:a=0.9:seed=7:r=${RATE}`,
    fx: "highpass=f=500,lowpass=f=6000,afade=t=in:d=0.3:curve=qsin,afade=t=out:st=0.3:d=0.25:curve=qsin,volume=2.4",
  },
  // The same, bigger and darker, for large things arriving.
  "whoosh-deep": {
    src: `anoisesrc=d=0.85:c=brown:a=1:seed=7:r=${RATE}`,
    fx: "highpass=f=60,lowpass=f=1500,afade=t=in:d=0.45:curve=qsin,afade=t=out:st=0.45:d=0.4:curve=qsin,volume=1.6",
  },
  // A light, short tick (text and list items).
  click: {
    expr: "0.6*sin(2*PI*2400*t)*exp(-t*90)+0.25*(random(1)*2-1)*exp(-t*160)",
    d: 0.06,
  },
  // A soft round pop (words, labels).
  pop: {
    expr: "0.7*sin(2*PI*(420+700*exp(-t*45))*t)*exp(-t*28)",
    d: 0.16,
  },
  // Two quick rising tones (cards, UI).
  "ui-blip": {
    expr: "0.4*(lt(t,0.07)*sin(2*PI*880*t)*exp(-t*20)+gte(t,0.07)*sin(2*PI*1320*t)*exp(-(t-0.07)*25))",
    d: 0.22,
  },
  // A short digital stutter (glitch-in titles).
  glitch: {
    expr: "0.35*sgn(sin(2*PI*180*t))*lt(mod(t,0.05),0.025)*exp(-t*9)+0.2*(random(2)*2-1)*lt(mod(t,0.033),0.01)",
    d: 0.3,
  },
  // Rising tension that leads into a chapter (1.5 s).
  riser: {
    expr: "(0.35*sin(2*PI*(180*t+260*t*t))+0.25*(random(3)*2-1))*pow(t/1.5,2)",
    d: 1.5,
    fx: "lowpass=f=5000,afade=t=out:st=1.42:d=0.08",
  },
  // A low impact where the chapter lands.
  hit: {
    expr: "0.9*sin(2*PI*(48+40*exp(-t*12))*t)*exp(-t*3.5)+0.35*(random(4)*2-1)*exp(-t*22)",
    d: 1.4,
    fx: "lowpass=f=4000",
  },
};

// Music beds: 32 s loops. Every frequency and wobble repeats a whole number
// of times in 32 s, so the end joins the start without a click.
const LOOP_S = 32;
const chord = (notes, gain) =>
  notes.map((f) => `${gain}*sin(2*PI*${f}*t)`).join("+");
const BEDS = {
  // Calm: A minor, slow swell.
  "bed-calm": `(${chord([110, 220, 261.625, 329.625], 0.12)})*(0.75+0.25*sin(2*PI*t/16))`,
  // Focus: C major 7, gentle shimmer.
  "bed-focus": `(${chord([130.8125, 164.8125, 196, 246.9375], 0.11)})*(0.8+0.2*sin(2*PI*t/8))+0.03*sin(2*PI*523.25*t)*(0.5+0.5*sin(2*PI*t/4))`,
  // Drive: D minor with a soft pulse at 120 bpm.
  "bed-drive": `(${chord([73.4375, 146.875, 174.625, 220], 0.12)})*(0.6+0.4*pow(sin(PI*2*t),2))`,
};

function render(name, args) {
  for (const dir of outDirs) {
    const file = path.join(dir, `${name}.m4a`);
    execFileSync(ffmpegPath, ["-y", "-loglevel", "error", ...args, "-c:a", "aac", "-b:a", "128k", file]);
  }
}

for (const [name, s] of Object.entries(SOUNDS)) {
  const src = s.src ?? `aevalsrc='${s.expr}':d=${s.d}:s=${RATE}`;
  const fx = [s.fx, "aformat=channel_layouts=stereo", "alimiter=limit=0.9"].filter(Boolean).join(",");
  render(name, ["-f", "lavfi", "-i", src, "-af", fx]);
  console.log(`made ${name}`);
}
for (const [name, expr] of Object.entries(BEDS)) {
  render(name, [
    "-f", "lavfi", "-i", `aevalsrc='${expr}':d=${LOOP_S}:s=${RATE}`,
    "-af", "lowpass=f=2400,aformat=channel_layouts=stereo,volume=0.9",
  ]);
  console.log(`made ${name}`);
}
