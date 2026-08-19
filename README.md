<p align="center">
  <img src="./.github/respotify.svg">
</p>

<p align="center">
  <em>headless spotify auth and track downloader for node — no browser, no official sdk.</em>
</p>

<p align="center">
  <a href="#install">install</a> ·
  <a href="#quick-start">quick start</a> ·
  <a href="#api">api</a> ·
  <a href="#how-it-works">how it works</a> ·
  <a href="#production-notes">production notes</a>
</p>

---

## what it does

respotify logs into spotify the way the android client does — protobuf over
`login5`, hashcash challenge solved locally — then resolves a track to its
encrypted cdn payload, gets a widevine content key, and hands both to ffmpeg to
produce playable audio.

no browser automation, no webdriver, no captcha service. one dependency-light
library that runs anywhere node runs.

| | |
|---|---|
| **auth** | `login5` password + stored-credential flows, hashcash solved in-process |
| **tokens** | expiry tracked from the wire, renewed lazily, single-flight |
| **download** | metadata → pssh → widevine license → cdn → decrypt |
| **transport** | per-attempt timeouts, exponential backoff, `retry-after`, proxy per instance |
| **types** | strict typescript, typed error hierarchy, esm + cjs |

## install

```bash
# not published to npm — install from git
pnpm add git+https://github.com/neverlane/respotify.git
npm  add git+https://github.com/neverlane/respotify.git
bun  add git+https://github.com/neverlane/respotify.git
```

requires node >= 18.17. `ffmpeg` ships with the package via `ffmpeg-static`, so
there is nothing to install system-wide.

> **pnpm 10+** blocks install scripts by default. `ffmpeg-static` needs its one
> to fetch a binary, so allow it in your `package.json`:
>
> ```json
> { "pnpm": { "onlyBuiltDependencies": ["ffmpeg-static", "respotify"] } }
> ```

## quick start

```ts
import { SpotifyAuth, SpotifyDownloader } from 'respotify';
import { writeFile } from 'node:fs/promises';

const auth = await SpotifyAuth.fromLoginPassword('username', 'password');
const downloader = new SpotifyDownloader(auth);

const { track, format } = await downloader.download({
  input: 'https://open.spotify.com/track/5yNQnqQ9X5dW6qXO8T6Xjg',
});

await writeFile(`out.${format.startsWith('MP4') ? 'm4a' : 'ogg'}`, track);
```

### reuse the session across restarts

logging in with a password every boot is slow and looks like abuse. log in once,
persist the stored credential, and resume from it afterwards:

```ts
// first run
const auth = await SpotifyAuth.fromLoginPassword('username', 'password');
await save(auth.exportedCredentials.storedCredential);

// every run after that
const auth = await SpotifyAuth.fromStoredCredential(await load());
```

spotify rotates the stored credential on every renewal, so re-persist it whenever
you renew if you want the longest-lived session.

## api

### `SpotifyAuth`

```ts
SpotifyAuth.fromLoginPassword(username, password, options?): Promise<SpotifyAuth>
SpotifyAuth.fromStoredCredential(credential, options?): Promise<SpotifyAuth>

auth.getAccessToken(): Promise<string>   // renews if stale — use this one
auth.updateStoredCredential(): Promise<this>
auth.isExpired: boolean
auth.expiresInMs: number
auth.exportedCredentials: SpotifyCredentials
```

`options` accepts `{ http, proxy, clientInfo, expirySkewMs }`.

**`getAccessToken()` is the accessor you want.** it checks the real expiry that
login5 reported, renews when the token is inside the skew window (60s by
default), and collapses concurrent renewals into a single round trip. there are
no background timers to leak, and no blind `setInterval` guessing at the
lifetime.

### `SpotifyDownloader`

```ts
new SpotifyDownloader(auth, decryptorOrOptions?)

downloader.download({
  input,        // bare 22-char id or open.spotify.com link
  type?,        // 'track' | 'episode', inferred from links
  format?,      // string or preference list, defaults to ['MP4_128', 'MP4_256']
  forceAccessToken?,
}): Promise<SpotifyDownloadResult>
```

returns `{ id, gid, type, format, track, encrypted, decryptionKey, streamUrl }`
where `track` is the decrypted audio and `encrypted` is what the cdn served.

