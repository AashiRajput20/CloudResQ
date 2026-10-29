import { useCallback, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts';
import { getMetrics, errorMessage } from '../services/api';
import usePolling from '../hooks/usePolling';

const axis = { stroke: '#64748b', fontSize: 11 };
const tooltip = {
  contentStyle: { background: '#0f172a', border: '1px solid #334155', borderRadius: 8 },
  labelStyle: { color: '#94a3b8' },
};
const timeLabel = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Live resource usage and replica count, refreshed every 5 s from the Health Monitor's data.
export default function MetricsChart({ serviceId, cpuThreshold = 85 }) {
  const [points, setPoints] = useState([]);
  const [minutes, setMinutes] = useState(10);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await getMetrics({ serviceId, minutes });
      setPoints(data.points.map((p) => ({ ...p, time: timeLabel(p.t) })));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [serviceId, minutes]);

  usePolling(load, 5000);

  return (
    <section className="card">
      <div className="form-row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Live metrics <span className="muted small">(updates every 5 s)</span></h3>
        <label>
          Last{' '}
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            <option value={5}>5 min</option>
            <option value={10}>10 min</option>
            <option value={30}>30 min</option>
          </select>
        </label>
      </div>
      {error && <p className="error-box">{error}</p>}

      {points.length < 2 ? (
        <p className="muted">Collecting data... the chart appears after a few monitor cycles.</p>
      ) : (
        <>
          <p className="muted small" style={{ margin: '4px 0' }}>
            CPU and memory (% of each container's limit). The dashed line is the {cpuThreshold}% scale-out threshold.
          </p>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis dataKey="time" {...axis} minTickGap={50} />
                <YAxis domain={[0, 100]} unit="%" {...axis} />
                <Tooltip {...tooltip} />
                <Legend />
                <ReferenceLine y={cpuThreshold} stroke="#f87171" strokeDasharray="6 4" />
                <Line type="monotone" dataKey="cpu" name="Average CPU" stroke="#38bdf8" dot={false} strokeWidth={2} isAnimationActive={false} />
                <Line type="monotone" dataKey="maxCpu" name="Hottest instance CPU" stroke="#fbbf24" dot={false} strokeWidth={2} isAnimationActive={false} />
                <Line type="monotone" dataKey="memory" name="Average memory" stroke="#a78bfa" dot={false} strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <p className="muted small" style={{ margin: '12px 0 4px' }}>Running replicas</p>
          <div className="chart-box chart-small">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis dataKey="time" {...axis} minTickGap={50} />
                <YAxis allowDecimals={false} domain={[0, (max) => max + 1]} {...axis} />
                <Tooltip {...tooltip} />
                <Line type="stepAfter" dataKey="replicas" name="Replicas" stroke="#4ade80" dot={false} strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </section>
  );
}