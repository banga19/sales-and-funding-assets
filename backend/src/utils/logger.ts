const LEVELS = ['http', 'info', 'warn', 'error'];
const levelIdx = (l: string) => Math.max(0, LEVELS.indexOf(l));
const shouldLog = (l: string, envLevel: string) => levelIdx(l) >= levelIdx(envLevel);

type Fn = (...args: unknown[]) => void;

type Logger = {
  http: Fn;
  info: Fn;
  warn: Fn;
  error: Fn;
};

function make(namespace: string): Logger {
  const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();

  function log(level: string, meta: Record<string, unknown>, ...rest: unknown[]) {
    if (!shouldLog(level, envLevel)) return;
    const ts = new Date().toISOString();
    const metaStr = Object.keys(meta).length ? `\n    ${JSON.stringify(meta)}` : '';
    const msg = rest.length ? rest.join(' ') : '';
    console.log(`[${ts}] [${namespace}] [${level.toUpperCase()}] ${msg}${metaStr}`);
  }

  return {
    http: (...a: unknown[]) => log('http', {}, ...a),
    info: (...a: unknown[]) => log('info', {}, ...a),
    warn: (...a: unknown[]) => log('warn', {}, ...a),
    error: (...a: unknown[]) => log('error', {}, ...a),
  };
}

export const logger = make('backend');
