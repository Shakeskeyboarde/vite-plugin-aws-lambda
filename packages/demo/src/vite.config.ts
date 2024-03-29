import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import lambda from 'vite-plugin-aws-lambda';

process.chdir(dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  plugins: [lambda({
    outFilename: 'foo.zip',
  })],
  build: {
    emptyOutDir: false,
    outDir: '../dist/lambda',
    lib: { entry: './index.ts' },
  },
});
