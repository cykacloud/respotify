import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  dts: true,
  splitting: false,
  bundle: true,
  clean: true,
  keepNames: true,
  minify: true,
  target: 'es2022',
  format: ['cjs', 'esm'],
});
