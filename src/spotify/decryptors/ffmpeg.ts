import { spawn } from 'child_process';
import { SpotifyDecryptor } from './abstract';
import ffmpegPath from 'ffmpeg-static';
import { randomBytes } from 'crypto';
import { readFile, rm } from 'fs/promises';
import createDebug from 'debug';

const debug = createDebug('respotify:decryptor:ffmpeg');

export class SpotifyDecryptorFFmpeg implements SpotifyDecryptor {
  constructor(public tmpFolder: string) {
    debug('constructor, tmpFolder %s', tmpFolder);
  }

  decrypt(key: string, data: Buffer): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      debug('decrypt key=%s ffmpeg=%s', key, ffmpegPath);
      if (!ffmpegPath) return reject(new Error('FFmpeg not found'));
      const outfile = `${this.tmpFolder}/spotdec_ffmpeg_${randomBytes(16).toString('hex')}.m4a`;
      debug('outfile %s', outfile);

      const process = spawn(ffmpegPath, [
        '-loglevel', 'error',
        '-y',
        '-decryption_key', key,
        '-i', 'pipe:',
        '-c', 'copy',
        outfile
      ]);

      process.once('error', (err) => {
        process.kill();
        reject(err);
      });
      process.stderr.once('error', (err) => {
        process.kill();
        reject(err);
      });

      process.stdin.write(data);
      process.stdin.end();

      process.once('close', (code) => {
        if (code !== 0) return reject(new Error(`FFmpeg exited with code ${code}`));
        readFile(outfile)
          .then(async (decrypted) => {
            await rm(outfile);
            resolve(decrypted);
          })
          .catch(reject);
      });
    });
    
  }
}