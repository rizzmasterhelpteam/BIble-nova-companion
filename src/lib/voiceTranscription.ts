export const MAX_VOICE_AUDIO_BYTES = 5 * 1024 * 1024;

export const SUPPORTED_VOICE_AUDIO_MIME_TYPES = [
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
] as const;

export const normalizeVoiceAudioMimeType = (mimeType: string) =>
  mimeType.split(";", 1)[0]?.trim().toLowerCase() || "";

export const isSupportedVoiceAudioMimeType = (mimeType: string) =>
  SUPPORTED_VOICE_AUDIO_MIME_TYPES.includes(
    normalizeVoiceAudioMimeType(mimeType) as typeof SUPPORTED_VOICE_AUDIO_MIME_TYPES[number],
  );

export const getVoiceAudioFilename = (mimeType: string) => {
  switch (normalizeVoiceAudioMimeType(mimeType)) {
    case "audio/mp4":
      return "speech.mp4";
    case "audio/ogg":
      return "speech.ogg";
    default:
      return "speech.webm";
  }
};

export const createVoiceTranscriptionFormData = (
  blob: Blob,
  language?: string,
  voiceLanguage?: string,
) => {
  const formData = new FormData();
  formData.append("file", blob, getVoiceAudioFilename(blob.type));
  if (language) formData.append("language", language);
  if (voiceLanguage) formData.append("voiceLanguage", voiceLanguage);
  return formData;
};
