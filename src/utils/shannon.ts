/**
 * shannon stream cipher — the one spotify's access point speaks.
 *
 * ported from the pure-javascript implementation by alexander kose
 * (https://github.com/twonky4/shannon, MIT), which is itself a port of felix
 * bruns' javascript port of the original c reference. vendored rather than
 * depended on: it is a single 0.0.1 release from 2019 with one maintainer, and a
 * cipher sitting in the authentication path is not somewhere to inherit an
 * unpatchable dependency. the upstream test vectors ship alongside it.
 *
 * the arithmetic below is deliberately unchanged from the reference. it relies
 * on javascript's 32-bit bitwise semantics throughout, including some habits
 * that look like mistakes and are not — see the notes at each one.
 */

const N = 16;
/**
 * how many register cycles to run after the last key byte, so that every output
 * byte depends on every key byte. equal to the register length, conservatively.
 */
const FOLD = N;
/** value of konst during key loading. */
const INITKONST = 0x6996c53a;
/** where key, mac and counter words are inserted. */
const KEYP = 13;

/**
 * `i >>> -distance` is not a typo: javascript masks shift counts to five bits,
 * so `-5` becomes 27, giving the right-hand half of a 32-bit rotation.
 */
const rotateLeft = (i: number, distance: number): number =>
  (i << distance) | (i >>> -distance);

const toBytes = (input: Buffer | Uint8Array | number[] | string): number[] => {
  if (typeof input === 'string') return [...Buffer.from(input, 'utf8')];
  if (Array.isArray(input)) return [...input];
  return [...Buffer.from(input)];
};

export class Shannon {
  /** working storage for the shift register. */
  private R = new Array<number>(N).fill(0);
  /** working storage for crc accumulation. */
  private CRC = new Array<number>(N).fill(0);
  /** saved register contents. */
  private initR = new Array<number>(N).fill(0);
  /** key dependent semi-constant. */
  private konst = 0;
  /** encryption buffer. */
  private sbuf = 0;
  /** partial word mac buffer. */
  private mbuf = 0;
  /** number of part-word stream bits buffered. */
  private nbuf = 0;

  constructor(key?: Buffer | Uint8Array | number[] | string) {
    if (key !== undefined) this.key(key);
  }

  /** nonlinear transform of a word; two slightly different combinations. */
  private static sbox(i: number): number {
    i ^= rotateLeft(i, 5) | rotateLeft(i, 7);
    i ^= rotateLeft(i, 19) | rotateLeft(i, 22);
    return i;
  }

  private static sbox2(i: number): number {
    i ^= rotateLeft(i, 7) | rotateLeft(i, 22);
    i ^= rotateLeft(i, 5) | rotateLeft(i, 19);
    return i;
  }

  /** cycle the register and produce one output word in sbuf. */
  private cycle(): void {
    let t = this.R[12] ^ this.R[13] ^ this.konst;
    t = Shannon.sbox(t) ^ rotateLeft(this.R[0], 1);

    for (let i = 1; i < N; i++) this.R[i - 1] = this.R[i];
    this.R[N - 1] = t;

    t = Shannon.sbox2(this.R[2] ^ this.R[15]);
    this.R[0] ^= t;
    this.sbuf = t ^ this.R[8] ^ this.R[12];
  }

  /**
   * accumulate a crc of input words for the mac: 32 parallel crc-16s over the
   * ibm polynomial x^16 + x^15 + x^2 + 1.
   */
  private crcFunc(i: number): void {
    const t = this.CRC[0] ^ this.CRC[2] ^ this.CRC[15] ^ i;

    for (let j = 1; j < N; j++) this.CRC[j - 1] = this.CRC[j];
    this.CRC[N - 1] = t;
  }

  /** normal mac word processing: both the stream register and the crc. */
  private macFunc(i: number): void {
    this.crcFunc(i);
    this.R[KEYP] ^= i;
  }

  private initState(): void {
    // register initialised to fibonacci numbers
    this.R[0] = 1;
    this.R[1] = 1;
    for (let i = 2; i < N; i++) this.R[i] = this.R[i - 1] + this.R[i - 2];

    this.konst = INITKONST;
  }

  private saveState(): void {
    for (let i = 0; i < N; i++) this.initR[i] = this.R[i];
  }

  private reloadState(): void {
    for (let i = 0; i < N; i++) this.R[i] = this.initR[i];
  }

  private addKey(k: number): void {
    this.R[KEYP] ^= k;
  }

  private diffuse(): void {
    for (let i = 0; i < FOLD; i++) this.cycle();
  }

