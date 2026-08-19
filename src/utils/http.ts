import createDebug from 'debug';
import { ProxyAgent, type Dispatcher } from 'undici';

import { HttpError, TimeoutError } from './errors';

const debug = createDebug('respotify:http');

export interface HttpClientOptions {
  /** proxy url (`http://`, `https://`, or `socks5://` if the runtime supports it). */
  proxy?: string;
  /** per-attempt deadline. defaults to 30s. */
  timeoutMs?: number;
  /** extra attempts after the first one. defaults to 3. */
  retries?: number;
  /** base delay for exponential backoff. defaults to 500ms. */
  retryDelayMs?: number;
  /** headers merged into every request. */
  headers?: Record<string, string>;
  /** swap in a custom fetch (tests, instrumentation). defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
}

export interface HttpRequestOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs?: number;
  retries?: number;
  /** treat these statuses as success instead of throwing (e.g. `[404]`). */
  allowStatus?: number[];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * retry-after is either a delay in seconds or an http date. returns milliseconds,
 * or `null` when the header is absent or unparseable.
 */
const parseRetryAfter = (value: string | null): number | null => {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;

  return Math.max(0, date - Date.now());
};

const isRetryableNetworkError = (error: unknown): boolean => {
  if (error instanceof TimeoutError) return true;
  if (!(error instanceof Error)) return false;

  // undici surfaces the real cause one level down.
  const code = (error as NodeJS.ErrnoException).code
    ?? ((error.cause as NodeJS.ErrnoException | undefined)?.code);

  return code === 'ECONNRESET'
    || code === 'ECONNREFUSED'
    || code === 'ETIMEDOUT'
    || code === 'EPIPE'
    || code === 'EAI_AGAIN'
    || code === 'UND_ERR_CONNECT_TIMEOUT'
    || code === 'UND_ERR_SOCKET';
};

/**
 * a small fetch wrapper that every spotify call goes through: per-attempt timeouts,
 * exponential backoff with retry-after support, and optional per-instance proxying.
 *
 * proxy agents are cached per url so a long-lived downloader reuses connections
 * instead of opening a fresh pool on every request.
 */
export class HttpClient {
  private static proxyAgents = new Map<string, ProxyAgent>();

  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly dispatcher?: Dispatcher;

  readonly timeoutMs: number;
  readonly retries: number;
  readonly retryDelayMs: number;
  readonly headers: Record<string, string>;

  constructor(private readonly options: HttpClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retries = options.retries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 500;
    this.headers = options.headers ?? {};
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.dispatcher = options.proxy ? HttpClient.agentFor(options.proxy) : undefined;
  }

  private static agentFor(proxy: string): ProxyAgent {
    let agent = this.proxyAgents.get(proxy);
    if (!agent) {
      agent = new ProxyAgent(proxy);
      this.proxyAgents.set(proxy, agent);
    }
    return agent;
  }

  /** derive a client that shares this one's settings, overriding some of them. */
  extend(options: HttpClientOptions): HttpClient {
    return new HttpClient({ ...this.options, ...options });
  }

  async request(url: string, init: HttpRequestOptions = {}): Promise<Response> {
    const { timeoutMs = this.timeoutMs, retries = this.retries, allowStatus, ...rest } = init;
    const attempts = retries + 1;

    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await this.attempt(url, rest, timeoutMs);

        if (response.ok || allowStatus?.includes(response.status)) return response;

        // read the body once so the error carries context and the socket is freed.
        const body = await response.text().catch(() => undefined);
        const error = new HttpError(
          `${init.method ?? 'GET'} ${url} failed with ${response.status}`,
          response.status,
          url,
          body
        );

        if (!error.retryable || attempt === attempts) throw error;

        const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
        await sleep(retryAfter ?? this.backoff(attempt));
        lastError = error;
        continue;
      } catch (error) {
        if (error instanceof HttpError) {
          if (!error.retryable || attempt === attempts) throw error;
          lastError = error;
          await sleep(this.backoff(attempt));
          continue;
        }

        if (!isRetryableNetworkError(error) || attempt === attempts) throw error;

        debug('attempt %d/%d for %s failed: %s', attempt, attempts, url, error);
        lastError = error;
        await sleep(this.backoff(attempt));
      }
    }

    throw lastError;
  }

  private async attempt(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await this.fetchImpl(url, {
        ...init,
        headers: { ...this.headers, ...(init.headers as Record<string, string> | undefined) },
        signal: controller.signal,
        // `dispatcher` is an undici extension that the dom RequestInit type omits.
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      } as RequestInit);
    } catch (error) {
      if (controller.signal.aborted) throw new TimeoutError(url, timeoutMs);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** exponential backoff with jitter, so retries from parallel callers spread out. */
  private backoff(attempt: number): number {
    const base = this.retryDelayMs * 2 ** (attempt - 1);
    return base + Math.random() * this.retryDelayMs;
  }

  async json<T>(url: string, init: HttpRequestOptions = {}): Promise<T> {
    const response = await this.request(url, init);
    return response.json() as Promise<T>;
  }

  async buffer(url: string, init: HttpRequestOptions = {}): Promise<Buffer> {
    const response = await this.request(url, init);
    return Buffer.from(await response.arrayBuffer());
  }

  async bytes(url: string, init: HttpRequestOptions = {}): Promise<Uint8Array> {
    const response = await this.request(url, init);
    return new Uint8Array(await response.arrayBuffer());
  }
}

/** shared client for callers that do not need proxying or custom tuning. */
export const defaultHttpClient = new HttpClient();
