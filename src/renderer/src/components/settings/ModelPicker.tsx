import { useEffect, useState } from 'react';
import type { ProviderId } from '@shared/agent-events';
import { MODEL_SUGGESTIONS } from '@shared/model-suggestions';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

/** Shared model menu; custom names commit on blur or Enter, never per keystroke. */
export function ModelPicker({ id, provider, value, onCommit, disabled = false }: {
  id: string;
  provider: ProviderId;
  value: string;
  onCommit: (model: string) => void | Promise<unknown>;
  disabled?: boolean;
}) {
  const [editingCustom, setEditingCustom] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const suggestions = MODEL_SUGGESTIONS[provider];
  const isCustom = value !== '' && !suggestions.includes(value);
  return <>
    <Select id={id} ariaLabel="Model" disabled={disabled}
      value={editingCustom || isCustom ? '__custom__' : value}
      onValueChange={(model) => {
        setEditingCustom(model === '__custom__');
        if (model === '__custom__') setDraft(isCustom ? value : '');
        else void onCommit(model);
      }}
      options={[
        { value: '', label: 'CLI default' },
        ...suggestions.map(model => ({ value: model, label: model })),
        { value: '__custom__', label: 'Custom model…' },
      ]}
      className="w-full max-w-sm px-3.5 py-2" />
    {(editingCustom || isCustom) && <div className="mt-3">
      <label htmlFor={`${id}-custom`} className="mb-1.5 block text-sm font-medium text-foreground/80">Custom model</label>
      <Input id={`${id}-custom`} value={draft} placeholder="Model name" disabled={disabled}
        autoComplete="off" spellCheck={false}
        className="h-auto max-w-sm rounded-md bg-card px-3 py-2"
        onChange={event => setDraft(event.target.value)}
        onBlur={() => { if (!disabled && draft.trim() !== value) void onCommit(draft.trim()); }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} />
    </div>}
  </>;
}
