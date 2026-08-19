import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DownloadError } from '../src/utils';
import { DEFAULT_FORMAT_PREFERENCE, SpotifyDownloader } from '../src/spotify/downloader';

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

describe('format selection', () => {
  const file = (format: string, formatId: number) => ({ fileId: `id-${format}`, format, formatId });

  it('takes the first format in the preference list that exists', () => {
    const files = [file('OGG_VORBIS_96', 0), file('OGG_VORBIS_320', 2), file('FLAC_FLAC', 16)];

    assert.equal(
      SpotifyDownloader.selectAudioFile(files, ['OGG_VORBIS_320', 'OGG_VORBIS_96']).format,
      'OGG_VORBIS_320'
    );
  });

  it('falls through to a later preference', () => {
    const files = [file('AAC_24', 8)];

    assert.equal(
      SpotifyDownloader.selectAudioFile(files, ['OGG_VORBIS_320', 'AAC_24']).format,
      'AAC_24'
    );
  });

  it('names what was available when nothing matches', () => {
    const files = [file('FLAC_FLAC', 16)];

    assert.throws(
      () => SpotifyDownloader.selectAudioFile(files, ['OGG_VORBIS_320']),
      /got \[FLAC_FLAC\]/
    );
  });

  it('says so when there are no files at all', () => {
    assert.throws(() => SpotifyDownloader.selectAudioFile([], ['OGG_VORBIS_320']), /got \[nothing\]/);
  });

  /**
   * mp4 used to be the default. spotify stopped serving those tiers, so a
   * preference list still headed by them would resolve nothing for every track.
   */
  it('defaults to formats spotify actually serves', () => {
    assert.equal(DEFAULT_FORMAT_PREFERENCE.includes('OGG_VORBIS_320' as never), true);
    assert.equal(DEFAULT_FORMAT_PREFERENCE.some((f) => f.startsWith('MP4')), false);
  });
});