  /**
   * fold key material into the register, allowing a length that is not a
   * multiple of four. initialises the crc register as a side effect.
   */
  private loadKey(key: number[]): void {
    const extra = [0, 0, 0, 0];
    let i = 0;

    for (i = 0; i < (key.length & ~0x03); i += 4) {
      this.addKey(
        ((key[i + 3] & 0xff) << 24)
        | ((key[i + 2] & 0xff) << 16)
        | ((key[i + 1] & 0xff) << 8)
        | (key[i] & 0xff)
      );
      this.cycle();
    }

    if (i < key.length) {
      let j = 0;
      for (; i < key.length; i++) extra[j++] = key[i];
      for (; j < 4; j++) extra[j] = 0;

      this.addKey(
        ((extra[3] & 0xff) << 24)
        | ((extra[2] & 0xff) << 16)
        | ((extra[1] & 0xff) << 8)
        | (extra[0] & 0xff)
      );
      this.cycle();
    }

    // fold in the length too
    this.addKey(key.length);
    this.cycle();

    for (i = 0; i < N; i++) this.CRC[i] = this.R[i];
    this.diffuse();
    // xor the copy back, which makes key loading irreversible
    for (i = 0; i < N; i++) this.R[i] ^= this.CRC[i];
  }

  key(key: Buffer | Uint8Array | number[] | string): this {
    this.initState();
    this.loadKey(toBytes(key));
    this.konst = this.R[0];
    this.saveState();
    this.nbuf = 0;

    return this;
  }

  /** set the iv. spotify uses the packet sequence number. */
  nonce(nonce: Buffer | Uint8Array | number[] | string): this {
    this.reloadState();
    this.konst = INITKONST;
    this.loadKey(toBytes(nonce));
    this.konst = this.R[0];
    this.nbuf = 0;

    return this;
  }

  /** xor keystream into the buffer. does not accumulate a mac. */
  stream(input: Buffer | Uint8Array | number[] | string): Buffer {
    const buffer = toBytes(input);
    let i = 0;
    let n = buffer.length;

    while (this.nbuf !== 0 && n !== 0) {
      buffer[i++] ^= this.sbuf & 0xff;
      this.sbuf >>= 8;
      this.nbuf -= 8;
      n--;
    }

    const j = n & ~0x03;
    while (i < j) {
      this.cycle();
      buffer[i + 3] ^= (this.sbuf >> 24) & 0xff;
      buffer[i + 2] ^= (this.sbuf >> 16) & 0xff;
      buffer[i + 1] ^= (this.sbuf >> 8) & 0xff;
      buffer[i] ^= this.sbuf & 0xff;
      i += 4;
    }

    n &= 0x03;
    if (n !== 0) {
      this.cycle();
      this.nbuf = 32;

      while (this.nbuf !== 0 && n !== 0) {
        buffer[i++] ^= this.sbuf & 0xff;
        this.sbuf >>= 8;
        this.nbuf -= 8;
        n--;
      }
    }

    return Buffer.from(buffer);
  }

  /** accumulate words into the mac without encrypting them. */
  macOnly(input: Buffer | Uint8Array | number[] | string): Buffer {
    const buffer = toBytes(input);
    let i = 0;
    let n = buffer.length;

    if (this.nbuf !== 0) {
      while (this.nbuf !== 0 && n !== 0) {
        this.mbuf ^= buffer[i++] << (32 - this.nbuf);
        this.nbuf -= 8;
        n--;
      }
      if (this.nbuf !== 0) return Buffer.from(buffer);
      this.macFunc(this.mbuf);
    }

    const j = n & ~0x03;
    while (i < j) {
      this.cycle();
      this.macFunc(
        ((buffer[i + 3] & 0xff) << 24)
        | ((buffer[i + 2] & 0xff) << 16)
        | ((buffer[i + 1] & 0xff) << 8)
        | (buffer[i] & 0xff)
      );
      i += 4;
    }

    n &= 0x03;
    if (n !== 0) {
      this.cycle();
      this.mbuf = 0;
      this.nbuf = 32;

      while (this.nbuf !== 0 && n !== 0) {
        this.mbuf ^= buffer[i++] << (32 - this.nbuf);
        this.nbuf -= 8;
        n--;
      }
    }

    return Buffer.from(buffer);
  }

