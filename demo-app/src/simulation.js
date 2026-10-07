// Failure simulation. Lets us trigger realistic problems on demand for the demo.

const state = {
  failMode: process.env.FAIL_MODE === 'true', // can also be set at startup
  cpuTimer: null,
  memoryHog: [], // holds allocated buffers so they are not garbage collected
};

const MAX_TOTAL_MEMORY_MB = 215; // safety cap for an 8 GB laptop

function setFailMode(value) {
  state.failMode = value;
}

// Burns CPU: blocks the event loop for 80 ms out of every 100 ms (about 80% of one core).
function startCpuLoad(seconds = 60) {
  stopCpuLoad();
  const endAt = Date.now() + seconds * 1000;
  state.cpuTimer = setInterval(() => {
    if (Date.now() >= endAt) return stopCpuLoad();
    const start = Date.now();
    while (Date.now() - start < 95) { /* busy loop */ }
  }, 100);
}

function stopCpuLoad() {
  if (state.cpuTimer) clearInterval(state.cpuTimer);
  state.cpuTimer = null;
}

// Allocates real memory. Buffer.alloc with a fill value forces the OS to commit the pages.
function startMemoryLoad(mb = 200) {
  const currentMB = state.memoryHog.reduce((sum, b) => sum + b.length / 1024 / 1024, 0);
  const allowed = Math.max(0, Math.min(mb, MAX_TOTAL_MEMORY_MB - currentMB));
  if (allowed > 0) state.memoryHog.push(Buffer.alloc(allowed * 1024 * 1024, 1));
  return allowed;
}

function stopMemoryLoad() {
  state.memoryHog = [];
  if (global.gc) global.gc();
}

function resetAll() {
  setFailMode(false);
  stopCpuLoad();
  stopMemoryLoad();
}

function status() {
  return {
    failMode: state.failMode,
    cpuLoadActive: state.cpuTimer !== null,
    simulatedMemoryMB: Math.round(state.memoryHog.reduce((s, b) => s + b.length / 1024 / 1024, 0)),
  };
}

module.exports = {
  state, setFailMode, startCpuLoad, stopCpuLoad,
  startMemoryLoad, stopMemoryLoad, resetAll, status,
};