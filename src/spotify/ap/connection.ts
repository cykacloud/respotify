import { connect, type Socket } from 'net';
import { randomBytes } from 'crypto';
import createDebug from 'debug';

import { AuthError, DownloadError, TimeoutError } from '../../utils/errors';
import { ProtobufWriter, stringAt, readFields } from '../../utils/protobuf';
import { Shannon } from '../../utils/shannon';
import { performHandshake, type HandshakeTransport } from './handshake';

const debug = createDebug('respotify:ap:connection');

/** packet types, from librespot's packet.rs. */
export const PACKET_LOGIN = 0xab;
export const PACKET_AP_WELCOME = 0xac;
export const PACKET_AUTH_FAILURE = 0xad;
export const PACKET_REQUEST_KEY = 0x0c;
export const PACKET_AES_KEY = 0x0d;
export const PACKET_AES_KEY_ERROR = 0x0e;
export const PACKET_PING = 0x04;
export const PACKET_PONG = 0x49;
export const PACKET_PING_REQUEST = 0x4a;
export const PACKET_COUNTRY_CODE = 0x1b;

/** authentication.proto field numbers. */
const CRE_LOGIN_CREDENTIALS = 10;
const CRE_SYSTEM_INFO = 50;
const CRE_VERSION_STRING = 70;
const CREDENTIALS_USERNAME = 10;
const CREDENTIALS_TYPE = 20;
const CREDENTIALS_AUTH_DATA = 30;
const SYSTEM_INFO_CPU_FAMILY = 10;
const SYSTEM_INFO_OS = 60;
const SYSTEM_INFO_STRING = 90;
const SYSTEM_INFO_DEVICE_ID = 100;
const AP_WELCOME_USERNAME = 10;

const AUTHENTICATION_SPOTIFY_TOKEN = 3;
const CPU_X86_64 = 2;
const OS_LINUX = 5;

export interface Packet {
  cmd: number;
  payload: Buffer;
}

/** buffers the socket so callers can await an exact number of bytes. */
class SocketReader {
  private chunks: Buffer = Buffer.alloc(0);
  private waiting: { length: number; resolve: (b: Buffer) => void; reject: (e: Error) => void } | null = null;
  private failure: Error | null = null;

  constructor(socket: Socket) {
    socket.on('data', (chunk) => {
      this.chunks = Buffer.concat([this.chunks, chunk]);
      this.serve();
    });
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new AuthError('the access point closed the connection')));
  }

  private fail(error: Error): void {
    this.failure = error;
    this.waiting?.reject(error);
    this.waiting = null;
  }

  private serve(): void {
    if (!this.waiting || this.chunks.length < this.waiting.length) return;

    const { length, resolve } = this.waiting;
    this.waiting = null;

    const out = this.chunks.subarray(0, length);
    this.chunks = this.chunks.subarray(length);
    resolve(out);
  }

  read(length: number): Promise<Buffer> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.waiting) return Promise.reject(new Error('a read is already pending'));

    return new Promise<Buffer>((resolve, reject) => {
      this.waiting = { length, resolve, reject };
      this.serve();
    });
  }
}

/** ask spotify which access point to use, rather than hardcoding one. */
export const resolveAccessPoint = async (
  fetchImpl: typeof globalThis.fetch = globalThis.fetch
): Promise<{ host: string; port: number }> => {
  const response = await fetchImpl('https://apresolve.spotify.com/?type=accesspoint');
  const body = await response.json() as { accesspoint?: string[] };
  const entry = body.accesspoint?.[0];

  if (!entry) throw new AuthError('apresolve returned no access point');

  const [host, port] = entry.split(':');

  return { host, port: Number(port) || 4070 };
};

export interface ApConnectionOptions {
  /** `ap.spotify.com:4070` style. resolved automatically when omitted. */
  address?: { host: string; port: number };
  /** shown to spotify as the device identity. */
  deviceId?: string;
  connectTimeoutMs?: number;
}

/**
 * a connection to spotify's access point.
 *
 * this exists for exactly one reason: the audio key for ogg and flac is served
 * nowhere else. spotify moved off widevine-protected mp4, and the replacement is
 * aes-128-ctr under a per-file key that only this protocol hands out.
 */
export class ApConnection {
  private socket: Socket | null = null;
  private reader: SocketReader | null = null;
  private sendCipher: Shannon | null = null;
  private recvCipher: Shannon | null = null;
  private sendSequence = 0;
  private recvSequence = 0;
  private keySequence = 0;
  private readonly deviceId: string;

  constructor(private readonly options: ApConnectionOptions = {}) {
    this.deviceId = options.deviceId ?? randomBytes(20).toString('hex');
  }

  get connected(): boolean {
    return this.socket !== null && this.sendCipher !== null;
  }

