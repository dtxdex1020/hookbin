import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { buildProgram, type CliIO } from '../src/cli.js';
import { RequestLog } from '../src/store.js';
import { close, tempFile } from './helpers.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  process.exitCode = undefined;
});

async function run(args: string[], extra: Partial<CliIO> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const program = buildProgram({
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    color: false,
    ...extra,
  });
  program.exitOverride();
  await program.parseAsync(args, { from: 'user' });
  return { out: out.join('\n'), err: err.join('\n') };
}

describe('cli', () => {
  it('listens, saves, lists, shows, replays and clears', async () => {
    const tmp = await tempFile();
    cleanups.push(tmp.cleanup);

    let server: Server | undefined;
    const started = await run(['listen', '-p', '0', '-f', tmp.file], {
      onListen: (s) => (server = s),
    });
    cleanups.push(() => close(server!));
    expect(started.out).toMatch(/hookbin listening on http:\/\/127\.0\.0\.1:\d+/);
    const port = (server!.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;

    await fetch(`${base}/first`, { method: 'POST', body: 'one' });
    expect((await run(['list', '-f', tmp.file])).out).toMatch(/1 .* POST +\/first 3b/);
    expect((await run(['show', '1', '-f', tmp.file])).out).toContain('one');
    expect(JSON.parse((await run(['show', 'last', '--json', '-f', tmp.file])).out).url).toBe(
      '/first',
    );

    // Replay into the same server: it should show up as request #2
    const replayed = await run([
      'replay',
      '1',
      `${base}/again`,
      '-f',
      tmp.file,
      '-H',
      'X-Extra: 1',
    ]);
    expect(replayed.out).toMatch(/#1 POST .*\/again -> 200 OK/);
    const second = await new RequestLog(tmp.file).get(2);
    expect(second).toMatchObject({ url: '/again', body: 'one' });
    expect(second?.headers['x-extra']).toBe('1');

    expect((await run(['clear', '-f', tmp.file])).out).toContain('Cleared');
    expect((await run(['list', '-f', tmp.file])).out).toBe('No requests saved yet.');
  });

  it('reports unknown ids', async () => {
    const tmp = await tempFile();
    cleanups.push(tmp.cleanup);
    const res = await run(['show', '42', '-f', tmp.file]);
    expect(res.err).toBe('No request with id 42.');
    expect(process.exitCode).toBe(1);
  });

  it('reports replay failures', async () => {
    const tmp = await tempFile();
    cleanups.push(tmp.cleanup);
    await new RequestLog(tmp.file).add({
      receivedAt: new Date().toISOString(),
      method: 'POST',
      url: '/',
      headers: {},
      body: 'x',
      bodyEncoding: 'utf8',
    });
    const res = await run(['replay', '1', 'http://127.0.0.1:1', '-f', tmp.file]);
    expect(res.err).toMatch(/^Replay failed/);
    expect(process.exitCode).toBe(1);
  });
});
