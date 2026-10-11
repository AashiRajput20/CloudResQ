import { useCallback, useState } from 'react';
import { getRecoveryEvents, errorMessage } from '../services/api';
import usePolling from '../hooks/usePolling';
import StatusBadge from '../components/StatusBadge';

const TYPE_LABEL = {
  CONTAINER_DOWN: 'Container Down',
  HEALTH_CHECK_FAILED: 'Health Check Failed',
  HIGH_CPU: 'High CPU',
  HIGH_MEMORY: 'High Memory',
  HIGH_LATENCY: 'High Latency',
  HIGH_ERROR_RATE: 'High Error Rate',
  REPEATED_FAILURE: 'Repeated Failure',
  MANUAL: 'Manual',
};

export default function RecoveryHistory() {
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState('ALL');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const params = { limit: 100 };
      if (filter !== 'ALL') params.action = filter;
      setEvents(await getRecoveryEvents(params));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  usePolling(load, 5000);

  // Quick summary of the loaded rows (the full analytics page comes later).
  const recoveries = events.filter((e) => ['RESTART', 'REPLACE'].includes(e.action) && e.status !== 'IN_PROGRESS');
  const ok = recoveries.filter((e) => e.status === 'SUCCESS');
  const avg = ok.length ? (ok.reduce((s, e) => s + (e.duration || 0), 0) / ok.length).toFixed(1) : null;

  return (
    <div className="container" style={{ maxWidth: 1200 }}>
      <h2 className="page-title">Recovery History</h2>
      {error && <p className="error-box">{error}</p>}

      <section className="card">
        <div className="form-row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Recovery actions <span className="muted small">(live, refreshes every 5 s)</span></h3>
          <label>
            Show{' '}
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="ALL">All</option>
              <option value="RESTART">Restarts</option>
              <option value="REPLACE">Replacements</option>
              <option value="REMOVE_FROM_TRAFFIC">Removed from traffic</option>
              <option value="ADD_TO_TRAFFIC">Added to traffic</option>
            </select>
          </label>
        </div>

        {recoveries.length > 0 && (
          <p className="muted small">
            In the rows below: {ok.length} of {recoveries.length} recoveries succeeded
            ({Math.round((ok.length / recoveries.length) * 100)}%){avg && `, average recovery time ${avg} s`}.
          </p>
        )}

        {loading ? (
          <p className="muted">Loading...</p>
        ) : events.length === 0 ? (
          <p className="muted">No recovery actions yet. Simulate a failure on Service Details and watch CloudResQ fix it.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Time</th><th>Instance</th><th>Failure</th><th>Action</th>
                <th>Reason</th><th>Duration</th><th>Result</th><th>By</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e._id}>
                  <td>{new Date(e.startedAt).toLocaleTimeString()}</td>
                  <td>
                    {e.action === 'REPLACE' && e.newInstance
                      ? `${e.oldInstance} → ${e.newInstance}`
                      : e.instanceName}
                  </td>
                  <td>{e.trigger ? (TYPE_LABEL[e.trigger] || e.trigger) : '-'}</td>
                  <td><StatusBadge status={e.action} /></td>
                  <td className="small">
                    {e.reason}
                    {e.error && <div className="bad-text">{e.error}</div>}
                  </td>
                  <td>{e.status === 'IN_PROGRESS' ? '...' : `${e.duration ?? 0} s`}</td>
                  <td><StatusBadge status={e.status} /></td>
                  <td className="small">{e.source === 'MANUAL' ? 'Manual' : 'Auto'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}