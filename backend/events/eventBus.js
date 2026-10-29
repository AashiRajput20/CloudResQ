// Event bus: publishes CloudResQ events to Redis and listens to them.
// Redis is OPTIONAL: publish() never throws, and when Redis is down events are only counted as "dropped".
const config = require('../config');

const cfg = config.redis;
const MAX_RECENT = 50;

const state = {
  pub: null,
  sub: null,
  published: 0,
  received: 0,
  dropped: 0,
  lastError: null,
  recent: [], // newest first: events that came back through Redis
};
const lastLogged = {}; // so a Redis outage logs once, not every retry

// Every event has the same shape: { event, timestamp, ...payload }
function buildEnvelope(event, payload = {}) {
  const timestamp = new Date().toISOString();
  return Object.assign({ event, timestamp }, payload, { event, timestamp });
}

function rememberEvent(envelope) {
  state.recent.unshift(envelope);
  if (state.recent.length > MAX_RECENT) state.recent.length = MAX_RECENT;
}

function logOnce(name, message) {
  state.lastError = message;
  if (lastLogged[name] !== message) {
    lastLogged[name] = message;
    console.warn(`[Events] ${name}: ${message}`);
  }
}

function makeClient(name) {
  const Redis = require('ioredis'); // loaded only when the bus starts
  const client = new Redis(cfg.url, {
    lazyConnect: true,
    enableOfflineQueue: false,          // when Redis is down, drop instead of piling up commands
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    retryStrategy: (times) => Math.min(times * 1000, 10000), // keep trying, at most every 10 s
  });
  client.on('error', (err) => logOnce(name, err.message));
  client.on('ready', () => {
    delete lastLogged[name];
    state.lastError = null;
    console.log(`[Events] ${name} connected to Redis`);
  });
  return client;
}

function start() {
  if (!cfg.enabled) return console.log('[Events] disabled (REDIS_ENABLED=false)');
  if (state.pub) return;

  state.pub = makeClient('publisher');
  state.sub = makeClient('subscriber');

  state.sub.on('message', (_channel, text) => {
    try {
      rememberEvent(JSON.parse(text));
      state.received += 1;
    } catch { /* ignore malformed messages */ }
  });
  // Subscribe each time the connection is ready (also after a reconnect).
  state.sub.on('ready', () => state.sub.subscribe(cfg.channel).catch((e) => logOnce('subscriber', e.message)));

  state.pub.connect().catch(() => {}); // failures are reported by the 'error' handler
  state.sub.connect().catch(() => {});
}

// Fire and forget. Returns true if the event was handed to Redis, false if it was dropped.
function publish(event, payload) {
  try {
    if (!cfg.enabled) return false;
    if (!state.pub || state.pub.status !== 'ready') {
      state.dropped += 1;
      return false;
    }
    state.pub
      .publish(cfg.channel, JSON.stringify(buildEnvelope(event, payload)))
      .then(() => { state.published += 1; })
      .catch((err) => { state.dropped += 1; logOnce('publisher', err.message); });
    return true;
  } catch (err) {
    state.dropped += 1;
    return false;
  }
}

async function stop() {
  await Promise.allSettled([state.pub?.quit(), state.sub?.quit()]);
  state.pub = null;
  state.sub = null;
}

function getStatus() {
  const ready = (c) => !!c && c.status === 'ready';
  return {
    enabled: cfg.enabled,
    connected: ready(state.pub) && ready(state.sub),
    url: cfg.url,
    channel: cfg.channel,
    published: state.published,
    received: state.received,
    dropped: state.dropped,
    lastError: state.lastError,
    recent: state.recent,
  };
}

module.exports = { start, stop, publish, getStatus, buildEnvelope, rememberEvent, MAX_RECENT };