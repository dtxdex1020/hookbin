import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function tempFile(name = 'hookbin.json') {
  const dir = await mkdtemp(join(tmpdir(), 'hookbin-'));
  return { file: join(dir, name), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

export function close(server: Server) {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}
