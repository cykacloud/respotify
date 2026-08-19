import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DownloadError } from '../src/utils';
import { SpotifyDownloader, type SpotifyMetadata } from '../src/spotify/downloader';

describe('input parsing', () => {
  it('accepts a bare 22-char id and defaults the type', () => {
    const [parsed, gid] = SpotifyDownloader.inputParse('5yNQnqQ9X5dW6qXO8T6Xjg');

    assert.equal(parsed.id, '5yNQnqQ9X5dW6qXO8T6Xjg');
    assert.equal(parsed.type, 'track');
    assert.equal(gid.length, 32);
  });

  it('honours an explicit type for bare ids', () => {
    const [parsed] = SpotifyDownloader.inputParse('5yNQnqQ9X5dW6qXO8T6Xjg', 'episode');
    assert.equal(parsed.type, 'episode');
  });

  it('extracts id and type from an open.spotify.com link', () => {
    const [parsed] = SpotifyDownloader.inputParse(
      'https://open.spotify.com/track/5yNQnqQ9X5dW6qXO8T6Xjg'
    );

    assert.equal(parsed.type, 'track');
    assert.equal(parsed.id, '5yNQnqQ9X5dW6qXO8T6Xjg');
  });

  it('extracts episodes too', () => {
    const [parsed] = SpotifyDownloader.inputParse(
      'https://open.spotify.com/episode/5yNQnqQ9X5dW6qXO8T6Xjg'
    );

    assert.equal(parsed.type, 'episode');
  });

  it('rejects links to other resource kinds', () => {
    assert.throws(
      () => SpotifyDownloader.inputParse('https://open.spotify.com/album/5yNQnqQ9X5dW6qXO8T6Xjg'),
      DownloadError
    );
  });

  it('rejects junk', () => {
    assert.throws(() => SpotifyDownloader.inputParse('hello'), DownloadError);
  });

  it('produces a stable 32-char gid', () => {
    const [, gid] = SpotifyDownloader.inputParse('5yNQnqQ9X5dW6qXO8T6Xjg');
    assert.match(gid, /^[0-9a-f]{32}$/);
  });
});

describe('metadata handling', () => {
  const file = (format: string) => ({ file_id: `id-${format}`, format });

  it('prefers the top-level file list', () => {
    const metadata: SpotifyMetadata = {
      file: [file('MP4_128')],
      audio: [file('MP4_256')],
    };

    assert.deepEqual(SpotifyDownloader.getAudioFilesFromMetadata(metadata), [file('MP4_128')]);
  });

  it('falls back to the first alternative that actually has files', () => {
    const metadata: SpotifyMetadata = {
      alternative: [{}, { file: [file('MP4_128')] }],
    };

    assert.deepEqual(SpotifyDownloader.getAudioFilesFromMetadata(metadata), [file('MP4_128')]);
  });

  it('falls back to the audio list', () => {
    const metadata: SpotifyMetadata = { audio: [file('MP4_256')] };

    assert.deepEqual(SpotifyDownloader.getAudioFilesFromMetadata(metadata), [file('MP4_256')]);
  });

  it('returns an empty list when nothing is available', () => {
    assert.deepEqual(SpotifyDownloader.getAudioFilesFromMetadata({}), []);
  });
});
