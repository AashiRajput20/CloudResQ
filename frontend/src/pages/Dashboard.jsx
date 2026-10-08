import useBackendHealth from '../hooks/useBackendHealth';

export default function Dashboard() {
  const { health, error, loading } = useBackendHealth(5000);

  const backendUp = !!health && health.status === 'ok';
  const dbUp = backendUp && health.mongodb === 'connected';

  return (
    <div className="container">
      <header>
        <h1>CLOUDRESQ</h1>
        <p className="subtitle">Intelligent Self-Healing Cloud Infrastructure</p>
      </header>

      <section className="card">
        {loading && <p className="status checking">Checking backend...</p>}

        {!loading && backendUp && (
          <p className="status ok">🟢 CloudResQ Backend Connected</p>
        )}

        {!loading && !backendUp && (
          <p className="status fail">🔴 Backend Unreachable ({error})</p>
        )}

        <ul className="details">
          <li>
            <span>Backend</span>
            <strong>{backendUp ? 'ONLINE' : 'OFFLINE'}</strong>
          </li>
          <li>
            <span>MongoDB</span>
            <strong>{dbUp ? 'CONNECTED' : backendUp ? health.mongodb.toUpperCase() : 'UNKNOWN'}</strong>
          </li>
          <li>
            <span>Docker Engine</span>
            <strong>{backendUp ? (health.docker === 'connected' ? 'CONNECTED' : 'UNREACHABLE') : 'UNKNOWN'}</strong>
          </li>
           <li>
            <span>Health Monitor</span>
            <strong>{backendUp ? (health.monitor === 'running' ? 'RUNNING' : 'STOPPED') : 'UNKNOWN'}</strong>
          </li>
          <li>
            <span>Backend uptime</span>
            <strong>{backendUp ? `${health.uptimeSeconds}s` : '-'}</strong>
          </li>
          <li>
            <span>Last checked</span>
            <strong>{backendUp ? new Date(health.timestamp).toLocaleTimeString() : '-'}</strong>
          </li>
        </ul>
      </section>
    </div>
  );
}