import createDebug from 'debug';

import { AudioKeyRequiredError, Base62, DownloadError, HttpClient, type HttpClientOptions } from '../utils';
import { fetchAudioFiles, type SpotifyAudioFile } from './audio-files';
import { License_KeyContainer_KeyType, Session } from '../widewine';
import { widevineIdentifierBlob, widevinePrivateKey } from './constants';
import { SpotifyDecryptor, SpotifyDecryptorFFmpeg } from './decryptors';
import { SpotifyAuth } from './auth';

export type { SpotifyAudioFile } from './audio-files';

export type SpotifyAudioType = 'track' | 'episode';

/**
 * formats tried in order when the caller does not pin one explicitly.
 *
 * mp4 is gone: spotify stopped offering the widevine-protected variants these
 * used to default to, and now serves ogg/aac/flac instead. 320 first because it
 * is the best lossy tier, flac last because it is an order of magnitude larger.
 */
export const DEFAULT_FORMAT_PREFERENCE = [
  'OGG_VORBIS_320',
  'OGG_VORBIS_160',
  'OGG_VORBIS_96',
  'AAC_24',
  'FLAC_FLAC',
] as const;

export interface SpotifyDownloadOptions {
  /** a bare 22-char id, or an `open.spotify.com` link. */
  input: string;
  type?: SpotifyAudioType;
  /** a single format, or a preference list tried in order. */
  format?: string | readonly string[];
  /** renew the access token before starting, even if it still looks valid. */
  forceAccessToken?: boolean;
}

/**
 * anything that can hand over a currently-valid access token.
 *
 * {@link SpotifyAuth} satisfies this, and so does a caller holding an oauth
 * refresh token: the internal `spclient` surface accepts a first-party bearer
 * token regardless of how it was obtained, so the downloader has no business
 * insisting on a login5 session.
 */
export interface SpotifyTokenProvider {
  getAccessToken(): Promise<string>;
  /** optional: only a login5 session can force a renewal on demand. */
  updateStoredCredential?(): Promise<unknown>;
}

export interface SpotifyDownloaderOptions {
  decryptor?: SpotifyDecryptor;
  /** http tuning for metadata/license/cdn calls. inherits the auth proxy if omitted. */
  http?: HttpClient | HttpClientOptions;
}

export interface SpotifyMetadata {
  name?: string;
  /**
   * the content identifier the audio file list is keyed on.
   *
   * this replaced the old `file` array, which spotify no longer returns in
   * either the json or the protobuf projection of track metadata.
   */
  original_audio?: { uuid: string; format?: string };
}

export interface SpotifyDownloadResult {
  id: string;
  gid: string;
  type: SpotifyAudioType;
  format: string;
  /** decrypted, playable audio. */
  track: Buffer;
  /** the raw encrypted payload as served by the cdn. */
  encrypted: Buffer;
  decryptionKey: string;
  streamUrl: string;
}

const debug = createDebug('respotify:downloader');

const SPCLIENT = 'https://spclient.wg.spotify.com';
const ID_PATTERN = /^[a-zA-Z0-9]{22}$/;
const AUDIO_TYPES: readonly string[] = ['track', 'episode'];

const isAudioType = (value: string): value is SpotifyAudioType => AUDIO_TYPES.includes(value);

const toHttpClient = (http?: HttpClient | HttpClientOptions): HttpClient | undefined => {
  if (!http) return undefined;
  return http instanceof HttpClient ? http : new HttpClient(http);
};

/**
 * resolves a track/episode to its encrypted cdn payload, obtains a widevine
 * content key, and hands both to a decryptor.
 *
 * every request pulls the token from {@link SpotifyAuth.getAccessToken}, so an
 * expired session renews itself mid-download instead of failing the call.
 */
export class SpotifyDownloader {
  static base62 = new Base62();

  static idToGid(id: string) {
    return BigInt(this.base62.decode(id)).toString(16).padStart(32, '0');
  }

  static extractId(link: string): { type: SpotifyAudioType; id: string } | null {
    try {
      const url = new URL(link);
      const groups = url.pathname.match(/^\/(?<type>track|episode)\/(?<id>[a-z0-9]+)/si)?.groups;
      if (!groups) return null;

      const { type, id } = groups;
      if (!isAudioType(type.toLowerCase())) return null;

      return { type: type.toLowerCase() as SpotifyAudioType, id };
    } catch {
      return null;
    }
  }

  /** parse a bare id or an open.spotify.com link into `[{ id, type }, gid]`. */
  static inputParse(
    input: string,
    type: SpotifyAudioType = 'track'
  ): [{ id: string; type: SpotifyAudioType }, string] {
    const extracted = ID_PATTERN.test(input)
      ? { type, id: input }
      : this.extractId(input);

    if (!extracted) throw new DownloadError(`not a valid spotify id or link: ${input}`);

    return [extracted, this.idToGid(extracted.id)];
  }

  readonly decryptor: SpotifyDecryptor;
  private readonly http: HttpClient;

  constructor(
    private readonly auth: SpotifyTokenProvider,
    decryptorOrOptions: SpotifyDecryptor | SpotifyDownloaderOptions = {}
  ) {
    const options: SpotifyDownloaderOptions = 'decrypt' in decryptorOrOptions
      ? { decryptor: decryptorOrOptions }
      : decryptorOrOptions;

    this.decryptor = options.decryptor ?? new SpotifyDecryptorFFmpeg();
    this.http = toHttpClient(options.http) ?? new HttpClient();
  }

