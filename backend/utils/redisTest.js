// Backend -> Redis integration check: publish one message and receive it back.
//   npm run redis:test
const Redis = require('ioredis');
const config = require('../config');

async function main() {
  const { url, channel } = config.redis;
  const sub = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
  const pub = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
  sub.on('error', () => {});
  pub.on('error', () => {});

  try {
    await Promise.all([sub.connect(), pub.connect()]);
  } catch (err) {
    throw new Error(`Cannot connect to Redis at ${url}. Is the container running? (docker compose up -d)`);
  }
  console.log(`Connected to Redis at ${url}`);

  const marker = `ping-${Date.now()}`;
  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No message came back within 3 seconds')), 3000);
    sub.on('message', (_c, text) => {
      if (JSON.parse(text).marker === marker) { clearTimeout(timer); resolve(); }
    });
  });

  await sub.subscribe(channel);
  await pub.publish(channel, JSON.stringify({ event: 'test.integration', marker }));
  await received;
  console.log(`Round trip OK: published and received on "${channel}"`);

  sub.disconnect();
  pub.disconnect();
}

main().catch((err) => {
  console.error('Redis test failed:', err.message);
  process.exit(1);
});