  /** encrypt, accumulating the plaintext into the mac. */
  encrypt(input: Buffer | Uint8Array | number[] | string, length?: number): Buffer {
    const buffer = toBytes(input);
    let n = length ?? buffer.length;
    let i = 0;
    let t = 0;

    if (this.nbuf !== 0) {
      while (this.nbuf !== 0 && n !== 0) {
        this.mbuf ^= (buffer[i] & 0xff) << (32 - this.nbuf);
        buffer[i] ^= (this.sbuf >> (32 - this.nbuf)) & 0xff;
        i++;
        this.nbuf -= 8;
        n--;
      }
      if (this.nbuf !== 0) return Buffer.from(buffer);
      this.macFunc(this.mbuf);
    }

    const j = n & ~0x03;
    while (i < j) {
      this.cycle();
      t = ((buffer[i + 3] & 0xff) << 24)
        | ((buffer[i + 2] & 0xff) << 16)
        | ((buffer[i + 1] & 0xff) << 8)
        | (buffer[i] & 0xff);

      this.macFunc(t);
      t ^= this.sbuf;

      buffer[i + 3] = (t >> 24) & 0xff;
      buffer[i + 2] = (t >> 16) & 0xff;
      buffer[i + 1] = (t >> 8) & 0xff;
      buffer[i] = t & 0xff;
      i += 4;
    }

    n &= 0x03;
    if (n !== 0) {
      this.cycle();
      this.mbuf = 0;
      this.nbuf = 32;

      while (this.nbuf !== 0 && n !== 0) {
        this.mbuf ^= (buffer[i] & 0xff) << (32 - this.nbuf);
        buffer[i] ^= (this.sbuf >> (32 - this.nbuf)) & 0xff;
        i++;
        this.nbuf -= 8;
        n--;
      }
    }

    return Buffer.from(buffer);
  }

  /** decrypt, accumulating the recovered plaintext into the mac. */
  decrypt(input: Buffer | Uint8Array | number[] | string, length?: number): Buffer {
    const buffer = toBytes(input);
    let n = length ?? buffer.length;
    let i = 0;
    let t = 0;

    if (this.nbuf !== 0) {
      while (this.nbuf !== 0 && n !== 0) {
        buffer[i] ^= (this.sbuf >> (32 - this.nbuf)) & 0xff;
        this.mbuf ^= (buffer[i] & 0xff) << (32 - this.nbuf);
        i++;
        this.nbuf -= 8;
        n--;
      }
      if (this.nbuf !== 0) return Buffer.from(buffer);
      this.macFunc(this.mbuf);
    }

    const j = n & ~0x03;
    while (i < j) {
      this.cycle();
      t = ((buffer[i + 3] & 0xff) << 24)
        | ((buffer[i + 2] & 0xff) << 16)
        | ((buffer[i + 1] & 0xff) << 8)
        | (buffer[i] & 0xff);

      t ^= this.sbuf;
      this.macFunc(t);

      buffer[i + 3] = (t >> 24) & 0xff;
      buffer[i + 2] = (t >> 16) & 0xff;
      buffer[i + 1] = (t >> 8) & 0xff;
      buffer[i] = t & 0xff;
      i += 4;
    }

    n &= 0x03;
    if (n !== 0) {
      this.cycle();
      this.mbuf = 0;
      this.nbuf = 32;

      while (this.nbuf !== 0 && n !== 0) {
        buffer[i] ^= (this.sbuf >> (32 - this.nbuf)) & 0xff;
        this.mbuf ^= (buffer[i] & 0xff) << (32 - this.nbuf);
        i++;
        this.nbuf -= 8;
        n--;
      }
    }

    return Buffer.from(buffer);
  }

  /**
   * finish the mac and write it into a buffer of the requested length.
   *
   * trailing bytes are treated as encrypted zero bytes, so the plaintext zeros
   * are accumulated.
   */
  finish(size: number | Buffer = 16): Buffer {
    const buffer = typeof size === 'number' ? new Array<number>(size).fill(0) : toBytes(size);
    let n = buffer.length;
    let i = 0;
    let j = 0;

    if (this.nbuf !== 0) this.macFunc(this.mbuf);

    // perturb the mac to mark the end of input. only the stream register is
    // touched, not the crc, which is what defeats extension attacks.
    this.cycle();
    this.addKey(INITKONST ^ (this.nbuf << 3));
    this.nbuf = 0;

    for (j = 0; j < N; j++) this.R[j] ^= this.CRC[j];
    this.diffuse();

    while (n > 0) {
      this.cycle();

      if (n >= 4) {
        buffer[i + 3] = (this.sbuf >> 24) & 0xff;
        buffer[i + 2] = (this.sbuf >> 16) & 0xff;
        buffer[i + 1] = (this.sbuf >> 8) & 0xff;
        buffer[i] = this.sbuf & 0xff;
        n -= 4;
        i += 4;
      } else {
        // reference behaviour, kept verbatim: it indexes the shift by `i`
        // rather than `j`. unreachable for the 16-byte macs spotify uses, and
        // changing it would diverge from the implementation the test vectors
        // came from.
        for (j = 0; j < n; j++) buffer[i + j] = (this.sbuf >> (i * 8)) & 0xff;
        break;
      }
    }

    return Buffer.from(buffer);
  }
}
