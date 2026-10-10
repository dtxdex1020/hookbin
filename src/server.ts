import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { RequestLog } from './store.js';
import type { CapturedRequest, Headers } from './types.js';

export interface ServerOptions {
  log?: RequestLog;
  /** Status code sent back to the caller. */
  status?: number;
  /** Requests with bigger bodies get a 413. */
  maxBodyBytes?: number;
  onRequest?: (req: CapturedRequest) => void;
  onError?: (err: unknown) => void;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

export function encodeBody(buf: Buffer): Pick<CapturedRequest, 'body' | 'bodyEncoding'> {
  try {
    return { body: utf8.decode(buf), bodyEncoding: 'utf8' };
  } catch {
    return { body: buf.toString('base64'), bodyEncoding: 'base64' };
  }
}

export function decodeBody(req: Pick<CapturedRequest, 'body' | 'bodyEncoding'>): Buffer {
  return Buffer.from(req.body, req.bodyEncoding === 'base64' ? 'base64' : 'utf8');
}

class TooLarge extends Error {}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new TooLarge();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Creates the catch-all server. Every request is recorded and answered with a small JSON body. */
export function createHookServer(options: ServerOptions = {}): Server {
  const status = options.status ?? 200;
  const limit = options.maxBodyBytes ?? 5 * 1024 * 1024;
  let counter = 0;

  return createServer(async (req, res) => {
    const reply = (code: number, body: object) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    try {
      const body = await readBody(req, limit);
      const captured: Omit<CapturedRequest, 'id'> = {
        receivedAt: new Date().toISOString(),
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: req.headers as Headers,
        ...encodeBody(body),
        remoteAddress: req.socket.remoteAddress,
      };
      const saved = options.log ? await options.log.add(captured) : { id: ++counter, ...captured };
      options.onRequest?.(saved);
      reply(status, { ok: status < 400, id: saved.id });
    } catch (err) {
      if (err instanceof TooLarge) return reply(413, { ok: false, error: 'body too large' });
      options.onError?.(err);
      reply(500, { ok: false, error: 'failed to record request' });
    }
  });
}
