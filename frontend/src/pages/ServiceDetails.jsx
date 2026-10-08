import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getService, getServiceInstances, getHealthChecks, syncFromDocker, errorMessage,
} from '../services/api';
import usePolling from '../hooks/usePolling';
import StatusBadge from '../components/StatusBadge';

export default function ServiceDetails() {
  const { id } = useParams();
  const [service, setService] = useState(null);
  const [instances, setInstances] = useState([]);
  const [checks, setChecks] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [svc, inst, hc] = await Promise.all([
        getService(id),
        getServiceInstances(id),
        getHealthChecks({ serviceId: id, limit: 15 }),
      ]);
      setService(svc);
      setInstances(inst);
      setChecks(hc);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [id]);

  // The Health Monitor updates the database every 5 s; the page re-reads it every 5 s.
  usePolling(load, 5000);

  const handleCheckNow = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await syncFromDocker();
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loadError && !service) {
    return (
      <div className="container">
        <p className="error-box">{loadError}</p>
        <Link to="/services">← Back to Services</Link>
      </div>
    );
  }
  if (!service) return <div className="container"><p className="muted">Loading...</p></div>;

  return (
    <div className="container">
      <Link to="/services">← Back to Services</Link>
      <h2 className="page-title">{service.name}</h2>

      {loadError && <p className="error-box">Connection problem: {loadError}</p>}
      {actionError && <p className="error-box">{actionError}</p>}

      <section className="card">
        <ul className="details">
          <li><span>Status</span><StatusBadge status={service.status} /></li>
          <li><span>Desired replicas</span><strong>{service.desiredReplicas}</strong></li>
          <li><span>Current replicas</span><strong>{service.currentReplicas}</strong></li>
          <li><span>Min / Max replicas</span><strong>{service.minimumReplicas} / {service.maximumReplicas}</strong></li>
        </ul>
      </section>

      <section className="card">
        <div className="form-row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Instances <span className="muted small">(live, refreshes every 5 s)</span></h3>
          <button className="btn" onClick={handleCheckNow} disabled={busy}>
            {busy ? 'Checking...' : 'Check now'}
          </button>
        </div>

        {instances.length === 0 ? (
          <p className="muted">No instances yet. Start the containers (<code>docker compose up -d</code>) and wait a few seconds.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Instance</th><th>Container</th><th>Status</th><th>CPU</th><th>Memory</th>
                <th>Response</th><th>Fail streak</th><th>Restarts</th><th>Failures</th><th>Last check</th>
              </tr>
            </thead>
            <tbody>
              {instances.map((i) => (
                <tr key={i._id}>
                  <td>{i.instanceName}</td>
                  <td><code>{i.containerId ? i.containerId.slice(0, 12) : '-'}</code></td>
                  <td><StatusBadge status={i.status} /></td>
                  <td>{i.cpuUsage}%</td>
                  <td>{i.memoryUsage}%</td>
                  <td>{i.responseTimeMs != null ? `${i.responseTimeMs} ms` : '-'}</td>
                  <td>{i.consecutiveFailures}</td>
                  <td>{i.restartCount}</td>
                  <td>{i.failureCount}</td>
                  <td>{i.lastHealthCheck ? new Date(i.lastHealthCheck).toLocaleTimeString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h3>Health check history <span className="muted small">(last 15)</span></h3>
        {checks.length === 0 ? (
          <p className="muted">No checks recorded yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Time</th><th>Instance</th><th>Result</th><th>HTTP</th>
                <th>Response</th><th>Error</th><th>Streak</th><th>Status after</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c._id}>
                  <td>{new Date(c.checkedAt).toLocaleTimeString()}</td>
                  <td>{c.instanceName}</td>
                  <td className={c.healthy ? 'ok-text' : 'bad-text'}>{c.healthy ? '✔ pass' : '✖ fail'}</td>
                  <td>{c.httpStatus ?? '-'}</td>
                  <td>{c.responseTimeMs != null ? `${c.responseTimeMs} ms` : '-'}</td>
                  <td>{c.error || '-'}</td>
                  <td>{c.consecutiveFailures}</td>
                  <td><StatusBadge status={c.statusAfter} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}