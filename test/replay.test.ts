import { createServer, type IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { replay, replayUrl } from '../src/replay.js';
import type { CapturedRequest } from '../src/types.js';
import { close, listen } from './helpers.js';

interface Received {
  method?: string;
  url?: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  while (servers.length) await close(servers.pop()!);
});

async function target(status = 202) {
  const received: Received[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    received.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: Buffer.concat(chunks),
    });
    res.writeHead(status, { 'content-type': 'text/plain' });
    res.end('thanks');
  });
  servers.push(server);
  return { url: await listen(server), received };
}

const saved: CapturedRequest = {
  id: 3,
  receivedAt: '2026-10-09T12:00:00.000Z',
  method: 'POST',
  url: '/webhooks/github?delivery=9',
  headers: {
    host: 'old-host:8787',
    'content-type': 'application/json',
    'content-length': '999',
    'x-github-event': 'push',
    'x-multi': ['a', 'b'],
  },
  body: '{"ref":"refs/heads/main"}',
  bodyEncoding: 'utf8',
};

describe('replay', () => {
  it('resends method, headers and body to the target', async () => {
    const { url, received } = await target();
    const res = await replay(saved, `${url}/local/hook`);
    expect(res).toMatchObject({ status: 202, body: 'thanks', url: `${url}/local/hook` });
    expect(res.ms).toBeGreaterThanOrEqual(0);

    const [got] = received;
    expect(got?.method).toBe('POST');
    expect(got?.url).toBe('/local/hook');
    expect(got?.body.toString()).toBe('{"ref":"refs/heads/main"}');
    expect(got?.headers['x-github-event']).toBe('push');
    expect(got?.headers['x-multi']).toBe('a, b');
    expect(got?.headers['x-hookbin-replay']).toBe('3');
    expect(got?.headers.host).toBe(new URL(url).host);
    expect(got?.headers['content-length']).toBe('25');
  });

  it('can append the original path and override headers', async () => {
    const { url, received } = await target();
    await replay(saved, `${url}/base/`, {
      appendPath: true,
      headers: { 'x-github-event': 'ping' },
    });
    expect(received[0]?.url).toBe('/base/webhooks/github?delivery=9');
    expect(received[0]?.headers['x-github-event']).toBe('ping');
  });

  it('replays binary bodies byte for byte', async () => {
    const { url, received } = await target();
    await replay({ ...saved, body: 'AP/+AQ==', bodyEncoding: 'base64' }, url);
    expect([...received[0]!.body]).toEqual([0, 255, 254, 1]);
  });

  it('sends no body for GET', async () => {
    const { url, received } = await target();
    await replay({ ...saved, method: 'GET' }, url);
    expect(received[0]?.method).toBe('GET');
    expect(received[0]?.body.length).toBe(0);
  });
});

describe('replayUrl', () => {
  it('builds target URLs', () => {
    expect(replayUrl(saved, 'http://localhost:3000/hook')).toBe('http://localhost:3000/hook');
    expect(replayUrl(saved, 'http://localhost:3000', true)).toBe(
      'http://localhost:3000/webhooks/github?delivery=9',
    );
  });
});
