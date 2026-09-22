export type HeaderIconName = 'sessions' | 'guide' | 'chats' | 'settings' | 'system' | 'light' | 'dark';

/** Compact monochrome pictograms with clean, unshaded outlines. */
export default function HeaderIcon({ name }: { name: HeaderIconName }) {
  const accent = 'currentColor';
  return (
    <svg className="size-[21px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === 'sessions' && <>
        <circle cx="11" cy="13" r="8" />
        <path d="M11 8v5l3 2M8 2h6m-3 0v3" />
        <path d="m17 4 3 3" stroke={accent} strokeWidth="2.5" />
        <circle cx="11" cy="13" r="1" fill="currentColor" stroke="none" />
      </>}
      {name === 'guide' && <>
        <path d="M5 3h14v18H6a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2Z" />
        <path d="M6 3v14m13 0H6a2 2 0 0 0 0 4m2-2h8" />
        <path d="M11 3h5v8l-2.5-1.7L11 11Z" fill={accent} stroke={accent} strokeWidth="1.2" />
      </>}
      {name === 'chats' && <>
        <path d="M18 10h1a2 2 0 0 1 2 2v9l-4-3h-7a2 2 0 0 1-2-2v-2" />
        <path d="M5 3h11a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7l-4 3V5a2 2 0 0 1 2-2Z" fill="var(--card)" />
        <path d="M7 7h7m-7 3h4" stroke={accent} />
      </>}
      {name === 'settings' && <>
        <path d="m9.5 3-.6 2.4-2 .9-2.3-.7-2.4 4.1 1.8 1.7v2.3l-1.8 1.7 2.4 4.1 2.3-.7 2 .9.6 2.3h5l.6-2.3 2-.9 2.3.7 2.4-4.1-1.8-1.7v-2.3l1.8-1.7-2.4-4.1-2.3.7-2-.9-.6-2.4Z" />
        <circle cx="12" cy="12.5" r="3.5" />
      </>}
      {name === 'system' && <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none" />
      </>}
      {name === 'light' && <>
        <path d="M7 15a5 5 0 0 1 10 0M3 15h18M6 19h12" />
        <path d="M12 3v3M4.2 7.2l2 2m11.6 0 2-2" />
      </>}
      {name === 'dark' && <>
        <path d="M19.5 15A8 8 0 0 1 9 4.5 8 8 0 1 0 19.5 15Z" />
        <path d="M17 3v4m-2-2h4" stroke={accent} />
      </>}
    </svg>
  );
}
