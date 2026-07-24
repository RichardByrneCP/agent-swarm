const paint = (code, text) => (useColor() ? `\u001b[${code}m${text}\u001b[0m` : text);

const c = {
  dim: (t) => paint('2', t),
  bold: (t) => paint('1', t),
  red: (t) => paint('31', t),
  green: (t) => paint('32', t),
  yellow: (t) => paint('33', t),
  blue: (t) => paint('34', t),
  magenta: (t) => paint('35', t),
  cyan: (t) => paint('36', t),
};

function useColor() {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

function useAsciiGlyphs() {
  if (process.env.SWARM_ASCII_LOG === '1') return true;
  if (process.platform !== 'win32') return false;
  // Legacy Windows consoles often lack UTF-8 glyphs.
  const cp = process.env.WT_SESSION || process.env.TERM_PROGRAM;
  return !cp && !/^utf-?8$/i.test(process.env.PYTHONIOENCODING || '');
}

const glyph = {
  step: () => (useAsciiGlyphs() ? '>' : '▸'),
  ok: () => (useAsciiGlyphs() ? 'OK' : '✓'),
  err: () => (useAsciiGlyphs() ? 'X' : '✗'),
};

const ts = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export const log = {
  color: c,
  info: (...a) => console.log(c.dim(ts()), ...a),
  step: (...a) => console.log(c.dim(ts()), c.cyan(glyph.step()), ...a),
  ok: (...a) => console.log(c.dim(ts()), c.green(glyph.ok()), ...a),
  warn: (...a) => console.warn(c.dim(ts()), c.yellow('!'), ...a),
  error: (...a) => console.error(c.dim(ts()), c.red(glyph.err()), ...a),
  planner: (...a) => console.log(c.dim(ts()), c.magenta('[planner]'), ...a),
  worker: (id, ...a) => console.log(c.dim(ts()), c.blue(`[worker ${id}]`), ...a),
  heading: (t) => console.log('\n' + c.bold(t)),
};
