import React, { forwardRef, useEffect, useRef, useState } from 'react';

const PREP_MS = 560;
const TYPE_MS = 8;
const CHARS_PER_TICK = 2;

/**
 * Chat-style typewriter for text inputs.
 * One shimmer pass, then type — real caret only after text has fully landed.
 * Value updates mid-type follow the new target without wiping/replaying.
 */
const TypewriterField = forwardRef(function TypewriterField(
  {
    value,
    onChange,
    animateKey = 0,
    multiline = false,
    rows = 3,
    disabled = false,
    locked = false,
    onComplete,
    className = '',
    placeholder,
    ...rest
  },
  ref
) {
  const full = String(value || '');
  const fullRef = useRef(full);
  fullRef.current = full;
  const [shown, setShown] = useState(animateKey > 0 ? '' : full);
  const [phase, setPhase] = useState('idle'); // idle | preparing | typing
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const userEditRef = useRef(false);
  const completedForKeyRef = useRef(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const indexRef = useRef(0);

  const signalComplete = (key) => {
    if (completedForKeyRef.current === key) return;
    completedForKeyRef.current = key;
    onCompleteRef.current?.();
  };

  // Start / restart typing only when animateKey changes — not on every value tweak.
  useEffect(() => {
    if (userEditRef.current) {
      setShown(fullRef.current);
      setPhase('idle');
      signalComplete(animateKey);
      return undefined;
    }

    if (animateKey <= 0 || !fullRef.current) {
      setShown(fullRef.current);
      setPhase('idle');
      signalComplete(animateKey);
      return undefined;
    }

    if (completedForKeyRef.current === animateKey) {
      setShown(fullRef.current);
      setPhase('idle');
      return undefined;
    }

    let cancelled = false;
    let timer = null;
    indexRef.current = 0;
    completedForKeyRef.current = null;
    setPhase('preparing');
    setShown('');

    const finish = () => {
      if (cancelled) return;
      setShown(fullRef.current);
      setPhase('idle');
      signalComplete(animateKey);
    };

    const tick = () => {
      if (cancelled) return;
      const target = fullRef.current;
      indexRef.current = Math.min(target.length, indexRef.current + CHARS_PER_TICK);
      setShown(target.slice(0, indexRef.current));
      if (indexRef.current < target.length) {
        timer = setTimeout(tick, TYPE_MS);
        return;
      }
      finish();
    };

    timer = setTimeout(() => {
      if (cancelled) return;
      setPhase('typing');
      tick();
    }, PREP_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally ignore `full`; follow via fullRef
  }, [animateKey]);

  // Idle: keep displayed text in sync when parent value changes (e.g. after animation).
  useEffect(() => {
    if (userEditRef.current) return;
    if (phaseRef.current !== 'idle') return;
    setShown(full);
  }, [full]);

  const handleChange = (e) => {
    if (locked || phase !== 'idle') return;
    userEditRef.current = true;
    setShown(e.target.value);
    onChange?.(e);
  };

  const handleFocus = (e) => {
    if (locked || phase !== 'idle') {
      e.target.blur();
      return;
    }
    rest.onFocus?.(e);
  };

  const Tag = multiline ? 'textarea' : 'input';
  const busy = phase === 'preparing' || phase === 'typing';
  const blocked = locked || busy;

  return (
    <div
      className={`typewriter-field${busy ? ' is-typing' : ''}${
        phase === 'preparing' ? ' is-preparing' : ''
      }${locked && !busy ? ' is-locked' : ''}${className ? ` ${className}` : ''}`}
    >
      <Tag
        {...rest}
        ref={ref}
        rows={multiline ? rows : undefined}
        value={shown}
        placeholder={busy ? '' : placeholder}
        disabled={disabled}
        tabIndex={blocked ? -1 : rest.tabIndex}
        readOnly={blocked || rest.readOnly}
        aria-busy={busy || undefined}
        onChange={handleChange}
        onFocus={handleFocus}
      />
    </div>
  );
});

export default TypewriterField;
