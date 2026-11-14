import { useCallback, useState } from 'react';
import { getAnalytics, errorMessage } from '../services/api';
import usePolling from '../hooks/usePolling';

const num = (v, unit = '') => (v == null ? '-' : `${v}${unit}`);

// Summary numbers for the main Dashboard (failures and recoveries cover the last 24 hours).
export default function OverviewCards() {
  const [a, setA] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setA(await getAnalytics({ minutes: 1440 }));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  usePolling(load, 5000);

  if (error && !a) return <p className="error-box">{error}</p>;
  if (!a) return null;
  const o = a.overview;

  const cards = [
    ['Total Services', o.totalServices, ''],
    ['Healthy Instances', o.healthyInstances, 'ok-text'],
    ['Unhealthy Instances', o.unhealthyInstances, o.unhealthyInstances > 0 ? 'bad-text' : ''],
    ['Active Replicas', o.activeReplicas, ''],
    ['Failures (24 h)', a.failures.total, ''],
    ['Recoveries (24 h)', a.recovery.total, ''],
    ['Recovery Success Rate', num(a.recovery.successRate, '%'), ''],
    ['Avg Recovery Time', num(a.recovery.avgRecoveryTimeSec, ' s'), ''],
  ];

  return (
    <div className="stat-grid">
      {cards.map(([label, value, cls]) => (
        <div className="stat-card" key={label}>
          <div className={`stat-value ${cls}`}>{value}</div>
          <div className="stat-label">{label}</div>
        </div>
      ))}
    </div>
  );
}