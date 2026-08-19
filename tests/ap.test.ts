import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';

import { AuthError } from '../src/utils/errors';
import { ProtobufWriter, messageAt, readFields } from '../src/utils/protobuf';
import { DH_KEY_LENGTH, DH_PRIME, DiffieHellman, toFixedWidth } from '../src/spotify/ap/dh';
import { buildClientHello, deriveKeys, readServerPublicKey } from '../src/spotify/ap/handshake';

describe('diffie-hellman', () => {
  it('uses the 768-bit modulus the access point expects', () => {
    assert.equal(DH_PRIME.length, DH_KEY_LENGTH);
    assert.equal(DH_PRIME[0], 0xff);
    assert.equal(DH_PRIME[DH_PRIME.length - 1], 0xff);
  });

  it('produces a public key of exactly the modulus width', () => {
    for (let i = 0; i < 5; i++) {
      assert.equal(new DiffieHellman().publicKey.length, DH_KEY_LENGTH);
    }
  });

  it('agrees on a shared secret from both sides', () => {
    const alice = new DiffieHellman();
    const bob = new DiffieHellman();

    assert.deepEqual(
      alice.sharedSecret(bob.publicKey),
      bob.sharedSecret(alice.publicKey)
    );
  });

  it('is deterministic for a fixed private key', () => {
    const privateKey = Buffer.alloc(95, 0x42);

    assert.deepEqual(
      new DiffieHellman(privateKey).publicKey,
      new DiffieHellman(privateKey).publicKey
    );
  });

  /**
   * a secret that happens to start with a zero byte must still be 96 bytes. left
   * unpadded it would be one short, every derived key would be wrong, and only
   * for a small fraction of connections — a failure that looks random.
   */
  it('zero-pads to a fixed width', () => {
    assert.equal(toFixedWidth(1n, DH_KEY_LENGTH).length, DH_KEY_LENGTH);
    assert.equal(toFixedWidth(1n, DH_KEY_LENGTH)[0], 0x00);
    assert.equal(toFixedWidth(1n, DH_KEY_LENGTH)[DH_KEY_LENGTH - 1], 0x01);
  });

  it('refuses a value wider than the requested width', () => {
    assert.throws(() => toFixedWidth(2n ** 800n, DH_KEY_LENGTH), RangeError);
  });
});

describe('handshake key derivation', () => {
  const secret = Buffer.alloc(96, 0x11);
  const transcript = Buffer.from('the framed bytes as they went over the wire');

  it('splits the hmac output the way the access point does', () => {
    const { challenge, sendKey, recvKey } = deriveKeys(secret, transcript);

    assert.equal(challenge.length, 20);
    assert.equal(sendKey.length, 32);
    assert.equal(recvKey.length, 32);
    assert.notDeepEqual(sendKey, recvKey);
  });

  it('derives from five hmac-sha1 rounds over the transcript', () => {
    const expected = Buffer.concat(
      Array.from({ length: 5 }, (_, i) =>
        createHmac('sha1', secret).update(transcript).update(Buffer.from([i + 1])).digest())
    );

    const { sendKey, recvKey } = deriveKeys(secret, transcript);

    assert.deepEqual(sendKey, expected.subarray(0x14, 0x34));
    assert.deepEqual(recvKey, expected.subarray(0x34, 0x54));
  });

  it('is deterministic, and changes with the transcript', () => {
    assert.deepEqual(deriveKeys(secret, transcript), deriveKeys(secret, transcript));
    assert.notDeepEqual(
      deriveKeys(secret, transcript).sendKey,
      deriveKeys(secret, Buffer.concat([transcript, Buffer.from('!')])).sendKey
    );
  });
});

describe('client hello', () => {
  it('carries the public key and a nonce', () => {
    const publicKey = Buffer.alloc(96, 0x07);
    const hello = readFields(buildClientHello(publicKey, Buffer.alloc(16, 0x09)));

    const loginCrypto = messageAt(hello, 50);
    assert.ok(loginCrypto, 'login_crypto_hello is field 50');

    const dh = messageAt(readFields(loginCrypto), 10);
    assert.ok(dh);
    assert.deepEqual(messageAt(readFields(dh), 10), publicKey);
    assert.deepEqual(messageAt(hello, 60), Buffer.alloc(16, 0x09));
  });
});

describe('ap response parsing', () => {
  const wrap = (gs: Buffer) => {
    const dh = new ProtobufWriter().bytes(10, gs);
    const union = new ProtobufWriter().message(10, dh);
    const challenge = new ProtobufWriter().message(10, union);
    return new ProtobufWriter().message(10, challenge).finish();
  };

  it('reads the server public key out of the challenge', () => {
    const gs = Buffer.alloc(96, 0x05);
    assert.deepEqual(readServerPublicKey(wrap(gs)), gs);
  });

  it('says which part was missing rather than throwing something opaque', () => {
    assert.throws(() => readServerPublicKey(Buffer.alloc(0)), AuthError);
    assert.throws(
      () => readServerPublicKey(new ProtobufWriter().message(10, new ProtobufWriter()).finish()),
      /no login crypto/
    );
  });
});
