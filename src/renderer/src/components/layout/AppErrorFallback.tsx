/**
 * Full-screen error fallback. Both actions perform a full-page navigation,
 * which resets application state, so no explicit error-clear call is needed.
 * The renderer is served by the loopback backend with an SPA fallback, so
 * `assign('/')` lands on the dashboard exactly as it would on the web.
 */
export default function AppErrorFallback({ message }: { message: string }) {
  function goHome() {
    window.location.assign('/');
  }

  function refreshPage() {
    window.location.reload();
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8 bg-background">
      <section className="w-[min(100%,32rem)] text-center">
        <img src="/numina_logo.svg" alt="Numina" className="w-12 h-12 mx-auto mb-4" />
        <p className="mb-3 text-muted-foreground text-sm font-semibold">Fuse</p>
        <h1 className="m-0 text-foreground text-3xl font-bold">We hit a problem.</h1>
        <p className="mt-4 mx-auto text-foreground/80 leading-relaxed">{message}</p>
        <div className="flex justify-center gap-3 mt-6">
          <button
            type="button"
            className="min-w-26 rounded-md px-4 py-2.5 font-semibold transition-opacity bg-primary text-primary-foreground hover:opacity-85"
            onClick={refreshPage}
          >
            Refresh
          </button>
          <button
            type="button"
            className="min-w-26 rounded-md px-4 py-2.5 font-semibold transition-opacity border border-border text-foreground bg-transparent hover:opacity-85"
            onClick={goHome}
          >
            Home
          </button>
        </div>
      </section>
    </main>
  );
}
