import React from 'react';

const META_BY_EXT = {
  pdf: { mark: 'PDF', tone: 'pdf' },
  txt: { mark: 'TXT', tone: 'txt' },
  text: { mark: 'TXT', tone: 'txt' },
  md: { mark: 'MD', tone: 'md' },
  markdown: { mark: 'MD', tone: 'md' },
};

function extFromSource(source) {
  const name = String(source?.label || source?.title || '').toLowerCase();
  const match = name.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
  if (match) return match[1];
  const type = String(source?.type || '').toLowerCase();
  if (type === 'pdf') return 'pdf';
  if (type === 'txt' || type === 'text') return 'txt';
  return '';
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

function LinkGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path
        d="M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 0 0-7.07-7.07L10 5.93"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M14 11a5 5 0 0 0-7.07 0L5.52 12.41a5 5 0 0 0 7.07 7.07L14 18.07"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** File / link glyph for chat citation rows (mirrors knowledge FileTypeIcon). */
export default function SourceTypeIcon({ source }) {
  const kind = source?.kind || (source?.type === 'url' ? 'url' : 'file');
  if (kind === 'url') {
    return (
      <span className="df-source-icon df-source-icon--link" aria-hidden="true">
        <LinkGlyph />
      </span>
    );
  }
  if (kind === 'key_facts' || source?.type === 'key_facts') {
    return (
      <span className="df-source-icon df-source-icon--doc" aria-hidden="true">
        <FileGlyph mark="•" />
      </span>
    );
  }

  const ext = extFromSource(source);
  const meta = META_BY_EXT[ext] || { mark: 'DOC', tone: 'doc' };
  return (
    <span className={`df-source-icon df-source-icon--${meta.tone}`} aria-hidden="true">
      <FileGlyph mark={meta.mark} />
    </span>
  );
}
