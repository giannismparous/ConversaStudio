import React, { useRef, useState } from 'react';
import { DefaultAvatar } from '@dialogos-forge/chat-widget';
import { useI18n } from '../lib/i18n.jsx';
import IconCropModal from './IconCropModal.jsx';

export default function BotIconField({
  iconUrl,
  accent = '#c45f2f',
  uploading = false,
  onUpload,
  onRemove,
}) {
  const { t } = useI18n();
  const inputRef = useRef(null);
  const [cropFile, setCropFile] = useState(null);

  const hasCustom = Boolean(iconUrl);

  const pickFile = () => {
    if (uploading) return;
    inputRef.current?.click();
  };

  const onFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    setCropFile(file);
  };

  const onCropped = async (blob) => {
    setCropFile(null);
    const file = new File([blob], 'icon.png', { type: 'image/png' });
    await onUpload(file);
  };

  return (
    <div className="bot-icon-field">
      <label>{t('icon.label')}</label>
      <div className="bot-icon-row">
        <div className="bot-icon-preview" aria-hidden="true">
          {hasCustom ? (
            <img src={iconUrl} alt="" />
          ) : (
            <DefaultAvatar size={72} accent={accent} />
          )}
        </div>
        <div className="bot-icon-meta">
          <div className="bot-icon-status">
            {uploading
              ? t('icon.uploading')
              : hasCustom
                ? t('icon.custom')
                : t('icon.default')}
          </div>
          <p className="muted" style={{ margin: '0.2rem 0 0.65rem', fontSize: '0.82rem' }}>
            {hasCustom ? t('icon.customHelp') : t('icon.defaultHelp')}
          </p>
          <div className="bot-icon-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={uploading}
              onClick={pickFile}
            >
              {hasCustom ? t('icon.change') : t('icon.upload')}
            </button>
            {hasCustom && (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={uploading}
                onClick={onRemove}
              >
                {t('icon.remove')}
              </button>
            )}
          </div>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={onFile}
      />

      {cropFile && (
        <IconCropModal
          file={cropFile}
          accent={accent}
          onCancel={() => setCropFile(null)}
          onCropped={onCropped}
        />
      )}
    </div>
  );
}