`format` accepts a preference list: the first format actually present in the
track's metadata wins, so a track missing your first choice still downloads.

### transport and proxies

every network call goes through `HttpClient`. give a session its own proxy and
all of its traffic — login5, metadata, license, cdn — follows it:

```ts
const auth = await SpotifyAuth.fromStoredCredential(credential, {
  http: { proxy: 'http://user:pass@host:8080', timeoutMs: 20_000, retries: 5 },
});

const downloader = new SpotifyDownloader(auth, {
  http: { proxy: 'http://user:pass@host:8080' },
});
```

proxy agents are pooled per url, so many accounts on one proxy share connections.

### errors

everything thrown derives from `RespotifyError`:

```
RespotifyError
├── HttpError        status, url, body, .retryable
├── TimeoutError     url, timeoutMs
├── AuthError        reason (login5 enum name)
│   └── TokenExpiredError
├── DownloadError    unresolvable input, missing format, missing key
└── DecryptError     ffmpeg failed or timed out
```

```ts
import { AuthError, DownloadError } from 'respotify';

try {
  await downloader.download({ input: id });
} catch (error) {
  if (error instanceof AuthError) await reconnectAccount();
  else if (error instanceof DownloadError) markUnavailable(id);
  else throw error;
}
```

### decryptors

`SpotifyDecryptorFFmpeg` is the default. it writes to a temp file (mp4 cannot be
muxed to a pipe), always cleans up, enforces a timeout, and reports ffmpeg's own
stderr when it fails.

```ts
new SpotifyDecryptorFFmpeg({ tmpFolder: '/var/tmp', timeoutMs: 60_000 })
```

implement `SpotifyDecryptor` to swap in your own backend:

```ts
interface SpotifyDecryptor {
  decrypt(key: string, data: Buffer): Promise<Buffer>;
}
```

## how it works

```
                fromLoginPassword / fromStoredCredential
                                │
                    ┌───────────▼───────────┐
                    │   login5 (protobuf)   │  hashcash solved in-process
                    └───────────┬───────────┘
                                │ access token + stored credential + expiry
                    ┌───────────▼───────────┐
                    │      SpotifyAuth      │  lazy, single-flight renewal
                    └───────────┬───────────┘
                                │ getAccessToken()
   ┌────────────────────────────▼────────────────────────────┐
   │                    SpotifyDownloader                    │
   │                                                         │
   │  metadata/4/{type}/{gid}      → audio file id           │
   │  seektable/{fileId}.json      → pssh box                │
   │  widevine-license/v1/audio    → content key             │
   │  storage-resolve/v2/files     → cdn url                 │
   │  GET cdn url                  → encrypted mp4           │
   └────────────────────────────┬────────────────────────────┘
                                │ key + ciphertext
                    ┌───────────▼───────────┐
                    │   SpotifyDecryptor    │  ffmpeg -decryption_key
                    └───────────┬───────────┘
                                ▼
                          playable audio
```

## production notes

- **renew lazily, not on a timer.** call `getAccessToken()` before each request.
  a `setInterval` that refreshes every N minutes will still hand out a dead token
  in the gap between ticks, and keeps the process alive when you want it to exit.
- **persist the rotated stored credential.** it changes on every renewal.
- **one proxy per account.** downloading many tracks from one ip is what gets
  accounts limited; `http.proxy` is per-instance for exactly this reason.
- **let the retry budget do its job.** transient 5xx and socket resets are
  retried with jittered backoff and `retry-after` support. wrapping calls in your
  own retry loop on top mostly multiplies the load.
- **catch `AuthError` distinctly.** it means the session is dead and needs a real
  reconnect; retrying will not fix it.

## development

```bash
pnpm install
pnpm check      # typecheck + lint + tests
pnpm build      # tsup -> dist (esm + cjs + d.ts)
```

debug logging is namespaced under `respotify:*`:

```bash
DEBUG=respotify:* node your-script.js
```

## thanks

- [librespot](https://github.com/librespot-org) — `.proto` definitions for the spotify client
- [Frooastside/node-widevine](https://github.com/Frooastside/node-widevine) — widevine session handling

used in production by [midvetbmarubot](https://github.com/neverlane/midvetbmarubot).
