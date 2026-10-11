import { useCallback, useState } from 'react';
import { getLiveDecisions, getDecisions, errorMessage } from '../services/api';
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
const time = (d) => new Date(d).toLocaleTimeString();
const pct = (n) => (n == null ? '-' : `${n}%`);

// "Why did CloudResQ choose this action?" - the Decision Engine screen.
export default function DecisionPanel({ serviceId }) {
  const [live, setLive] = useState([]);
  const [log, setLog] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [l, g] = await Promise.all([getLiveDecisions({ serviceId }), getDecisions({ serviceId, limit: 10 })]);
      setLive(l);
      setLog(g);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [serviceId]);

  usePolling(load, 5000);

  // Show the full explanation only for instances where something is happening.
   const interesting = live.filter((d) => d.action !== 'NO_ACTION' || d.trafficAction || d.blockedBy || ['WARNING', 'RECOVERING'].includes(d.inputs.health));

  return (
    <section className="card">
      <h3>Decision Engine <span className="muted small">(Rule-Based Intelligent Decision Engine, live)</span></h3>
      {error && <p className="error-box">{error}</p>}

      <table className="table">
        <thead>
          <tr>
            <th>Instance</th><th>Health</th><th>Failure</th><th>Failures</th><th>Restarts</th>
            <th>CPU</th><th>Mem</th><th>Decision</th><th>Traffic</th><th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {live.map((d) => (
            <tr key={String(d.instanceId)}>
              <td>{d.instanceName}</td>
              <td><StatusBadge status={d.inputs.health} /></td>
              <td>{d.inputs.failureType ? TYPE_LABEL[d.inputs.failureType] : '-'}</td>
              <td>{d.inputs.failureCount}</td>
              <td>{d.inputs.recentRestarts}</td>
              <td>{pct(d.inputs.cpu)}</td>
              <td>{pct(d.inputs.memory)}</td>
              <td><StatusBadge status={d.action} /></td>
              <td>{d.trafficAction ? <StatusBadge status={d.trafficAction} /> : '-'}</td>
              <td>{d.confidence}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {interesting.map((d) => (
        <div className="decision-box" key={`why-${String(d.instanceId)}`}>
          <ul className="details">
            <li><span>Instance</span><strong>{d.instanceName}</strong></li>
            <li><span>Failure type</span><strong>{d.inputs.failureType ? TYPE_LABEL[d.inputs.failureType] : '-'}</strong></li>
            <li><span>Failure count (10 min)</span><strong>{d.inputs.failureCount}</strong></li>
            <li><span>Recent restarts</span><strong>{d.inputs.recentRestarts} ({d.inputs.failedRestarts} failed)</strong></li>
            <li><span>CPU / Memory</span><strong>{pct(d.inputs.cpu)} / {pct(d.inputs.memory)}</strong></li>
            <li>
              <span>Decision</span>
              <span><StatusBadge status={d.action} /> {d.trafficAction && <StatusBadge status={d.trafficAction} />}</span>
            </li>
            <li><span>Priority / confidence</span><strong>{d.priority} / {d.confidence}</strong></li>
            <li><span>Rule</span><code>{d.rule}</code></li>
          </ul>
          <p><strong>Reason:</strong> "{d.reason}"</p>
        </div>
      ))}

      <h4 style={{ marginBottom: 6 }}>Decision log <span className="muted small">(last 10)</span></h4>
      {log.length === 0 ? (
        <p className="muted">No decisions yet. The log only records proposals that need action, for example after a failure test.</p>
      ) : (
        <table className="table">
          <thead>
            <tr><th>Time</th><th>Instance</th><th>Decision</th><th>Priority</th><th>Conf.</th><th>Reason</th><th>Status</th></tr>
          </thead>
          <tbody>
            {log.map((d) => (
              <tr key={d._id}>
                <td>{time(d.decidedAt)}</td>
                <td>{d.instanceName}</td>
                <td>
                  <StatusBadge status={d.action} />{' '}
                  {d.trafficAction && <StatusBadge status={d.trafficAction} />}
                </td>
                <td><StatusBadge status={d.priority} /></td>
                <td>{d.confidence}</td>
                               <td className="small">
                  {d.reason}
                  {d.note && <div className="muted">Result: {d.note}</div>}
                </td>
                <td><StatusBadge status={d.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
            <p className="muted small">
        The Recovery Controller executes each decision automatically. The log status shows EXECUTED, FAILED or SKIPPED (scaling is skipped until Phase 13).
      </p>
    </section>
  );
}