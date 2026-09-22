import { Input } from '@/components/ui/input';

import { MAX_SOURCE_NAME_CHARACTERS } from './helpers';

interface SourceNameFieldProps {
  value: string;
  trimmedName: string;
  collision: boolean;
  tooLong: boolean;
  error?: string | null;
  onChange: (value: string) => void;
  onSubmit?: () => void;
}

export function SourceNameField(props: SourceNameFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="source-name-input" className="text-xs font-semibold text-muted-foreground">
          Name
        </label>
        <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
          {props.value.length} / {MAX_SOURCE_NAME_CHARACTERS}
        </span>
      </div>
      <Input
        id="source-name-input"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder="Source name"
        maxLength={MAX_SOURCE_NAME_CHARACTERS}
        aria-invalid={props.collision || props.tooLong}
        className="focus-visible:border-primary focus-visible:ring-0 aria-invalid:ring-0"
        onKeyDown={props.onSubmit ? (event) => {
          if (event.key === 'Enter') props.onSubmit?.();
        } : undefined}
      />
      {props.collision ? (
        <p className="mt-2 text-sm text-destructive">
          A source named "{props.trimmedName}" already exists.
        </p>
      ) : props.tooLong ? (
        <p className="mt-2 text-sm text-destructive">
          Source names must be {MAX_SOURCE_NAME_CHARACTERS} characters or fewer.
        </p>
      ) : props.error ? (
        <p className="mt-2 text-sm text-destructive">{props.error}</p>
      ) : null}
    </div>
  );
}
