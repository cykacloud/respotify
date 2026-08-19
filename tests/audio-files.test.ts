import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DownloadError } from '../src/utils';
import {
  ProtobufWriter,
  messageAt,
  messagesAt,
  readFields,
  stringAt,
  varintAt,
} from '../src/utils/protobuf';
import {
  audioUriFromUuid,
  buildAudioFilesRequest,
  parseAudioFilesResponse,
} from '../src/spotify/audio-files';

describe('protobuf wire format', () => {
  it('round-trips a varint', () => {
    for (const value of [0, 1, 127, 128, 300, 65_535, 1_000_000]) {
      const buf = new ProtobufWriter().varint(3, value).finish();
      assert.equal(varintAt(readFields(buf), 3), value, `value ${value}`);
    }
  });

  it('round-trips a string', () => {
    const buf = new ProtobufWriter().string(1, 'spotify:audio:abc').finish();
    assert.equal(stringAt(readFields(buf), 1), 'spotify:audio:abc');
  });

  it('round-trips bytes, including high bytes', () => {
    const payload = Buffer.from([0x00, 0xff, 0x7f, 0x80, 0x01]);
    const buf = new ProtobufWriter().bytes(9, payload).finish();

    assert.deepEqual(messageAt(readFields(buf), 9), payload);
  });

  it('keeps repeated fields in order', () => {
    const buf = new ProtobufWriter()
      .string(1, 'first')
      .string(1, 'second')
      .finish();

    assert.deepEqual(
      messagesAt(readFields(buf), 1).map((b) => b.toString('utf8')),
      ['first', 'second']
    );
  });

  it('nests messages', () => {
    const inner = new ProtobufWriter().varint(1, 5);
    const buf = new ProtobufWriter().message(2, inner).finish();
    const nested = messageAt(readFields(buf), 2);

    assert.ok(nested);
    assert.equal(varintAt(readFields(nested), 1), 5);
  });

  it('reads past fields it does not know', () => {
    const buf = new ProtobufWriter()
      .varint(1, 7)
      .string(99, 'something new spotify added')
      .varint(2, 9)
      .finish();

    assert.equal(varintAt(readFields(buf), 2), 9);
  });

  it('refuses a truncated field rather than returning junk', () => {
    const buf = new ProtobufWriter().string(1, 'abcdef').finish();
    assert.throws(() => readFields(buf.subarray(0, 4)), /truncated/);
  });
});

describe('audio entity uri', () => {
  /**
   * a real pair, taken from a live response: this uuid is what track metadata
   * returned for "Never Gonna Give You Up", and this uri is what
   * extended-metadata accepted for it.
   */
  it('converts a uuid the way the service expects', () => {
    assert.equal(
      audioUriFromUuid('ad3a7457424544d1a3f2c3e25334f81d'),
      'spotify:audio:5gSnX3fjUjOghfFZMHpVDv'
    );
  });

  it('rejects anything that is not a 32-char hex uuid', () => {
    assert.throws(() => audioUriFromUuid('nope'), DownloadError);
    assert.throws(() => audioUriFromUuid('ad3a7457424544d1a3f2c3e25334f81'), DownloadError);
  });
});

describe('audio files request', () => {
  it('asks for AUDIO_FILES against the entity uri', () => {
    const request = readFields(buildAudioFilesRequest('spotify:audio:abc'));
    const entity = messageAt(request, 2);
    assert.ok(entity, 'entity_request should be field 2');

    const entityFields = readFields(entity);
    assert.equal(stringAt(entityFields, 1), 'spotify:audio:abc');

    const query = messageAt(entityFields, 2);
    assert.ok(query, 'query should be field 2');
    // ExtensionKind.AUDIO_FILES
    assert.equal(varintAt(readFields(query), 1), 5);
  });
});

/** rebuild the response spotify actually sends, then read it back. */
const buildResponse = (
  files: Array<[fileId: string, format: number]>,
  typeUrl = 'type.googleapis.com/spotify.extendedmetadata.audiofiles.AudioFilesExtensionResponse'
) => {
  const payload = new ProtobufWriter();
  for (const [fileId, format] of files) {
    payload.message(1, new ProtobufWriter().bytes(1, Buffer.from(fileId, 'hex')).varint(2, format));
  }

  const any = new ProtobufWriter().string(1, typeUrl).message(2, payload);
  const entity = new ProtobufWriter().message(3, any);
  const array = new ProtobufWriter().message(3, entity);

  return new ProtobufWriter().message(2, array).finish();
};

describe('audio files response', () => {
  /** the exact formats a live response carried for that track. */
  const LIVE = [
    ['7ef44d290dc516478ca0366864edb669b4a6bea0', 0],
    ['df6087632f48c2da7a049edf3bad9f5bf672781d', 8],
    ['b7098e5bb8c2c1639bb44e0c17549e6d9f24bb3f', 1],
    ['8499085407168921ce3d76c10ae6e7911e788b0b', 16],
    ['5182bea01744133d7c58ad7f0360c6f7891f94d6', 2],
  ] as Array<[string, number]>;

  it('reads every file with its id and format name', () => {
    const files = parseAudioFilesResponse(buildResponse(LIVE));

    assert.deepEqual(files.map((f) => f.format), [
      'OGG_VORBIS_96', 'AAC_24', 'OGG_VORBIS_160', 'FLAC_FLAC', 'OGG_VORBIS_320',
    ]);
    assert.equal(files[0].fileId, '7ef44d290dc516478ca0366864edb669b4a6bea0');
    assert.equal(files[0].fileId.length, 40, 'file ids are 20 bytes');
  });

  it('keeps an unknown format as its number rather than dropping the file', () => {
    const files = parseAudioFilesResponse(buildResponse([['aa'.repeat(20), 250]]));

    assert.equal(files.length, 1);
    assert.equal(files[0].format, '250');
  });

  it('refuses a response for a different extension', () => {
    assert.throws(
      () => parseAudioFilesResponse(buildResponse(LIVE, 'type.googleapis.com/something.Else')),
      /answered with/
    );
  });

  it('refuses an empty response rather than reporting no files', () => {
    assert.throws(() => parseAudioFilesResponse(Buffer.alloc(0)), DownloadError);
  });
});
