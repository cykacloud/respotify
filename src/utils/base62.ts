export class Base62 {
  private readonly base: bigint = BigInt(62);
  private readonly charset: string[] = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  constructor(customCharset?: string | string[]) {
    if (customCharset)
      this.charset = Array.isArray(customCharset) ? customCharset : customCharset.split('');
  }

  public encode(integer: string): string {
    if (Number(integer) === 0) {
      return '0';
    }

    let num: bigint = BigInt(integer);
    let str: string[] = [];

    while (num > 0) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      str = [this.charset[num % this.base], ...str];
      num = num / this.base;
    }

    return str.join('');
  }

  public decode(str: string): string {
    return str.split('').reverse().reduce(
      (prev: bigint, char: string, i: number) =>
        prev + (BigInt(this.charset.indexOf(char)) * (this.base ** BigInt(i))),
      BigInt(0)).toString();
  }
}