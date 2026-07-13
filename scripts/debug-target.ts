type TickState = {
  counter: number;
  phase: 'boot' | 'warm' | 'hot';
  nested: {
    value: number;
    parity: 'even' | 'odd';
  };
};

const state: TickState = {
  counter: 0,
  phase: 'boot',
  nested: {
    value: 0,
    parity: 'even',
  },
};

(globalThis as Record<string, unknown>).devPagghiaroState = state;
(globalThis as Record<string, unknown>).devPagghiaroCounter = 0;

const timer = setInterval(() => {
  state.counter += 1;
  state.nested.value = state.counter * 3;
  state.nested.parity = state.counter % 2 === 0 ? 'even' : 'odd';

  if (state.counter >= 8) {
    state.phase = 'hot';
  } else if (state.counter >= 3) {
    state.phase = 'warm';
  }

  (globalThis as Record<string, unknown>).devPagghiaroCounter = state.counter;

  if (state.counter % 5 === 0) {
    process.stdout.write(`[debug-target] tick=${state.counter} phase=${state.phase}\n`);
  }
}, 250);

timer.unref?.();

process.on('SIGTERM', () => {
  clearInterval(timer);
  process.exit(0);
});

process.on('SIGINT', () => {
  clearInterval(timer);
  process.exit(0);
});

process.stdout.write('[debug-target] started\n');

setInterval(() => {
  // keep process alive
}, 60_000);
