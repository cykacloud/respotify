import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import assert from 'assert';
import { createHash, randomBytes } from 'crypto';
import createDebug from 'debug';
import { hrtime } from 'process';

import { AuthError, HttpClient, type HttpClientOptions, TokenExpiredError } from '../utils';
import {
  HashcashSolutionSchema
} from './librespot/spotify/login5/v3/challenges/hashcash_pb';
import {
  type ClientInfo,
  ClientInfoSchema,
} from './librespot/spotify/login5/v3/client_info_pb';
import {
  type Challenge,
  type LoginRequest,
  type ChallengeSolution,
  type LoginResponse,
  ChallengeSolutionSchema,
  ChallengeSolutionsSchema,
  LoginError,
  LoginRequestSchema,
  LoginResponseSchema,
} from './librespot/spotify/login5/v3/login5_pb';
import {
  PasswordSchema, StoredCredentialSchema
} from './librespot/spotify/login5/v3/credentials/credentials_pb';

const debug = createDebug('respotify:auth');

export interface SpotifyAuthLoginViaPasswordOptions {
  clientInfo?: ClientInfo;
  username: string;
  password: string;
  http?: HttpClient;
}

export interface SpotifyAuthLoginViaStoredCredentialOptions {
  clientInfo?: ClientInfo;
  username?: string;
  storedCredential: Uint8Array;
  http?: HttpClient;
}

export interface SpotifyAuthOptions {
  loginResponse: LoginResponse;
  clientInfo?: ClientInfo;
  /** http tuning (proxy, timeouts, retries) reused for every renewal. */
  http?: HttpClient | HttpClientOptions;
  /**
   * renew this many ms before the token actually expires, so an in-flight request
   * never races the expiry. defaults to 60s.
   */
  expirySkewMs?: number;
}

export interface SpotifyCredentials {
  accessToken: string;
  storedCredential: string;
  username: string;
  clientInfo: ClientInfo;
  /** epoch ms at which the access token stops being valid. */
  expiresAt: number;
}

interface ChallengeSolve {
  suffix: Uint8Array;
  ctr: number;
}

const toHttpClient = (http?: HttpClient | HttpClientOptions): HttpClient =>
  http instanceof HttpClient ? http : new HttpClient(http);

/**
 * headless spotify session built on login5. holds an access token, knows when it
 * expires, and renews itself from the stored credential on demand.
 *
 * renewal is lazy and single-flight: callers await {@link getAccessToken} and the
 * first one to find the token stale performs the refresh while everyone else
 * awaits the same promise. no background timers, nothing to leak.
 */
export class SpotifyAuth {
  static LOGIN5_V3_LOGIN_URL = 'https://login5.spotify.com/v3/login';
  static LOGIN5_HEADERS = {
    'user-agent': 'Spotify/8.9.62.566 Android/33 (Pixel 5)',
  };
  static SPOTIFY_CLIENT_ID = '9a8d2f0ce77a4e248bb71fefcb557637';

