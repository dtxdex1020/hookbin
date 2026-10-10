import { createColors } from 'picocolors';
import { describe, expect, it } from 'vitest';
import { colorJson, formatBody, formatRequest, formatSummary } from '../src/format.js';
import type { CapturedRequest } from '../src/types.js';

const req = (over: Partial<CapturedRequest> = {}): CapturedRequest => ({
  id: 7,
  receivedAt: '2026-10-09T12:34:56.000Z',
  method: 'POST',
  url: '/hooks?x=1',
  headers: { 'content-type': 'application/json', 'x-signature': 'abc' },
  body: '{"event":"paid","amount":42,"ok":true,"meta":null,"items":[]}',
  bodyEncoding: 'utf8',
  ...over,
});

const plain = createColors(false);

describe('formatBody', () => {
  it('pretty-prints JSON', () => {
    expect(formatBody(req(), plain)).toBe(
      '{\n  "event": "paid",\n  "amount": 42,\n  "ok": true,\n  "meta": null,\n  "items": []\n}',
    );
  });

  it('detects JSON without a content type', () => {
    expect(formatBody(req({ headers: {}, body: '[1,2]' }), plain)).toBe('[\n  1,\n  2\n]');
  });

  it('falls back to raw text for broken JSON', () => {
    expect(formatBody(req({ body: '{nope' }), plain)).toBe('{nope');
  });

  it('lays out form bodies as aligned pairs', () => {
    const form = req({
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'a=1&name=Jane+Doe',
    });
    expect(formatBody(form, plain)).toBe('a     1\nname  Jane Doe');
  });

  it('summarizes binary and empty bodies', () => {
    expect(formatBody(req({ body: 'AAEC/w==', bodyEncoding: 'base64' }), plain)).toBe(
      '(binary, 4 bytes)',
    );
    expect(formatBody(req({ body: '' }), plain)).toBe('(empty body)');
  });
});

describe('colorJson', () => {
  it('adds colors when enabled', () => {
    const out = colorJson({ a: 'x', n: 1 }, createColors(true));
    expect(out).toContain('\x1b[36m"a"\x1b[39m');
    expect(out).toContain('\x1b[32m"x"\x1b[39m');
    expect(out).toContain('\x1b[33m1\x1b[39m');
  });
});

describe('formatRequest', () => {
  it('prints the request line, headers and body', () => {
    const out = formatRequest(req({ body: '' }));
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/^#7 POST \/hooks\?x=1 \d\d:\d\d:\d\d$/);
    expect(lines[1]).toBe('  content-type  application/json');
    expect(lines[2]).toBe('  x-signature   abc');
    expect(out).toContain('(empty body)');
  });

  it('hides headers in compact mode and joins repeated headers', () => {
    expect(formatRequest(req(), { compact: true })).not.toContain('x-signature');
    expect(formatRequest(req({ headers: { 'set-cookie': ['a=1', 'b=2'] } }))).toContain(
      'set-cookie  a=1, b=2',
    );
  });
});

describe('formatSummary', () => {
  it('fits on one line', () => {
    expect(formatSummary(req({ body: 'hello' }))).toBe(
      '   7  2026-10-09T12:34:56.000Z  POST    /hooks?x=1 5b',
    );
  });
});
