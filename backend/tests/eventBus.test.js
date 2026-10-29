// Unit tests for the event bus (no Redis needed). Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const bus = require('../events/eventBus');

test('envelope has event, timestamp and the payload', () => {
  const e = bus.buildEnvelope('recovery.request', { instance: 'app-2', action: 'RESTART' });
  assert.equal(e.event, 'recovery.request');
  assert.equal(e.instance, 'app-2');
  assert.equal(e.action, 'RESTART');
  assert.ok(!Number.isNaN(Date.parse(e.timestamp)));
});

test('payload cannot overwrite the event name', () => {
  const e = bus.buildEnvelope('health.failure', { event: 'fake' });
  assert.equal(e.event, 'health.failure');
});

test('publish before the bus is started never throws and reports a drop', () => {
  assert.equal(bus.publish('health.failure', { instance: 'app-1' }), false);
  assert.ok(bus.getStatus().dropped >= 1);
});

test('only the newest 50 events are kept', () => {
  for (let i = 0; i < bus.MAX_RECENT + 10; i += 1) bus.rememberEvent({ event: 'x', n: i });
  const { recent } = bus.getStatus();
  assert.equal(recent.length, bus.MAX_RECENT);
  assert.equal(recent[0].n, bus.MAX_RECENT + 9); // newest first
});