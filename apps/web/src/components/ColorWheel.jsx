import React, { useEffect, useRef, useState } from 'react';

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function hsvToHex(h, s, v) {
  const hh = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (n) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function hexToHsv(hex) {
  const raw = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return { h: 20, s: 0.55, v: 0.85 };
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

/**
 * Sample wheel using CSS conic angles: 0deg = top, clockwise.
 * (Matches `conic-gradient(from 0deg, …)`.)
 */
function samplePoint(el, clientX, clientY, valueV) {
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  const radius = Math.max(rect.width / 2, 1);
  const dist = Math.sqrt(dx * dx + dy * dy);
  // atan2(dx, -dy): 0 at top, clockwise with y-down screen coords
  const h = (((Math.atan2(dx, -dy) * 180) / Math.PI) + 360) % 360;
  const s = clamp(dist / (radius * 0.92), 0, 1);
  const rad = (h * Math.PI) / 180;
  const ring = s * 42;
  return {
    h,
    s,
    v: valueV,
    hex: hsvToHex(h, s, valueV),
    x: clamp(50 + Math.sin(rad) * ring, 4, 96),
    y: clamp(50 - Math.cos(rad) * ring, 4, 96),
  };
}

/**
 * Hover previews color. Click locks it. Leave without click reverts.
 */
export default function ColorWheel({
  value,
  onPreview,
  onCommit,
  onCancelPreview,
  active = false,
  label = 'Color',
}) {
  const rootRef = useRef(null);
  const onPreviewRef = useRef(onPreview);
  const onCommitRef = useRef(onCommit);
  const onCancelRef = useRef(onCancelPreview);
  const brightnessRef = useRef(hexToHsv(value).v);
  onPreviewRef.current = onPreview;
  onCommitRef.current = onCommit;
  onCancelRef.current = onCancelPreview;

  const committed = hexToHsv(value);
  const [aim, setAim] = useState(null);
  const [ping, setPing] = useState(null);
  const pingSeq = useRef(0);

  /** Wheel stays vivid while open — never re-lock to near-black after pointer leave. */
  const pickBrightness = (hsv) => {
    const { v, s } = hsv;
    if (v < 0.28 || (v > 0.97 && s < 0.06)) return 0.88;
    return clamp(v, 0.18, 1);
  };

  useEffect(() => {
    if (!active) {
      setAim(null);
      brightnessRef.current = pickBrightness(hexToHsv(value));
      return;
    }
    // Only seed brightness when the wheel opens. Do NOT sync back to committed.v
    // while active — leaving the wheel used to reset V≈0 and every later click
    // sampled black again (text color looked “stuck”).
    brightnessRef.current = pickBrightness(hexToHsv(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !active) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      brightnessRef.current = clamp(brightnessRef.current - e.deltaY * 0.0015, 0.12, 1);
      setAim((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          v: brightnessRef.current,
          hex: hsvToHex(prev.h, prev.s, brightnessRef.current),
        };
        onPreviewRef.current?.(next.hex);
        return next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [active]);

  const sample = (clientX, clientY) => {
    const el = rootRef.current;
    if (!el) return null;
    return samplePoint(el, clientX, clientY, brightnessRef.current);
  };

  const marker = aim || {
    h: committed.h,
    s: committed.s,
    hex: value,
    x: 50 + Math.sin((committed.h * Math.PI) / 180) * committed.s * 42,
    y: 50 - Math.cos((committed.h * Math.PI) / 180) * committed.s * 42,
  };

  return (
    <div
      className={`theme-color-wheel${active ? ' is-active' : ''}`}
      ref={rootRef}
      role="button"
      aria-label={label}
      aria-valuetext={value}
      tabIndex={active ? 0 : -1}
      onPointerMove={(e) => {
        if (!active) return;
        const next = sample(e.clientX, e.clientY);
        if (!next) return;
        setAim(next);
        onPreviewRef.current?.(next.hex);
      }}
      onPointerLeave={() => {
        setAim(null);
        onCancelRef.current?.();
      }}
      onPointerDown={(e) => {
        if (!active) return;
        e.preventDefault();
        e.stopPropagation();
        const next = sample(e.clientX, e.clientY);
        if (!next) return;
        setAim(next);
        onCommitRef.current?.(next.hex);
        pingSeq.current += 1;
        const id = pingSeq.current;
        setPing({ id, x: next.x, y: next.y, color: next.hex });
        window.setTimeout(() => {
          setPing((p) => (p?.id === id ? null : p));
        }, 520);
      }}
      style={{
        '--cw-marker-x': `${marker.x}%`,
        '--cw-marker-y': `${marker.y}%`,
        '--cw-current': value,
        '--cw-aim': marker.hex || value,
      }}
    >
      <div className="theme-color-wheel-spectrum" aria-hidden="true" />
      <div className="theme-color-wheel-soft" aria-hidden="true" />
      <div className="theme-color-wheel-core" aria-hidden="true" />
      <span
        className={`theme-color-wheel-marker${aim ? ' is-aiming' : ''}`}
        aria-hidden="true"
      />
      {ping ? (
        <span
          key={ping.id}
          className="theme-color-wheel-ping"
          style={{
            left: `${ping.x}%`,
            top: `${ping.y}%`,
            '--cw-ping': ping.color,
          }}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}

export { hsvToHex, hexToHsv };
