#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Command, InvalidArgumentError } from 'commander';
import pc from 'picocolors';
import { formatRequest, formatSummary } from './format.js';
import { replay } from './replay.js';
import { createHookServer } from './server.js';
import { RequestLog } from './store.js';

export interface CliIO {
  out: (text: string) => void;
  err: (text: string) => void;
  color: boolean;
  /** Called once the server is up. Mostly useful for tests. */
  onListen?: (server: Server) => void;
}

const defaultIO: CliIO = {
  out: (t) => process.stdout.write(`${t}\n`),
  err: (t) => process.stderr.write(`${t}\n`),
  color: pc.isColorSupported,
};

function int(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new InvalidArgumentError('Expected a whole number.');
  return n;
}

function headerPair(value: string, prev: Record<string, string> = {}) {
  const i = value.indexOf(':');
  if (i < 1) throw new InvalidArgumentError('Expected "Name: value".');
  return { ...prev, [value.slice(0, i).trim()]: value.slice(i + 1).trim() };
}

const FILE_OPTION = ['-f, --file <path>', 'request log file', 'hookbin.json'] as const;

export function buildProgram(io: CliIO = defaultIO): Command {
  const program = new Command('hookbin')
    .description('Catch, inspect and replay webhooks locally.')
    .version('0.1.0')
    .configureOutput({
      writeOut: (s) => io.out(s.trimEnd()),
      writeErr: (s) => io.err(s.trimEnd()),
    });

  program
    .command('listen', { isDefault: true })
    .description('start the server and print every request')
    .option('-p, --port <port>', 'port to listen on', int, 8787)
    .option('--host <host>', 'interface to bind', '127.0.0.1')
    .option('-s, --status <code>', 'status code to respond with', int, 200)
    .option(...FILE_OPTION)
    .option('--no-save', 'print only, do not write the log')
    .option('-c, --compact', 'hide headers')
    .action(async (opts) => {
      const server = createHookServer({
        log: opts.save ? new RequestLog(opts.file) : undefined,
        status: opts.status,
        onRequest: (req) => io.out(formatRequest(req, { color: io.color, compact: opts.compact })),
        onError: (err) => io.err(`failed to record request: ${String(err)}`),
      });
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(opts.port, opts.host, resolve);
      });
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port;
      const c = pc.createColors(io.color);
      io.out(
        `${c.bold(c.cyan('hookbin'))} listening on ${c.bold(`http://${opts.host}:${port}`)}` +
          (opts.save ? c.dim(`  (saving to ${opts.file})`) : ''),
      );
      io.onListen?.(server);
    });

  program
    .command('list')
    .description('list saved requests')
    .option(...FILE_OPTION)
    .action(async (opts) => {
      const all = await new RequestLog(opts.file).list();
      if (!all.length) return io.out('No requests saved yet.');
      for (const req of all) io.out(formatSummary(req, { color: io.color }));
    });

  program
    .command('show')
    .description('print a saved request')
    .argument('<id>', 'request id, or "last"')
    .option(...FILE_OPTION)
    .option('--json', 'print the raw saved JSON')
    .action(async (id, opts) => {
      const req = await new RequestLog(opts.file).get(id);
      if (!req) {
        io.err(`No request with id ${id}.`);
        process.exitCode = 1;
        return;
      }
      io.out(opts.json ? JSON.stringify(req, null, 2) : formatRequest(req, { color: io.color }));
    });

  program
    .command('replay')
    .description('send a saved request to another URL')
    .argument('<id>', 'request id, or "last"')
    .argument('<target>', 'URL to send it to')
    .option(...FILE_OPTION)
    .option('-a, --append-path', 'append the original path and query to the target')
    .option('-H, --header <header>', 'extra header, repeatable ("Name: value")', headerPair)
    .option('-t, --timeout <ms>', 'request timeout in ms', int, 30_000)
    .action(async (id, target, opts) => {
      const req = await new RequestLog(opts.file).get(id);
      if (!req) {
        io.err(`No request with id ${id}.`);
        process.exitCode = 1;
        return;
      }
      const c = pc.createColors(io.color);
      try {
        const res = await replay(req, target, {
          appendPath: opts.appendPath,
          headers: opts.header,
          timeoutMs: opts.timeout,
        });
        const paint = res.status < 300 ? c.green : res.status < 400 ? c.yellow : c.red;
        io.out(
          `${c.dim(`#${req.id}`)} ${req.method} ${res.url} -> ${paint(c.bold(`${res.status} ${res.statusText}`))} ${c.dim(`${res.ms}ms`)}`,
        );
        if (res.body) io.out(res.body);
        if (res.status >= 400) process.exitCode = 1;
      } catch (err) {
        io.err(`Replay failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });

  program
    .command('clear')
    .description('delete all saved requests')
    .option(...FILE_OPTION)
    .action(async (opts) => {
      await new RequestLog(opts.file).clear();
      io.out(`Cleared ${opts.file}.`);
    });

  return program;
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  buildProgram()
    .parseAsync()
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
