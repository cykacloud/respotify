import createDebug from 'debug';

import { Base62, DownloadError, HttpClient } from '../utils';
import {
  ProtobufWriter,
  messageAt,
  messagesAt,
  readFields,
  stringAt,
  varintAt,
} from '../utils/protobuf';

const debug = createDebug('respotify:audio-files');

const EXTENDED_METADATA_URL =
  'https://spclient.wg.spotify.com/extended-metadata/v0/extended-metadata';

/** ExtensionKind.AUDIO_FILES, from librespot's extension_kind.proto. */
const EXTENSION_KIND_AUDIO_FILES = 5;

const base62 = new Base62();

/** AudioFile.Format, from librespot's metadata.proto. */
export const AUDIO_FILE_FORMATS = {
  0: 'OGG_VORBIS_96',
  1: 'OGG_VORBIS_160',
  2: 'OGG_VORBIS_320',
  3: 'MP3_256',
  4: 'MP3_320',
  5: 'MP3_160',
  6: 'MP3_96',
  7: 'MP3_160_ENC',
  8: 'AAC_24',
  9: 'AAC_48',
  16: 'FLAC_FLAC',
  18: 'XHE_AAC_24',
  19: 'XHE_AAC_16',
  20: 'XHE_AAC_12',
  22: 'FLAC_FLAC_24BIT',
} as const;

export type AudioFileFormat = (typeof AUDIO_FILE_FORMATS)[keyof typeof AUDIO_FILE_FORMATS];

export interface SpotifyAudioFile {
  /** hex, 20 bytes — what storage-resolve and the audio key are keyed on. */
  fileId: string;
  /** the enum name when known, otherwise the raw number as a string. */
  format: string;
  formatId: number;
  /** bits per second, as the service reports it. */
  bitrate?: number;
}

/**
 * turn `original_audio.uuid` from track metadata into the entity uri the
 * extended-metadata service wants: `spotify:audio:<base62 of the uuid>`.
 */
export const audioUriFromUuid = (uuid: string): string => {
  if (!/^[0-9a-f]{32}$/i.test(uuid))
    throw new DownloadError(`not a spotify audio uuid: ${uuid}`);

  const id = base62.encode(BigInt(`0x${uuid}`).toString()).padStart(22, '0');

  return `spotify:audio:${id}`;
};

/**
 * field numbers read off a live response rather than guessed:
 *
 *   BatchedExtensionResponse.extended_metadata = 2
 *   EntityExtensionDataArray.extension_data    = 3
 *   EntityExtensionData.extension_data (Any)   = 3
 *   Any.type_url = 1, Any.value = 2
 *
 *   AudioFilesExtensionResponse.entry = 1   (repeated)
 *     entry.audio_file = 1
 *       audio_file.file_id = 1, .format = 2
 *     entry.bitrate = 4
 *
 * the entry wrapper is easy to miss: reading `file_id` straight off the entry
 * yields the whole nested message — 24 bytes of tags and payload — which then
 * sails through as a plausible-looking hex id and 404s at the cdn.
 */
const RESPONSE_EXTENDED_METADATA = 2;
const ARRAY_EXTENSION_DATA = 3;
const ENTITY_EXTENSION_DATA = 3;
const ANY_TYPE_URL = 1;
const ANY_VALUE = 2;
const RESPONSE_ENTRY = 1;
const ENTRY_AUDIO_FILE = 1;
const ENTRY_BITRATE = 4;
const AUDIO_FILE_ID = 1;
const AUDIO_FILE_FORMAT = 2;

const buildRequest = (entityUri: string): Buffer => {
  const query = new ProtobufWriter().varint(1, EXTENSION_KIND_AUDIO_FILES);
  const entity = new ProtobufWriter().string(1, entityUri).message(2, query);

  // BatchedEntityRequest.entity_request = 2
  return new ProtobufWriter().message(2, entity).finish();
};

const parseResponse = (body: Buffer): SpotifyAudioFile[] => {
  const array = messageAt(readFields(body), RESPONSE_EXTENDED_METADATA);
  if (!array) throw new DownloadError('extended-metadata returned no entity data');

  const entity = messageAt(readFields(array), ARRAY_EXTENSION_DATA);
  if (!entity) throw new DownloadError('extended-metadata returned no extension data');

  const any = messageAt(readFields(entity), ENTITY_EXTENSION_DATA);
  if (!any) throw new DownloadError('extended-metadata returned an empty extension');

  const anyFields = readFields(any);
  const typeUrl = stringAt(anyFields, ANY_TYPE_URL) ?? '';

  if (!typeUrl.includes('AudioFilesExtensionResponse'))
    throw new DownloadError(`extended-metadata answered with ${typeUrl || 'no type'}`);

  const payload = messageAt(anyFields, ANY_VALUE);
  if (!payload) throw new DownloadError('extended-metadata extension carried no value');

  return messagesAt(readFields(payload), RESPONSE_ENTRY).map((entry) => {
    const entryFields = readFields(entry);
    const audioFile = messageAt(entryFields, ENTRY_AUDIO_FILE);

    if (!audioFile) throw new DownloadError('audio file entry carried no file');

    const fileFields = readFields(audioFile);
    const fileId = messageAt(fileFields, AUDIO_FILE_ID);
    const formatId = varintAt(fileFields, AUDIO_FILE_FORMAT) ?? 0;

    if (!fileId || fileId.length !== 20)
      throw new DownloadError(
        `audio file id should be 20 bytes, got ${fileId?.length ?? 0} — the response shape changed`
      );

    return {
      fileId: fileId.toString('hex'),
      format: AUDIO_FILE_FORMATS[formatId as keyof typeof AUDIO_FILE_FORMATS] ?? String(formatId),
      formatId,
      bitrate: varintAt(entryFields, ENTRY_BITRATE),
    };
  });
};

/**
 * ask which audio files exist for a track.
 *
 * spotify removed the `file` list from track metadata entirely — it is not
 * empty for some regions, it is gone from both the json and the protobuf
 * projections — and moved it here. anything that still reads `metadata.file`
 * finds nothing and concludes the track is unavailable.
 */
export const fetchAudioFiles = async (
  http: HttpClient,
  accessToken: string,
  audioUuid: string
): Promise<SpotifyAudioFile[]> => {
  const entityUri = audioUriFromUuid(audioUuid);
  debug('requesting audio files for %s', entityUri);

  const response = await http.request(EXTENDED_METADATA_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/protobuf',
      accept: 'application/protobuf',
    },
    body: buildRequest(entityUri) as unknown as RequestInit['body'],
  });

  const files = parseResponse(Buffer.from(await response.arrayBuffer()));
  debug('found %d files: %o', files.length, files.map((f) => f.format));

  return files;
};

export { parseResponse as parseAudioFilesResponse, buildRequest as buildAudioFilesRequest };
