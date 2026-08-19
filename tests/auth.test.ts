import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { create, toBinary } from '@bufbuild/protobuf';

import { AuthError, HttpClient } from '../src/utils';
import { SpotifyAuth } from '../src/spotify/auth';
import {
  LoginError,
  LoginOkSchema,
  LoginResponseSchema,
} from '../src/spotify/librespot/spotify/login5/v3/login5_pb';

/** encode a login5 "ok" payload the way the real endpoint would. */
const okResponse = (overrides: Partial<{
  accessToken: string;
  storedCredential: string;
  username: string;
  accessTokenExpiresIn: number;
}> = {}) => toBinary(LoginResponseSchema, create(LoginResponseSchema, {
  response: {
    case: 'ok',
    value: create(LoginOkSchema, {
      accessToken: overrides.accessToken ?? 'token-1',
      storedCredential: new TextEncoder().encode(overrides.storedCredential ?? 'stored-1'),
      username: overrides.username ?? 'tester',
      accessTokenExpiresIn: overrides.accessTokenExpiresIn ?? 3600,
    }),
  },
}));

const errorResponse = (error: LoginError) =>
  toBinary(LoginResponseSchema, create(LoginResponseSchema, {
    response: { case: 'error', value: error },
  }));

/** fetch stub replaying scripted login5 payloads, counting round trips. */
const login5Fetch = (payloads: Uint8Array[]) => {
  let call = 0;
  const stub = (async () => {
    const payload = payloads[Math.min(call, payloads.length - 1)];
    call++;
    return new Response(
      payload as unknown as ConstructorParameters<typeof Response>[0],
      { status: 200 }
    );
  }) as unknown as typeof globalThis.fetch;

  return { stub, calls: () => call };
};

const httpWith = (stub: typeof globalThis.fetch) =>
  new HttpClient({ fetch: stub, retries: 0, retryDelayMs: 1 });

describe('spotify auth', () => {
  it('logs in from a stored credential and exposes credentials', async () => {
    const { stub } = login5Fetch([okResponse()]);
    const auth = await SpotifyAuth.fromStoredCredential('stored-0', { http: httpWith(stub) });

    const credentials = auth.exportedCredentials;
    assert.equal(credentials.accessToken, 'token-1');
    assert.equal(credentials.username, 'tester');
    assert.equal(credentials.storedCredential, 'stored-1');
    assert.ok(credentials.expiresAt > Date.now());
  });

  it('maps a login5 error onto AuthError with a readable reason', async () => {
    const { stub } = login5Fetch([errorResponse(LoginError.INVALID_CREDENTIALS)]);

    await assert.rejects(
      () => SpotifyAuth.fromStoredCredential('bad', { http: httpWith(stub) }),
      (error: unknown) => error instanceof AuthError
        && error.reason === 'INVALID_CREDENTIALS'
    );
  });

  it('treats a token as live until the skew window', async () => {
    const { stub, calls } = login5Fetch([okResponse({ accessTokenExpiresIn: 3600 })]);
    const auth = await SpotifyAuth.fromStoredCredential('stored-0', {
      http: httpWith(stub),
      expirySkewMs: 60_000,
    });

    assert.equal(auth.isExpired, false);
    assert.equal(await auth.getAccessToken(), 'token-1');
    // no extra login5 round trip beyond the initial login.
    assert.equal(calls(), 1);
  });

  it('renews when the token is inside the skew window', async () => {
    const { stub, calls } = login5Fetch([
      okResponse({ accessToken: 'token-1', accessTokenExpiresIn: 30 }),
      okResponse({ accessToken: 'token-2', accessTokenExpiresIn: 3600 }),
    ]);

    const auth = await SpotifyAuth.fromStoredCredential('stored-0', {
      http: httpWith(stub),
      expirySkewMs: 60_000,
    });

    assert.equal(auth.isExpired, true);
    assert.equal(await auth.getAccessToken(), 'token-2');
    assert.equal(auth.isExpired, false);
    assert.equal(calls(), 2);
  });

  it('collapses concurrent renewals into a single round trip', async () => {
    const { stub, calls } = login5Fetch([
      okResponse({ accessToken: 'token-1', accessTokenExpiresIn: 1 }),
      okResponse({ accessToken: 'token-2', accessTokenExpiresIn: 3600 }),
    ]);

    const auth = await SpotifyAuth.fromStoredCredential('stored-0', {
      http: httpWith(stub),
      expirySkewMs: 60_000,
    });

    const tokens = await Promise.all([
      auth.getAccessToken(),
      auth.getAccessToken(),
      auth.getAccessToken(),
    ]);

    assert.deepEqual(tokens, ['token-2', 'token-2', 'token-2']);
    // one initial login plus exactly one renewal, not three.
    assert.equal(calls(), 2);
  });

  it('falls back to an hour when login5 reports no lifetime', async () => {
    const { stub } = login5Fetch([okResponse({ accessTokenExpiresIn: 0 })]);
    const auth = await SpotifyAuth.fromStoredCredential('stored-0', { http: httpWith(stub) });

    const remaining = auth.exportedCredentials.expiresAt - Date.now();
    assert.ok(remaining > 3_500_000, `expected ~1h of validity, got ${remaining}ms`);
  });

  it('rotates the stored credential on renewal', async () => {
    const { stub } = login5Fetch([
      okResponse({ storedCredential: 'stored-1', accessTokenExpiresIn: 3600 }),
      okResponse({ storedCredential: 'stored-2', accessTokenExpiresIn: 3600 }),
    ]);

    const auth = await SpotifyAuth.fromStoredCredential('stored-0', { http: httpWith(stub) });
    assert.equal(auth.exportedCredentials.storedCredential, 'stored-1');

    await auth.updateStoredCredential();
    assert.equal(auth.exportedCredentials.storedCredential, 'stored-2');
  });
});
