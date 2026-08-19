const DEFAULT_CHARSET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * base62 codec over bigint-sized values. spotify ids are 22-char base62, which is
 * well past `Number.MAX_SAFE_INTEGER`, so both directions work in bigint and
 * exchange decimal strings with the caller.
 */
export class Base62 {
  private readonly base = 62n;
  private readonly charset: string[];
  /** char -> value, so decode does not pay a linear scan per character. */
  private readonly values: Map<string, bigint>;

  constructor(customCharset?: string | string[]) {
    this.charset = customCharset
      ? (Array.isArray(customCharset) ? [...customCharset] : customCharset.split(''))
      : DEFAULT_CHARSET.split('');

    if (this.charset.length !== 62)
      throw new Error(`base62 charset must hold 62 characters, got ${this.charset.length}`);

    this.values = new Map(this.charset.map((char, index) => [char, BigInt(index)]));
  }

  /** encode a decimal string (or bigint) into base62. */
  encode(integer: string | bigint): string {
    let num = BigInt(integer);
    if (num < 0n) throw new Error('base62 cannot encode negative values');
    if (num === 0n) return this.charset[0];

    const out: string[] = [];
    while (num > 0n) {
      out.unshift(this.charset[Number(num % this.base)]);
      num /= this.base;
    }

    return out.join('');
  }

  /** decode base62 into a decimal string. */
  decode(str: string): string {
    let result = 0n;

    for (const char of str) {
      const value = this.values.get(char);
      if (value === undefined) throw new Error(`character ${char} is not in the base62 charset`);
      result = result * this.base + value;
    }

    return result.toString();
  }
}
