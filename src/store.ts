import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CapturedRequest } from './types.js';

/** Requests kept in a single JSON array file. Writes go through a temp file so the log never ends up half-written. */
export class RequestLog {
  private writing: Promise<void> = Promise.resolve();

  constructor(readonly file: string) {}

  async list(): Promise<CapturedRequest[]> {
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    if (!raw.trim()) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error(`${this.file} is not a hookbin log`);
    return data as CapturedRequest[];
  }

  /** Looks up a request by id. "last" returns the most recent one. */
  async get(id: string | number): Promise<CapturedRequest | undefined> {
    const all = await this.list();
    if (id === 'last') return all.at(-1);
    return all.find((r) => r.id === Number(id));
  }

  /** Appends a request, assigning the next id. Calls are serialized so ids stay unique. */
  add(req: Omit<CapturedRequest, 'id'>): Promise<CapturedRequest> {
    const run = this.writing.then(async () => {
      const all = await this.list();
      const saved = { id: (all.at(-1)?.id ?? 0) + 1, ...req };
      await this.save([...all, saved]);
      return saved;
    });
    this.writing = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async clear(): Promise<void> {
    await this.save([]);
  }

  private async save(all: CapturedRequest[]) {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(all, null, 2)}\n`);
    await rename(tmp, this.file);
  }
}
