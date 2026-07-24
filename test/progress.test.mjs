import assert from 'node:assert/strict';
import {
  createProgressTracker,
  extractPath,
  formatToolStart,
  summarizeStreamEvent,
  truncate,
} from '../lib/progress.js';

assert.equal(extractPath({ path: 'src/a.js' }), 'src/a.js');
assert.equal(extractPath({ filePath: 'lib/b.ts' }), 'lib/b.ts');
assert.equal(extractPath({ paths: ['x.js', 'y.js'] }), 'x.js');
assert.equal(extractPath({ command: 'ls' }), null);

assert.equal(formatToolStart('read', { path: 'index.js' }), 'read index.js');
assert.equal(formatToolStart('shell', { command: 'npm test' }), 'shell: npm test');
assert.equal(formatToolStart('grepTool', { pattern: 'TODO' }), 'grepTool: TODO');
assert.ok(truncate('abcdefghij', 5).endsWith('…'));
assert.equal(truncate('abc', 5), 'abc');

assert.equal(
  summarizeStreamEvent({
    type: 'tool_call',
    name: 'edit',
    status: 'running',
    args: { path: 'lib/agent.js' },
  }),
  'edit lib/agent.js',
);
assert.equal(
  summarizeStreamEvent({
    type: 'tool_call',
    name: 'read',
    status: 'completed',
    args: { path: 'lib/agent.js' },
  }),
  null,
);
assert.equal(
  summarizeStreamEvent({
    type: 'tool_call',
    name: 'read',
    status: 'error',
    args: { path: 'missing.js' },
  }),
  'read missing.js failed',
);
assert.equal(
  summarizeStreamEvent({ type: 'thinking', text: 'hmm', thinking_duration_ms: 2500 }),
  'thinking 3s',
);
assert.equal(summarizeStreamEvent({ type: 'thinking', text: 'x' }), null);
assert.equal(
  summarizeStreamEvent({ type: 'task', text: '  drafted plan  ' }),
  'drafted plan',
);
assert.equal(summarizeStreamEvent({ type: 'assistant', message: { content: [] } }), null);

const lines = [];
const tracker = createProgressTracker({
  emit: (m) => lines.push(m),
  heartbeatMs: 0,
});
tracker.note('read a.js');
tracker.note('read a.js');
tracker.note('edit a.js');
assert.deepEqual(lines, ['read a.js', 'edit a.js']);
assert.equal(tracker.lastText, 'edit a.js');

console.log('progress tests ok');
