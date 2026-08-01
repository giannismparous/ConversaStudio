import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import TypewriterField from './TypewriterField.jsx';

let rowIdSeq = 0;
function nextRowId() {
  rowIdSeq += 1;
  return `q-${rowIdSeq}`;
}

/**
 * Editable ordered list — compact single-line rows.
 * Enter = new item, paste newlines = many items, ↑↓ reorder, + add.
 */
export default function OrderedListEditor({
  items,
  onChange,
  placeholder = 'Type and press Enter for a new line…',
  showPriority = false,
  addLabel = 'Add',
  animateKey = 0,
  locked = false,
  onAllComplete,
}) {
  const { t } = useI18n();
  const list = Array.isArray(items) ? items : [];
  const refs = useRef([]);
  const idsRef = useRef([]);
  const listRef = useRef(list);
  const rowElsRef = useRef(new Map());
  const pendingRef = useRef(new Set());
  const onAllCompleteRef = useRef(onAllComplete);
  const [enteringIds, setEnteringIds] = useState(() => new Set());
  const [leavingIds, setLeavingIds] = useState(() => new Set());
  onAllCompleteRef.current = onAllComplete;
  listRef.current = list;

  // Keep stable row ids aligned with list length.
  if (idsRef.current.length !== list.length) {
    if (idsRef.current.length < list.length) {
      while (idsRef.current.length < list.length) {
        idsRef.current.push(nextRowId());
      }
    } else {
      idsRef.current = idsRef.current.slice(0, list.length);
    }
  }

  const prevAnimateKeyRef = useRef(animateKey);
  useEffect(() => {
    if (prevAnimateKeyRef.current === animateKey) return;
    prevAnimateKeyRef.current = animateKey;
    idsRef.current = list.map(() => nextRowId());
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
    const armed = list.map((_, index) => String(index));
    pendingRef.current = new Set(armed);
    if (pendingRef.current.size === 0) {
      onAllCompleteRef.current?.();
    }
    // Intentionally only re-arm when animateKey changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animateKey]);

  const markRowComplete = (index) => {
    if (animateKey <= 0) return;
    if (!pendingRef.current.has(String(index))) return;
    pendingRef.current.delete(String(index));
    if (pendingRef.current.size === 0) {
      onAllCompleteRef.current?.();
    }
  };

  const markEntering = (ids) => {
    setEnteringIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const clearEntering = (id) => {
    setEnteringIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const focusAt = (index) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const node = refs.current[index];
        if (!node) return;
        node.focus();
        const len = node.value?.length ?? 0;
        try {
          node.setSelectionRange(len, len);
        } catch {
          /* some inputs may not support selection */
        }
      });
    });
  };

  const setAt = (index, value) => {
    const next = [...list];
    next[index] = value;
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
    const next = current.filter((_, i) => i !== index);
    onChange(next.length ? next : ['']);
  };

  const removeAt = (index) => {
    if (locked) return;
    const id = idsRef.current[index];
    if (!id) {
      const next = list.filter((_, i) => i !== index);
      onChange(next.length ? next : ['']);
      return;
    }
    if (leavingIds.has(id)) return;
    // Single remaining empty row — clear instead of animating away.
    if (list.length <= 1) {
      idsRef.current = [id];
      onChange(['']);
      return;
    }
    setLeavingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const insertAt = (index, value = '') => {
    if (locked) return;
    const id = nextRowId();
    idsRef.current.splice(index, 0, id);
    markEntering([id]);
    const next = [...list];
    next.splice(index, 0, value);
    onChange(next);
    focusAt(index);
  };

  const move = (index, dir) => {
    if (locked) return;
    const j = index + dir;
    if (j < 0 || j >= list.length) return;

    const idA = idsRef.current[index];
    const idB = idsRef.current[j];
    const elA = rowElsRef.current.get(idA);
    const elB = rowElsRef.current.get(idB);
    const firstA = elA?.getBoundingClientRect();
    const firstB = elB?.getBoundingClientRect();

    const next = [...list];
    [next[index], next[j]] = [next[j], next[index]];
    const ids = idsRef.current;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    onChange(next);

    const playFlip = (el, first) => {
      if (!el || !first) return;
      const last = el.getBoundingClientRect();
      const dy = first.top - last.top;
      if (Math.abs(dy) < 0.5) return;
      el.classList.add('is-reordering');
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
      // Force reflow so the invert sticks before the play.
      void el.offsetHeight;
      el.style.transition = 'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)';
      el.style.transform = '';
      const clear = (e) => {
        if (e.propertyName && e.propertyName !== 'transform') return;
        el.classList.remove('is-reordering');
        el.style.transition = '';
        el.style.transform = '';
        el.removeEventListener('transitionend', clear);
      };
      el.addEventListener('transitionend', clear);
    };

    requestAnimationFrame(() => {
      playFlip(elA, firstA);
      playFlip(elB, firstB);
    });
  };

  const onKeyDown = (e, index) => {
    if (locked) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const el = e.target;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const before = el.value.slice(0, start);
      const after = el.value.slice(end);
      const id = nextRowId();
      idsRef.current.splice(index + 1, 0, id);
      markEntering([id]);
      const next = [...list];
      next[index] = before;
      next.splice(index + 1, 0, after);
      onChange(next);
      focusAt(index + 1);
    }
    if (e.key === 'Backspace' && !e.target.value && list.length > 1) {
      e.preventDefault();
      const focusTo = Math.max(0, index - 1);
      removeAt(index);
      focusAt(focusTo);
    }
  };

  const onPaste = (e, index) => {
    if (locked) return;
    const text = e.clipboardData?.getData('text') || '';
    if (!text.includes('\n')) return;
    e.preventDefault();
    const parts = text
      .split(/\r?\n/)
      .map((p) => p.replace(/^\s*\d+[).:-]\s*/, '').trim())
      .filter(Boolean);
    if (!parts.length) return;
    const el = e.target;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    const first = `${before}${parts[0]}`.trim();
    const lastExtra = after.trim();
    const middle = parts.slice(1);
    const insert = [...middle];
    if (lastExtra) insert.push(lastExtra);
    const newIds = insert.map(() => nextRowId());
    idsRef.current.splice(index + 1, 0, ...newIds);
    markEntering(newIds);
    const next = [...list];
    next[index] = first;
    next.splice(index + 1, 0, ...insert);
    onChange(next);
  };

  return (
    <div className={`ordered-list-editor${locked ? ' is-anim-locked' : ''}`}>
      {list.map((item, index) => {
        const rowId = idsRef.current[index] || `fallback-${index}`;
        const entering = enteringIds.has(rowId);
        const leaving = leavingIds.has(rowId);
        return (
          <div
            className={`ordered-list-row${entering ? ' is-entering' : ''}${
              leaving ? ' is-leaving' : ''
            }`}
            key={rowId}
            ref={(el) => {
              if (el) rowElsRef.current.set(rowId, el);
              else rowElsRef.current.delete(rowId);
            }}
            onAnimationEnd={(e) => {
              if (e.target !== e.currentTarget) return;
              if (leavingIds.has(rowId)) {
                commitRemove(rowId);
                return;
              }
              clearEntering(rowId);
            }}
          >
            <span
              className={showPriority ? 'ordered-list-priority' : 'ordered-list-bullet'}
              title={showPriority ? t('list.priorityHint') : undefined}
            >
              {index + 1}
            </span>
            {animateKey > 0 ? (
              <TypewriterField
                ref={(el) => {
                  refs.current[index] = el;
                }}
                className="ordered-list-typewriter"
                value={item}
                animateKey={animateKey}
                locked={locked}
                placeholder={placeholder}
                onComplete={() => markRowComplete(index)}
                onChange={(e) => setAt(index, e.target.value)}
                onKeyDown={(e) => onKeyDown(e, index)}
                onPaste={(e) => onPaste(e, index)}
              />
            ) : (
              <input
                ref={(el) => {
                  refs.current[index] = el;
                }}
                type="text"
                className="ordered-list-input"
                value={item}
                placeholder={placeholder}
                onChange={(e) => setAt(index, e.target.value)}
                onKeyDown={(e) => onKeyDown(e, index)}
                onPaste={(e) => onPaste(e, index)}
              />
            )}
            <div className="ordered-list-actions">
              <button
                type="button"
                className="icon-btn"
                title={t('list.moveUp')}
                onClick={() => move(index, -1)}
                disabled={locked || leaving || index === 0}
              >
                ↑
              </button>
              <button
                type="button"
                className="icon-btn"
                title={t('list.moveDown')}
                onClick={() => move(index, 1)}
                disabled={locked || leaving || index === list.length - 1}
              >
                ↓
              </button>
              <button
                type="button"
                className="icon-btn danger"
                title={t('list.remove')}
                onClick={() => removeAt(index)}
                disabled={locked || leaving}
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
      {!locked ? (
        <button
          type="button"
          className="btn btn-secondary ordered-list-add"
          onClick={() => insertAt(list.length, '')}
        >
          + {addLabel}
        </button>
      ) : null}
    </div>
  );
}
