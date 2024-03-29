# vite-plugin-aws-lambda

Helper for building AWS lambda functions with Vite.

- Defaults library formats to `['es']`.
- Defaults `es` formatted output filenames to `<name>.mjs`.
- Externalizes all NodeJS internal modules.
- Zips the output directory.

## Usage

The plugin should generally be last. A library entry point must be set, or the plugin will have no effect.

```ts
import lambda from 'vite-plugin-aws-lambda';

export default {
  plugins: [lambda()],
  build: {
    lib: { entry: 'src/index.ts' },
  },
};
```

## Options

- `outFilename`: The output filename for the Lambda function zip file.
  - Relative paths are resolved from the `config.outDir` (not `config.root`).
  - Set to `false` to disable zipping.
  - Default: `../<outDirBasename>.zip`