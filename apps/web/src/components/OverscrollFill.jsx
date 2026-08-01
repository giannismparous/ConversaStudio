import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import './OverscrollFill.css';

const TOP_BG = '#f3efe6';
const BOTTOM_BG = '#ebe4d6';
const IMMERSIVE_BG = '#1a1510';
const EDGE_THRESHOLD = 120;

/** Keeps rubber-band / overscroll areas matching the page gradient edges (simasia v3 pattern). */
export default function OverscrollFill() {
  const { pathname } = useLocation();

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    let raf = 0;

    const syncBackdrop = () => {
      const immersive = document.documentElement.classList.contains('wizard-build-immersive');

      if (immersive) {
        document.documentElement.style.backgroundColor = IMMERSIVE_BG;
        document.body.style.backgroundColor = '';
        document.body.style.background = '';
        const root = document.getElementById('root');
        if (root) {
          root.style.backgroundColor = 'transparent';
          root.style.background = 'transparent';
        }
        if (meta) meta.setAttribute('content', IMMERSIVE_BG);
        return;
      }

      document.body.style.background = '';

      const scroller = document.querySelector('.shell-main');
      const scrollY = scroller ? scroller.scrollTop : window.scrollY;
      const viewH = scroller ? scroller.clientHeight : window.innerHeight;
      const scrollH = scroller ? scroller.scrollHeight : document.documentElement.scrollHeight;
      const atTop = scrollY < EDGE_THRESHOLD;
      const atBottom = scrollY + viewH >= scrollH - EDGE_THRESHOLD;

      const backdrop = atBottom && !atTop ? BOTTOM_BG : TOP_BG;

      document.documentElement.classList.toggle('page-backdrop-top', !atBottom || atTop);
      document.documentElement.classList.toggle('page-backdrop-bottom', atBottom && !atTop);
      document.documentElement.style.backgroundColor = backdrop;
      document.body.style.backgroundColor = backdrop;
      const root = document.getElementById('root');
      if (root) root.style.backgroundColor = backdrop;
      if (meta) meta.setAttribute('content', backdrop);
    };

    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        syncBackdrop();
      });
    };

    syncBackdrop();
    const scroller = document.querySelector('.shell-main');
    scroller?.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    // Poll lightly instead of MutationObserver — avoids class-toggle feedback loops.
    const poll = window.setInterval(syncBackdrop, 250);
    return () => {
      scroller?.removeEventListener('scroll', schedule);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.clearInterval(poll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [pathname]);

  return (
    <>
      <div className="overscroll-fill overscroll-fill--top" aria-hidden="true" />
      <div className="overscroll-fill overscroll-fill--bottom" aria-hidden="true" />
    </>
  );
}
