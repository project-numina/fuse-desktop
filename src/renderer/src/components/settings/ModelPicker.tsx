import { useEffect, useState } from 'react';
import type { ProviderId } from '@shared/agent-events';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useProviderModels } from '@/hooks/use-provider-models';

/**
 * Shared model menu listing what the installed CLI itself offers, so new
 * models appear without an app update. Custom names commit on blur or Enter,
 * never per keystroke.
 */
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
  const { status, models } = useProviderModels(provider);
  // Until the CLI answers, a saved model is shown as itself rather than as custom.
  const isCustom = value !== '' && status !== 'loading' && !models.some(model => model.value === value);
  const options = [
    { value: '', label: 'CLI default' },
    ...models.map(model => ({ value: model.value, label: model.label, description: model.description })),
    ...(status === 'loading' && value !== '' ? [{ value, label: value }] : []),
    { value: '__custom__', label: 'Custom model…' },
  ];
  return <>
    <Select id={id} ariaLabel="Model" disabled={disabled}
      value={editingCustom || isCustom ? '__custom__' : value}
      onValueChange={(model) => {
        setEditingCustom(model === '__custom__');
        if (model === '__custom__') setDraft(isCustom ? value : '');
        else void onCommit(model);
      }}
      options={options}
      className="w-full max-w-sm px-3.5 py-2" />
    {status !== 'ready' && <p role="status" className="mt-2 text-xs text-muted-foreground">
      {status === 'loading' ? 'Loading models…' : 'Could not load models. Use CLI default or enter a custom model.'}
    </p>}
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
