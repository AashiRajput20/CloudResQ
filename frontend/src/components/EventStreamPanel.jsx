import { useCallback, useState } from 'react';
import { getEvents, sendTestEvent, errorMessage } from '../services/api';
import usePolling from '../hooks/usePolling';

const detail = (e) => e.message || e.reason || e.resolution || e.note || '';

// The last events that travelled through Redis.
export default function EventStreamPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await getEvents());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  usePolling(load, 3000);

  const handleTest = async () => {
    try {
      await sendTestEvent();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <section className="card">
      <div className="form-row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Event Stream <span className="muted small">(Redis pub/sub, live)</span></h3>
        <button className="btn btn-small" onClick={handleTest}>Send test event</button>
      </div>
      {error && <p className="error-box">{error}</p>}
      {!data ? (
        <p className="muted">Loading...</p>
      ) : !data.enabled ? (
        <p className="muted">Redis messaging is disabled (REDIS_ENABLED=false).</p>
      ) : (
        <>
          <p className="small">
            <span className={`badge ${data.connected ? 'badge-healthy' : 'badge-failed'}`}>
              {data.connected ? 'CONNECTED' : 'UNREACHABLE'}
            </span>{' '}
            <span className="muted">
              published {data.published} · received {data.received} · dropped {data.dropped} · channel <code>{data.channel}</code>
            </span>
          </p>
          {!data.connected && (
            <p className="muted small">
              Redis is down. CloudResQ keeps working normally; events are dropped until it is back.
            </p>
          )}
          {data.recent.length === 0 ? (
            <p className="muted">No events yet. Simulate a failure, or click "Send test event".</p>
          ) : (
            <table className="table">
              <thead><tr><th>Time</th><th>Event</th><th>Instance</th><th>Action / type</th><th>Detail</th></tr></thead>
              <tbody>
                {data.recent.slice(0, 8).map((e, i) => (
                  <tr key={`${e.timestamp}-${i}`}>
                    <td>{new Date(e.timestamp).toLocaleTimeString()}</td>
                    <td><code>{e.event}</code></td>
                    <td>{e.instance || '-'}</td>
                    <td>{e.action || e.failureType || '-'}{e.status ? ` (${e.status})` : ''}</td>
                    <td className="small">{detail(e)}{e.duration != null ? ` ${e.duration} s` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}