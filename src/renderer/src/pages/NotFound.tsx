import { Link } from 'react-router-dom';
import TilingPage from '@/components/layout/TilingPage';
import { Button } from '@/components/ui/button';

/** Application 404 page. */
export default function NotFound() {
  return (
    <TilingPage>
      <section className="text-center">
        <div className="flex items-center justify-center gap-3">
          <img src="/numina_logo.svg" alt="Numina" className="w-10 h-10" />
          <h1 className="text-2xl font-bold text-foreground">Fuse</h1>
        </div>

        <p className="mt-10 mb-3 text-[2.25rem] font-bold leading-none tracking-[-0.02em] text-[color:var(--numina-accent)]">
          404
        </p>
        <p className="m-0 text-base font-medium text-foreground">Page not found</p>

        <Button
          render={<Link to="/" />}
          variant="outline"
          className="mt-10 inline-block px-8 py-2 no-underline"
        >
          Home
        </Button>
      </section>
    </TilingPage>
  );
}
