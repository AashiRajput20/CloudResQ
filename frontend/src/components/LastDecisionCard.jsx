import { useCallback, useState } from 'react';
import { getDecisions } from '../services/api';
import usePolling from '../hooks/usePolling';
import StatusBadge from './StatusBadge';

// "Last decision" box for the main dashboard.
export default function LastDecisionCard() {
  const [last, setLast] = useState(null);

  const load = useCallback(async () => {
    try {
      const rows = await getDecisions({ limit: 1 });
      setLast(rows[0] || null);
    } catch {
      setLast(null);
    }
  }, []);

  usePolling(load, 5000);

  return (
    <section className="card">
      <h3>Decision Engine</h3>
      {!last ? (
        <p className="muted">No decisions yet. Everything is within thresholds.</p>
      ) : (
        <>
          <p>
            Last decision: <StatusBadge status={last.action} /> <strong>{last.instanceName}</strong>{' '}
            <span className="muted small">at {new Date(last.decidedAt).toLocaleTimeString()}</span>
          </p>
          <p><strong>Reason:</strong> "{last.reason}"</p>
          <p className="muted small">Priority {last.priority} · confidence {last.confidence} · status {last.status}</p>
        </>
      )}
    </section>
  );
}
