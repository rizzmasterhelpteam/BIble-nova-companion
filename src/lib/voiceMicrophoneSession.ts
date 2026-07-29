export type MicrophoneAcquireResult = {
  stream: MediaStream;
  reused: boolean;
};

const hasLiveAudioTrack = (stream: MediaStream | null) =>
  Boolean(
    stream?.getAudioTracks().some((track) => track.readyState === "live"),
  );

const stopStream = (stream: MediaStream) => {
  stream.getTracks().forEach((track) => track.stop());
};

export class VoiceMicrophoneSession {
  private stream: MediaStream | null = null;

  get current() {
    return this.stream;
  }

  owns(stream: MediaStream | null | undefined) {
    return Boolean(stream && this.stream === stream);
  }

  async acquire(
    createStream: () => Promise<MediaStream>,
  ): Promise<MicrophoneAcquireResult> {
    if (hasLiveAudioTrack(this.stream)) {
      return { stream: this.stream!, reused: true };
    }

    if (this.stream) {
      stopStream(this.stream);
      this.stream = null;
    }

    const stream = await createStream();
    if (!hasLiveAudioTrack(stream)) {
      stopStream(stream);
      throw new Error("The microphone did not provide a live audio track.");
    }
    this.stream = stream;
    return { stream, reused: false };
  }

  setEnabled(enabled: boolean) {
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }

  release(expectedStream?: MediaStream | null) {
    if (expectedStream && this.stream && expectedStream !== this.stream) {
      stopStream(expectedStream);
      return false;
    }

    const target = expectedStream || this.stream;
    if (!target) return false;
    stopStream(target);
    if (target === this.stream) this.stream = null;
    return true;
  }
}
