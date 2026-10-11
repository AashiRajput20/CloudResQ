import { useCallback, useState } from 'react';
import { getLoadBalancer, syncLoadBalancer, errorMessage } from '../services/api';
import usePolling from '../hooks/usePolling';

// Which instances receive traffic through Nginx right now, and why the others do not.
export default function LoadBalancerPanel() {
  const [lb, setLb] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setLb(await getLoadBalancer());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  usePolling(load, 5000);

  const handleSync = async () => {
    setBusy(true);
    try {
      setLb(await syncLoadBalancer());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="form-row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Load Balancer <span className="muted small">(Nginx, live)</span></h3>
        <button className="btn btn-small" onClick={handleSync} disabled={busy}>
          {busy ? 'Applying...' : 'Re-apply pool'}
        </button>
      </div>

      {error && <p className="error-box">{error}</p>}
      {!lb ? (
        <p className="muted">Loading...</p>
      ) : (
        <>
          {lb.lastError && <p className="error-box">{lb.lastError}</p>}
          <ul className="details">
            <li><span>Entry point</span><code>{lb.entryUrl}</code></li>
            <li>
              <span>Nginx</span>
              <span className={`badge ${lb.nginx.running ? 'badge-healthy' : 'badge-failed'}`}>
                {lb.nginx.running ? 'RUNNING' : 'STOPPED'}
              </span>
            </li>
            <li>
              <span>Active pool ({lb.pool.length})</span>
              <div className="pool-list">
                {lb.pool.length === 0 && <span className="muted">empty</span>}
                {lb.pool.map((n) => <span key={n} className="badge badge-healthy">{n}</span>)}
              </div>
            </li>
            <li>
              <span>Not receiving traffic ({lb.excluded.length})</span>
              <div className="pool-list">
                {lb.excluded.length === 0 && <span className="muted">none</span>}
                {lb.excluded.map((e) => (
                  <span key={e.instanceName}>
                    <span className="badge badge-failed">{e.instanceName}</span>{' '}
                    <span className="muted small">{e.reason}</span>
                  </span>
                ))}
              </div>
            </li>
            <li><span>Nginx reloads</span><strong>{lb.reloads}</strong></li>
            <li>
              <span>Last reload</span>
              <strong>{lb.lastReloadAt ? new Date(lb.lastReloadAt).toLocaleTimeString() : '-'}</strong>
            </li>
          </ul>
        </>
      )}
    </section>
  );
}