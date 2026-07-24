const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const paint = (code, text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);

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

const ts = () => new Date().toISOString().slice(11, 19);

export const log = {
  color: c,
  info: (...a) => console.log(c.dim(ts()), ...a),
  step: (...a) => console.log(c.dim(ts()), c.cyan('▸'), ...a),
  ok: (...a) => console.log(c.dim(ts()), c.green('✓'), ...a),
  warn: (...a) => console.warn(c.dim(ts()), c.yellow('!'), ...a),
  error: (...a) => console.error(c.dim(ts()), c.red('✗'), ...a),
  planner: (...a) => console.log(c.dim(ts()), c.magenta('[planner]'), ...a),
  worker: (id, ...a) => console.log(c.dim(ts()), c.blue(`[worker ${id}]`), ...a),
  heading: (t) => console.log('\n' + c.bold(t)),
};
