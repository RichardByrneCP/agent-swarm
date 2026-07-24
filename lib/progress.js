/**
 * Turn SDK stream events into short human progress lines.
 * Pure helpers — safe to unit-test without the Cursor SDK.
 */

const PATH_KEYS = [
  'path',
  'filePath',
  'file_path',
  'target',
  'filename',
  'relativeWorkspacePath',
  'target_file',
  'file',
];

/**
 * @param {any} event SDKMessage-like object
 * @returns {string|null} progress line, or null to skip
 */
export function summarizeStreamEvent(event) {
  if (!event || typeof event !== 'object') return null;

  switch (event.type) {
    case 'tool_call': {
      if (event.status === 'running') {
        return formatToolStart(event.name, event.args);
      }
      if (event.status === 'error') {
        const detail = formatToolStart(event.name, event.args);
        return `${detail} failed`;
      }
      return null;
    }
    case 'thinking': {
      // Only log completed thinking chunks that report a duration (avoid token spam).
      if (typeof event.thinking_duration_ms === 'number' && event.thinking_duration_ms >= 1000) {
        return `thinking ${Math.round(event.thinking_duration_ms / 1000)}s`;
      }
      return null;
    }
    case 'task': {
      const text = typeof event.text === 'string' ? event.text.trim() : '';
      if (text) return truncate(text, 80);
      if (event.status) return `task ${event.status}`;
      return null;
    }
    case 'status': {
      if (event.status === 'RUNNING' || event.status === 'CREATING') return null;
      return event.message ? `${event.status}: ${truncate(event.message, 60)}` : String(event.status || '');
    }
    default:
      return null;
  }
}

export function formatToolStart(name, args) {
  const tool = String(name || 'tool').replace(/^mcp[_:]/, '');
  const file = extractPath(args);
  if (file) return `${tool} ${file}`;

  if (args && typeof args === 'object') {
    if (typeof args.command === 'string' && args.command.trim()) {
      return `${tool}: ${truncate(args.command.trim(), 60)}`;
    }
    if (typeof args.query === 'string' && args.query.trim()) {
      return `${tool}: ${truncate(args.query.trim(), 60)}`;
    }
    if (typeof args.pattern === 'string' && args.pattern.trim()) {
      return `${tool}: ${truncate(args.pattern.trim(), 60)}`;
    }
    if (typeof args.glob_pattern === 'string' && args.glob_pattern.trim()) {
      return `${tool}: ${truncate(args.glob_pattern.trim(), 60)}`;
    }
  }
  return tool;
}

export function extractPath(args) {
  if (!args || typeof args !== 'object') return null;
  for (const key of PATH_KEYS) {
    if (typeof args[key] === 'string' && args[key].trim()) return args[key].trim();
  }
  if (Array.isArray(args.paths) && typeof args.paths[0] === 'string') {
    return args.paths[0].trim();
  }
  return null;
}

export function truncate(s, max) {
  const str = String(s);
  if (str.length <= max) return str;
  return `${str.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Create a progress reporter with idle heartbeats and duplicate suppression.
 *
 * @param {object} opts
 * @param {(msg: string) => void} opts.emit
 * @param {number} [opts.heartbeatMs]
 * @param {() => number} [opts.now]
 */
export function createProgressTracker({ emit, heartbeatMs = 30_000, now = () => Date.now() }) {
  let lastText = 'starting';
  let lastAt = now();
  let lastEmitted = '';
  let timer = null;

  const note = (text) => {
    if (!text) return;
    lastText = text;
    lastAt = now();
    if (text === lastEmitted) return;
    lastEmitted = text;
    emit(text);
  };

  const startHeartbeat = () => {
    if (!heartbeatMs || heartbeatMs <= 0) return;
    stopHeartbeat();
    timer = setInterval(() => {
      const idleSec = Math.round((now() - lastAt) / 1000);
      if (idleSec * 1000 >= heartbeatMs) {
        emit(`still working (${idleSec}s) · last: ${lastText}`);
      }
    }, heartbeatMs);
    if (typeof timer.unref === 'function') timer.unref();
  };

  const stopHeartbeat = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  return {
    note,
    startHeartbeat,
    stopHeartbeat,
    get lastText() {
      return lastText;
    },
  };
}
