import { useCallback, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { getAnalytics, errorMessage } from '../services/api';
import usePolling from '../hooks/usePolling';

const TYPE_LABEL = {
  CONTAINER_DOWN: 'Container Down',
  HEALTH_CHECK_FAILED: 'Health Check Failed',
  HIGH_CPU: 'High CPU',
  HIGH_MEMORY: 'High Memory',
  HIGH_LATENCY: 'High Latency',
  HIGH_ERROR_RATE: 'High Error Rate',
  REPEATED_FAILURE: 'Repeated Failure',
};
const axis = { stroke: '#64748b', fontSize: 11 };
const tooltip = {
  contentStyle: { background: '#0f172a', border: '1px solid #334155', borderRadius: 8 },
  labelStyle: { color: '#94a3b8' },
  cursor: { fill: 'rgba(148,163,184,0.08)' },
};
const OK = '#4ade80';
const BAD = '#f87171';
const BLUE = '#38bdf8';

const num = (v, unit = '') => (v == null ? '-' : `${v}${unit}`);
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const minutesText = (sec) => (sec >= 120 ? `${Math.round(sec / 60)} min` : `${sec} s`);

function Stat({ label, value, hint, cls = '' }) {
  return (
    <div className="stat-card">
      <div className={`stat-value ${cls}`}>{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

function ChartCard({ title, note, empty, children }) {
  return (
    <section className="card">
      <h3 style={{ marginBottom: 2 }}>{title}</h3>
      {note && <p className="muted small" style={{ margin: '0 0 8px' }}>{note}</p>}
      {empty ? <p className="muted">{empty}</p> : <div className="chart-box">{children}</div>}
    </section>
  );
}

export default function Analytics() {
  const [a, setA] = useState(null);
  const [minutes, setMinutes] = useState(60);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setA(await getAnalytics({ minutes }));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [minutes]);

  usePolling(load, 5000);

  const timeline = (a?.timeline || []).map((e) => ({ label: `${clock(e.t)} ${e.name}`, duration: e.duration, status: e.status }));
  const failuresByType = (a?.failures.byType || []).map((x) => ({ name: TYPE_LABEL[x.type] || x.type, count: x.count }));
  const outcomes = (a?.recovery.byAction || []).map((x) => ({
    name: x.action === 'RESTART' ? 'Restarts' : 'Replacements', success: x.success, failed: x.failed,
  }));
  const instanceAvail = (a?.availability.instances || []).map((i) => ({ name: i.instanceName, availability: i.availability ?? 0 }));

  return (
    <div className="container" style={{ maxWidth: 1100 }}>
      <div className="form-row" style={{ justifyContent: 'space-between' }}>
        <h2 className="page-title">Analytics</h2>
        <label>
          Time window{' '}
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            <option value={15}>Last 15 minutes</option>
            <option value={60}>Last hour</option>
            <option value={360}>Last 6 hours</option>
            <option value={1440}>Last 24 hours</option>
          </select>
        </label>
      </div>
      {error && <p className="error-box">{error}</p>}

      {!a ? (
        <p className="muted">Loading...</p>
      ) : (
        <>
          <div className="stat-grid">
            <Stat label="Recovery Success Rate" value={num(a.recovery.successRate, '%')}
              hint={`${a.recovery.successful} of ${a.recovery.total} automatic recoveries`}
              cls={a.recovery.successRate != null && a.recovery.successRate < 80 ? 'bad-text' : 'ok-text'} />
            <Stat label="Average Recovery Time" value={num(a.recovery.avgRecoveryTimeSec, ' s')}
              hint={a.recovery.maxRecoveryTimeSec != null ? `fastest ${a.recovery.minRecoveryTimeSec} s, slowest ${a.recovery.maxRecoveryTimeSec} s` : 'no recoveries yet'} />
            <Stat label="Service Availability" value={num(a.availability.service.percent, '%')}
              hint={`up ${minutesText(a.availability.service.uptimeSec)}, down ${minutesText(a.availability.service.downtimeSec)}`}
              cls={a.availability.service.percent != null && a.availability.service.percent < 99 ? 'bad-text' : 'ok-text'} />
            <Stat label="Failure Detection Time" value={num(a.detection.avgDetectionTimeSec, ' s')}
              hint={`${a.detection.samples} availability failure(s)`} />
          </div>
          <div className="stat-grid">
            <Stat label="Failures detected" value={a.failures.total} hint={`${a.failures.active} active now`} />
            <Stat label="Failed recoveries" value={a.recovery.failed} cls={a.recovery.failed > 0 ? 'bad-text' : ''} />
            <Stat label="Scaling actions" value={a.scaling.total} hint={`${a.scaling.scaleOut} out, ${a.scaling.scaleIn} in`} />
            <Stat label="Decisions made" value={a.decisions.byAction.reduce((s, d) => s + d.count, 0)}
              hint={a.decisions.byAction.slice(0, 3).map((d) => `${d.action} ${d.count}`).join(', ') || 'none'} />
          </div>

          <ChartCard title="Recovery time per recovery" note="Green = recovered, red = the recovery failed. Newest on the right."
            empty={timeline.length === 0 ? 'No automatic recoveries in this window. Simulate a failure on Service Details.' : null}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={timeline} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={30} />
                <YAxis unit=" s" {...axis} />
                <Tooltip {...tooltip} />
                <Bar dataKey="duration" name="Duration (s)" isAnimationActive={false}>
                  {timeline.map((e, i) => <Cell key={i} fill={e.status === 'SUCCESS' ? OK : BAD} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Failures by type"
            empty={failuresByType.length === 0 ? 'No failures in this window.' : null}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={failuresByType} layout="vertical" margin={{ top: 8, right: 24, left: 20, bottom: 0 }}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} {...axis} />
                <YAxis type="category" dataKey="name" width={140} {...axis} />
                <Tooltip {...tooltip} />
                <Bar dataKey="count" name="Failures" fill={BLUE} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Recovery outcomes" note="Automatic recoveries by strategy."
            empty={a.recovery.total === 0 ? 'No automatic recoveries in this window.' : null}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={outcomes} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis dataKey="name" {...axis} />
                <YAxis allowDecimals={false} {...axis} />
                <Tooltip {...tooltip} />
                <Legend />
                <Bar dataKey="success" name="Succeeded" stackId="o" fill={OK} isAnimationActive={false} />
                <Bar dataKey="failed" name="Failed" stackId="o" fill={BAD} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Instance availability"
            note="Share of health checks that passed. The service itself stays available while other instances answer."
            empty={instanceAvail.length === 0 ? 'No health checks in this window yet.' : null}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={instanceAvail} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis dataKey="name" {...axis} />
                <YAxis domain={[0, 100]} unit="%" {...axis} />
                <Tooltip {...tooltip} />
                <Bar dataKey="availability" name="Availability (%)" isAnimationActive={false}>
                  {instanceAvail.map((i, k) => <Cell key={k} fill={i.availability >= 99 ? OK : i.availability >= 90 ? '#fbbf24' : BAD} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <section className="card">
            <h3>How these numbers are calculated</h3>
            <table className="table">
              <tbody>
                <tr><td><strong>Recovery Success Rate</strong></td><td>successful recoveries / total recoveries &times; 100. Only automatic RESTART and REPLACE actions count; manual button clicks are excluded.</td></tr>
                <tr><td><strong>Average Recovery Time</strong></td><td>total time of successful recoveries / number of successful recoveries. Time runs from the action start until /health passed verification.</td></tr>
                <tr><td><strong>Availability</strong></td><td>uptime / (uptime + downtime) &times; 100. Each {a.intervalMs / 1000} s monitor cycle in which at least one instance was healthy counts as uptime, otherwise downtime. Only monitored time is counted.</td></tr>
                <tr><td><strong>Failure Detection Time</strong></td><td>time the failure was confirmed - time of the first failed health check (about 2 intervals with 3 checks).</td></tr>
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}