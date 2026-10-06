import { useEffect, useState } from 'react';
import { getBackendHealth } from '../services/api';

// Polls /api/health every `intervalMs` and exposes the result.
export default function useBackendHealth(intervalMs = 5000) {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const check = async () => {
      try {
        const data = await getBackendHealth();
        if (active) {
          setHealth(data);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setHealth(null);
          setError(err.message);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    check();
    const timer = setInterval(check, intervalMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return { health, error, loading };
}