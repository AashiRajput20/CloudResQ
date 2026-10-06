import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getServices, createService, deleteService, errorMessage } from '../services/api';
import StatusBadge from '../components/StatusBadge';

const emptyForm = { name: '', desiredReplicas: 3, minimumReplicas: 2, maximumReplicas: 5 };

export default function Services() {
  const [services, setServices] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setServices(await getServices());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleChange = (e) => {
    const { name, value, type } = e.target;
    setForm({ ...form, [name]: type === 'number' ? Number(value) : value });
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await createService(form);
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleDelete = async (service) => {
    if (!window.confirm(`Delete "${service.name}" and all its instances?`)) return;
    try {
      await deleteService(service._id);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="container">
      <h2 className="page-title">Services</h2>

      {error && <p className="error-box">{error}</p>}

      <section className="card">
        <h3>Add Service</h3>
        <form className="form-row" onSubmit={handleCreate}>
          <input name="name" placeholder="Service name" value={form.name} onChange={handleChange} required />
          <label>Desired <input type="number" name="desiredReplicas" min="1" value={form.desiredReplicas} onChange={handleChange} /></label>
          <label>Min <input type="number" name="minimumReplicas" min="1" value={form.minimumReplicas} onChange={handleChange} /></label>
          <label>Max <input type="number" name="maximumReplicas" min="1" value={form.maximumReplicas} onChange={handleChange} /></label>
          <button type="submit" className="btn">Create</button>
        </form>
      </section>

      <section className="card">
        {loading ? (
          <p className="muted">Loading...</p>
        ) : services.length === 0 ? (
          <p className="muted">No services yet. Create one above, or run <code>npm run seed</code> in the backend.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th><th>Status</th><th>Replicas</th><th>Min / Max</th><th></th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s._id}>
                  <td><Link to={`/services/${s._id}`}>{s.name}</Link></td>
                  <td><StatusBadge status={s.status} /></td>
                  <td>{s.currentReplicas} / {s.desiredReplicas}</td>
                  <td>{s.minimumReplicas} / {s.maximumReplicas}</td>
                  <td className="actions">
                    <Link to={`/services/${s._id}`} className="btn btn-small">View</Link>
                    <button className="btn btn-small btn-danger" onClick={() => handleDelete(s)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}