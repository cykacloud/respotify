import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import assert from 'assert';
import { createHash, randomBytes } from 'crypto';
import createDebug from 'debug';
import { hrtime } from 'process';

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
}

export interface SpotifyAuthLoginViaStoredCredentialOptions {
  clientInfo?: ClientInfo;
  username?: string;
  storedCredential: Uint8Array;
}

export interface SpotifyAuthOptions {
  loginResponse: LoginResponse;
  clientInfo?: ClientInfo;
}

interface ChallengeSolve {
  suffix: Uint8Array;
  ctr: number;
}

export class SpotifyAuth {
  static LOGIN5_V3_LOGIN_URL = 'https://login5.spotify.com/v3/login';
  static LOGIN5_HEADERS = {
    'user-agent': 'Spotify/8.9.62.566 Android/33 (Pixel 5)',
  };
  static SPOTIFY_CLIENT_ID = '9a8d2f0ce77a4e248bb71fefcb557637';

  static sendLogin5(data: Uint8Array, headers?: Record<string, string>): Promise<Uint8Array> {
    debug('sendLogin5', data, headers);
    return fetch(this.LOGIN5_V3_LOGIN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-protobuf',
        ...this.LOGIN5_HEADERS,
        ...headers
      },
      body: data
    })
      .then((response) => response.arrayBuffer())
      .then((data) => new Uint8Array(data));
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
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const digest = Uint8Array.from(createHash('SHA1')
        .update(prefix)
        .update(suffix)
        .digest());
  
      if (checkHashcash(digest))
        return {
          suffix,
          ctr: iters
        };
  
      incrementCtr(suffix, suffix.length-1);
      incrementCtr(suffix, 7);
      iters++;
    }    
  }

  static solveChallenges(loginContext: Uint8Array, challenges: Challenge[]) {
    const challengeSolutions: ChallengeSolution[] = [];
    
    for (const { challenge } of challenges) {
      switch (challenge.case) {
        case 'hashcash': {
          const {
            prefix, length
          } = challenge.value;

          const loginContextDigest = createHash('SHA1')
            .update(loginContext)
            .digest();
          const seed = new Uint8Array(loginContextDigest)
            .slice(12, 20);

          const start = hrtime.bigint();
          const solved = this.solveHashcash(prefix, length, seed);
          const duration = hrtime.bigint() - start;
          
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
          throw new Error('unknown challenge, i cant solve it');
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
  
  static async sendLoginRequest(loginRequest: LoginRequest) {
    return fromBinary(
      LoginResponseSchema,
      await this.sendLogin5(
        toBinary(LoginRequestSchema, loginRequest)
      )
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
      })
    );

    switch (firstResponse.response.case) {
      case 'challenges': {
        return this.sendLoginRequest(
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
          })
          // this.solveChallenges(firstResponse, clientInfo)
        );
      }
      default: return firstResponse;
    }
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

    const response = await this.sendLoginRequest(
      create(LoginRequestSchema, {
        clientInfo,
        loginContext: new Uint8Array(),
        loginMethod
      })
    );

    if (response.response.case === 'challenges') throw new Error('oops, this should not happen, because we login via storedCredential');

    return response;
  }

  static async fromLoginPassword(username: string, password: string, clientInfo?: ClientInfo) {
    return new SpotifyAuth({
      loginResponse: await SpotifyAuth.loginViaPassword({ username, password, clientInfo }),
      clientInfo
    });
  }

  static async fromStoredCredential(storedCredential: Uint8Array | string, clientInfo?: ClientInfo) {
    const _ = typeof storedCredential === 'string'
      ? new TextEncoder().encode(storedCredential)
      : storedCredential;
    return new SpotifyAuth({
      loginResponse: await SpotifyAuth.loginViaStoredCredential({
        storedCredential: _,
        clientInfo
      }),
      clientInfo
    });
  }

  private clientInfo: ClientInfo;
  private storedCredential: string;
  private accessToken: string;
  private username: string;

  constructor(opts: SpotifyAuthOptions) {
    if (opts.loginResponse.response.case !== 'ok') throw new Error(`passed loginResponse must have response.case === "ok", but it is "${opts.loginResponse.response.case}"`);
    const loginOk = opts.loginResponse.response.value;
    this.accessToken = loginOk.accessToken;
    this.storedCredential = new TextDecoder().decode(loginOk.storedCredential);
    this.username = loginOk.username;
    this.clientInfo = opts.clientInfo ?? SpotifyAuth.generateClientInfo();
  }

  get exportedCredentials() {
    return {
      accessToken: this.accessToken,
      storedCredential: this.storedCredential,
      username: this.username,
      clientInfo: this.clientInfo
    };
  }

  async updateStoredCredential() {
    const response = await SpotifyAuth.loginViaStoredCredential({
      storedCredential: new TextEncoder().encode(this.storedCredential),
      clientInfo: this.clientInfo,
      username: this.username
    });

    debug('updateStoredCredential response', response.response);
    if (response.response.case !== 'ok') throw new Error('Failed to update storedCredential');
    const loginOk = response.response.value;
    this.accessToken = loginOk.accessToken;
    this.storedCredential = new TextDecoder().decode(loginOk.storedCredential);

    return this;
  }
}