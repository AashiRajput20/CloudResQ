import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getService, getServiceInstances, errorMessage } from '../services/api';
import StatusBadge from '../components/StatusBadge';

export default function ServiceDetails() {
  const { id } = useParams();
  const [service, setService] = useState(null);
  const [instances, setInstances] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [svc, inst] = await Promise.all([getService(id), getServiceInstances(id)]);
        setService(svc);
        setInstances(inst);
        setError(null);
      } catch (err) {
        setError(errorMessage(err));
      }
    };
    load();
  }, [id]);

  if (error) {
    return (
      <div className="container">
        <p className="error-box">{error}</p>
        <Link to="/services">← Back to Services</Link>
      </div>
    );
  }
  if (!service) return <div className="container"><p className="muted">Loading...</p></div>;

  return (
    <div className="container">
      <Link to="/services">← Back to Services</Link>
      <h2 className="page-title">{service.name}</h2>

      <section className="card">
        <ul className="details">
          <li><span>Status</span><StatusBadge status={service.status} /></li>
          <li><span>Desired replicas</span><strong>{service.desiredReplicas}</strong></li>
          <li><span>Current replicas</span><strong>{service.currentReplicas}</strong></li>
          <li><span>Min / Max replicas</span><strong>{service.minimumReplicas} / {service.maximumReplicas}</strong></li>
        </ul>
      </section>

      <section className="card">
        <h3>Instances</h3>
        {instances.length === 0 ? (
          <p className="muted">No instances yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Instance</th><th>Status</th><th>CPU</th><th>Memory</th>
                <th>Restarts</th><th>Failures</th><th>Last Health Check</th>
              </tr>
            </thead>
            <tbody>
              {instances.map((i) => (
                <tr key={i._id}>
                  <td>{i.instanceName}</td>
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
        <p className="muted small">Action buttons (Restart, Replace, Scale...) are added in later phases.</p>
      </section>
    </div>
  );
}