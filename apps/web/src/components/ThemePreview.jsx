import React, { useMemo } from 'react';
import { DefaultAvatar } from '@dialogos-forge/chat-widget';
import { useI18n } from '../lib/i18n.jsx';
import {
  englishFallbackUiCopy,
  greekFallbackUiCopy,
  normalizeSuggestedQuestions,
  resolveTestUiCopy,
} from '../lib/testUiLocalize.js';

function safeHex(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function luminance(hex) {
  const h = safeHex(hex, '#141413').slice(1);
  const toLin = (c) => {
    const v = parseInt(c, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * toLin(h.slice(0, 2)) +
    0.7152 * toLin(h.slice(2, 4)) +
    0.0722 * toLin(h.slice(4, 6))
  );
}

function onColor(bg) {
  return luminance(bg) > 0.55 ? '#141413' : '#faf9f5';
}

export default function ThemePreview({
  theme = {},
  botName = '',
  iconUrl,
  welcomeMessage = '',
  suggestedQuestions = [],
  personaGender = 'neutral',
}) {
  const { locale, t } = useI18n();
  const panelBg = safeHex(theme.panelBg, '#faf9f5');
  const accent = safeHex(theme.accent, '#d97757');
  const launcherBg = safeHex(theme.launcherBg, '#ffffff');
  const textColor = safeHex(theme.textColor, '#141413');
  const onText = onColor(textColor);

  const displayName = botName?.trim() || t('editor.previewAssistant');

  const localized = useMemo(() => {
    const language = locale === 'el' ? 'el' : 'en';
    const questions = normalizeSuggestedQuestions(suggestedQuestions);
    const instant = resolveTestUiCopy({
      welcomeMessage,
      suggestedQuestions: questions,
      language,
      botName: displayName,
      personaGender,
    });
    if (instant) return instant;
    // Wrong-language stored copy: never keep Greek on English (or vice versa).
    return language === 'el'
      ? greekFallbackUiCopy(displayName, personaGender)
      : englishFallbackUiCopy(displayName);
  }, [locale, welcomeMessage, suggestedQuestions, displayName, personaGender]);

  const welcomeRaw =
    String(localized.welcomeMessage || '').trim() || t('editor.previewWelcome');
  const welcome = welcomeRaw.length > 72 ? `${welcomeRaw.slice(0, 71)}…` : welcomeRaw;
  const sampleChip =
    (localized.suggestedQuestions || []).map((q) => String(q || '').trim()).find(Boolean) ||
    t('editor.previewSampleQuestion');

  return (
    <div className="theme-preview" aria-hidden="true">
      <div className="theme-preview-caption">{t('editor.livePreview')}</div>
      <div className="theme-preview-stage">
        <div
          className="theme-preview-panel"
          style={{
            '--tp-panel': panelBg,
            '--tp-accent': accent,
            '--tp-text': textColor,
            '--tp-on-text': onText,
          }}
        >
          <div className="theme-preview-header">
            <div className="theme-preview-avatar">
              {iconUrl ? (
                <img src={iconUrl} alt="" />
              ) : (
                <DefaultAvatar size={22} accent={accent} />
              )}
            </div>
            <span className="theme-preview-name">{displayName}</span>
          </div>

          <div className="theme-preview-body">
            <p className="theme-preview-welcome">{welcome}</p>
            <div className="theme-preview-chips">
              <span className="theme-preview-chip">{sampleChip}</span>
            </div>
            <div className="theme-preview-user-bubble">{t('editor.previewUserBubble')}</div>
          </div>

          <div className="theme-preview-footer">
            <span className="theme-preview-input">{t('editor.previewInput')}</span>
            <span className="theme-preview-send">
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M8 3V13M8 3L4.5 6.5M8 3L11.5 6.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </div>
        </div>

        <div
          className="theme-preview-launcher"
          style={{
            '--tp-launcher': launcherBg,
            '--tp-accent': accent,
            '--tp-text': textColor,
          }}
        >
          <div className="theme-preview-launcher-avatar">
            {iconUrl ? (
              <img src={iconUrl} alt="" />
            ) : (
              <DefaultAvatar size={18} accent={accent} />
            )}
          </div>
          <span className="theme-preview-launcher-text">
            {t('editor.previewLauncherAsk', { name: displayName })}
          </span>
          <span className="theme-preview-launcher-send">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M8 3V13M8 3L4.5 6.5M8 3L11.5 6.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>
      </div>
    </div>
  );
}
