import { Base62 } from '~/utils';
import { License_KeyContainer_KeyType, Session } from '~/widewine';
import { widevineIdentifierBlob, widevinePrivateKey } from './constants';
import { SpotifyDecryptor, SpotifyDecryptorFFmpeg } from './decryptors';
import createDebug from 'debug';
import { SpotifyAuth } from './auth';

export interface SpotifyAudioFile {
  file_id: string;
  format: string;
}

export type SpotifyAudioFiles = SpotifyAudioFile[]

export type SpotifyAudioType = 'track' | 'episode';

export interface SpotifyDownloadOptions {
  input: string;
  type?: SpotifyAudioType;
  format?: string;
  forceAccessToken?: boolean;
}

export interface SpotifyMetadata {
  file: SpotifyAudioFiles;
  alternative?: [
    {
      file?: SpotifyAudioFiles;
    }
  ];
  audio?: SpotifyAudioFiles;
}

export interface SpotifyDownloadResult {
  id: string;
  gid: string;
  track: Buffer;
  encrypted: Buffer;
  decryptionKey: string;
  streamUrl: string;
}

const debug = createDebug('respotify:downloader');

export class SpotifyDownloader {
  static base62 = new Base62();

  static idToGid(id: string) {
    return BigInt(this.base62.decode(id)).toString(16).padStart(32, '0');
  }

  static extractId(link: string) {
    try {
      const url = new URL(link);
      const groups = url.pathname.match(/^\/(?<type>track|episode)\/(?<id>[a-z0-9]+)/si)?.groups;
      if (!groups) return null;
      const { type, id } = groups;
      return { type, id };
    } catch (e) {
      return null;
    }
  }

  static getAudioFilesFromMetadata(metadata: SpotifyMetadata): SpotifyAudioFiles | null {
    return metadata.file ?? metadata.alternative?.[0]?.file ?? metadata?.audio ?? null;
  }

  /**
   * Parse input (id or open.spotify.com link) and return [id, gid]
   */
  static inputParse(input: string, type: SpotifyAudioType = 'track'): [
    {
      id: string;
      type: SpotifyAudioType;
    },
    string
  ] {
    const extracted = /^[a-zA-Z0-9]{22}$/.test(input) ? { type, id: input } : this.extractId(input);
    if (!extracted) throw new Error('Invalid ID or link');
    // @ts-expect-error poebat)
    return [extracted, this.idToGid(extracted.id)] as const;
  }

  constructor(private auth: SpotifyAuth, public decryptor: SpotifyDecryptor = new SpotifyDecryptorFFmpeg('/tmp')) {}

  get accessToken() {
    return this.auth.exportedCredentials.accessToken;
  }

  get hasAccessToken() {
    return !!this.accessToken;
  }

  async fetchMetadata(gid: string, type: SpotifyAudioType = 'track'): Promise<SpotifyMetadata> {
    debug('fetch metadata gid=%s type=%s', gid, type);
    if (!this.hasAccessToken) throw new Error('No access token');

    const response = await fetch(`https://spclient.wg.spotify.com/metadata/4/${type}/${gid}?market=from_token`, {
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        accept: 'application/json',    
      }
    });

    const json = await response.json();
    debug('metadata', json);

    return json;
  }

  async fetchPssh(fileId: string) {
    debug('fetch pssh', fileId);
    const response = await fetch(`https://seektables.scdn.co/seektable/${fileId}.json`);
    const json = await response.json();
    debug('pssh', json);
    return Buffer.from(json['pssh'], 'base64');
  }

  async fetchLicense(body: ArrayBuffer | Buffer) {
    debug('fetch license');
    const response = await fetch('https://spclient.wg.spotify.com/widevine-license/v1/audio/license', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        'content-type': 'application/octet-stream',
        'content-length': String(body.byteLength),
        'user-agent': 'Spotify/8.9.62.566 Android/33 (Pixel 5)',
        
      },
      body
    });
    debug('is license fetched', response.ok);
    if (!response.ok) throw new Error('Failed to fetch license');
    
    return response.arrayBuffer();
  }

  async fetchStreamUrl(fileId: string): Promise<string | null> {
    const response = await fetch(`https://spclient.wg.spotify.com/storage-resolve/v2/files/audio/interactive/11/${fileId}?version=10000000&product=9&platform=39&alt=json`, {
      headers: {
        authorization: `Bearer ${this.accessToken}`,
      }
    });
    const json = await response.json();
    return json['cdnurl']?.[0] ?? null;
  }

  async download({
    input,
    type = 'track',
    format = 'MP4_128', 
    forceAccessToken = false
  }: SpotifyDownloadOptions): Promise<SpotifyDownloadResult> {
    debug('download track, input=%s forceAccessToken=%b', input, forceAccessToken);
    debug('format', format);

    const [{ id, type: audioType }, gid] = SpotifyDownloader.inputParse(input, type);

    if (forceAccessToken || !this.hasAccessToken) {
      debug(`fetch accessToken (reason: forceAccessToken=${forceAccessToken}, hasAccessToken=${this.hasAccessToken})`);
      await this.auth.updateStoredCredential();
    }

    const metadata = await this.fetchMetadata(gid, audioType);
    const audioFile = SpotifyDownloader.getAudioFilesFromMetadata(metadata)
      ?.find((audioFile) => audioFile.format === format);
    if (!audioFile) throw new Error(`No ${format} audio file found`);
    debug('found audioFile', audioFile);

    const pssh = await this.fetchPssh(audioFile.file_id);
    debug('create session');
    const session = new Session({
      privateKey: widevinePrivateKey, identifierBlob: widevineIdentifierBlob
    }, pssh);

    const licenseResponse = await this.fetchLicense(session.createLicenseRequest());
    const license = session.parseLicense(Buffer.from(licenseResponse));
    debug('parsed license', license);
    if (license.length === 0) throw new Error('Failed to parse license');

    const decryptionKey = license.find((k) => k.type === License_KeyContainer_KeyType.CONTENT)?.key;
    debug('decryptionKey', decryptionKey);
    if (!decryptionKey) throw new Error('Failed to find decryption key');
    const streamUrl = await this.fetchStreamUrl(audioFile.file_id);
    debug('streamUrl', streamUrl);
    if (!streamUrl) throw new Error('Failed to fetch stream URL');

    const encryptedm4a = await fetch(streamUrl);
    const encrypted = Buffer.from(await encryptedm4a.arrayBuffer());
    debug('trying to decrypt');
    const track = await this.decryptor.decrypt(decryptionKey, encrypted);

    return {
      id,
      gid,
      track,
      encrypted,
      decryptionKey,
      streamUrl
    };
  }
}
