import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { getServices, getServiceInstances, errorMessage } from '../services/api';
import usePolling from '../hooks/usePolling';
import StatusBadge from '../components/StatusBadge';

// Shows every instance of every service in one table, refreshed every 5 s.
export default function Instances() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const services = await getServices();
      const lists = await Promise.all(
        services.map(async (s) => {
          const inst = await getServiceInstances(s._id);
          return inst.map((i) => ({ ...i, serviceName: s.name, serviceId: s._id }));
        })
      );
      setRows(lists.flat());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(load, 5000);

  return (
    <div className="container">
      <h2 className="page-title">Instances</h2>
      {error && <p className="error-box">{error}</p>}

      <section className="card">
        {loading ? (
          <p className="muted">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="muted">No instances yet. Run <code>docker compose up -d</code> and wait a few seconds.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Instance</th><th>Service</th><th>Container</th><th>Status</th>
                <th>CPU</th><th>Memory</th><th>Response</th><th>Fail streak</th>
                <th>Restarts</th><th>Last check</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i._id}>
                  <td>{i.instanceName}</td>
                  <td><Link to={`/services/${i.serviceId}`}>{i.serviceName}</Link></td>
                  <td><code>{i.containerId ? i.containerId.slice(0, 12) : '-'}</code></td>
                  <td><StatusBadge status={i.status} /></td>
                  <td>{i.cpuUsage}%</td>
                  <td>{i.memoryUsage}%</td>
                  <td>{i.responseTimeMs != null ? `${i.responseTimeMs} ms` : '-'}</td>
                  <td>{i.consecutiveFailures ?? 0}</td>
                  <td>{i.restartCount}</td>
                  <td>{i.lastHealthCheck ? new Date(i.lastHealthCheck).toLocaleTimeString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">Action buttons (Restart, Replace, Scale...) arrive with the Recovery Controller.</p>
      </section>
    </div>
  );
}