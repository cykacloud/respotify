import { randomBytes } from 'crypto';

/**
 * the 768-bit modulus spotify's access point uses. this is a fixed protocol
 * constant, not a choice: the server computes against the same one.
 */
export const DH_PRIME = Buffer.from([
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xc9, 0x0f, 0xda, 0xa2,
  0x21, 0x68, 0xc2, 0x34, 0xc4, 0xc6, 0x62, 0x8b, 0x80, 0xdc, 0x1c, 0xd1,
  0x29, 0x02, 0x4e, 0x08, 0x8a, 0x67, 0xcc, 0x74, 0x02, 0x0b, 0xbe, 0xa6,
  0x3b, 0x13, 0x9b, 0x22, 0x51, 0x4a, 0x08, 0x79, 0x8e, 0x34, 0x04, 0xdd,
  0xef, 0x95, 0x19, 0xb3, 0xcd, 0x3a, 0x43, 0x1b, 0x30, 0x2b, 0x0a, 0x6d,
  0xf2, 0x5f, 0x14, 0x37, 0x4f, 0xe1, 0x35, 0x6d, 0x6d, 0x51, 0xc2, 0x45,
  0xe4, 0x85, 0xb5, 0x76, 0x62, 0x5e, 0x7e, 0xc6, 0xf4, 0x4c, 0x42, 0xe9,
  0xa6, 0x3a, 0x36, 0x20, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
]);

export const DH_GENERATOR = 2n;

/** the modulus is 96 bytes, and both keys are exchanged at that exact width. */
export const DH_KEY_LENGTH = 96;

const toBigInt = (buffer: Buffer): bigint =>
  buffer.length === 0 ? 0n : BigInt(`0x${buffer.toString('hex')}`);

/**
 * big-endian, zero-padded to a fixed width.
 *
 * the padding is not cosmetic: a shared secret that happens to start with a zero
 * byte would otherwise be one byte short, and every derived key would be wrong
 * for that one connection in a few hundred — the kind of failure that looks
 * random and is nearly impossible to reproduce.
 */
export const toFixedWidth = (value: bigint, width: number): Buffer => {
  const hex = value.toString(16).padStart(width * 2, '0');
  if (hex.length > width * 2) throw new RangeError('value does not fit the requested width');

  return Buffer.from(hex, 'hex');
};

const modPow = (base: bigint, exponent: bigint, modulus: bigint): bigint => {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;

  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }

  return result;
};

/** an ephemeral diffie-hellman key pair for one access-point connection. */
export class DiffieHellman {
  private readonly privateKey: bigint;
  readonly publicKey: Buffer;

  constructor(privateKey?: Buffer) {
    // 95 bytes, matching librespot: one byte short of the modulus, so the
    // exponent is always smaller than it.
    this.privateKey = toBigInt(privateKey ?? randomBytes(95));
    this.publicKey = toFixedWidth(
      modPow(DH_GENERATOR, this.privateKey, toBigInt(DH_PRIME)),
      DH_KEY_LENGTH
    );
  }

  sharedSecret(remotePublicKey: Buffer): Buffer {
    return toFixedWidth(
      modPow(toBigInt(remotePublicKey), this.privateKey, toBigInt(DH_PRIME)),
      DH_KEY_LENGTH
    );
  }
}