  /** authorization header with a token guaranteed fresh at call time. */
  private async authHeaders(): Promise<Record<string, string>> {
    return { authorization: `Bearer ${await this.auth.getAccessToken()}` };
  }

  async fetchMetadata(gid: string, type: SpotifyAudioType = 'track'): Promise<SpotifyMetadata> {
    debug('fetch metadata gid=%s type=%s', gid, type);

    return this.http.json<SpotifyMetadata>(
      `${SPCLIENT}/metadata/4/${type}/${gid}?market=from_token`,
      {
        headers: {
          ...(await this.authHeaders()),
          accept: 'application/json',
        }
      }
    );
  }

  async fetchPssh(fileId: string): Promise<Buffer> {
    debug('fetch pssh %s', fileId);

    const json = await this.http.json<{ pssh?: string }>(
      `https://seektables.scdn.co/seektable/${fileId}.json`
    );

    if (!json.pssh) throw new DownloadError(`no pssh in seektable for file ${fileId}`);

    return Buffer.from(json.pssh, 'base64');
  }

  async fetchLicense(body: ArrayBuffer | Buffer): Promise<ArrayBuffer> {
    debug('fetch widevine license');

    const response = await this.http.request(`${SPCLIENT}/widevine-license/v1/audio/license`, {
      method: 'POST',
      headers: {
        ...(await this.authHeaders()),
        'content-type': 'application/octet-stream',
        'user-agent': SpotifyAuth.LOGIN5_HEADERS['user-agent'],
      },
      body: body as unknown as RequestInit['body'],
    });

    return response.arrayBuffer();
  }

  async fetchStreamUrl(fileId: string): Promise<string> {
    const json = await this.http.json<{ cdnurl?: string[] }>(
      `${SPCLIENT}/storage-resolve/v2/files/audio/interactive/11/${fileId}`
        + '?version=10000000&product=9&platform=39&alt=json',
      { headers: await this.authHeaders() }
    );

    const url = json.cdnurl?.[0];
    if (!url) throw new DownloadError(`storage-resolve returned no cdn url for file ${fileId}`);

    return url;
  }

  /** pick the first available file matching the caller's format preference. */
  static selectAudioFile(
    files: SpotifyAudioFile[],
    preference: readonly string[]
  ): SpotifyAudioFile {
    for (const format of preference) {
      const match = files.find((file) => file.format === format);
      if (match) return match;
    }

    throw new DownloadError(
      `none of the requested formats [${preference.join(', ')}] are available; `
      + `got [${files.map((f) => f.format).join(', ') || 'nothing'}]`
    );
  }

  /**
   * every audio file spotify offers for a track: metadata for the content id,
   * then the extended-metadata service for the files themselves.
   */
  async resolveAudioFiles(
    input: string,
    type: SpotifyAudioType = 'track'
  ): Promise<SpotifyAudioFile[]> {
    const [{ type: audioType }, gid] = SpotifyDownloader.inputParse(input, type);
    const metadata = await this.fetchMetadata(gid, audioType);
    const uuid = metadata.original_audio?.uuid;

    if (!uuid)
      throw new DownloadError(
        `track metadata carried no original_audio.uuid, so its files cannot be looked up${
          metadata.name ? ` (${metadata.name})` : ''}`
      );

    return fetchAudioFiles(this.http, await this.auth.getAccessToken(), uuid);
  }

  async download({
    input,
    type = 'track',
    format = DEFAULT_FORMAT_PREFERENCE,
    forceAccessToken = false
  }: SpotifyDownloadOptions): Promise<SpotifyDownloadResult> {
    const [{ id, type: audioType }, gid] = SpotifyDownloader.inputParse(input, type);
    const preference = typeof format === 'string' ? [format] : format;
    debug('download id=%s type=%s formats=%o', id, audioType, preference);

    if (forceAccessToken) await this.auth.updateStoredCredential?.();

    const files = await this.resolveAudioFiles(input, audioType);
    const audioFile = SpotifyDownloader.selectAudioFile(files, preference);
    debug('selected %s (%s)', audioFile.format, audioFile.fileId);

    const streamUrl = await this.fetchStreamUrl(audioFile.fileId);
    const encrypted = await this.http.buffer(streamUrl);
    debug('downloaded %d encrypted bytes', encrypted.byteLength);

    // widevine still covers the mp4 tiers, and its key comes over https. the
    // ogg/aac/flac tiers spotify now serves instead are aes-128-ctr under a key
    // only the access point hands out, so they stop here rather than returning
    // ciphertext dressed up as audio.
    const pssh = await this.fetchPssh(audioFile.fileId).catch(() => null);
    if (!pssh) throw new AudioKeyRequiredError(audioFile.fileId, audioFile.format);

    const session = new Session(
      { privateKey: widevinePrivateKey, identifierBlob: widevineIdentifierBlob },
      pssh
    );

    const licenseResponse = await this.fetchLicense(session.createLicenseRequest());
    const license = session.parseLicense(Buffer.from(licenseResponse));
    if (license.length === 0) throw new DownloadError('widevine license contained no keys');

    const decryptionKey = license
      .find((k) => k.type === License_KeyContainer_KeyType.CONTENT)?.key;
    if (!decryptionKey) throw new DownloadError('widevine license contained no content key');

    const track = await this.decryptor.decrypt(decryptionKey, encrypted);
    debug('decrypted to %d bytes', track.byteLength);

    return {
      id,
      gid,
      type: audioType,
      format: audioFile.format,
      track,
      encrypted,
      decryptionKey,
      streamUrl
    };
  }
}
