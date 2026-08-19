import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import createDebug from 'debug';
import ffmpegPath from 'ffmpeg-static';

import { DecryptError } from '~/utils';
import { SpotifyDecryptor } from './abstract';

const debug = createDebug('respotify:decryptor:ffmpeg');

export interface SpotifyDecryptorFFmpegOptions {
  /** where intermediate files land. defaults to the os temp dir. */
  tmpFolder?: string;
  /** kill ffmpeg if it has not finished within this many ms. defaults to 120s. */
  timeoutMs?: number;
  /** override the bundled ffmpeg-static binary. */
  binary?: string;
}

/**
 * decrypts widevine-protected mp4 audio by handing the content key to ffmpeg and
 * remuxing to a plain container.
 *
 * ffmpeg cannot write mp4 to a pipe (it needs to seek back and patch the moov
 * atom), so output goes to a temp file that is always removed — on success, on
 * failure, and on timeout.
 */
export class SpotifyDecryptorFFmpeg implements SpotifyDecryptor {
  readonly tmpFolder: string;
  readonly timeoutMs: number;
  readonly binary: string | null;

  constructor(options: string | SpotifyDecryptorFFmpegOptions = {}) {
    const opts: SpotifyDecryptorFFmpegOptions = typeof options === 'string'
      ? { tmpFolder: options }
      : options;

    this.tmpFolder = opts.tmpFolder ?? tmpdir();
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.binary = opts.binary ?? ffmpegPath;
    debug('tmpFolder=%s timeout=%dms binary=%s', this.tmpFolder, this.timeoutMs, this.binary);
  }

  async decrypt(key: string, data: Buffer): Promise<Buffer> {
    if (!this.binary) throw new DecryptError('ffmpeg binary not found');

    const outfile = join(this.tmpFolder, `respotify_${randomBytes(16).toString('hex')}.m4a`);

    try {
      await this.run(key, data, outfile);
      return await readFile(outfile);
    } finally {
      await rm(outfile, { force: true }).catch((error) => {
        debug('failed to remove %s: %s', outfile, error);
      });
    }
  }

  private run(key: string, data: Buffer, outfile: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(this.binary as string, [
        '-loglevel', 'error',
        '-y',
        '-decryption_key', key,
        '-i', 'pipe:',
        '-c', 'copy',
        outfile
      ]);

      // collect stderr so a non-zero exit reports what ffmpeg actually complained about.
      let stderr = '';
      let settled = false;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          child.kill('SIGKILL');
          reject(error);
        } else {
          resolve();
        }
      };

      const timer = setTimeout(
        () => finish(new DecryptError(`ffmpeg timed out after ${this.timeoutMs}ms`)),
        this.timeoutMs
      );

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.once('error', (error) => finish(new DecryptError('failed to spawn ffmpeg', error)));

      // ffmpeg closes stdin as soon as it has what it needs; that surfaces as EPIPE
      // on our side and is not a failure.
      child.stdin.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EPIPE') return;
        finish(new DecryptError('failed to write to ffmpeg stdin', error));
      });

      child.once('close', (code) => {
        if (code === 0) return finish();
        finish(new DecryptError(
          `ffmpeg exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`
        ));
      });

      child.stdin.end(data);
    });
  }
}
