import { useEffect } from 'react';

// Calls `fn` immediately, then every `intervalMs`. `fn` must be wrapped in useCallback.
export default function usePolling(fn, intervalMs = 5000) {
  useEffect(() => {
    let active = true;
    const tick = () => { if (active) fn(); };
    tick();
    const timer = setInterval(tick, intervalMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [fn, intervalMs]);
}