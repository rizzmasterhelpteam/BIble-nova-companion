import type { NativeRuntimeInfo } from "../platform/types";

type UpdateRequiredScreenProps = {
  runtime: NativeRuntimeInfo;
};

export default function UpdateRequiredScreen({ runtime }: UpdateRequiredScreenProps) {
  return (
    <main
      className="flex min-h-screen items-center justify-center px-6 py-10"
      style={{ background: "var(--app-page-bg)", color: "var(--app-text)" }}
    >
      <section
        className="app-panel-strong w-full max-w-md rounded-[2rem] border p-7 text-center shadow-xl"
        style={{ borderColor: "var(--app-card-border)" }}
      >
        <p className="app-kicker">Bible Nova Companion</p>
        <h1 className="app-heading mt-3 font-serif text-3xl font-semibold">Update required</h1>
        <p className="app-muted mt-3 text-sm leading-relaxed">
          This version of the app cannot safely run the latest experience. Update from Google Play,
          then open Bible Nova Companion again.
        </p>
        <a
          className="app-primary-button mt-6 inline-flex min-h-12 items-center justify-center rounded-pill px-5 text-sm font-semibold"
          href="https://play.google.com/store/apps/details?id=com.biblenovacompanion.app"
          target="_blank"
          rel="noreferrer"
        >
          Update app
        </a>
        <p className="app-muted mt-5 text-[11px]">
          Bridge {runtime.bridgeVersion} · App {runtime.appVersion} · Build {runtime.buildNumber}
        </p>
      </section>
    </main>
  );
}
