import { useCallback, useState } from 'react';
import { getScalingEvents, errorMessage } from '../services/api';
import usePolling from '../hooks/usePolling';
import StatusBadge from '../components/StatusBadge';

const TRIGGER_LABEL = { CPU: 'High CPU', MEMORY: 'High memory', LOW_USAGE: 'Low usage', MANUAL: 'Manual' };

export default function ScalingHistory() {
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setEvents(await getScalingEvents({ limit: 100 }));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(load, 5000);

  return (
    <div className="container" style={{ maxWidth: 1200 }}>
      <h2 className="page-title">Scaling History</h2>
      {error && <p className="error-box">{error}</p>}

      <section className="card">
        <h3>Scaling actions <span className="muted small">(live, refreshes every 5 s)</span></h3>
        {loading ? (
          <p className="muted">Loading...</p>
        ) : events.length === 0 ? (
          <p className="muted">No scaling yet. Create CPU load on an instance (Simulate &gt; High CPU) or use the Scale buttons on Service Details.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Time</th><th>Action</th><th>Replicas</th><th>Instance</th><th>Trigger</th>
                <th>Reason</th><th>Duration</th><th>Result</th><th>By</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e._id}>
                  <td>{new Date(e.startedAt).toLocaleTimeString()}</td>
                  <td><StatusBadge status={e.action} /></td>
                  <td><strong>{e.previousReplicas} &rarr; {e.newReplicas}</strong></td>
                  <td>{e.action === 'SCALE_OUT' ? `+ ${e.instanceName}` : `- ${e.instanceName}`}</td>
                  <td>{TRIGGER_LABEL[e.trigger] || e.trigger}</td>
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