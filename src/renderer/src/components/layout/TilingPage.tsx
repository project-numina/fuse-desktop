import { useEffect, useRef, type ReactNode } from 'react';
import { generateTiling, renderTiling } from '@/lib/einstein-tiling';
import { useTheme } from '@/state/theme';

/**
 * Centered card over the Einstein aperiodic-tiling background.
 *
 * Rendered both by routes (NotFound) and by app chrome that sits outside the
 * router (the small-screen warning), so nothing in here may depend on a
 * navigation context.
 */
export default function TilingPage({
  cardWidth = 'md',
  cardPadding = 'p-8',
  children,
}: {
  // Max width of the centered card. 'md' (~28rem) for status pages,
  // 'xl' (~36rem) for forms with more inputs.
  cardWidth?: 'md' | 'xl';
  // Tailwind padding utility for the card.
  cardPadding?: string;
  children?: ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { resolvedTheme } = useTheme();

  // Paint the aperiodic "hat" tiling on mount, on resize, and whenever the
  // theme flips (so the palette swaps in sync with the rest of the page).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const hats = generateTiling(3);
    const render = () => renderTiling(canvas, hats);
    render();
    window.addEventListener('resize', render);
    return () => window.removeEventListener('resize', render);
  }, [resolvedTheme]);

  return (
    <div
      className="relative h-screen overflow-y-auto [overscroll-behavior:none]"
      style={{ background: 'var(--numina-bg-gradient-end)' }}
    >
      <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-0" />

      <div className="min-h-full grid [place-items:safe_center] box-border px-4 py-10">
        <div className={`w-full relative z-10 ${cardWidth === 'xl' ? 'max-w-xl' : 'max-w-md'}`}>
          <div
            className={cardPadding}
            style={{
              background: 'var(--tiling-card-bg)',
              backdropFilter: 'blur(24px)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--tiling-card-border)',
              boxShadow: 'var(--tiling-card-shadow)',
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
