import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import TypewriterField from './TypewriterField.jsx';

const emptyFact = () => ({ title: '', body: '' });

let factIdSeq = 0;
function nextFactId() {
  factIdSeq += 1;
  return `kf-${factIdSeq}`;
}

/**
 * Editable list of authoritative Q&A-style facts (title + body).
 * These are always injected into chat context, ahead of RAG chunks.
 * Empty list is allowed — user can remove every row and add again later.
 */
export default function KeyFactsEditor({
  items,
  onChange,
  animateKey = 0,
  locked = false,
  onAllComplete,
}) {
  const { t } = useI18n();
  const list = Array.isArray(items) ? items : [];
  const idsRef = useRef([]);
  const listRef = useRef(list);
  const pendingRef = useRef(new Set());
  const onAllCompleteRef = useRef(onAllComplete);
  const [enteringIds, setEnteringIds] = useState(() => new Set());
  const [leavingIds, setLeavingIds] = useState(() => new Set());
  onAllCompleteRef.current = onAllComplete;
  listRef.current = list;

  if (idsRef.current.length !== list.length) {
    if (idsRef.current.length < list.length) {
      while (idsRef.current.length < list.length) {
        idsRef.current.push(nextFactId());
      }
    } else {
      idsRef.current = idsRef.current.slice(0, list.length);
    }
  }

  const prevAnimateKeyRef = useRef(animateKey);
  useEffect(() => {
    if (prevAnimateKeyRef.current === animateKey) return;
    prevAnimateKeyRef.current = animateKey;
    idsRef.current = list.map(() => nextFactId());
    setEnteringIds(new Set());
    setLeavingIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animateKey]);

  useEffect(() => {
    if (animateKey <= 0) {
      pendingRef.current = new Set();
      onAllCompleteRef.current?.();
      return;
    }
    const pending = new Set();
    list.forEach((fact, index) => {
      if (String(fact?.title || '').trim()) pending.add(`${index}:title`);
      if (String(fact?.body || '').trim()) pending.add(`${index}:body`);
    });
    pendingRef.current = pending;
    if (pendingRef.current.size === 0) {
      onAllCompleteRef.current?.();
    }
    // Intentionally only re-arm when animateKey changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animateKey]);

  const markComplete = (id) => {
    if (animateKey <= 0) return;
    if (!pendingRef.current.has(id)) return;
    pendingRef.current.delete(id);
    if (pendingRef.current.size === 0) {
      onAllCompleteRef.current?.();
    }
  };

  const setAt = (index, patch) => {
    if (locked) return;
    const next = list.map((f, i) => (i === index ? { ...f, ...patch } : f));
    onChange(next);
  };

  const commitRemove = (id) => {
    const index = idsRef.current.indexOf(id);
    setLeavingIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (index < 0) return;
    idsRef.current.splice(index, 1);
    const current = listRef.current;
    onChange(current.filter((_, i) => i !== index));
  };

  const removeAt = (index) => {
    if (locked) return;
    const id = idsRef.current[index];
    if (!id) {
      onChange(list.filter((_, i) => i !== index));
      return;
    }
    if (leavingIds.has(id)) return;
    // Animate out even when it's the last row — empty list is valid.
    setLeavingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    // Fallback if animationend never fires (reduced motion / interrupted).
    window.setTimeout(() => {
      if (idsRef.current.includes(id)) commitRemove(id);
    }, 400);
  };

  const add = () => {
    if (locked) return;
    const id = nextFactId();
    idsRef.current = [...idsRef.current, id];
    setEnteringIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    onChange([...list, emptyFact()]);
  };

  const clearEntering = (id) => {
    setEnteringIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const animating = animateKey > 0;

  return (
    <div className={`key-facts-editor${locked ? ' is-anim-locked' : ''}`}>
      {list.map((fact, index) => {
        const rowId = idsRef.current[index] || `fallback-${index}`;
        const entering = enteringIds.has(rowId);
        const leaving = leavingIds.has(rowId);
        return (
          <div
            className={`key-fact-item${entering ? ' is-entering' : ''}${
              leaving ? ' is-leaving' : ''
            }`}
            key={rowId}
            onAnimationEnd={(e) => {
              if (e.target !== e.currentTarget) return;
              if (leavingIds.has(rowId)) {
                commitRemove(rowId);
                return;
              }
              clearEntering(rowId);
            }}
          >
            <div className="key-fact-row">
              {animating ? (
                <>
                  <TypewriterField
                    className="key-fact-typewriter key-fact-typewriter-title"
                    value={fact.title || ''}
                    animateKey={animateKey}
                    locked={locked}
                    placeholder={t('keyFacts.titlePlaceholder')}
                    onComplete={() => markComplete(`${index}:title`)}
                    onChange={(e) => setAt(index, { title: e.target.value })}
                  />
                  <TypewriterField
                    className="key-fact-typewriter key-fact-typewriter-body"
                    multiline
                    rows={3}
                    value={fact.body || ''}
                    animateKey={animateKey}
                    locked={locked}
                    placeholder={t('keyFacts.bodyPlaceholder')}
                    onComplete={() => markComplete(`${index}:body`)}
                    onChange={(e) => setAt(index, { body: e.target.value })}
                  />
                </>
              ) : (
                <>
                  <input
                    type="text"
                    className="key-fact-title"
                    placeholder={t('keyFacts.titlePlaceholder')}
                    value={fact.title || ''}
                    onChange={(e) => setAt(index, { title: e.target.value })}
                  />
                  <textarea
                    className="key-fact-body"
                    placeholder={t('keyFacts.bodyPlaceholder')}
                    value={fact.body || ''}
                    rows={3}
                    onChange={(e) => setAt(index, { body: e.target.value })}
                  />
                </>
              )}
            </div>
            <button
              type="button"
              className="icon-btn danger key-fact-remove"
              title={t('list.remove')}
              onClick={() => removeAt(index)}
              disabled={locked || leaving}
              hidden={locked}
            >
              ×
            </button>
          </div>
        );
      })}
      {!locked ? (
        <button type="button" className="btn btn-secondary ordered-list-add" onClick={add}>
          + {t('keyFacts.addAnswer')}
        </button>
      ) : null}
    </div>
  );
}
