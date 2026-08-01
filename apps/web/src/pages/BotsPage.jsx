import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { DefaultAvatar } from '@dialogos-forge/chat-widget';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { useConfirm } from '../lib/useConfirm.jsx';
import { getEmbedSnippet } from '../lib/embedSnippet.js';
import CheckIcon from '../components/CheckIcon.jsx';
import CodeIcon from '../components/CodeIcon.jsx';
import DuplicateIcon from '../components/DuplicateIcon.jsx';
import TrashIcon from '../components/TrashIcon.jsx';
import { getSetupBotId, clearHasDashboardBot } from '../lib/wizardSession.js';

const BOT_LEAVE_MS = 380;

function StatusBadge({ status }) {
  const { t } = useI18n();
  const key = status || 'draft';
  if (key === 'draft') return null;
  return <span className={`badge badge-${key}`}>{t(`status.${key}`)}</span>;
}

function BotListIcon({ bot }) {
  const accent = bot.theme?.accent || '#d97757';
  return (
    <div className="bot-item-icon" aria-hidden="true">
      {bot.iconUrl ? (
        <img src={bot.iconUrl} alt="" />
      ) : (
        <DefaultAvatar size={44} accent={accent} />
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bot-stat">
      <span className="bot-stat-value">{value}</span>
      <span className="bot-stat-label">{label}</span>
    </div>
  );
}

function BotEmbedButton({ botId }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const snippet = getEmbedSnippet(botId);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <button
        type="button"
        className="bot-item-embed-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <CodeIcon className="bot-item-embed-icon" />
        <span>{t('bots.embed')}</span>
      </button>
      {open
        ? createPortal(
            <div
              className="confirm-backdrop"
              role="presentation"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) close();
              }}
            >
              <div
                className="embed-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="bot-embed-title"
              >
                <div className="embed-modal-head">
                  <div>
                    <h2 id="bot-embed-title" className="confirm-dialog-title">
                      {t('bots.embed')}
                    </h2>
                    <p className="confirm-dialog-message">{t('bots.embedHelp')}</p>
                  </div>
                  <button
                    type="button"
                    className="icon-btn embed-modal-close"
                    onClick={close}
                    aria-label={t('common.close')}
                  >
                    ×
                  </button>
                </div>
                <ol className="embed-steps">
                  <li>{t('bots.embedStep1')}</li>
                  <li>{t('bots.embedStep2')}</li>
                  <li>{t('bots.embedStep3')}</li>
                </ol>
                <pre className="code-block embed-code">{snippet}</pre>
                <div className="embed-modal-actions">
                  <button
                    type="button"
                    className={`btn btn-accent btn-with-icon${copied ? ' embed-copy-done' : ''}`}
                    onClick={copy}
                    aria-live="polite"
                  >
                    {copied ? (
                      <>
                        <CheckIcon />
                        {t('common.copied')}
                      </>
                    ) : (
                      t('bots.embedCopy')
                    )}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export default function BotsPage() {
  const { username, ready, user } = useAuth();
  const { t, dateLocale } = useI18n();
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirm();
  const [bots, setBots] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [setupBotId, setSetupBotId] = useState(() => getSetupBotId());
  const [enteringIds, setEnteringIds] = useState(() => new Set());
  const [leavingIds, setLeavingIds] = useState(() => new Set());
  const slotRefs = useRef(new Map());
  const knownIdsRef = useRef(new Set());
  const leaveTimersRef = useRef(new Map());
  const reduceMotionRef = useRef(false);

  useEffect(() => {
    reduceMotionRef.current = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)'
    )?.matches;
  }, []);

  const load = async ({ soft = false } = {}) => {
    if (!soft) setLoading(true);
    setError('');
    try {
      const data = await api('/bots', { username });
      const next = data.bots || [];
      setBots(next);
      if (next.length === 0) clearHasDashboardBot();
      setSetupBotId(getSetupBotId());
    } catch (err) {
      setError(err.message);
    } finally {
      if (!soft) setLoading(false);
    }
  };

  useEffect(() => {
    if (!ready || !user) return;
    load();
  }, [ready, user?.id, username]);

  const listedBots = useMemo(() => {
    // Hide unfinished create-wizard sessions (listed=false). Duplicate drafts stay listed.
    let list = (bots || []).filter((b) => b.listed !== false);
    if (setupBotId) list = list.filter((b) => b.id !== setupBotId);
    return list;
  }, [bots, setupBotId]);

  // Animate cards in when they first appear on the dashboard.
  useEffect(() => {
    const nextIds = listedBots.map((b) => b.id);
    const known = knownIdsRef.current;
    const fresh = nextIds.filter((id) => !known.has(id) && !leavingIds.has(id));
    nextIds.forEach((id) => known.add(id));
    // Drop ids that are gone (deleted / filtered) so a re-created bot can enter again.
    for (const id of [...known]) {
      if (!nextIds.includes(id) && !leavingIds.has(id)) known.delete(id);
    }
    if (!fresh.length) return undefined;
    setEnteringIds((prev) => {
      const next = new Set(prev);
      fresh.forEach((id) => next.add(id));
      return next;
    });
    return undefined;
  }, [listedBots, leavingIds]);

  useEffect(
    () => () => {
      for (const timer of leaveTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      leaveTimersRef.current.clear();
    },
    []
  );

  const showInvite = !loading && listedBots.length === 0;
  const showListHeader = !loading && listedBots.length > 0;

  const clearEntering = (id) => {
    setEnteringIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const finishLeave = (id) => {
    const timer = leaveTimersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      leaveTimersRef.current.delete(id);
    }
    knownIdsRef.current.delete(id);
    setBots((prev) => {
      const next = prev.filter((b) => b.id !== id);
      if (next.length === 0) clearHasDashboardBot();
      return next;
    });
    setLeavingIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    const el = slotRefs.current.get(id);
    if (el) {
      el.style.height = '';
      el.style.marginBottom = '';
    }
  };

  const duplicate = async (id) => {
    try {
      const data = await api(`/bots/${id}/duplicate`, { method: 'POST', username });
      navigate(`/bots/${data.bot.id}`);
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (id) => {
    if (leavingIds.has(id)) return;
    const bot = bots.find((b) => b.id === id);
    const ok = await confirm({
      title: t('bots.deleteTitle'),
      message: bot
        ? t('bots.deleteMessage', { name: bot.name })
        : t('bots.deleteMessageGeneric'),
      confirmLabel: t('bots.deleteConfirm'),
      cancelLabel: t('common.cancel'),
      danger: true,
    });
    if (!ok) return;

    const slot = slotRefs.current.get(id);
    if (slot && !reduceMotionRef.current) {
      const height = slot.getBoundingClientRect().height;
      slot.style.height = `${height}px`;
      slot.style.marginBottom = getComputedStyle(slot).marginBottom;
      void slot.offsetHeight;
    }

    setLeavingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    clearEntering(id);

    requestAnimationFrame(() => {
      const el = slotRefs.current.get(id);
      if (el && !reduceMotionRef.current) {
        el.style.height = '0px';
        el.style.marginBottom = '0px';
      }
    });

    const settle = () => finishLeave(id);
    if (reduceMotionRef.current) {
      settle();
    } else {
      const timer = window.setTimeout(settle, BOT_LEAVE_MS);
      leaveTimersRef.current.set(id, timer);
    }

    try {
      await api(`/bots/${id}`, { method: 'DELETE', username });
    } catch (err) {
      const timer = leaveTimersRef.current.get(id);
      if (timer) {
        window.clearTimeout(timer);
        leaveTimersRef.current.delete(id);
      }
      const el = slotRefs.current.get(id);
      if (el) {
        el.style.height = '';
        el.style.marginBottom = '';
      }
      setLeavingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setError(err.message);
      void load({ soft: true });
    }
  };

  return (
    <div className={`bots-page${showInvite ? ' bots-page--empty' : ''}`}>
      {showListHeader && (
        <div className="bots-page-header">
          <div>
            <h2 className="section-title">{t('bots.title')}</h2>
          </div>
          <Link className="btn btn-accent" to="/bots/new">
            {t('bots.new')}
          </Link>
        </div>
      )}

      {error && (
        <div className="login-error" role="alert">
          {error}
        </div>
      )}

      {loading && (
        <div className="bots-loading">
          <span className="app-loading-spinner" aria-hidden="true" />
          <span className="muted">{t('common.loading')}</span>
        </div>
      )}

      {showInvite && (
        <div className="bots-empty bots-empty--invite">
          <div className="bots-invite">
            <h3 className="bots-invite-title">{t('bots.inviteTitle')}</h3>
            <Link className="btn btn-accent bots-invite-cta" to="/bots/new">
              {t('bots.inviteCta')}
            </Link>
          </div>
        </div>
      )}

      {!loading && listedBots.length > 0 && (
        <div className="bot-stack">
          {listedBots.map((bot, index) => {
            const sources = bot.sourceCount ?? 0;
            const chunks = bot.chunkCount || 0;
            const canTest = Boolean(bot.lastBuiltAt) || chunks > 0;
            const entering = enteringIds.has(bot.id);
            const leaving = leavingIds.has(bot.id);
            const enterDelay = entering ? Math.min(index, 8) * 45 : 0;
            return (
              <div
                key={bot.id}
                className={`bot-item-slot${entering ? ' is-entering' : ''}${
                  leaving ? ' is-leaving' : ''
                }`}
                style={entering ? { animationDelay: `${enterDelay}ms` } : undefined}
                ref={(el) => {
                  if (el) slotRefs.current.set(bot.id, el);
                  else slotRefs.current.delete(bot.id);
                }}
                onAnimationEnd={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (enteringIds.has(bot.id)) clearEntering(bot.id);
                }}
              >
                <article className="bot-item">
                  <div className="bot-item-top">
                    <div className="bot-item-heading">
                      <BotListIcon bot={bot} />
                      <h3 className="bot-item-name">{bot.name}</h3>
                      <StatusBadge status={bot.status} />
                    </div>
                    <div className="bot-stats">
                      <Stat
                        value={sources}
                        label={sources === 1 ? t('bots.source') : t('bots.sources')}
                      />
                      <Stat
                        value={chunks}
                        label={chunks === 1 ? t('bots.chunk') : t('bots.chunks')}
                      />
                    </div>
                  </div>

                  {bot.lastBuiltAt && (
                    <p className="muted bot-item-meta">
                      {t('bots.lastBuilt', {
                        date: new Date(bot.lastBuiltAt).toLocaleString(dateLocale),
                      })}
                    </p>
                  )}
                  {bot.buildError && <p className="error-text">{bot.buildError}</p>}

                  <div className="bot-item-footer">
                    <Link className="btn btn-accent bot-edit-btn" to={`/bots/${bot.id}`}>
                      {t('bots.edit')}
                    </Link>
                    {canTest && (
                      <Link className="btn btn-outline" to={`/bots/${bot.id}/test`}>
                        {t('bots.test')}
                      </Link>
                    )}
                    <div className="bot-item-links">
                      <BotEmbedButton botId={bot.id} />
                      <button
                        type="button"
                        className="bot-item-link-action"
                        onClick={() => duplicate(bot.id)}
                        disabled={leaving}
                      >
                        <DuplicateIcon className="bot-item-link-icon" />
                        <span>{t('common.duplicate')}</span>
                      </button>
                      <button
                        type="button"
                        className="bot-item-link-action danger-link"
                        onClick={() => remove(bot.id)}
                        disabled={leaving}
                      >
                        <TrashIcon className="bot-item-link-icon" />
                        <span>{t('common.delete')}</span>
                      </button>
                    </div>
                  </div>
                </article>
              </div>
            );
          })}
        </div>
      )}
      {dialog}
    </div>
  );
}
