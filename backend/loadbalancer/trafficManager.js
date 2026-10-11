// Load Balancer Manager: keeps Nginx's backend list equal to the traffic pool.
//   instances in traffic -> upstream file in the Nginx container -> nginx -t -> nginx -s reload
// It never throws: a load-balancer problem must not break monitoring.
const config = require('../config');
const dockerManager = require('../docker/dockerManager');
const Service = require('../models/Service');
const Instance = require('../models/Instance');
const { slugify } = require('../services/serviceRegistry');
const { classify, buildUpstreamConfig } = require('./upstreamBuilder');

const cfg = config.nginx;

const state = {
  appliedContent: null,   // the config Nginx is running with
  appliedPool: null,      // instance names in that config
  nginxStartedAt: null,   // lets us notice that the Nginx container restarted
  nginxRunning: false,
  pool: [],
  excluded: [],
  reloads: 0,
  lastSyncAt: null,
  lastReloadAt: null,
  lastError: null,
};
let chain = Promise.resolve(); // syncs run one after another, never in parallel

const exec = (cmd) => dockerManager.execInContainer(cfg.containerName, cmd);

function setError(message) {
  if (message !== state.lastError) console.warn(`[LoadBalancer] ${message}`);
  state.lastError = message;
}
function clearError() {
  if (state.lastError) console.log('[LoadBalancer] recovered');
  state.lastError = null;
}

// Writes the file INSIDE the container (base64 avoids any quoting problems), tests, reloads.
async function apply(content) {
  const b64 = Buffer.from(content, 'utf8').toString('base64');
  const write = await exec(['/bin/sh', '-c', `echo ${b64} | base64 -d > ${cfg.upstreamPath}`]);
  if (write.exitCode !== 0) throw new Error(`Could not write the Nginx config: ${write.output}`);

  const test = await exec(['nginx', '-t']);
  if (test.exitCode !== 0) throw new Error(`nginx -t rejected the config: ${test.output.slice(-300)}`);

  const reload = await exec(['nginx', '-s', 'reload']);
  if (reload.exitCode !== 0) throw new Error(`nginx reload failed: ${reload.output.slice(-300)}`);
}

function logChange(prev, next) {
  if (prev === null) return console.log(`[LoadBalancer] pool: ${next.join(', ') || '(empty)'} (initial)`);
  const added = next.filter((n) => !prev.includes(n));
  const removed = prev.filter((n) => !next.includes(n));
  const notes = [];
  if (added.length) notes.push(`added ${added.join(', ')}`);
  if (removed.length) notes.push(`removed ${removed.join(', ')}`);
  console.log(`[LoadBalancer] pool: ${next.join(', ') || '(empty)'} (${notes.join('; ')})`);
}

function snapshot() {
  return {
    enabled: cfg.enabled,
    entryUrl: `http://localhost:${cfg.hostPort}`,
    nginx: { container: cfg.containerName, running: state.nginxRunning },
    pool: state.pool.map((s) => s.instanceName),
    excluded: state.excluded,
    reloads: state.reloads,
    lastSyncAt: state.lastSyncAt,
    lastReloadAt: state.lastReloadAt,
    lastError: state.lastError,
    upstreamConfig: state.appliedContent,
  };
}

async function doSync(force) {
  try {
    const containers = (await dockerManager.listManagedContainers()).filter((c) => c.serviceLabel === cfg.serviceLabel);
    const service = (await Service.find()).find((s) => slugify(s.name) === cfg.serviceLabel);
    const instances = service ? await Instance.find({ serviceId: service._id }) : [];

    const { pool, excluded } = classify(containers, instances);
    state.pool = pool;
    state.excluded = excluded;
    state.lastSyncAt = new Date();

    const nginx = await dockerManager.getContainerStatus(cfg.containerName);
    state.nginxRunning = !!nginx.running;
    if (!nginx.running) {
      setError(`Nginx container "${cfg.containerName}" is not running (run: docker compose up -d)`);
      return snapshot();
    }

    const content = buildUpstreamConfig(pool, config.docker.containerPort);
    const restarted = state.nginxStartedAt !== nginx.startedAt; // a fresh Nginx has the placeholder list
    if (!force && !restarted && content === state.appliedContent) {
      clearError();
      return snapshot();
    }

    await apply(content);
    logChange(restarted ? null : state.appliedPool, pool.map((s) => s.instanceName));
    state.appliedContent = content;
    state.appliedPool = pool.map((s) => s.instanceName);
    state.nginxStartedAt = nginx.startedAt;
    state.reloads += 1;
    state.lastReloadAt = new Date();
    clearError();
  } catch (err) {
    setError(err.message); // the old config stays active; the next cycle tries again
  }
  return snapshot();
}

// Safe to call from anywhere, without await. Always resolves.
function sync({ force = false } = {}) {
  const run = chain.then(() => doSync(force));
  chain = run.catch(() => {});
  return run;
}

const getStatus = () => snapshot();

module.exports = { sync, getStatus };