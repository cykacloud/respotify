<p align="center">
  <img src="./.github/respotify.svg">
</p>

> my lib for interacting with spotify, auth and download songs
it used in the [midvetbmarubot](https://github.com/neverlane/respotify)

## install

```bash
# lib not published to npm, use git
npm add git+https://github.com/neverlane/respotify.git
yarn add git+https://github.com/neverlane/respotify.git
pnpm add git+https://github.com/neverlane/respotify.git
bun add git+https://github.com/neverlane/respotify.git
```

## usage

```ts
import { SpotifyAuth, SpotifyDownloader, SpotifyDecryptorFFmpeg } from "respotify";

const auth = await SpotifyAuth.fromLoginPassword("username", "password");
const downloader = new SpotifyDownloader(
  auth,
  new SpotifyDecryptorFFmpeg("/tmp/.decryptor-ffmpeg-cache")
);

downloader
  .download("https://open.spotify.com/track/5yNQnqQ9X5dW6qXO8T6Xjg");

```

## thanq

- [librespot](https://github.com/librespot-org) - for .proto Spotify client files
- [Frooastside/node-widevine](https://github.com/spotify/node-widevine) - for widevine decryption
