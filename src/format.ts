import { createColors } from 'picocolors';
import { decodeBody } from './server.js';
import type { CapturedRequest } from './types.js';

type Colors = ReturnType<typeof createColors>;

const METHOD_COLORS: Record<string, keyof Colors> = {
  GET: 'green',
  POST: 'cyan',
  PUT: 'yellow',
  PATCH: 'yellow',
  DELETE: 'red',
};

function header(name: string, req: CapturedRequest): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v.join(', ') : v;
}

/** Pretty-prints a JSON value with syntax colors. */
export function colorJson(value: unknown, c: Colors, indent = 0): string {
  const pad = '  '.repeat(indent);
  const inner = '  '.repeat(indent + 1);
  if (value === null) return c.dim('null');
  if (typeof value === 'string') return c.green(JSON.stringify(value));
  if (typeof value === 'number') return c.yellow(String(value));
  if (typeof value === 'boolean') return c.magenta(String(value));
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const items = value.map((v) => inner + colorJson(v, c, indent + 1));
    return `[\n${items.join(',\n')}\n${pad}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return '{}';
    const lines = entries.map(
      ([k, v]) => `${inner}${c.cyan(JSON.stringify(k))}: ${colorJson(v, c, indent + 1)}`,
    );
    return `{\n${lines.join(',\n')}\n${pad}}`;
  }
  return String(value);
}

/** Renders the body based on its content type. */
export function formatBody(req: CapturedRequest, c: Colors): string {
  if (!req.body) return c.dim('(empty body)');
  if (req.bodyEncoding === 'base64') {
    return c.dim(`(binary, ${decodeBody(req).length} bytes)`);
  }
  const type = header('content-type', req) ?? '';
  if (/json/i.test(type) || /^\s*[[{]/.test(req.body)) {
    try {
      return colorJson(JSON.parse(req.body), c);
    } catch {
      // not JSON after all, fall through to raw text
    }
  }
  if (/x-www-form-urlencoded/i.test(type)) {
    const params = [...new URLSearchParams(req.body)];
    const width = Math.max(...params.map(([k]) => k.length));
    return params.map(([k, v]) => `${c.cyan(k.padEnd(width))}  ${v}`).join('\n');
  }
  return req.body;
}

export interface FormatOptions {
  color?: boolean;
  /** Hide headers, show only the request line and body. */
  compact?: boolean;
}

export function formatRequest(req: CapturedRequest, options: FormatOptions = {}): string {
  const c = createColors(options.color ?? false);
  const methodColor = c[METHOD_COLORS[req.method] ?? 'blue'] as (s: string) => string;
  const time = new Date(req.receivedAt).toLocaleTimeString('en-GB', { hour12: false });
  const lines = [
    `${c.dim(`#${req.id}`)} ${c.bold(methodColor(req.method))} ${c.bold(req.url)} ${c.dim(time)}`,
  ];
  if (!options.compact) {
    const names = Object.keys(req.headers);
    const width = Math.max(0, ...names.map((n) => n.length));
    for (const name of names) {
      lines.push(`  ${c.dim(name.padEnd(width))}  ${header(name, req)}`);
    }
  }
  lines.push('', formatBody(req, c), '');
  return lines.join('\n');
}

/** One line per request, for `hookbin list`. */
export function formatSummary(req: CapturedRequest, options: FormatOptions = {}): string {
  const c = createColors(options.color ?? false);
  const size = decodeBody(req).length;
  return `${c.dim(String(req.id).padStart(4))}  ${req.receivedAt}  ${c.bold(req.method.padEnd(7))} ${req.url} ${c.dim(`${size}b`)}`;
}
