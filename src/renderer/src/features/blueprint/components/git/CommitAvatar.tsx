import { useEffect, useState } from 'react';

import { actorInitial } from '@/features/blueprint/lib/commit-history';

/**
 * Commit author avatar: renders the remote avatar image, falling back to the
 * actor's initial in a tinted circle when there is no URL or the image fails
 * to load.
 *
 * Self-contained so sibling views can reuse it. A remote URL that 404s or
 * errors falls back to the initials placeholder rather than a broken-image
 * glyph; the failure state is reset whenever `avatarUrl` changes so a fresh
 * commit's avatar gets a chance to load.
 */
export interface CommitAvatarProps {
  /** Remote avatar URL, or null to render the initials fallback. */
  avatarUrl: string | null;
  /** Display name used for the initial and the image `alt` text. */
  actor: string;
}

function CommitAvatar({ avatarUrl, actor }: CommitAvatarProps) {
  const [failed, setFailed] = useState(false);

  // Reset the failure state when the URL changes so a fresh commit's avatar
  // gets a chance to load.
  useEffect(() => {
    setFailed(false);
  }, [avatarUrl]);

  const usable = !!avatarUrl && !failed;

  return (
    <span
      className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--numina-surface-sunken)] text-[var(--text-muted)]"
      aria-hidden="true"
    >
      {usable ? (
        <img
          src={avatarUrl ?? undefined}
          alt={actor}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="text-xs font-semibold">{actorInitial(actor)}</span>
      )}
    </span>
  );
}

export default CommitAvatar;
