import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../lib/i18n.jsx';
import { greekBuildNameVars } from '../lib/testUiLocalize.js';
import {
  BUILD_IMMERSIVE_EXIT_MS,
  BUILD_MIN_VISIBLE_ADAPTIVE_MS,
  BUILD_MIN_VISIBLE_FULL_MS,
  MAX_BUILD_FLOATERS,
  MAX_BUILD_FLOATERS_ADAPTIVE,
  formatBuildMessage,
  makeFloaterMotion,
  pickLatestFloaterLine,
  pushBuildLogEntry,
  scatterFloaterPosition,
  setBuildImmersive,
  setBuildImmersiveExit,
  splitIntoChunkLines,
} from '../lib/buildImmersive.js';

/**
 * Full-screen build experience (same language/feel as the create wizard).
 * variant "adaptive" is lighter: Updating title, fewer floaters, shorter hold.
 */
export default function BuildImmersiveOverlay({
  active,
  variant = 'full',
  botName,
  personaGender = 'neutral',
  job,
  onComplete,
  onError,
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState([]);
  const [driftTexts, setDriftTexts] = useState([]);

  const logSeqRef = useRef(0);
  const lastMsgRef = useRef('');
  const lastSnippetRef = useRef('');
  const progressTargetRef = useRef(0);
  const startedAtRef = useRef(0);
  const finishLockRef = useRef(false);
  const driftBandRef = useRef(0);
  const lastDriftRef = useRef('');
  const driftPoolRef = useRef([]);
  const driftPositionsRef = useRef([]);
  const exitTimerRef = useRef(0);
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  onCompleteRef.current = onComplete;
  onErrorRef.current = onError;

  const isAdaptive = variant === 'adaptive';
  const displayName = String(botName || '').trim() || 'DialogosAI';
  const nameVars = greekBuildNameVars(displayName, personaGender);
  const title = isAdaptive
    ? t('wizard.buildUpdateTitle', nameVars)
    : t('wizard.buildLiveTitle', nameVars);

  const spawnDrift = (forcedLine) => {
    if (forcedLine) {
      const cleaned = String(forcedLine)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 96);
      if (cleaned.length >= 8) {
        const prev = driftPoolRef.current || [];
        driftPoolRef.current = [cleaned, ...prev.filter((l) => l !== cleaned)].slice(0, 80);
      }
    }
    const line =
      (forcedLine &&
        String(forcedLine)
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 96)) ||
      pickLatestFloaterLine(driftPoolRef.current, lastDriftRef.current);
    if (!line || line.length < 8) return;
    lastDriftRef.current = line;

    const id = `df-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const band = driftBandRef.current;
    driftBandRef.current += 1;
    const pos = scatterFloaterPosition(band, driftPositionsRef.current);
    const motion = makeFloaterMotion(pos, { adaptive: isAdaptive });
    const item = {
      id,
      text: line,
      left: pos.left,
      top: pos.top,
      ...motion,
    };

    setDriftTexts((prev) => {
      const cap = isAdaptive ? MAX_BUILD_FLOATERS_ADAPTIVE : MAX_BUILD_FLOATERS;
      // Wait for natural fade — don't yank old lines off for new ones.
      if (prev.length >= cap) return prev;
      const next = [...prev, item];
      driftPositionsRef.current = next.map((d) => ({ left: d.left, top: d.top }));
      const fadeMs = motion.life + 120 + Math.floor(Math.random() * 400);
      window.setTimeout(() => {
        setDriftTexts((p) => {
          const filtered = p.filter((d) => d.id !== id);
          driftPositionsRef.current = filtered.map((d) => ({ left: d.left, top: d.top }));
          return filtered;
        });
      }, fadeMs);
      return next;
    });
  };

  const beginExit = (ok) => {
    if (finishLockRef.current) return;
    finishLockRef.current = true;
    setExiting(true);
    setBuildImmersiveExit(true);
    window.clearTimeout(exitTimerRef.current);
    exitTimerRef.current = window.setTimeout(() => {
      setBuildImmersive(false);
      setBuildImmersiveExit(false);
      setVisible(false);
      setExiting(false);
      setDriftTexts([]);
      setLog([]);
      setProgress(0);
      progressTargetRef.current = 0;
      lastMsgRef.current = '';
      lastSnippetRef.current = '';
      finishLockRef.current = false;
      if (ok) onCompleteRef.current?.();
      else onErrorRef.current?.();
    }, BUILD_IMMERSIVE_EXIT_MS);
  };

  // Enter / leave immersive chrome
  useEffect(() => {
    if (!active) {
      if (visible && !exiting && !finishLockRef.current) {
        setBuildImmersive(false);
        setBuildImmersiveExit(false);
        setVisible(false);
        setLog([]);
        setDriftTexts([]);
        setProgress(0);
      }
      return undefined;
    }
    finishLockRef.current = false;
    startedAtRef.current = Date.now();
    progressTargetRef.current = 0;
    lastMsgRef.current = '';
    lastSnippetRef.current = '';
    setProgress(0);
    setLog([]);
    setDriftTexts([]);
    driftPoolRef.current = [];
    driftPositionsRef.current = [];
    setExiting(false);
    setVisible(true);
    setBuildImmersiveExit(false);
    setBuildImmersive(true, { editor: true });
    driftBandRef.current = Math.floor(Math.random() * 4);

    const starter = formatBuildMessage('Starting…', displayName, t, personaGender);
    logSeqRef.current += 1;
    setLog([
      {
        id: logSeqRef.current,
        text: starter,
        status: 'active',
      },
    ]);

    return () => {
      window.clearTimeout(exitTimerRef.current);
    };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(
    () => () => {
      window.clearTimeout(exitTimerRef.current);
      setBuildImmersive(false);
      setBuildImmersiveExit(false);
    },
    []
  );

  // Drive log / progress / floaters from job
  useEffect(() => {
    if (!active || !visible || exiting) return;

    const rawProgress = Number(job?.progress);
    if (Number.isFinite(rawProgress)) {
      const next = Math.max(progressTargetRef.current, Math.min(96, rawProgress));
      progressTargetRef.current = next;
      setProgress(next);
    }

    const snippet = String(job?.snippet || '').trim();
    const snippetChanged = Boolean(snippet) && snippet !== lastSnippetRef.current;
    if (snippetChanged) {
      lastSnippetRef.current = snippet;
      const lines = splitIntoChunkLines(snippet, 88);
      const extras = lines.length ? lines : [snippet.slice(0, 96)];
      const prev = driftPoolRef.current || [];
      const seen = new Set(prev);
      driftPoolRef.current = [
        ...extras.filter((l) => l && !seen.has(l)),
        ...prev,
      ].slice(0, 80);
      spawnDrift(extras[0] || snippet.slice(0, 96));
    }

    const raw = String(job?.message || '').trim();
    if (!raw || raw === lastMsgRef.current) return;
    lastMsgRef.current = raw;
    const text = formatBuildMessage(raw, displayName, t, personaGender);
    setLog((prev) => {
      logSeqRef.current += 1;
      return pushBuildLogEntry(prev, {
        id: logSeqRef.current,
        text,
        status: 'active',
      });
    });

    const isSkip = /^Skipped /i.test(raw);
    if (isSkip) {
      spawnDrift(text.slice(0, 72));
    } else if (!snippetChanged) {
      if (!isAdaptive) {
        const soft = text.replace(/^Already knew\s+/i, '').slice(0, 64);
        if (soft.length >= 10) spawnDrift(soft);
      } else if (/^(Indexing|Reading|Parsing|Embedding|Crawling|Embedded)/i.test(raw)) {
        spawnDrift(shortLabelFromMessage(raw));
      }
    }
  }, [job?.message, job?.progress, job?.snippet, active, visible, exiting, displayName, t, isAdaptive]);

  // Occasional ambient floaters — prefer latest source pool, staggered random timing.
  useEffect(() => {
    if (!active || !visible || exiting) return undefined;
    let cancelled = false;
    let timer = 0;
    const tick = () => {
      if (cancelled) return;
      timer = window.setTimeout(() => {
        if (cancelled) return;
        if (Math.random() < (isAdaptive ? 0.62 : 0.75)) spawnDrift();
        tick();
      }, (isAdaptive ? 520 : 400) + Math.floor(Math.random() * (isAdaptive ? 560 : 480)));
    };
    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, visible, exiting, isAdaptive]);

  // Finish when job completes
  useEffect(() => {
    if (!active || !visible || exiting || !job) return;
    const status = job.status;
    if (status !== 'done' && status !== 'completed' && status !== 'error') return;

    let cancelled = false;
    const run = async () => {
      setLog((prev) =>
        prev.map((item) =>
          item.status === 'active'
            ? { ...item, status: status === 'error' ? 'error' : 'done' }
            : item
        )
      );
      const minMs = isAdaptive ? BUILD_MIN_VISIBLE_ADAPTIVE_MS : BUILD_MIN_VISIBLE_FULL_MS;
      const wait = Math.max(600, minMs - (Date.now() - (startedAtRef.current || Date.now())));
      await new Promise((r) => setTimeout(r, wait));
      if (cancelled) return;
      progressTargetRef.current = 100;
      setProgress(100);
      await new Promise((r) => setTimeout(r, 280));
      if (cancelled) return;
      beginExit(status !== 'error');
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [job?.status, active, visible, exiting, isAdaptive]);

  if (!visible || typeof document === 'undefined') return null;

  const pct = Math.max(0, Math.min(100, Number(progress) || 0));

  return createPortal(
    <>
      <div
        className={`wizard-build-atmosphere editor-build-layer is-on${exiting ? ' is-exiting' : ''}`}
        aria-hidden="true"
      />
      {!exiting ? (
        <div className="wizard-build-floaters editor-build-layer" aria-hidden="true">
          {driftTexts.map((d) => (
            <span
              key={d.id}
              className="wizard-build-floater"
              style={{
                left: `${d.left}%`,
                top: `${d.top}%`,
                '--df-dx': `${d.dx}px`,
                '--df-dy': `${d.dy}px`,
                '--df-dur': `${d.dur}s`,
              }}
            >
              <span
                className="wizard-build-floater-inner"
                style={{
                  '--df-rot': `${d.rot}deg`,
                  '--df-spin-end': `${d.spinEnd}deg`,
                  '--df-size': d.size,
                }}
              >
                {d.text}
              </span>
            </span>
          ))}
        </div>
      ) : null}
      <div
        className={`editor-build-live${isAdaptive ? ' is-adaptive' : ''}${
          exiting ? ' is-exiting' : ''
        }`}
      >
        <div className={`wizard-build is-building${isAdaptive ? ' is-adaptive' : ''}`}>
          <h2 className="wizard-title wizard-build-live-title">
            <span className="wizard-build-live-label">{title}</span>
            <span className="wizard-build-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </h2>
          <div
            className="wizard-build-meter"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
            aria-label={title}
          >
            <div className="wizard-build-meter-fill" style={{ width: `${pct}%` }}>
              <span className="wizard-build-meter-sheen" aria-hidden="true" />
            </div>
          </div>
          <ul className="wizard-build-log" aria-live="polite">
            {log.map((item) => (
              <li key={item.id} className={`wizard-build-log-item is-${item.status}`}>
                <span className="wizard-build-log-mark" aria-hidden="true">
                  <span className="wizard-build-log-mark-core" />
                  <span className="wizard-build-log-mark-ring" />
                </span>
                <span className="wizard-build-log-text">
                  <span className="wizard-build-log-copy">{item.text}</span>
                  {item.status === 'active' && (
                    <span className="wizard-build-inline-dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>,
    document.body
  );
}

function shortLabelFromMessage(raw) {
  const m = String(raw || '').match(/^[^:]+:\s*(.+)$/);
  const label = (m ? m[1] : raw).replace(/\s*\(\d+\/\d+\)\s*$/, '').trim();
  return label.slice(0, 72);
}
