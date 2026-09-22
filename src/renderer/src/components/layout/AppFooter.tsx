/** Global app footer. The hosted service's legal links do not apply locally. */
export default function AppFooter({ className }: { className?: string }) {
  return (
    <footer
      className={`px-6 pt-4 pb-6 text-center text-xs text-muted-foreground flex flex-col items-center gap-1 flex-shrink-0 ${className ?? ''}`}
    >
      <div className="flex items-center gap-2">
        <span>&copy; 2026 Project Numina</span>
      </div>
    </footer>
  );
}
