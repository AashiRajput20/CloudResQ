import { useCallback, useState } from 'react';
import { getFailures, errorMessage } from '../services/api';
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
};

const time = (d) => (d ? new Date(d).toLocaleTimeString() : '-');

export default function FailureHistory() {
  const [failures, setFailures] = useState([]);
  const [filter, setFilter] = useState('ALL');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const params = { limit: 100 };
      if (filter !== 'ALL') params.status = filter;
      setFailures(await getFailures(params));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  usePolling(load, 5000);

  return (
    <div className="container" style={{ maxWidth: 1200 }}>
      <h2 className="page-title">Failure History</h2>
      {error && <p className="error-box">{error}</p>}

      <section className="card">
        <div className="form-row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Detected failures <span className="muted small">(live, refreshes every 5 s)</span></h3>
          <label>
            Show{' '}
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="ALL">All</option>
              <option value="ACTIVE">Active</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </label>
        </div>

        {loading ? (
          <p className="muted">Loading...</p>
        ) : failures.length === 0 ? (
          <p className="muted">No failures recorded. Try a simulation, for example <code>POST /simulate/failure</code> on an app.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Detected</th><th>Instance</th><th>Type</th><th>Severity</th><th>Status</th>
                <th>Details</th><th>Detection time</th><th>Resolved</th><th>Recent count</th>
              </tr>
            </thead>
            <tbody>
              {failures.map((f) => (
                <tr key={f._id}>
                  <td>{time(f.detectedAt)}</td>
                  <td>{f.instanceName}</td>
                  <td>{TYPE_LABEL[f.failureType] || f.failureType}</td>
                  <td><StatusBadge status={f.severity} /></td>
                  <td><StatusBadge status={f.status} /></td>
                  <td className="small">{f.message}</td>
                  <td>{f.detectionTimeSec != null ? `${f.detectionTimeSec} s` : '-'}</td>
                  <td>{time(f.resolvedAt)}</td>
                  <td>{f.failureCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}