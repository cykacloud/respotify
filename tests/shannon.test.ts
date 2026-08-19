import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Shannon } from '../src/utils/shannon';

/** the key from the upstream test suite this port came from. */
const KEY = Buffer.from([0x65, 0x87, 0xd8, 0x8f, 0x6c, 0x32, 0x9d, 0x8a, 0xe4, 0x6b]);

const CIPHERTEXT = Buffer.from([
  0x94, 0x81, 0xe5, 0xa9, 0x5f, 0x93, 0x5e, 0xcb, 0x6c, 0xb5, 0x24,
]);

const MAC = Buffer.from([
  0x43, 0x23, 0x86, 0x24, 0xf3, 0xc9, 0x0c, 0x58,
  0x79, 0xf4, 0xd3, 0xef, 0x83, 0x98, 0x2e, 0x4e,
]);

describe('shannon', () => {
  /**
   * the upstream vectors. these are the whole reason this is a port rather than
   * a fresh implementation: a stream cipher that is subtly wrong still produces
   * confident-looking bytes, and the access point answers a bad handshake by
   * closing the socket without a word.
   */
  it('matches the reference ciphertext and mac when encrypting', () => {
    const shannon = new Shannon(KEY);
    const encrypted = shannon.encrypt('Hello World');

    assert.deepEqual(encrypted, CIPHERTEXT);
    assert.deepEqual(shannon.finish(16), MAC);
  });

  it('matches the reference when decrypting', () => {
    const shannon = new Shannon(KEY);
    const decrypted = shannon.decrypt(Buffer.from(CIPHERTEXT));

    assert.deepEqual(decrypted, Buffer.from('Hello World'));
    assert.deepEqual(shannon.finish(16), MAC);
  });

  it('round-trips arbitrary lengths, including partial words', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 7, 8, 15, 16, 17, 64, 255, 1024]) {
      const plaintext = Buffer.alloc(length);
      for (let i = 0; i < length; i++) plaintext[i] = (i * 37 + 11) & 0xff;

      const encrypted = new Shannon(KEY).encrypt(Buffer.from(plaintext));
      const decrypted = new Shannon(KEY).decrypt(encrypted);

      assert.deepEqual(decrypted, plaintext, `length ${length}`);
    }
  });

  it('gives a different keystream per nonce', () => {
    const first = new Shannon(KEY);
    first.nonce(Buffer.from([0, 0, 0, 0]));

    const second = new Shannon(KEY);
    second.nonce(Buffer.from([0, 0, 0, 1]));

    const plaintext = Buffer.from('the same plaintext');

    assert.notDeepEqual(
      first.encrypt(Buffer.from(plaintext)),
      second.encrypt(Buffer.from(plaintext))
    );
  });

  it('round-trips across a nonce, the way a session does', () => {
    // each packet gets the sequence number as its nonce, and key() is not
    // repeated — reusing one keyed instance is exactly how the ap connection
    // drives this.
    const sender = new Shannon(KEY);
    const receiver = new Shannon(KEY);

    for (let seq = 0; seq < 5; seq++) {
      const nonce = Buffer.alloc(4);
      nonce.writeUInt32BE(seq);

      const plaintext = Buffer.from(`packet number ${seq}`);

      sender.nonce(Buffer.from(nonce));
      const encrypted = sender.encrypt(Buffer.from(plaintext));
      const sentMac = sender.finish(4);

      receiver.nonce(Buffer.from(nonce));
      const decrypted = receiver.decrypt(encrypted);
      const seenMac = receiver.finish(4);

      assert.deepEqual(decrypted, plaintext, `packet ${seq}`);
      assert.deepEqual(seenMac, sentMac, `mac for packet ${seq}`);
    }
  });

  it('notices tampering through the mac', () => {
    const sender = new Shannon(KEY);
    const encrypted = sender.encrypt('a message that matters');
    const mac = sender.finish(16);

    encrypted[3] ^= 0x01;

    const receiver = new Shannon(KEY);
    receiver.decrypt(encrypted);

    assert.notDeepEqual(receiver.finish(16), mac);
  });

  it('produces a mac of the requested size', () => {
    for (const size of [4, 8, 16]) {
      const shannon = new Shannon(KEY);
      shannon.encrypt('x');
      assert.equal(shannon.finish(size).length, size, `size ${size}`);
    }
  });

  it('accepts a key as bytes or as a string', () => {
    const fromBytes = new Shannon(Buffer.from('secret', 'utf8')).encrypt('payload');
    const fromString = new Shannon('secret').encrypt('payload');

    assert.deepEqual(fromBytes, fromString);
  });
});
