import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Base62, HttpClient, HttpError, TimeoutError } from '../src/utils';

describe('base62', () => {
  const base62 = new Base62();

  it('round-trips values', () => {
    for (const value of ['0', '1', '61', '62', '3844', '9007199254740993']) {
      assert.equal(base62.decode(base62.encode(value)), value);
    }
  });

  it('encodes zero as the first charset character', () => {
    assert.equal(base62.encode('0'), '0');
  });

  it('decodes a real 22-char spotify id', () => {
    // 5yNQnqQ9X5dW6qXO8T6Xjg is the id used in the readme example.
    const decoded = base62.decode('5yNQnqQ9X5dW6qXO8T6Xjg');
    assert.equal(BigInt(decoded).toString(16).padStart(32, '0').length, 32);
  });

  it('rejects characters outside the charset', () => {
    assert.throws(() => base62.decode('not-base62!'), /not in the base62 charset/);
  });

  it('rejects negative input', () => {
    assert.throws(() => base62.encode('-1'), /negative/);
  });

  it('rejects a charset that is not 62 characters', () => {
    assert.throws(() => new Base62('abc'), /62 characters/);
  });
});

/** builds a fetch stub that replays a scripted list of responses. */
const scriptedFetch = (steps: Array<() => Response | Promise<Response>>) => {
  let call = 0;
  const stub = (async () => {
    const step = steps[Math.min(call, steps.length - 1)];
    call++;
    return step();
  }) as unknown as typeof globalThis.fetch;

  return { stub, calls: () => call };
};

describe('http client', () => {
  it('returns a successful response without retrying', async () => {
    const { stub, calls } = scriptedFetch([() => new Response('ok', { status: 200 })]);
    const http = new HttpClient({ fetch: stub, retries: 3, retryDelayMs: 1 });

    const response = await http.request('https://example.test/');

    assert.equal(await response.text(), 'ok');
    assert.equal(calls(), 1);
  });

  it('retries a 500 and succeeds on a later attempt', async () => {
    const { stub, calls } = scriptedFetch([
      () => new Response('boom', { status: 500 }),
      () => new Response('boom', { status: 500 }),
      () => new Response('finally', { status: 200 }),
    ]);
    const http = new HttpClient({ fetch: stub, retries: 3, retryDelayMs: 1 });

    const response = await http.request('https://example.test/');

    assert.equal(await response.text(), 'finally');
    assert.equal(calls(), 3);
  });

  it('gives up after exhausting the retry budget', async () => {
    const { stub, calls } = scriptedFetch([() => new Response('down', { status: 503 })]);
    const http = new HttpClient({ fetch: stub, retries: 2, retryDelayMs: 1 });

    await assert.rejects(
      () => http.request('https://example.test/'),
      (error: unknown) => error instanceof HttpError && error.status === 503
    );
    assert.equal(calls(), 3);
  });

  it('does not retry a 4xx', async () => {
    const { stub, calls } = scriptedFetch([() => new Response('nope', { status: 404 })]);
    const http = new HttpClient({ fetch: stub, retries: 3, retryDelayMs: 1 });

    await assert.rejects(
      () => http.request('https://example.test/'),
      (error: unknown) => error instanceof HttpError && error.status === 404
    );
    assert.equal(calls(), 1);
  });

  it('honours allowStatus instead of throwing', async () => {
    const { stub } = scriptedFetch([() => new Response('missing', { status: 404 })]);
    const http = new HttpClient({ fetch: stub, retries: 0 });

    const response = await http.request('https://example.test/', { allowStatus: [404] });

    assert.equal(response.status, 404);
  });

  it('retries a retryable network error', async () => {
    const { stub, calls } = scriptedFetch([
      () => {
        const error = new Error('socket hang up') as NodeJS.ErrnoException;
        error.code = 'ECONNRESET';
        throw error;
      },
      () => new Response('recovered', { status: 200 }),
    ]);
    const http = new HttpClient({ fetch: stub, retries: 2, retryDelayMs: 1 });

    const response = await http.request('https://example.test/');

    assert.equal(await response.text(), 'recovered');
    assert.equal(calls(), 2);
  });

  it('surfaces a timeout as TimeoutError', async () => {
    const stub = ((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    })) as unknown as typeof globalThis.fetch;

    const http = new HttpClient({ fetch: stub, retries: 0, timeoutMs: 20 });

    await assert.rejects(
      () => http.request('https://example.test/'),
      (error: unknown) => error instanceof TimeoutError
    );
  });

  it('parses json and bytes helpers', async () => {
    const { stub } = scriptedFetch([
      () => Response.json({ hello: 'world' }),
      () => new Response(new Uint8Array([1, 2, 3])),
    ]);
    const http = new HttpClient({ fetch: stub, retries: 0 });

    assert.deepEqual(await http.json('https://example.test/'), { hello: 'world' });
    assert.deepEqual([...await http.bytes('https://example.test/')], [1, 2, 3]);
  });
});
