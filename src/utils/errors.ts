/**
 * every error thrown by respotify derives from {@link RespotifyError}, so callers
 * can tell "the library failed" apart from "something else in the process failed"
 * with a single `instanceof` check.
 */
export class RespotifyError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

/** a request exhausted its retry budget, or failed in a way retrying cannot fix. */
export class HttpError extends RespotifyError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
    public readonly body?: string
  ) {
    super(message);
  }

  /** 408/429/5xx are worth another attempt; everything else is terminal. */
  get retryable(): boolean {
    return this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

/** the request did not complete within its deadline. */
export class TimeoutError extends RespotifyError {
  constructor(public readonly url: string, public readonly timeoutMs: number) {
    super(`request to ${url} timed out after ${timeoutMs}ms`);
  }
}

/** login5 rejected the credentials, or the session could not be renewed. */
export class AuthError extends RespotifyError {
  constructor(message: string, public readonly reason?: string) {
    super(message);
  }
}

/** the access token is gone or expired and no credential is available to renew it. */
export class TokenExpiredError extends AuthError {
  constructor() {
    super('access token expired and no stored credential is available to renew it');
  }
}

/** the requested track/episode could not be resolved, or has no downloadable file. */
export class DownloadError extends RespotifyError {}

/** ffmpeg (or another decryptor backend) failed to produce plaintext audio. */
export class DecryptError extends RespotifyError {}

/**
 * the file was located, but decrypting it needs an audio key.
 *
 * spotify moved off widevine-protected mp4 for these formats: the audio is now
 * ogg/aac/flac encrypted with aes-128-ctr under a per-file key, and that key is
 * only served over the access-point protocol. distinct from
 * {@link DownloadError} so callers can tell "this track does not exist" from
 * "this build cannot decrypt it yet".
 */
export class AudioKeyRequiredError extends RespotifyError {
  constructor(public readonly fileId: string, public readonly format: string) {
    super(
      `decrypting ${format} needs an audio key from the access point, `
      + `which this build does not implement yet (file ${fileId})`
    );
  }
}
