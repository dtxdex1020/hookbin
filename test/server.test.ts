import { afterEach, describe, expect, it } from 'vitest';
import { createHookServer } from '../src/server.js';
import { RequestLog } from '../src/store.js';
import type { CapturedRequest } from '../src/types.js';
import { close, listen, tempFile } from './helpers.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function setup(opts: Parameters<typeof createHookServer>[0] = {}) {
  const tmp = await tempFile();
  const log = new RequestLog(tmp.file);
  const seen: CapturedRequest[] = [];
  const server = createHookServer({ log, onRequest: (r) => seen.push(r), ...opts });
  const url = await listen(server);
  cleanups.push(tmp.cleanup, () => close(server));
  return { log, seen, url };
}

describe('hook server', () => {
  it('records requests to the log and answers with the id', async () => {
    const { log, seen, url } = await setup();
    const res = await fetch(`${url}/stripe?live=0`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sig': 't=1' },
      body: JSON.stringify({ type: 'invoice.paid' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: 1 });

    const [saved] = await log.list();
    expect(saved).toMatchObject({
      id: 1,
      method: 'POST',
      url: '/stripe?live=0',
      body: '{"type":"invoice.paid"}',
      bodyEncoding: 'utf8',
    });
    expect(saved?.headers['x-sig']).toBe('t=1');
    expect(seen).toEqual([saved]);
  });

  it('assigns increasing ids under concurrent load', async () => {
    const { log, url } = await setup();
    await Promise.all(Array.from({ length: 20 }, (_, i) => fetch(`${url}/${i}`)));
    const ids = (await log.list()).map((r) => r.id);
    expect(ids).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('stores binary bodies as base64', async () => {
    const { log, url } = await setup();
    await fetch(url, { method: 'PUT', body: new Uint8Array([0, 255, 254, 1]) });
    expect(await log.get('last')).toMatchObject({ body: 'AP/+AQ==', bodyEncoding: 'base64' });
  });

  it('uses the configured status code', async () => {
    const { url } = await setup({ status: 503 });
    const res = await fetch(url);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, id: 1 });
  });

  it('rejects oversized bodies', async () => {
    const { log, url } = await setup({ maxBodyBytes: 10 });
    const res = await fetch(url, { method: 'POST', body: 'x'.repeat(100) });
    expect(res.status).toBe(413);
    expect(await log.list()).toEqual([]);
  });

  it('works without a log', async () => {
    const server = createHookServer();
    const url = await listen(server);
    cleanups.push(() => close(server));
    expect(await (await fetch(url)).json()).toEqual({ ok: true, id: 1 });
    expect(await (await fetch(url)).json()).toEqual({ ok: true, id: 2 });
  });
});

describe('RequestLog', () => {
  it('returns an empty list for a missing file and can be cleared', async () => {
    const tmp = await tempFile('nested/dir/log.json');
    cleanups.push(tmp.cleanup);
    const log = new RequestLog(tmp.file);
    expect(await log.list()).toEqual([]);
    await log.add({
      receivedAt: new Date().toISOString(),
      method: 'GET',
      url: '/',
      headers: {},
      body: '',
      bodyEncoding: 'utf8',
    });
    expect(await log.get(1)).toBeDefined();
    expect(await log.get('2')).toBeUndefined();
    await log.clear();
    expect(await log.list()).toEqual([]);
  });
});
