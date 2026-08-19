import { createHmac, randomBytes } from 'crypto';
import createDebug from 'debug';

import { AuthError } from '../../utils/errors';
import { ProtobufWriter, messageAt, readFields } from '../../utils/protobuf';
import { DiffieHellman } from './dh';

const debug = createDebug('respotify:ap:handshake');

/** field numbers from librespot's keyexchange.proto. */
const CLIENT_HELLO_BUILD_INFO = 10;
const CLIENT_HELLO_CRYPTOSUITES = 30;
const CLIENT_HELLO_LOGIN_CRYPTO = 50;
const CLIENT_HELLO_NONCE = 60;
const CLIENT_HELLO_PADDING = 70;

const BUILD_INFO_PRODUCT = 10;
const BUILD_INFO_PLATFORM = 30;
const BUILD_INFO_VERSION = 40;

const DH_HELLO_GC = 10;
const DH_HELLO_SERVER_KEYS_KNOWN = 20;

const AP_RESPONSE_CHALLENGE = 10;
const AP_CHALLENGE_LOGIN_CRYPTO = 10;
const UNION_DIFFIE_HELLMAN = 10;
const DH_CHALLENGE_GS = 10;

const RESPONSE_LOGIN_CRYPTO = 10;
const RESPONSE_POW = 20;
const RESPONSE_CRYPTO = 30;
const DH_RESPONSE_HMAC = 10;

/** PRODUCT_CLIENT, PLATFORM_LINUX_X86_64, CRYPTO_SUITE_SHANNON. */
const PRODUCT_CLIENT = 0;
const PLATFORM_LINUX_X86_64 = 0x08;
const CRYPTO_SUITE_SHANNON = 0;
const SPOTIFY_VERSION = 117_300_517;

export interface HandshakeKeys {
  sendKey: Buffer;
  recvKey: Buffer;
}

/** what the handshake needs from its transport: ordered bytes, both ways. */
export interface HandshakeTransport {
  write(data: Buffer): Promise<void>;
  read(length: number): Promise<Buffer>;
}

const buildClientHello = (publicKey: Buffer, nonce: Buffer): Buffer => {
  const buildInfo = new ProtobufWriter()
    .varint(BUILD_INFO_PRODUCT, PRODUCT_CLIENT)
    .varint(BUILD_INFO_PLATFORM, PLATFORM_LINUX_X86_64)
    .varint(BUILD_INFO_VERSION, SPOTIFY_VERSION);

  const dhHello = new ProtobufWriter()
    .bytes(DH_HELLO_GC, publicKey)
    .varint(DH_HELLO_SERVER_KEYS_KNOWN, 1);

  const loginCrypto = new ProtobufWriter().message(UNION_DIFFIE_HELLMAN, dhHello);

  return new ProtobufWriter()
    .message(CLIENT_HELLO_BUILD_INFO, buildInfo)
    .varint(CLIENT_HELLO_CRYPTOSUITES, CRYPTO_SUITE_SHANNON)
    .message(CLIENT_HELLO_LOGIN_CRYPTO, loginCrypto)
    .bytes(CLIENT_HELLO_NONCE, nonce)
    .bytes(CLIENT_HELLO_PADDING, Buffer.from([0x1e]))
    .finish();
};

const readServerPublicKey = (apResponse: Buffer): Buffer => {
  const challenge = messageAt(readFields(apResponse), AP_RESPONSE_CHALLENGE);
  if (!challenge)
    throw new AuthError('the access point sent no challenge — it may have refused the hello');

  const loginCrypto = messageAt(readFields(challenge), AP_CHALLENGE_LOGIN_CRYPTO);
  if (!loginCrypto) throw new AuthError('challenge carried no login crypto');

  const dh = messageAt(readFields(loginCrypto), UNION_DIFFIE_HELLMAN);
  if (!dh) throw new AuthError('the access point did not offer diffie-hellman');

  const gs = messageAt(readFields(dh), DH_CHALLENGE_GS);
  if (!gs) throw new AuthError('challenge carried no server public key');

  return gs;
};

/**
 * derive the session keys.
 *
 * five hmac-sha1 rounds over the full handshake transcript produce 100 bytes:
 * the first 20 key the challenge that proves we computed the same secret, and
 * the next 64 are the two shannon keys. the transcript is the framed bytes as
 * they went over the wire, headers included — hashing the protobuf bodies alone
 * gives a plausible-looking answer the server rejects.
 */
export const deriveKeys = (
  sharedSecret: Buffer,
  transcript: Buffer
): HandshakeKeys & { challenge: Buffer } => {
  const data = Buffer.concat(
    Array.from({ length: 5 }, (_, index) =>
      createHmac('sha1', sharedSecret)
        .update(transcript)
        .update(Buffer.from([index + 1]))
        .digest()
    )
  );

  return {
    challenge: createHmac('sha1', data.subarray(0, 0x14)).update(transcript).digest(),
    sendKey: data.subarray(0x14, 0x34),
    recvKey: data.subarray(0x34, 0x54),
  };
};

/**
 * run the access-point handshake and return the two shannon keys.
 *
 * on any mismatch the server simply closes the socket, so every step that can
 * fail says which one it was.
 */
export const performHandshake = async (
  transport: HandshakeTransport,
  dh: DiffieHellman = new DiffieHellman()
): Promise<HandshakeKeys> => {
  const hello = buildClientHello(dh.publicKey, randomBytes(16));

  // 0x0004 magic, then the total length including these six bytes
  const header = Buffer.alloc(6);
  header.writeUInt8(0x00, 0);
  header.writeUInt8(0x04, 1);
  header.writeUInt32BE(2 + 4 + hello.length, 2);

  const clientPacket = Buffer.concat([header, hello]);
  await transport.write(clientPacket);
  debug('sent client hello, %d bytes', clientPacket.length);

  const sizeHeader = await transport.read(4);
  const size = sizeHeader.readUInt32BE(0);
  if (size < 4 || size > 1024 * 1024)
    throw new AuthError(`the access point answered with an implausible length: ${size}`);

  const body = await transport.read(size - 4);
  const serverPacket = Buffer.concat([sizeHeader, body]);
  debug('read ap response, %d bytes', serverPacket.length);

  const sharedSecret = dh.sharedSecret(readServerPublicKey(body));
  const { challenge, sendKey, recvKey } = deriveKeys(
    sharedSecret,
    Buffer.concat([clientPacket, serverPacket])
  );

  const response = new ProtobufWriter()
    .message(
      RESPONSE_LOGIN_CRYPTO,
      new ProtobufWriter().message(
        UNION_DIFFIE_HELLMAN,
        new ProtobufWriter().bytes(DH_RESPONSE_HMAC, challenge)
      )
    )
    .message(RESPONSE_POW, new ProtobufWriter())
    .message(RESPONSE_CRYPTO, new ProtobufWriter())
    .finish();

  const responseHeader = Buffer.alloc(4);
  responseHeader.writeUInt32BE(4 + response.length, 0);
  await transport.write(Buffer.concat([responseHeader, response]));
  debug('sent client response, handshake complete');

  return { sendKey, recvKey };
};

export { buildClientHello, readServerPublicKey };
