import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import ColorField, { normalizeHex } from './ColorField.jsx';
import ColorWheel from './ColorWheel.jsx';

/**
 * Color fields (left) + spectrum wheel (right).
 * Hover previews; click locks baseline. Leave wheel restores baseline.
 */
export default function ThemeColors({ theme, onChange }) {
  const { t } = useI18n();
  const [activeKey, setActiveKey] = useState(null);
  const rootRef = useRef(null);
  const baselineRef = useRef(null);
  const activeKeyRef = useRef(null);
  activeKeyRef.current = activeKey;

  const setColor = (key, hex) => {
    const next = normalizeHex(hex, theme[key]);
    onChange((prev) => ({ ...prev, [key]: next }));
  };

  const restoreBaseline = () => {
    const key = activeKeyRef.current;
    if (!key || baselineRef.current == null) return;
    setColor(key, baselineRef.current);
  };

  const clearSelection = () => {
    // Keep the last committed color — only clear the wheel selection.
    baselineRef.current = null;
    setActiveKey(null);
  };

  useEffect(() => {
    if (!activeKey) return undefined;
    const onPointer = (e) => {
      if (rootRef.current?.contains(e.target)) return;
      clearSelection();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') clearSelection();
    };
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, onChange]);

  const selectKey = (key) => {
    setActiveKey((current) => {
      if (current === key) {
        // Toggle off — keep whatever is currently shown (committed or last preview).
        baselineRef.current = null;
        return null;
      }
      baselineRef.current = normalizeHex(theme[key]);
      return key;
    });
  };

  const open = Boolean(activeKey);
  const activeValue = activeKey ? normalizeHex(theme[activeKey]) : '#d97757';

  return (
    <div ref={rootRef} className={`theme-colors${open ? ' has-palette' : ''}`}>
      <div className="theme-colors-fields">
        <ColorField
          label={t('editor.panelBg')}
          value={theme.panelBg}
          selected={activeKey === 'panelBg'}
          onSelect={() => selectKey('panelBg')}
          onChange={(v) => {
            setColor('panelBg', v);
            if (activeKey === 'panelBg') baselineRef.current = normalizeHex(v);
          }}
        />
        <ColorField
          label={t('editor.accent')}
          value={theme.accent}
          selected={activeKey === 'accent'}
          onSelect={() => selectKey('accent')}
          onChange={(v) => {
            setColor('accent', v);
            if (activeKey === 'accent') baselineRef.current = normalizeHex(v);
          }}
        />
        <ColorField
          label={t('editor.launcherBg')}
          value={theme.launcherBg}
          selected={activeKey === 'launcherBg'}
          onSelect={() => selectKey('launcherBg')}
          onChange={(v) => {
            setColor('launcherBg', v);
            if (activeKey === 'launcherBg') baselineRef.current = normalizeHex(v);
          }}
        />
        <ColorField
          label={t('editor.textColor')}
          value={theme.textColor}
          selected={activeKey === 'textColor'}
          onSelect={() => selectKey('textColor')}
          onChange={(v) => {
            setColor('textColor', v);
            if (activeKey === 'textColor') baselineRef.current = normalizeHex(v);
          }}
        />
      </div>

      <div className={`theme-color-wheel-slot${open ? ' is-open' : ''}`} aria-hidden={!open}>
        <ColorWheel
          active={open}
          value={activeValue}
          label={t('editor.pickColor')}
          onPreview={(hex) => {
            if (activeKey) setColor(activeKey, hex);
          }}
          onCancelPreview={restoreBaseline}
          onCommit={(hex) => {
            if (!activeKey) return;
            const next = normalizeHex(hex);
            baselineRef.current = next;
            setColor(activeKey, next);
          }}
        />
      </div>
    </div>
  );
}
