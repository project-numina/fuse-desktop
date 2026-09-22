/**
 * Empty-state placeholder for the Lean view when no file is selected.
 *
 * Purely presentational; rendered by the Lean view mode in place of the code
 * pane until the user
 * picks a file from the file tree on the right.
 */
function LeanEmptyState() {
  return (
    <div className="flex w-full items-start justify-center px-6 pb-6 pt-[clamp(3.5rem,34vh,40rem)]">
      <div className="flex max-w-xs flex-col items-center gap-3 text-center">
        <h2 className="m-0 text-lg font-semibold text-foreground">
          Open a file
        </h2>
        <p className="m-0 text-sm leading-relaxed text-muted-foreground">
          Browse your repository from the panel on the right. Lean files include
          proof goals and diagnostics; documents and other files open here too.
        </p>
      </div>
    </div>
  );
}

export default LeanEmptyState;
