import TilingPage from '@/components/layout/TilingPage';

/** Warning shown when the window is too small for the workspace layout. */
export default function SmallScreenWarning() {
  return (
    <TilingPage>
      <section className="text-center">
        <div className="flex items-center justify-center gap-3">
          <img src="/numina_logo.svg" alt="Numina" className="w-10 h-10" />
          <h1 className="text-2xl font-bold text-primary">Fuse</h1>
        </div>

        <p className="mt-10 mb-3 text-primary text-2xl font-bold leading-tight tracking-tight">
          Window too small
        </p>
        <p className="mx-auto max-w-sm text-foreground/80 text-base leading-relaxed">
          Fuse needs a larger window. Resize or maximize it to continue.
        </p>
      </section>
    </TilingPage>
  );
}
