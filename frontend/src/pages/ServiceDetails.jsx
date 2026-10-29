import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getService, getServiceInstances, getHealthChecks, syncFromDocker,
  restartInstance, replaceInstance, simulateInstance, restartService, scaleService, errorMessage,
} from '../services/api';
import usePolling from '../hooks/usePolling';
import StatusBadge from '../components/StatusBadge';
import AnalysisPanel from '../components/AnalysisPanel';
import DecisionPanel from '../components/DecisionPanel';
import MetricsChart from '../components/MetricsChart';

const SIM_TYPES = [
  ['health', 'Health failure (503)'],
  ['persistent', 'Repeated failure (survives restart)'],
  ['crash', 'Container crash'],
  ['cpu', 'High CPU (120 s)'],
  ['memory', 'High memory'],
  ['latency', 'High latency'],
  ['recovery', 'Clear simulation (recover)'],
];

export default function ServiceDetails() {
  const { id } = useParams();
  const [service, setService] = useState(null);
  const [instances, setInstances] = useState([]);
  const [checks, setChecks] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [simType, setSimType] = useState({}); // instanceId -> selected simulation

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

  // Runs one action, shows the result, then refreshes the page data.
  const run = async (key, fn, okMessage) => {
    setBusyKey(key);
    setActionError(null);
    setNotice(null);
    try {
      const result = await fn();
      setNotice(okMessage(result));
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyKey(null);
    }
  };

  const simFor = (i) => simType[i._id] || 'health';

  const handleRestart = (i) =>
    run(`${i._id}:restart`, () => restartInstance(i._id), (e) =>
      e.status === 'SUCCESS'
        ? `${i.instanceName}: restarted and healthy again in ${e.duration} s`
        : `${i.instanceName}: restart failed (${e.error})`);

  const handleReplace = (i) => {
    if (!window.confirm(`Replace ${i.instanceName} with a brand-new instance?`)) return null;
    return run(`${i._id}:replace`, () => replaceInstance(i._id), (e) =>
      e.status === 'SUCCESS'
        ? `${e.oldInstance} replaced by ${e.newInstance} in ${e.duration} s`
        : `Replace failed (${e.error})`);
  };

  const handleSimulate = (i) =>
    run(`${i._id}:sim`, () => simulateInstance(i._id, simFor(i)), (r) => r.message || 'Simulation started');

  const handleRolling = () => {
    if (!window.confirm('Restart every instance, one after another?')) return null;
    return run('service:restart', () => restartService(id), (r) =>
      `Rolling restart finished: ${r.results.map((x) => `${x.instance} ${x.status}`).join(', ')}`);
  };

  const handleScale = (direction) =>
    run(`scale:${direction}`, () => scaleService(id, direction), (e) =>
      e.status === 'SUCCESS'
        ? `${direction === 'out' ? 'Scaled out' : 'Scaled in'}: ${e.previousReplicas} to ${e.newReplicas} replicas in ${e.duration} s (${e.instanceName})`
        : `Scaling failed (${e.error})`);

  const handleCheckNow = () => run('check', () => syncFromDocker(), () => 'Checked all instances');

  if (loadError && !service) {
    return (
      <div className="container">
        <p className="error-box">{loadError}</p>
        <Link to="/services">← Back to Services</Link>
      </div>
    );
  }
  if (!service) return <div className="container"><p className="muted">Loading...</p></div>;

  const anyBusy = !!busyKey;

  return (
    <div className="container" style={{ maxWidth: 1200 }}>
      <Link to="/services">← Back to Services</Link>
      <h2 className="page-title">{service.name}</h2>

      {loadError && <p className="error-box">Connection problem: {loadError}</p>}
      {actionError && <p className="error-box">{actionError}</p>}
      {notice && <p className="notice-box">{notice}</p>}

      <section className="card">
        <ul className="details">
          <li><span>Status</span><StatusBadge status={service.status} /></li>
          <li><span>Desired replicas</span><strong>{service.desiredReplicas}</strong></li>
          <li><span>Current replicas</span><strong>{service.currentReplicas}</strong></li>
          <li><span>Min / Max replicas</span><strong>{service.minimumReplicas} / {service.maximumReplicas}</strong></li>
        </ul>
      </section>

      <MetricsChart serviceId={id} />

      <section className="card">
        <div className="form-row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Instances <span className="muted small">(live, refreshes every 5 s)</span></h3>
          <div className="row-actions">
            <button className="btn btn-secondary" onClick={() => handleScale('out')} disabled={anyBusy}>
              {busyKey === 'scale:out' ? 'Scaling out...' : 'Scale out'}
            </button>
            <button className="btn btn-secondary" onClick={() => handleScale('in')} disabled={anyBusy}>
              {busyKey === 'scale:in' ? 'Scaling in...' : 'Scale in'}
            </button>
            <button className="btn btn-secondary" onClick={handleRolling} disabled={anyBusy}>
              {busyKey === 'service:restart' ? 'Restarting all...' : 'Rolling restart'}
            </button>
            <button className="btn" onClick={handleCheckNow} disabled={anyBusy}>
              {busyKey === 'check' ? 'Checking...' : 'Check now'}
            </button>
          </div>
        </div>

        {instances.length === 0 ? (
          <p className="muted">No instances yet. Start the containers (<code>docker compose up -d</code>) and wait a few seconds.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Instance</th><th>Status</th><th>Traffic</th><th>CPU</th><th>Memory</th>
                <th>Streak</th><th>Restarts</th><th>Failures</th><th>Last check</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {instances.map((i) => (
                <tr key={i._id}>
                  <td>{i.instanceName}</td>
                  <td><StatusBadge status={i.status} /></td>
                  <td className={i.inTraffic === false ? 'bad-text' : 'ok-text'}>{i.inTraffic === false ? 'OUT' : 'IN'}</td>
                  <td>{i.cpuUsage}%</td>
                  <td>{i.memoryUsage}%</td>
                  <td>{i.consecutiveFailures}</td>
                  <td>{i.restartCount}</td>
                  <td>{i.failureCount}</td>
                  <td>{i.lastHealthCheck ? new Date(i.lastHealthCheck).toLocaleTimeString() : '-'}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-small" disabled={anyBusy} onClick={() => handleRestart(i)}>
                        {busyKey === `${i._id}:restart` ? 'Restarting...' : 'Restart'}
                      </button>
                      <button className="btn btn-small btn-danger" disabled={anyBusy} onClick={() => handleReplace(i)}>
                        {busyKey === `${i._id}:replace` ? 'Replacing...' : 'Replace'}
                      </button>
                      <select value={simFor(i)} onChange={(e) => setSimType({ ...simType, [i._id]: e.target.value })}>
                        {SIM_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                      <button className="btn btn-small btn-secondary" disabled={anyBusy} onClick={() => handleSimulate(i)}>
                        Simulate
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">
          Scale out and Scale in change the replica count by one, within the service's min and max. CloudResQ also does this by itself
          when the Decision Engine decides to. These actions are not protected by a login yet.
        </p>
      </section>

      <AnalysisPanel serviceId={id} />
      <DecisionPanel serviceId={id} />

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