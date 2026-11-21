// Builds infrastructure/grafana/dashboards/cloudresq.json ("dashboard as code").
// Run it after changing a panel:   node infrastructure/grafana/generate-dashboard.js
const fs = require('fs');
const path = require('path');

const DS = { type: 'prometheus', uid: 'prometheus' }; // matches provisioning/datasources/prometheus.yml
let nextId = 1;

const q = (expr, legend = '') => ({ datasource: DS, expr, legendFormat: legend, instant: false });
const steps = (redAt) => (redAt == null
  ? [{ color: 'green', value: null }]
  : [{ color: 'green', value: null }, { color: 'red', value: redAt }]);

// A number tile (top row).
function stat(title, expr, x, { unit = 'short', decimals = 0, noValue = '0', description = '' } = {}) {
  return {
    id: nextId++, type: 'stat', title, description, datasource: DS,
    gridPos: { h: 4, w: 4, x, y: 0 },
    targets: [{ ...q(expr), refId: 'A' }],
    fieldConfig: {
      defaults: { unit, decimals, noValue, color: { mode: 'thresholds' }, thresholds: { mode: 'absolute', steps: steps() } },
      overrides: [],
    },
    options: {
      reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
      colorMode: 'value', graphMode: 'none', textMode: 'auto', orientation: 'auto',
    },
  };
}

// A time-series graph. `redAt` draws a red threshold line (for example 85% CPU).
function graph(title, queries, pos, { unit = 'short', min, max, redAt, style = 'line', step = false, description = '', noValue } = {}) {
  const defaults = {
    unit,
    color: { mode: 'palette-classic' },
    custom: {
      drawStyle: style, lineWidth: 2, fillOpacity: style === 'bars' ? 60 : 10,
      showPoints: style === 'points' ? 'always' : 'never', spanNulls: true,
      lineInterpolation: step ? 'stepAfter' : 'linear',
      thresholdsStyle: { mode: redAt == null ? 'off' : 'line' },
    },
    thresholds: { mode: 'absolute', steps: steps(redAt) },
  };
  if (min != null) defaults.min = min;
  if (max != null) defaults.max = max;
  if (noValue) defaults.noValue = noValue;
  return {
    id: nextId++, type: 'timeseries', title, description, datasource: DS, gridPos: pos,
    targets: queries.map((t, i) => ({ ...t, refId: String.fromCharCode(65 + i) })),
    fieldConfig: { defaults, overrides: [] },
    options: {
      legend: { displayMode: 'list', placement: 'bottom', showLegend: true },
      tooltip: { mode: 'multi', sort: 'none' },
    },
  };
}

const at = (x, y, w = 12, h = 8) => ({ x, y, w, h });

const panels = [
  // ---- row 1: key numbers for the selected time range ----
  stat('Active instances', 'sum(cloudresq_active_instances)', 0, { description: 'Instances able to receive traffic right now' }),
  stat('Healthy instances', 'sum(cloudresq_instance_healthy)', 4),
  stat('Failures detected', 'sum(increase(cloudresq_failures_total[$__range]))', 8),
  stat('Successful recoveries', 'sum(increase(cloudresq_recoveries_total{status="SUCCESS"}[$__range]))', 12),
  stat('Avg recovery time',
    'sum(increase(cloudresq_recovery_duration_seconds_sum[$__range])) / sum(increase(cloudresq_recovery_duration_seconds_count[$__range])) > 0',
    16, { unit: 's', decimals: 1, noValue: '-' }),
  stat('Scaling actions', 'sum(increase(cloudresq_scaling_events_total{status="SUCCESS"}[$__range]))', 20),

  // ---- row 2: resources ----
  graph('CPU usage per instance', [q('cloudresq_cpu_usage', '{{instance}}')], at(0, 4),
    { unit: 'percent', min: 0, max: 100, redAt: 85, description: 'Percent of the container CPU limit. Red line = scale-out threshold (85%).' }),
  graph('Memory usage per instance', [q('cloudresq_memory_usage', '{{instance}}')], at(12, 4),
    { unit: 'percent', min: 0, max: 100, redAt: 85, description: 'Percent of the container memory limit. Red line = scale-out threshold (85%).' }),

  // ---- row 3: replicas and traffic ----
  graph('Replicas', [
    q('sum(cloudresq_active_instances)', 'Active (receiving traffic)'),
    q('sum(cloudresq_current_replicas)', 'Running'),
    q('sum(cloudresq_min_replicas)', 'Minimum'),
    q('sum(cloudresq_max_replicas)', 'Maximum'),
  ], at(0, 12), { min: 0, step: true, description: 'Scale-out and scale-in appear as steps. Min and max are the limits the Decision Engine respects.' }),
  graph('Request rate per instance', [q('sum by (instance_name) (rate(cloudresq_requests_total[$__rate_interval]))', '{{instance_name}}')],
    at(12, 12), { unit: 'reqps', min: 0, description: 'Needs traffic: run  npm run traffic  in the backend folder.' }),

  // ---- row 4: errors and latency ----
  graph('Error rate (HTTP 5xx per second)', [q('sum by (instance_name) (rate(cloudresq_errors_total[$__rate_interval]))', '{{instance_name}}')],
    at(0, 20), { unit: 'reqps', min: 0, noValue: 'no errors', description: 'A failing instance returns 503 on /health until CloudResQ removes it from traffic.' }),
  graph('Response time', [
    q('histogram_quantile(0.95, sum by (le, instance_name) (rate(cloudresq_request_duration_seconds_bucket[$__rate_interval])))', 'p95 request {{instance_name}}'),
    q('cloudresq_response_time_ms / 1000', 'health check {{instance}}'),
  ], at(12, 20), { unit: 's', min: 0, description: 'p95 of real requests (needs traffic) and the monitor\'s health-check time.' }),

  // ---- row 5: what CloudResQ did ----
  graph('Failures by type', [q('sum by (type) (increase(cloudresq_failures_total[1m]))', '{{type}}')],
    at(0, 28, 8), { style: 'bars', min: 0, description: 'Failures detected per minute.' }),
  graph('Recoveries', [q('sum by (action, status) (increase(cloudresq_recoveries_total[1m]))', '{{action}} {{status}}')],
    at(8, 28, 8), { style: 'bars', min: 0, description: 'Restarts and replacements finished per minute.' }),
  graph('Recovery time', [q(
    'sum by (action) (increase(cloudresq_recovery_duration_seconds_sum[5m])) / sum by (action) (increase(cloudresq_recovery_duration_seconds_count[5m])) > 0',
    'avg {{action}}')],
  at(16, 28, 8), { unit: 's', min: 0, style: 'points', description: 'Average time of successful recoveries (5-minute window).' }),
];

const dashboard = {
  uid: 'cloudresq-overview',
  title: 'CloudResQ - Infrastructure',
  description: 'Infrastructure metrics. Decisions and their reasons are shown in the CloudResQ dashboard.',
  tags: ['cloudresq'],
  timezone: 'browser',
  schemaVersion: 39,
  version: 1,
  editable: true,
  refresh: '5s',
  time: { from: 'now-15m', to: 'now' },
  templating: { list: [] },
  annotations: { list: [] },
  panels,
};

const outDir = path.join(__dirname, 'dashboards');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'cloudresq.json');
fs.writeFileSync(outFile, `${JSON.stringify(dashboard, null, 2)}\n`);
console.log(`Wrote ${outFile} (${panels.length} panels)`);