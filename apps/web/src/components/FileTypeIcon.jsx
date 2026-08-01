import React from 'react';

export function extFromSource(source) {
  const name = String(source?.label || source?.uri || '').toLowerCase();
  const match = name.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
  if (match) return match[1];
  if (source?.type === 'pdf') return 'pdf';
  if (source?.type === 'txt') return 'txt';
  return '';
}

const META_BY_EXT = {
  pdf: { mark: 'PDF', tone: 'pdf', label: 'PDF' },
  txt: { mark: 'TXT', tone: 'txt', label: 'TXT' },
  text: { mark: 'TXT', tone: 'txt', label: 'TXT' },
  md: { mark: 'MD', tone: 'md', label: 'Markdown' },
  markdown: { mark: 'MD', tone: 'md', label: 'Markdown' },
};

export function hasKnownFileTypeIcon(source) {
  return Boolean(META_BY_EXT[extFromSource(source)]);
}

/** Filename for UI: drop extension when a typed icon covers it; keep it for the default doc icon. */
export function fileSourceDisplayName(source) {
  const raw = String(source?.label || source?.uri || '').trim();
  if (!raw) return raw;
  if (!hasKnownFileTypeIcon(source)) return raw;
  return raw.replace(/\.[a-z0-9]+$/i, '');
}

function FileGlyph({ mark }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path
        fill="currentColor"
        opacity="0.92"
        d="M8 2h11l7 7v19a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
      />
      <path fill="rgba(255,255,255,0.92)" d="M19 2v6a1 1 0 0 0 1 1h6" />
      <text
        x="16"
        y="23"
        textAnchor="middle"
        fill="rgba(255,255,255,0.96)"
        fontSize="8"
        fontWeight="700"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {mark}
      </text>
    </svg>
  );
}

/**
 * Small file-type glyph for uploaded knowledge sources.
 * Falls back to a generic document icon.
 */
export default function FileTypeIcon({ source, className = '' }) {
  const ext = extFromSource(source);
  const meta = META_BY_EXT[ext] || { mark: 'DOC', tone: 'doc', label: 'File' };

  return (
    <span
      className={`file-type-icon file-type-icon--${meta.tone}${className ? ` ${className}` : ''}`}
      title={meta.label}
      aria-label={meta.label}
    >
      <FileGlyph mark={meta.mark} />
    </span>
  );
}
