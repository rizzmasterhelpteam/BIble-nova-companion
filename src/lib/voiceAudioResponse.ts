const base64ToArrayBuffer = (value: string) => {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

export const readVoiceAudioResponse = async (response: Response) => {
  const contentType = response.headers.get("Content-Type")?.toLowerCase() || "";
  if (contentType.includes("audio/")) {
    return response.arrayBuffer();
  }

  const compatibility = await response.json().catch(() => ({})) as {
    audioContent?: string;
  };
  if (!compatibility.audioContent) {
    throw new Error(
      "The voice response could not be generated. The reply is saved in Chat.",
    );
  }
  return base64ToArrayBuffer(compatibility.audioContent);
};