  async connect(): Promise<void> {
    const address = this.options.address ?? await resolveAccessPoint();
    const timeoutMs = this.options.connectTimeoutMs ?? 15_000;
    debug('connecting to %s:%d', address.host, address.port);

    const socket = await new Promise<Socket>((resolve, reject) => {
      const s = connect({ host: address.host, port: address.port });
      const timer = setTimeout(() => {
        s.destroy();
        reject(new TimeoutError(`${address.host}:${address.port}`, timeoutMs));
      }, timeoutMs);

      s.once('connect', () => {
        clearTimeout(timer);
        s.setNoDelay(true);
        resolve(s);
      });
      s.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    this.socket = socket;
    this.reader = new SocketReader(socket);

    const transport: HandshakeTransport = {
      write: (data) => new Promise<void>((resolve, reject) => {
        socket.write(data, (error) => (error ? reject(error) : resolve()));
      }),
      read: (length) => (this.reader as SocketReader).read(length),
    };

    const { sendKey, recvKey } = await performHandshake(transport);

    this.sendCipher = new Shannon(sendKey);
    this.recvCipher = new Shannon(recvKey);
    this.sendSequence = 0;
    this.recvSequence = 0;
  }

  private nonceFor(sequence: number): Buffer {
    const nonce = Buffer.alloc(4);
    nonce.writeUInt32BE(sequence >>> 0, 0);
    return nonce;
  }

  async send(cmd: number, payload: Buffer): Promise<void> {
    if (!this.socket || !this.sendCipher) throw new AuthError('not connected');

    const header = Buffer.alloc(3);
    header.writeUInt8(cmd, 0);
    header.writeUInt16BE(payload.length, 1);

    this.sendCipher.nonce(this.nonceFor(this.sendSequence++));
    const encrypted = this.sendCipher.encrypt(Buffer.concat([header, payload]));
    const mac = this.sendCipher.finish(4);

    await new Promise<void>((resolve, reject) => {
      (this.socket as Socket).write(Buffer.concat([encrypted, mac]), (error) =>
        (error ? reject(error) : resolve()));
    });
  }

  async receive(): Promise<Packet> {
    if (!this.reader || !this.recvCipher) throw new AuthError('not connected');

    this.recvCipher.nonce(this.nonceFor(this.recvSequence++));

    const header = this.recvCipher.decrypt(await this.reader.read(3));
    const cmd = header.readUInt8(0);
    const size = header.readUInt16BE(1);

    const payload = size > 0 ? this.recvCipher.decrypt(await this.reader.read(size)) : Buffer.alloc(0);
    const mac = await this.reader.read(4);
    const expected = this.recvCipher.finish(4);

    if (!mac.equals(expected))
      throw new AuthError('packet mac mismatch — the shannon stream is out of step');

    return { cmd, payload };
  }

  /**
   * read until a packet the caller cares about arrives.
   *
   * the access point interleaves keepalives and account chatter with replies, so
   * anything unwanted is answered where it needs answering and skipped otherwise.
   */
  private async receiveUntil(wanted: number[], limit = 32): Promise<Packet> {
    for (let i = 0; i < limit; i++) {
      const packet = await this.receive();

      if (wanted.includes(packet.cmd)) return packet;

      if (packet.cmd === PACKET_PING || packet.cmd === PACKET_PING_REQUEST) {
        debug('keepalive 0x%s', packet.cmd.toString(16));
        await this.send(PACKET_PONG, Buffer.alloc(4));
        continue;
      }

      debug('ignoring packet 0x%s (%d bytes)', packet.cmd.toString(16), packet.payload.length);
    }

    throw new AuthError(`no ${wanted.map((c) => `0x${c.toString(16)}`).join('/')} packet arrived`);
  }

  /**
   * authenticate with an oauth access token.
   *
   * the same token the http surfaces take: no password, no stored credential, so
   * an account with two-factor auth is not a special case.
   */
  async login(accessToken: string): Promise<string> {
    const credentials = new ProtobufWriter()
      .string(CREDENTIALS_USERNAME, '')
      .varint(CREDENTIALS_TYPE, AUTHENTICATION_SPOTIFY_TOKEN)
      .bytes(CREDENTIALS_AUTH_DATA, Buffer.from(accessToken, 'utf8'));

    const systemInfo = new ProtobufWriter()
      .varint(SYSTEM_INFO_CPU_FAMILY, CPU_X86_64)
      .varint(SYSTEM_INFO_OS, OS_LINUX)
      .string(SYSTEM_INFO_STRING, 'librespot')
      .string(SYSTEM_INFO_DEVICE_ID, this.deviceId);

    const request = new ProtobufWriter()
      .message(CRE_LOGIN_CREDENTIALS, credentials)
      .message(CRE_SYSTEM_INFO, systemInfo)
      .string(CRE_VERSION_STRING, 'respotify')
      .finish();

    await this.send(PACKET_LOGIN, request);

    const packet = await this.receiveUntil([PACKET_AP_WELCOME, PACKET_AUTH_FAILURE]);

    if (packet.cmd === PACKET_AUTH_FAILURE)
      throw new AuthError('the access point rejected the access token');

    const username = stringAt(readFields(packet.payload), AP_WELCOME_USERNAME) ?? '';
    debug('logged in as %s', username);

    return username;
  }

  /**
   * the audio key for one file of one track.
   *
   * both ids are required: the key is bound to the pair, and a file id alone
   * gets an error back.
   */
  async requestAudioKey(fileId: Buffer, trackGid: Buffer): Promise<Buffer> {
    if (fileId.length !== 20) throw new DownloadError('file id must be 20 bytes');
    if (trackGid.length !== 16) throw new DownloadError('track gid must be 16 bytes');

    const sequence = this.keySequence++;
    const request = Buffer.alloc(20 + 16 + 4 + 2);
    fileId.copy(request, 0);
    trackGid.copy(request, 20);
    request.writeUInt32BE(sequence, 36);
    request.writeUInt16BE(0, 40);

    await this.send(PACKET_REQUEST_KEY, request);

    const packet = await this.receiveUntil([PACKET_AES_KEY, PACKET_AES_KEY_ERROR]);

    if (packet.cmd === PACKET_AES_KEY_ERROR) {
      const code = packet.payload.length >= 6 ? packet.payload.readUInt16BE(4) : 0;
      throw new DownloadError(`the access point refused the audio key (error ${code})`);
    }

    // seq(4) then the 16-byte key
    return packet.payload.subarray(4, 20);
  }

  close(): void {
    this.socket?.destroy();
    this.socket = null;
    this.reader = null;
    this.sendCipher = null;
    this.recvCipher = null;
  }
}
