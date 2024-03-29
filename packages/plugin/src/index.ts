import fs from 'node:fs/promises';
import module from 'node:module';
import path, { relative } from 'node:path';
import stream from 'node:stream';

import JSZip from 'jszip';
import { type BuildOptions, type LibraryOptions, type Plugin, type Rollup } from 'vite';

/**
 * Options for the AWS Lambda plugin.
 */
export interface AwsLambdaPluginOptions {
  /**
   * The output filename for the Lambda function zip file.
   *
   * Set to false to disable zipping.
   *
   * Defaults to `../<outDirBasename>.zip` which places the zip file adjacent
   * to your Vite output directory.
   */
  readonly outFilename?: string | false;

  /**
   * Suppress log messages from the plugin.
   */
  readonly quiet?: boolean;
}

const PLUGIN_NAME = 'vite-plugin-aws-lambda';

/**
 * Helper for building AWS lambda functions with Vite.
 */
export default ({ outFilename, quiet = false }: AwsLambdaPluginOptions = {}): Plugin => {
  let enabled = true;
  let root: string;
  let absInDir: string;
  let absOutFilename: string | false;

  return {
    name: PLUGIN_NAME,
    apply: 'build',
    enforce: 'post',
    onLog(level, log) {
      // Filter log messages from this plugin if quiet is enabled.
      return log.plugin !== PLUGIN_NAME || !quiet;
    },
    async config({ build }) {
      if (build?.lib === false || !build?.lib?.entry) {
        // This plugin is disabled if there is no library entry point.
        enabled = false;
        return;
      }

      return await getConfigDefaults(build.lib, build.rollupOptions);
    },
    async configResolved(config) {
      if (!enabled) return;

      root = config.root;
      absInDir = path.resolve(config.root, config.build.outDir);

      if (outFilename === false) {
        absOutFilename = false;
      }
      else {
        absOutFilename = path.resolve(root, config.build.outDir, outFilename ?? `../${path.basename(config.build.outDir)}.zip`);

        if (config.build.emptyOutDir !== false) {
        // By default, the zip file is adjacent to the output directory, not
        // inside it. So, this deletes the zip file independently if the
        // emptyOutDir option is not explicitly disabled.
          await fs.rm(absOutFilename, { force: true, recursive: true });
        }
      }
    },
    async closeBundle() {
      if (!enabled) return;
      if (!absOutFilename) return;

      this.info('zipping output directory...');
      this.info(`filename: ${relative(root, absOutFilename)}"`);

      await zipDir(absInDir, absOutFilename, (filename) => this.info(filename));
    },
  };
};

const getConfigDefaults = async (
  lib: LibraryOptions,
  rollupOptions: Rollup.RollupOptions | undefined,
): Promise<{ build: BuildOptions }> => {
  return {
    build: {
      lib: {
        entry: lib.entry,
        formats: lib?.formats ?? ['es'],
        fileName: lib?.fileName ?? ((format, name) => {
          return format === 'es' || format === 'esm' || format === 'module'
            ? `${name}.mjs`
            : `${name}.js`;
        }),
      },
      rollupOptions: {
        external: rollupOptions?.external ?? module.isBuiltin,
      },
    },
  };
};

const zipDir = async (inDir: string, outFilename: string, onFile: (filename: string) => void): Promise<void> => {
  const entries = await fs.opendir(inDir, { recursive: true });
  const zip = new JSZip();

  try {
    for await (const entry of entries) {
      const parentPath = (entry as any).parentPath ?? entry.path;
      const filename = path.resolve(parentPath, entry.name);
      const relativeFilename = path.relative(inDir, filename);

      if (filename === outFilename) {
        // Refuse to add the (previous) zip file to itself.
        continue;
      }

      if (entry.isDirectory()) {
        const stats = await fs.stat(filename);

        zip.file(relativeFilename, null, { dir: true, date: stats.mtime });
      }
      else if (entry.isFile()) {
        const [stats, content] = await Promise.all([
          fs.stat(filename),
          fs.readFile(filename),
        ]);

        onFile(relativeFilename);
        zip.file(relativeFilename, content, { date: stats.mtime });
      }
    }
  }
  finally {
    await entries.close()
      .catch((err: any) => {
        if (err?.code !== 'ERR_DIR_CLOSED') {
          throw err;
        }
      });
  }

  const readable = new stream.Readable()
    .wrap(zip.generateNodeStream({
      compression: 'DEFLATE',
      compressionOptions: {
        level: 9,
      },
    }));

  await fs.mkdir(path.dirname(outFilename), { recursive: true });
  await fs.writeFile(outFilename, readable);
};
