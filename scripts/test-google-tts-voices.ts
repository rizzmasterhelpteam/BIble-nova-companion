import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const SAMPLE_TEXT =
  "I hear you. That feels heavy, but you are not alone in it. Take one slow breath, and let's bring this to God together.";

const candidates = [
  {
    label: "current-au-algenib",
    languageCode: "en-AU",
    voiceName: "en-AU-Chirp3-HD-Algenib",
  },
  {
    label: "au-female-aoede",
    languageCode: "en-AU",
    voiceName: "en-AU-Chirp3-HD-Aoede",
  },
  {
    label: "us-charon",
    languageCode: "en-US",
    voiceName: "en-US-Chirp3-HD-Charon",
  },
  {
    label: "gb-female-leda",
    languageCode: "en-GB",
    voiceName: "en-GB-Chirp3-HD-Leda",
  },
] as const;

const main = async () => {
  const { synthesizeSpeech } = await import("../server-api.js");
  const outputDirectory = path.join(
    os.tmpdir(),
    "bible-nova-google-tts-voices",
  );
  await mkdir(outputDirectory, { recursive: true });

  for (const candidate of candidates) {
    const audio = await synthesizeSpeech(SAMPLE_TEXT, {
      languageCode: candidate.languageCode,
      voiceName: candidate.voiceName,
      speakingRate: 0.94,
      pitch: -1,
      enableSsml: true,
    });
    const outputPath = path.join(outputDirectory, `${candidate.label}.mp3`);
    await writeFile(outputPath, Buffer.from(audio.audioContent, "base64"));
    console.info(
      `${candidate.voiceName}: ${audio.synthesisMode} -> ${outputPath}`,
    );
  }

  console.info(
    "Listen on the target Android speaker before changing GOOGLE_TTS_VOICE_NAME.",
  );
};

void main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Google TTS voice testing failed.",
  );
  process.exitCode = 1;
});
