# agents.md

guidance for ai agents working in this repository.

## what this is

respotify is a node library that logs into spotify through `login5` (the protobuf
endpoint the android client uses) and downloads tracks by resolving them to their
encrypted cdn payload, obtaining a widevine content key, and decrypting with
ffmpeg. it is consumed by `midvetbmarubot`.

## conventions

- **all comments and documentation are english, lowercase.** this includes jsdoc,
  inline comments, readme prose, and commit messages. identifiers keep normal
  casing.
- commits follow conventional commits: `type(scope): subject`, subject lowercase,
  imperative mood. never add `Co-Authored-By` trailers.
- two-space indent, single quotes, semicolons. enforced by eslint — run it.
- comments explain *why*, not *what*. if a line needs a comment to say what it
  does, rewrite the line.

## layout

```
src/
  utils/
    errors.ts      typed error hierarchy — everything derives from RespotifyError
    http.ts        HttpClient: timeouts, backoff, retry-after, proxy pooling
    base62.ts      spotify id <-> gid conversion (bigint, ids exceed 2^53)
    aes-cmac.ts    used by the widevine session
  spotify/
    auth.ts        SpotifyAuth — login5 flows, expiry tracking, lazy renewal
    downloader.ts  SpotifyDownloader — metadata -> license -> cdn -> decrypt
    constants.ts   widevine device blob and private key
    decryptors/    SpotifyDecryptor interface + ffmpeg implementation
    librespot/     generated protobuf — do not hand-edit
  widewine/
    session.ts     widevine license request/parse
    license_protocol_pb.ts  generated protobuf — do not hand-edit
tests/             node:test suites, run through tsx
```

## rules that matter

**never reintroduce timer-based token refresh.** token lifetime comes from
`LoginOk.accessTokenExpiresIn` on the wire. `SpotifyAuth.getAccessToken()` renews
lazily inside a skew window and collapses concurrent renewals through the
`renewal` promise. a `setInterval` refresh both leaks a handle and still serves
dead tokens between ticks.

**all network calls go through `HttpClient`.** never call bare `fetch` in `src/`.
the client is what provides timeouts, retry with jittered backoff, `retry-after`
handling, and per-instance proxying. adding a raw `fetch` silently opts that call
out of every one of those.

**throw typed errors.** use the classes in `utils/errors.ts` rather than bare
`Error`. consumers branch on `AuthError` vs `DownloadError` to decide between
reconnecting an account and marking a track unavailable.

**the generated protobuf directories are generated.** `src/spotify/librespot/**`
and `src/widewine/license_protocol_pb.ts` come from `.proto` files. regenerate
rather than patching by hand.

**no `@ts-ignore` / `@ts-expect-error`.** the codebase is clean of them. if types
fight you, the types are usually right.

**no tsconfig path aliases.** imports inside `src/` are relative. this package is
consumed as a git dependency, and pnpm builds it through `prepare` in a temporary
directory where esbuild did not resolve `~/*` — the build failed there while
succeeding in a normal checkout. relative imports resolve the same everywhere.

**`dist/` is committed.** consumers install this straight from git, and building
at install time made them depend on the toolchain matching across machines —
tsup's declaration step produced a complete 81kb `.d.ts` locally and an empty
80-byte one on the ci runner, so every install silently got a package with no
types. there is no `prepare` script any more; run `pnpm build` and commit the
result with the source change. `pnpm build:verify` fails if the two drift.

## verification

```bash
pnpm typecheck   # tsc --noEmit, strict, must be silent
pnpm lint        # eslint, must be silent
pnpm test        # node:test via tsx
pnpm check       # all three
pnpm build       # tsup -> dist, esm + cjs + declarations
```

run `pnpm check` before claiming anything works. the test suite covers base62,
the http retry matrix, and auth expiry/renewal semantics with a stubbed fetch —
no network access required, so there is no excuse for skipping it.

## what is not covered by tests

the download pipeline past `inputParse` and metadata selection needs live spotify
credentials, so it is not exercised in ci. if you change `download()`, say plainly
that it was not verified end-to-end rather than implying it was.
