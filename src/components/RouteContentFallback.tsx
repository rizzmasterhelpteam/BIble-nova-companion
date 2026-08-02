export function RouteContentFallback() {
  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-4 px-[var(--app-page-padding)] py-6"
      aria-busy="true"
      aria-label="Loading page"
      style={{ color: "var(--app-text)" }}
    >
      <div
        className="h-5 w-28 animate-pulse rounded-full"
        style={{ background: "var(--app-surface-muted)" }}
      />
      <div
        className="h-28 w-full animate-pulse rounded-card"
        style={{ background: "var(--app-surface-elevated)", border: "1px solid var(--app-card-border)" }}
      />
      <div className="space-y-2">
        <div
          className="h-3 w-4/5 animate-pulse rounded-full"
          style={{ background: "var(--app-surface-muted)" }}
        />
        <div
          className="h-3 w-3/5 animate-pulse rounded-full"
          style={{ background: "var(--app-surface-muted)" }}
        />
      </div>
    </section>
  );
}

export default RouteContentFallback;
