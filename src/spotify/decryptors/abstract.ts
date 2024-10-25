export interface SpotifyDecryptor {
  decrypt: (key: string, data: Buffer) => Promise<Buffer>
}