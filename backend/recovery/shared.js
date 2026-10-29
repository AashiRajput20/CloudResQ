// Helpers shared by the Recovery Controller and the Scaling Controller.
const config = require('../config');
const dockerManager = require('../docker/dockerManager');
const Decision = require('../models/Decision');

const cfg = config.recovery;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- one action per instance at a time ----
const locks = new Set();
const lockKey = (serviceId, instanceName) => `${serviceId}:${instanceName}`;
const tryLock = (key) => {
  if (locks.has(key)) return false;
  locks.add(key);
  return true;
};
const unlock = (key) => { locks.delete(key); };
const isLocked = (key) => locks.has(key);

// ---- containers CloudResQ just removed (the monitor must not recreate their records) ----
const removed = new Map(); // containerId -> ms when removed
const markRemoved = (containerId) => removed.set(containerId, Date.now());
function wasRemoved(containerId) {
  const t = removed.get(containerId);
  if (!t) return false;
  if (Date.now() - t > 60000) {
    removed.delete(containerId);
    return false;
  }
  return true;
}

// ---- verification: /health must pass N times in a row ----
async function verifyHealthy(ref) {
  const started = Date.now();
  let streak = 0;
  let last = null;
  while (Date.now() - started < cfg.verifyTimeoutMs) {
    last = await dockerManager.getContainerHealth(ref).catch((e) => ({ healthy: false, error: e.message }));
    streak = last.healthy ? streak + 1 : 0;
    if (streak >= cfg.verifySuccesses) return { ok: true };
    await sleep(cfg.verifyIntervalMs);
  }
  return { ok: false, error: last?.error, waitedSec: Math.round((Date.now() - started) / 1000) };
}

// ---- writes the outcome onto the Decision that triggered an action ----
async function closeDecision(decisionId, status, note, recoveryEventId = null) {
  if (!decisionId) return;
  await Decision.updateOne(
    { _id: decisionId },
    { $set: { status, note, executedAt: new Date(), recoveryEventId } }
  ).catch(() => {});
}

module.exports = {
  sleep, lockKey, tryLock, unlock, isLocked, markRemoved, wasRemoved, verifyHealthy, closeDecision,
};