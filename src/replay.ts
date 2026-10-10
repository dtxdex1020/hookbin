import { decodeBody } from './server.js';
import type { CapturedRequest } from './types.js';

// Headers that describe the original connection rather than the request itself.
const SKIP = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'upgrade',
  'expect',
  'accept-encoding',
]);

export interface ReplayOptions {
  /** Append the original path and query string to the target. */
  appendPath?: boolean;
  /** Extra headers that override the saved ones. */
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface ReplayResult {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  ms: number;
}

export function replayUrl(req: CapturedRequest, target: string, appendPath = false): string {
  const base = new URL(target);
  if (!appendPath) return base.toString();
  const original = new URL(req.url, 'http://placeholder');
  base.pathname = `${base.pathname.replace(/\/$/, '')}${original.pathname}`;
  base.search = original.search;
  return base.toString();
}

/** Sends a saved request to another URL with the same method, headers and body. */
export async function replay(
  req: CapturedRequest,
  target: string,
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  const url = replayUrl(req, target, options.appendPath);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (SKIP.has(name.toLowerCase())) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  headers.set('x-hookbin-replay', String(req.id));
  for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);

  const hasBody = !['GET', 'HEAD'].includes(req.method.toUpperCase());
  const started = performance.now();
  const res = await fetch(url, {
    method: req.method,
    headers,
    body: hasBody ? decodeBody(req) : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  });
  const body = await res.text();
  return {
    url,
    status: res.status,
    statusText: res.statusText,
    headers: Object.fromEntries(res.headers),
    body,
    ms: Math.round(performance.now() - started),
  };
}
