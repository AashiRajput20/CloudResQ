const eventBus = require('../events/eventBus');

// GET /api/events
exports.getEvents = (req, res) => res.json(eventBus.getStatus());

// POST /api/events/test   (publishes a test event, handy for checking Redis)
exports.sendTestEvent = (req, res) => {
  const sent = eventBus.publish('test.ping', { instance: 'dashboard', note: 'Test event from the dashboard' });
  res.json({ sent });
};