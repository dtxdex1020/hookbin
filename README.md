# hookbin

[![CI](https://img.shields.io/github/actions/workflow/status/dtxdex1020/hookbin/ci.yml?branch=main&style=flat-square&label=CI&labelColor=1f4e79)](https://github.com/dtxdex1020/hookbin/actions/workflows/ci.yml)
[![node](https://img.shields.io/badge/node-%3E%3D20-4aa3df?style=flat-square&labelColor=1f4e79&logo=nodedotjs&logoColor=white)](./package.json)
[![license](https://img.shields.io/badge/license-MIT-4aa3df?style=flat-square&labelColor=1f4e79)](./LICENSE)

A webhook catcher that lives in your terminal. Point Stripe, GitHub or your own service at it, watch the requests roll in with readable colored output, then replay any of them at your real handler as many times as it takes to get the bug out.

No account, no tunnel dashboard, no browser tab. Two small dependencies.

## Install

```sh
npm install -g github:dtxdex1020/hookbin
```

Or clone and run it from source:

```sh
git clone https://github.com/dtxdex1020/hookbin && cd hookbin
npm install
node dist/cli.js
```

## Usage

Start catching:

```sh
hookbin                       # http://127.0.0.1:8787, saves to ./hookbin.json
hookbin -p 4000 --status 202  # different port, different reply
hookbin --host 0.0.0.0        # reachable from other machines or containers
hookbin --no-save --compact   # just print, no headers
```

Send it something:

```sh
curl -X POST localhost:8787/webhooks/stripe \
  -H 'content-type: application/json' \
  -d '{"type":"invoice.paid","data":{"amount":4200,"live":false}}'
```

And you get:

```text
#1 POST /webhooks/stripe 14:02:11
  host            localhost:8787
  user-agent      curl/8.14.1
  content-type    application/json
  content-length  59

{
  "type": "invoice.paid",
  "data": {
    "amount": 4200,
    "live": false
  }
}
```

JSON is pretty-printed and colored, form bodies are shown as aligned key/value pairs, and binary bodies are stored as base64 so nothing gets mangled.

### Replay

```sh
hookbin list
#    1  2026-10-09T18:02:11.304Z  POST    /webhooks/stripe 59b
#    2  2026-10-09T18:03:40.019Z  POST    /webhooks/github 7321b

hookbin replay 1 http://localhost:3000/api/stripe
# #1 POST http://localhost:3000/api/stripe -> 200 OK 14ms

hookbin replay last http://localhost:3000 --append-path   # -> /webhooks/github
hookbin replay 2 http://localhost:3000/hook -H 'X-Hub-Signature-256: sha256=...'
```

Replays keep the method, headers and body. Connection headers (`host`, `content-length` and friends) are recalculated, and an `x-hookbin-replay: <id>` header is added so your handler can tell. Non-2xx/3xx responses exit with code 1, which makes it handy in scripts.

## Commands

| Command                     | What it does                                   |
| --------------------------- | ---------------------------------------------- |
| `hookbin [listen]`          | Start the server and print every request       |
| `hookbin list`              | One line per saved request                     |
| `hookbin show <id>`         | Full request; `--json` for the raw saved entry |
| `hookbin replay <id> <url>` | Send a saved request somewhere else            |
| `hookbin clear`             | Empty the log                                  |

`<id>` can be a number or `last`. Every command takes `-f, --file <path>` (default `hookbin.json`).

| `listen` option       | Default     |                       |
| --------------------- | ----------- | --------------------- |
| `-p, --port <port>`   | `8787`      | `0` picks a free port |
| `--host <host>`       | `127.0.0.1` |                       |
| `-s, --status <code>` | `200`       | Status code sent back |
| `--no-save`           |             | Don't write the log   |
| `-c, --compact`       |             | Hide headers          |

| `replay` option      | Default |                                            |
| -------------------- | ------- | ------------------------------------------ |
| `-a, --append-path`  | off     | Add the original path and query to the URL |
| `-H, --header <h>`   |         | Extra header, repeatable                   |
| `-t, --timeout <ms>` | `30000` |                                            |

Colors follow `NO_COLOR` / `FORCE_COLOR`.

## Using it as a library

```ts
import { createHookServer, RequestLog, replay } from 'hookbin';

const log = new RequestLog('./hooks.json');
createHookServer({ log, onRequest: (req) => console.log(req.method, req.url) }).listen(8787);

const last = await log.get('last');
if (last) await replay(last, 'http://localhost:3000/webhooks');
```

## Why

Debugging webhooks usually means re-triggering the event in someone else's dashboard, waiting, and squinting at a minified body. I wanted the boring local version: catch it once, save it, replay it on demand while I fix the handler. The log is plain JSON, so it's also easy to commit a few real payloads as test fixtures.

## Development

```sh
npm install
npm test        # vitest, spins up real servers on random ports
npm run lint    # eslint + prettier + tsc
npm run build
```

## License

[MIT](./LICENSE)
