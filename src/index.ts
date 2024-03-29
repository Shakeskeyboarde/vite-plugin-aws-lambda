import fs from 'node:fs/promises';
import module from 'node:module';
import path from 'node:path';
import stream from 'node:stream';

import JSZip from 'jszip';
import { type LibraryOptions, type Plugin, type Rollup } from 'vite';

/**
 * Options for the AWS Lambda plugin.
 */
export interface AwsLambdaOptions {
  /**
   * The output filename for the Lambda function zip file.
   *
   * Set to false to disable zipping.
   *
   * Defaults to `../<outDirBasename>.zip` which places the zip file adjacent
   * to your Vite output directory.
   */
  readonly outFilename?: string | false;
}

/**
 * Helper for building AWS lambda functions with Vite.
 *
 * - Applies appropriate library mode configuration defaults.
 * - Changes library mode module output file extensions to `.mjs`.
 * - Marks all NodeJS internal modules as external.
 * - Zips the output directory.
 */
export default ({ outFilename }: AwsLambdaOptions = {}): Plugin => {
  let enabled = true;
  let absInDir: string;
  let absOutFilename: string | false;

  return {
    name: 'vite-plugin-aws-lambda',
    apply: 'build',
    enforce: 'post',
    async config({ build }) {
      if (build?.lib === false || !build?.lib?.entry) {
        // This plugin is disabled if there is no library entry point.
        enabled = false;
        return;
      }

      return await getConfigDefaults(build.lib, build.rollupOptions);
    },
    async configResolved({ root, build }) {
      if (!enabled) return;

      absInDir = path.resolve(root, build.outDir);

      if (outFilename === false) {
        absOutFilename = false;
      }
      else if (build.emptyOutDir !== false) {
        absOutFilename = path.resolve(root, build.outDir, outFilename ?? `../${path.basename(build.outDir)}.zip`);

        // By default, the zip file is adjacent to the output directory, not
        // inside it. So, this deletes the zip file independently if the
        // emptyOutDir option is not explicitly disabled.
        await fs.rm(absOutFilename, { force: true, recursive: true });
      }
    },
    async closeBundle() {
      if (!enabled) return;
      if (!absOutFilename) return;

      await zipDir(absInDir, absOutFilename);
    },
  };
};

const getConfigDefaults = async (
  lib: LibraryOptions,
  rollupOptions: Rollup.RollupOptions | undefined,
): Promise<ReturnType<Extract<Plugin['config'], Function>>> => {
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

const zipDir = async (inDir: string, outFilename: string): Promise<void> => {
  const entries = await fs.opendir(inDir, { recursive: true });
  const zip = new JSZip();

  try {
    for await (const entry of entries) {
      const parentPath = (entry as any).parentPath ?? entry.path;
      const filename = path.join(parentPath, entry.name);

      if (entry.isDirectory()) {
        const stats = await fs.stat(filename);

        zip.file(path.relative(inDir, filename), null, { dir: true, date: stats.mtime });
      }
      else if (entry.isFile()) {
        const [stats, content] = await Promise.all([
          fs.stat(filename),
          fs.readFile(filename),
        ]);

        zip.file(path.relative(inDir, filename), content, { date: stats.mtime });
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
