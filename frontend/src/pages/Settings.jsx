import { useCallback, useEffect, useState } from 'react';
import { getSettings, updateServiceLimits, errorMessage } from '../services/api';

const show = (v) => (typeof v === 'boolean' ? (v ? 'ON' : 'OFF') : String(v));

export default function Settings() {
  const [data, setData] = useState(null);
  const [limits, setLimits] = useState({}); // serviceId -> { min, max } being edited
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await getSettings();
      setData(d);
      setLimits(Object.fromEntries(d.services.map((s) => [s._id, { min: s.minimumReplicas, max: s.maximumReplicas }])));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const edit = (id, field, value) =>
    setLimits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));

  const save = async (s) => {
    setSavingId(s._id);
    setError(null);
    setNotice(null);
    try {
      const { min, max } = limits[s._id];
      const updated = await updateServiceLimits(s._id, Number(min), Number(max));
      setNotice(`${updated.name}: limits saved (min ${updated.minimumReplicas}, max ${updated.maximumReplicas}). The next monitor cycle uses them.`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 1000 }}>
      <h2 className="page-title">System Settings</h2>
      {error && <p className="error-box">{error}</p>}
      {notice && <p className="notice-box">{notice}</p>}
      {!data ? (
        <p className="muted">Loading...</p>
      ) : (
        <>
          <section className="card">
            <h3>Replica limits</h3>
            <p className="muted small">
              The Decision Engine never scales below the minimum or above the maximum (Rules 9 and 10). Allowed range: 1 to {data.hardMaxReplicas}.
            </p>
            {data.services.length === 0 ? (
              <p className="muted">No services yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr><th>Service</th><th>Running</th><th>Minimum</th><th>Maximum</th><th></th></tr>
                </thead>
                <tbody>
                  {data.services.map((s) => (
                    <tr key={s._id}>
                      <td>{s.name}</td>
                      <td>{s.currentReplicas}</td>
                      <td>
                        <input type="number" min="1" max={data.hardMaxReplicas} value={limits[s._id]?.min ?? ''}
                          onChange={(e) => edit(s._id, 'min', e.target.value)} />
                      </td>
                      <td>
                        <input type="number" min="1" max={data.hardMaxReplicas} value={limits[s._id]?.max ?? ''}
                          onChange={(e) => edit(s._id, 'max', e.target.value)} />
                      </td>
                      <td>
                        <button className="btn btn-small" disabled={savingId === s._id} onClick={() => save(s)}>
                          {savingId === s._id ? 'Saving...' : 'Save'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {data.sections.map((sec) => (
            <section className="card" key={sec.title}>
              <h3 style={{ marginBottom: 2 }}>{sec.title}</h3>
              <p className="muted small" style={{ margin: '0 0 8px' }}>{sec.description}</p>
              <table className="table">
                <tbody>
                  {sec.items.map((it) => (
                    <tr key={it.label}>
                      <td>{it.label}</td>
                      <td><strong>{show(it.value)}{it.unit && typeof it.value !== 'boolean' ? ` ${it.unit}` : ''}</strong></td>
                      <td className="small"><code>{it.env}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
          <p className="muted small">
            Thresholds come from <code>backend/.env</code> (shown in the right-hand column). Change a value there and restart the backend to apply it.
          </p>
        </>
      )}
    </div>
  );
}