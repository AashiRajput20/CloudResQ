import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getService, getServiceInstances, syncFromDocker, errorMessage } from '../services/api';
import StatusBadge from '../components/StatusBadge';

export default function ServiceDetails() {
  const { id } = useParams();
  const [service, setService] = useState(null);
  const [instances, setInstances] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [syncError, setSyncError] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [svc, inst] = await Promise.all([getService(id), getServiceInstances(id)]);
      setService(svc);
      setInstances(inst);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      await syncFromDocker();
      await load();
    } catch (err) {
      setSyncError(errorMessage(err));
    } finally {
      setSyncing(false);
    }
  };

  if (loadError) {
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

      {syncError && <p className="error-box">{syncError}</p>}

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
          <h3 style={{ margin: 0 }}>Instances</h3>
          <button className="btn" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing...' : 'Sync from Docker'}
          </button>
        </div>

        {instances.length === 0 ? (
          <p className="muted">No instances yet. Start the containers and click "Sync from Docker".</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Instance</th><th>Container</th><th>Status</th><th>CPU</th><th>Memory</th>
                <th>Restarts</th><th>Failures</th><th>Last Health Check</th>
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
                  <td>{i.restartCount}</td>
                  <td>{i.failureCount}</td>
                  <td>{i.lastHealthCheck ? new Date(i.lastHealthCheck).toLocaleTimeString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">Values update when you click Sync. Continuous monitoring arrives in Phase 6.</p>
      </section>
    </div>
  );
}