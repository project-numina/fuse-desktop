import { fileKind, formatBytes } from './helpers';

export function SelectedSourceFile({ file }: { file: File }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
      <svg
        className="h-6 w-6 shrink-0 text-[#22c55e]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">
          {file.name}
        </span>
        <span className="text-xs text-muted-foreground">
          {fileKind(file)} · {formatBytes(file.size)}
        </span>
      </span>
    </div>
  );
}
