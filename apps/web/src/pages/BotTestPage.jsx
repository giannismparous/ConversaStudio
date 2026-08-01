import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChatbotBubble } from '@dialogos-forge/chat-widget';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.jsx';
import {
  greekFallbackUiCopy,
  normalizeSuggestedQuestions,
  personalizeUiCopy,
  resolveTestUiCopy,
} from '../lib/testUiLocalize.js';

const EMPTY_UI = { welcomeMessage: '', suggestedQuestions: [] };

/** Instant copy only — returns null when Greek needs a translate API call. */
function uiCopyForBot(bot, language, botName) {
  const questions = normalizeSuggestedQuestions(bot.suggestedQuestions);
  const gender = bot.personaGender || 'neutral';
  return resolveTestUiCopy({
    welcomeMessage: bot.welcomeMessage,
    suggestedQuestions: questions,
    language,
    botName,
    personaGender: gender,
  });
}

export default function BotTestPage() {
  const { id } = useParams();
  const { username } = useAuth();
  const { locale, t } = useI18n();
  const [bot, setBot] = useState(null);
  const [error, setError] = useState('');
  // Follow the app language toggle (Greek UI → Greek welcome/chips).
  const [testLanguage, setTestLanguage] = useState(locale === 'el' ? 'el' : 'en');
  const [resetSignal, setResetSignal] = useState(0);
  const [uiCopy, setUiCopy] = useState(EMPTY_UI);
  const [uiLoading, setUiLoading] = useState(false);
  const [uiError, setUiError] = useState('');

  useEffect(() => {
    const next = locale === 'el' ? 'el' : 'en';
    setTestLanguage((prev) => {
      if (prev === next) return prev;
      setResetSignal((value) => value + 1);
      return next;
    });
  }, [locale]);

  useEffect(() => {
    api(`/bots/${id}`, { username })
      .then((data) => {
        setBot(data.bot);
      })
      .catch((err) => setError(err.message));
  }, [id, username]);

  useEffect(() => {
    if (!bot) return undefined;

    let cancelled = false;
    const gender = bot.personaGender || 'neutral';

    const applyCopy = (copy) => {
      if (!cancelled) {
        setUiCopy({
          welcomeMessage: copy.welcomeMessage || '',
          suggestedQuestions: copy.suggestedQuestions || [],
        });
      }
    };

    const instant = uiCopyForBot(bot, testLanguage, bot.name);
    if (instant) {
      applyCopy(instant);
      setUiLoading(false);
      setUiError('');
      return undefined;
    }

    if (testLanguage === 'en') {
      applyCopy({
        welcomeMessage: bot.welcomeMessage,
        suggestedQuestions: normalizeSuggestedQuestions(bot.suggestedQuestions),
      });
      setUiLoading(false);
      setUiError('');
      return undefined;
    }

    // Greek + custom English UI copy → translate (never leave English on screen).
    setUiLoading(true);
    setUiError('');
    applyCopy(greekFallbackUiCopy(bot.name, gender));
    api(`/bots/${bot.id}/localize-ui`, {
      method: 'POST',
      username,
      body: { language: 'el' },
    })
      .then((data) => {
        applyCopy(
          personalizeUiCopy(
            {
              welcomeMessage: data.welcomeMessage,
              suggestedQuestions: data.suggestedQuestions,
            },
            bot.name,
            gender
          )
        );
      })
      .catch((err) => {
        if (!cancelled) {
          setUiError(err.message || t('test.translateError'));
          applyCopy(greekFallbackUiCopy(bot.name, gender));
        }
      })
      .finally(() => {
        if (!cancelled) setUiLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bot, testLanguage, username, t]);

  const resetConversation = useCallback(() => {
    setResetSignal((value) => value + 1);
  }, []);

  const switchLanguage = useCallback(
    (language) => {
      if (!bot || language === testLanguage) return;
      const instant = uiCopyForBot(bot, language, bot.name);
      if (instant) setUiCopy(instant);
      else if (language === 'el') {
        setUiCopy(greekFallbackUiCopy(bot.name, bot.personaGender || 'neutral'));
      }
      setTestLanguage(language);
      setResetSignal((value) => value + 1);
    },
    [bot, testLanguage]
  );

  if (error) return <p className="error-text">{error}</p>;

  return (
    <div className="bot-test-page">
      <div className="topbar bot-test-topbar" style={{ marginBottom: '1rem' }}>
        <div>
          <h2 className="section-title">{t('test.title', { name: bot?.name || '…' })}</h2>
          {uiLoading && testLanguage === 'el' && (
            <p className="muted" style={{ margin: 0 }}>
              {t('test.translating')}
            </p>
          )}
        </div>

        {bot ? (
          <div className="test-toolbar">
            <div className="scrape-mode-toggle" role="group" aria-label={t('test.languageGroup')}>
              <button
                type="button"
                className={`mode-chip${testLanguage === 'en' ? ' active' : ''}`}
                onClick={() => switchLanguage('en')}
              >
                {t('common.english')}
              </button>
              <button
                type="button"
                className={`mode-chip${testLanguage === 'el' ? ' active' : ''}`}
                onClick={() => switchLanguage('el')}
                disabled={uiLoading}
              >
                {t('common.greek')}
              </button>
            </div>
            <button type="button" className="btn btn-ghost test-reset-btn" onClick={resetConversation}>
              {t('test.reset')}
            </button>
          </div>
        ) : null}
      </div>

      {bot?.status && bot.status !== 'ready' && (
        <p className="error-text">
          {t('test.statusWarning', { status: bot.status })}
        </p>
      )}

      {uiError && <p className="error-text">{uiError}</p>}

      {!bot ? (
        <p className="muted">{t('test.loadingBot')}</p>
      ) : !uiCopy.welcomeMessage && uiLoading ? (
        <p className="muted">{t('test.translating')}</p>
      ) : (
        <ChatbotBubble
          botName={bot.name}
          theme={bot.theme}
          iconUrl={bot.iconUrl}
          welcomeMessage={uiCopy.welcomeMessage}
          suggestedQuestions={uiCopy.suggestedQuestions}
          autoOpenDelayMs={1200}
          resetSignal={resetSignal}
          contentKey={`${resetSignal}-${testLanguage}-${uiCopy.welcomeMessage}`}
          inputPlaceholder={testLanguage === 'el' ? 'Ρωτήστε οτιδήποτε…' : 'Ask anything...'}
          sourcesLabel={testLanguage === 'el' ? 'Πηγές' : 'Sources'}
          showSources={bot.sourceCitations?.showSources !== false}
          onSend={async ({ message, history }) =>
            api(`/bots/${bot.id}/chat`, {
              method: 'POST',
              username,
              body: { message, history },
            })
          }
        />
      )}
    </div>
  );
}