  static async sendLogin5(
    data: Uint8Array,
    headers?: Record<string, string>,
    http: HttpClient = new HttpClient()
  ): Promise<Uint8Array> {
    debug('sendLogin5 %d bytes', data.byteLength);

    return http.bytes(this.LOGIN5_V3_LOGIN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-protobuf',
        ...this.LOGIN5_HEADERS,
        ...headers
      },
      body: data as unknown as RequestInit['body'],
    });
  }

  static solveHashcash(prefix: Uint8Array, length: number, random: Uint8Array): ChallengeSolve {
    assert(length === 10, 'hashcash length should be 10');

    const suffix = new Uint8Array(16);
    suffix.set(random);

    const numberOfTrailingZeros = (i: number) => {
      if (i === 0) return 32;
      let num = 0;
      while ((i & 1) === 0) {
        i >>= 1;
        num++;
      }
      return num;
    };
    const incrementCtr = (ctr: Uint8Array, index: number) => {
      ctr[index]++;
      if (ctr[index] === 0 && index !== 0)
        incrementCtr(ctr, index - 1);
    };
    const checkHashcash = (hash: Uint8Array) =>
      hash[hash.length - 1] === 0 &&
      numberOfTrailingZeros(hash[hash.length - 2]) >= 2;

    let iters = 0;

    for (;;) {
      const digest = Uint8Array.from(createHash('SHA1')
        .update(prefix)
        .update(suffix)
        .digest());

      if (checkHashcash(digest))
        return {
          suffix,
          ctr: iters
        };

      incrementCtr(suffix, suffix.length - 1);
      incrementCtr(suffix, 7);
      iters++;
    }
  }

  static solveChallenges(loginContext: Uint8Array, challenges: Challenge[]) {
    const challengeSolutions: ChallengeSolution[] = [];

    for (const { challenge } of challenges) {
      switch (challenge.case) {
        case 'hashcash': {
          const { prefix, length } = challenge.value;

          const loginContextDigest = createHash('SHA1')
            .update(loginContext)
            .digest();
          const seed = new Uint8Array(loginContextDigest)
            .slice(12, 20);

          const start = hrtime.bigint();
          const solved = this.solveHashcash(prefix, length, seed);
          const duration = hrtime.bigint() - start;
          debug('solved hashcash in %d iterations', solved.ctr);

          challengeSolutions.push(
            create(ChallengeSolutionSchema, {
              solution: {
                case: 'hashcash',
                value: create(HashcashSolutionSchema, {
                  suffix: solved.suffix,
                  duration: {
                    seconds: duration / BigInt(1e9),
                    nanos: Number(duration % BigInt(1e9)),
                  }
                })
              }
            })
          );

          break;
        }

        default:
          throw new AuthError(`unsupported login5 challenge: ${challenge.case}`);
      }
    }

    return challengeSolutions;
  }

  static generateClientInfo() {
    return create(ClientInfoSchema, {
      clientId: this.SPOTIFY_CLIENT_ID,
      deviceId: randomBytes(8).toString('hex')
    });
  }

  static async sendLoginRequest(loginRequest: LoginRequest, http?: HttpClient) {
    return fromBinary(
      LoginResponseSchema,
      await this.sendLogin5(
        toBinary(LoginRequestSchema, loginRequest),
        undefined,
        http
      )
    );
  }

  /** turn a non-ok login5 response into a typed error with a readable reason. */
  private static assertOk(response: LoginResponse): LoginResponse {
    if (response.response.case === 'ok') return response;

    if (response.response.case === 'error') {
      const reason = LoginError[response.response.value] ?? String(response.response.value);
      throw new AuthError(`login5 rejected the request: ${reason}`, reason);
    }

    throw new AuthError(
      `unexpected login5 response: ${response.response.case ?? 'empty'}`,
      response.response.case
    );
  }

  static async loginViaPassword(opts: SpotifyAuthLoginViaPasswordOptions) {
    const clientInfo = opts.clientInfo ?? this.generateClientInfo();
    const loginMethod: LoginRequest['loginMethod'] = {
      case: 'password',
      value: create(PasswordSchema, {
        id: opts.username,
        password: opts.password
      })
    };

    const firstResponse = await this.sendLoginRequest(
      create(LoginRequestSchema, {
        clientInfo,
        loginContext: new Uint8Array(),
        loginMethod
      }),
      opts.http
    );

    if (firstResponse.response.case !== 'challenges') return this.assertOk(firstResponse);

    return this.assertOk(
      await this.sendLoginRequest(
        create(LoginRequestSchema, {
          clientInfo,
          loginMethod,
          loginContext: firstResponse.loginContext,
          challengeSolutions: create(ChallengeSolutionsSchema, {
            solutions: this.solveChallenges(
              firstResponse.loginContext,
              firstResponse.response.value.challenges
            )
          })
        }),
        opts.http
      )
    );
  }

  static async loginViaStoredCredential(opts: SpotifyAuthLoginViaStoredCredentialOptions) {
    const clientInfo = opts.clientInfo ?? this.generateClientInfo();
    const loginMethod: LoginRequest['loginMethod'] = {
      case: 'storedCredential',
      value: create(StoredCredentialSchema, {
        username: opts.username,
        data: opts.storedCredential
      })
    };

    return this.assertOk(
      await this.sendLoginRequest(
        create(LoginRequestSchema, {
          clientInfo,
          loginContext: new Uint8Array(),
          loginMethod
        }),
        opts.http
      )
    );
  }

  static async fromLoginPassword(
    username: string,
    password: string,
    options: Omit<SpotifyAuthOptions, 'loginResponse'> = {}
  ) {
    const http = toHttpClient(options.http);
    return new SpotifyAuth({
      ...options,
      http,
      loginResponse: await SpotifyAuth.loginViaPassword({
        username,
        password,
        clientInfo: options.clientInfo,
        http
      }),
    });
  }

  static async fromStoredCredential(
    storedCredential: Uint8Array | string,
    options: Omit<SpotifyAuthOptions, 'loginResponse'> = {}
  ) {
    const bytes = typeof storedCredential === 'string'
      ? new TextEncoder().encode(storedCredential)
      : storedCredential;
    const http = toHttpClient(options.http);

    return new SpotifyAuth({
      ...options,
      http,
      loginResponse: await SpotifyAuth.loginViaStoredCredential({
        storedCredential: bytes,
        clientInfo: options.clientInfo,
        http
      }),
    });
  }

  private clientInfo: ClientInfo;
  private storedCredential: string;
  private accessToken: string;
  private username: string;
  private expiresAt: number;
  private readonly expirySkewMs: number;
  private readonly http: HttpClient;
  /** in-flight renewal shared by every concurrent caller. */
  private renewal: Promise<string> | null = null;

  constructor(opts: SpotifyAuthOptions) {
    const response = SpotifyAuth.assertOk(opts.loginResponse);
    const loginOk = response.response.value as Extract<
      LoginResponse['response'], { case: 'ok' }
    >['value'];

    this.accessToken = loginOk.accessToken;
    this.storedCredential = new TextDecoder().decode(loginOk.storedCredential);
    this.username = loginOk.username;
    this.clientInfo = opts.clientInfo ?? SpotifyAuth.generateClientInfo();
    this.expirySkewMs = opts.expirySkewMs ?? 60_000;
    this.http = toHttpClient(opts.http);
    this.expiresAt = SpotifyAuth.expiryFrom(loginOk.accessTokenExpiresIn);
  }

  /**
   * login5 reports lifetime in seconds. it has been observed to come back as 0 on
   * some responses, so fall back to spotify's usual one-hour window rather than
   * treating the fresh token as already dead.
   */
  private static expiryFrom(expiresInSeconds: number): number {
    const seconds = expiresInSeconds > 0 ? expiresInSeconds : 3600;
    return Date.now() + seconds * 1000;
  }

  get exportedCredentials(): SpotifyCredentials {
    return {
      accessToken: this.accessToken,
      storedCredential: this.storedCredential,
      username: this.username,
      clientInfo: this.clientInfo,
      expiresAt: this.expiresAt,
    };
  }

  /** true once the token is within the skew window of expiring. */
  get isExpired(): boolean {
    return Date.now() >= this.expiresAt - this.expirySkewMs;
  }

  /** ms until renewal is due; 0 when it is already due. */
  get expiresInMs(): number {
    return Math.max(0, this.expiresAt - this.expirySkewMs - Date.now());
  }

  /**
   * the only token accessor callers should use. renews transparently when stale,
   * and collapses concurrent renewals into one login5 round trip.
   */
  async getAccessToken(): Promise<string> {
    if (!this.isExpired) return this.accessToken;

    if (!this.storedCredential) throw new TokenExpiredError();

    this.renewal ??= this.renew().finally(() => {
      this.renewal = null;
    });

    return this.renewal;
  }

  private async renew(): Promise<string> {
    debug('renewing access token for %s', this.username);
    await this.updateStoredCredential();
    return this.accessToken;
  }

  /**
   * exchange the stored credential for a fresh access token (and a fresh stored
   * credential — spotify rotates it). prefer {@link getAccessToken}, which only
   * calls this when the token is actually stale.
   */
  async updateStoredCredential(): Promise<this> {
    const response = await SpotifyAuth.loginViaStoredCredential({
      storedCredential: new TextEncoder().encode(this.storedCredential),
      clientInfo: this.clientInfo,
      username: this.username,
      http: this.http,
    });

    const loginOk = response.response.value as Extract<
      LoginResponse['response'], { case: 'ok' }
    >['value'];

    this.accessToken = loginOk.accessToken;
    this.storedCredential = new TextDecoder().decode(loginOk.storedCredential);
    this.expiresAt = SpotifyAuth.expiryFrom(loginOk.accessTokenExpiresIn);
    debug('renewed, valid for %dms', this.expiresAt - Date.now());

    return this;
  }
}
