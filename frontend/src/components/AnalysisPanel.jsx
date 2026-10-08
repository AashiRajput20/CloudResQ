import { useCallback, useState } from 'react';
import { getAnalysis, errorMessage } from '../services/api';
import usePolling from '../hooks/usePolling';
import StatusBadge from './StatusBadge';

const TYPE_LABEL = {
  CONTAINER_DOWN: 'Container Down',
  HEALTH_CHECK_FAILED: 'Health Check Failed',
  HIGH_CPU: 'High CPU',
  HIGH_MEMORY: 'High Memory',
  HIGH_LATENCY: 'High Latency',
  HIGH_ERROR_RATE: 'High Error Rate',
  REPEATED_FAILURE: 'Repeated Failure',
};

// Shows the Failure Analyzer's view of every instance of one service.
export default function AnalysisPanel({ serviceId }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setRows(await getAnalysis({ serviceId }));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [serviceId]);

  usePolling(load, 5000);

  return (
    <section className="card">
      <h3>Failure Analysis <span className="muted small">(live, refreshes every 5 s)</span></h3>
      {error && <p className="error-box">{error}</p>}
      {rows.length === 0 ? (
        <p className="muted">No instances to analyze yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Instance</th><th>Health</th><th>Failure type</th><th>Severity</th>
              <th>Failures (10 min)</th><th>Restarts (10 min)</th>
              <th>CPU</th><th>Mem</th><th>Error rate</th><th>Suggested action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.instanceId}>
                <td>{a.instanceName}</td>
                <td><StatusBadge status={a.health} /></td>
                <td>{a.failureType ? TYPE_LABEL[a.failureType] : '-'}</td>
                <td><StatusBadge status={a.severity} /></td>
                <td>{a.failureCount}{a.unstable ? ' (unstable)' : ''}</td>
                <td>{a.recentRestarts}{a.failedRestarts ? ` (${a.failedRestarts} failed)` : ''}</td>
                <td>{a.cpu != null ? `${a.cpu}%` : '-'}</td>
                <td>{a.memory != null ? `${a.memory}%` : '-'}</td>
                <td>{a.errorRate != null ? `${Math.round(a.errorRate)}%` : '-'}</td>
                <td><StatusBadge status={a.recommendedAction} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.filter((a) => a.severity !== 'NONE').map((a) => (
        <p key={a.instanceId} className="small muted">
          <strong>{a.instanceName}:</strong> {a.reasons.join(' · ')}
        </p>
      ))}
      <p className="muted small">
        The suggested action is the Analyzer's hint. The final decision, with confidence and explanation, comes from the Decision Engine (Phase 9).
      </p>
    </section>
  );
}