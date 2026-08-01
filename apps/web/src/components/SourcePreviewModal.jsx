import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../lib/i18n.jsx';
import { fileSourceDisplayName } from './FileTypeIcon.jsx';

export default function SourcePreviewModal({ preview, onClose }) {
  const { t } = useI18n();

  useEffect(() => {
    if (!preview) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [preview, onClose]);

  if (!preview || typeof document === 'undefined') return null;

  const label =
    preview.source.type === 'pdf' || preview.source.type === 'txt'
      ? fileSourceDisplayName(preview.source) || preview.source.label
      : preview.source.label;

  return createPortal(
    <div
      className="preview-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t('editor.previewAria', { label: label || preview.source.label })}
      onClick={onClose}
    >
      <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="preview-modal-head">
          <div className="preview-modal-title">
            <strong>{label || preview.source.label}</strong>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              {preview.source.type}
              {preview.kind === 'url' ? ` · ${preview.url}` : ''}
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('editor.closePreview')}
          </button>
        </div>
        <div className="preview-modal-body">
          {preview.kind === 'loading' && (
            <div className="preview-loading">
              <span className="spinner" aria-hidden="true" />
              <span className="muted">{t('common.loading')}</span>
            </div>
          )}
          {preview.kind === 'pdf' && (
            <iframe title={label || preview.source.label} src={preview.url} className="preview-frame" />
          )}
          {preview.kind === 'text' && <pre className="preview-text">{preview.text}</pre>}
          {preview.kind === 'url' && (
            <div className="preview-url">
              <p className="muted">{t('editor.previewOpenUrl')}</p>
              <a href={preview.url} target="_blank" rel="noreferrer" className="btn btn-accent">
                {t('editor.openInBrowser')}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
