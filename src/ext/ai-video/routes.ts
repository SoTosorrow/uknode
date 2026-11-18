import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import sharp from 'sharp';
import { nanoid } from 'nanoid';
import type { FastifyInstance } from 'fastify';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { WriteError } from '../../runtime/errors.js';
import { generateImage, ImageGenerationError } from '../../integrations/openai/images.js';
import { imageSizeError, imageOptionsSchema, type ImageOptions } from '../../integrations/openai/image-options.js';
import { assetPattern } from './model.js';
import { findImageReferences } from './storage.js';

export const maxImageBytes = 20 * 1024 * 1024;
const imageMime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;
function imageExtension(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw new WriteError('INVALID_IMAGE', '仅支持 PNG、JPEG、WebP 图片');
}

async function storeImage(directory: string, bytes: Buffer) {
  const path = `assets/${nanoid(12)}.${imageExtension(bytes)}`;
  await mkdir(resolve(directory, 'assets'), { recursive: true });
  await writeFile(resolve(directory, path), bytes, { flag: 'wx' });
  return path;
}

export function registerVideoRoutes(app: FastifyInstance, directory: string, db: BetterSQLite3Database) {
  // Raw binary upload uses Axios and Fastify directly; no multipart dependency.
  app.register(async scope => {
    scope.get('/api/ext/ai-video/library', async () => {
      const assets = resolve(directory, 'assets');
      try {
        const entries = await readdir(assets, { withFileTypes: true });
        return { directory: assets, files: entries.filter(entry => entry.isFile()).map(entry => entry.name).sort() };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { directory: assets, files: [] };
        throw error;
      }
    });
    scope.get<{ Querystring: { filename: string } }>('/api/ext/ai-video/library/references', {
      schema: { querystring: { type: 'object', required: ['filename'], properties: { filename: { type: 'string', minLength: 1, pattern: '^[^/]+$' } } } },
    }, async request => findImageReferences(db, request.query.filename));
    scope.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: maxImageBytes }, (_, body, done) => done(null, body));
    scope.post<{ Body: Buffer; Querystring: { name: string } }>('/api/ext/ai-video/images', {
      bodyLimit: maxImageBytes,
      schema: { querystring: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 255 } } } },
    }, async (request, reply) => {
      if (!Buffer.isBuffer(request.body)) throw new WriteError('INVALID_IMAGE', '请上传图片文件');
      const path = await storeImage(directory, request.body);
      return reply.code(201).send({ path, name: request.query.name.split(/[\\/]/).at(-1)! });
    });
    scope.post<{ Body: { prompt: string; reference?: string; options?: ImageOptions } }>('/api/ext/ai-video/images/generate', {
      schema: { body: { type: 'object', additionalProperties: false, required: ['prompt'], properties: {
        prompt: { type: 'string', minLength: 1, maxLength: 20000, pattern: '\\S' },
        reference: { type: 'string', pattern: assetPattern.source },
        options: imageOptionsSchema,
      } } },
    }, async (request, reply) => {
      const { prompt, reference, options } = request.body;
      if (options?.size !== undefined) {
        const error = imageSizeError(options.size);
        if (error) throw new WriteError('INVALID_IMAGE_SIZE', error);
      }
      const controller = new AbortController();
      const onClose = () => controller.abort();
      reply.raw.once('close', onClose);
      try {
        let file: File | undefined;
        if (reference) {
          const extension = reference.split('.').pop() as keyof typeof imageMime;
          try {
            const bytes = await readFile(resolve(directory, reference));
            file = new File([bytes], basename(reference), { type: imageMime[extension] });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new WriteError('MISSING_IMAGE', '参考图片不存在，请重新上传');
            throw error;
          }
        }
        const bytes = await generateImage({ prompt: prompt.trim(), reference: file, options, signal: controller.signal });
        controller.signal.throwIfAborted();
        const path = await storeImage(directory, bytes);
        return reply.code(201).send({ path, name: basename(path) });
      } catch (error) {
        if (error instanceof ImageGenerationError) return reply.code(502).send({ code: 'IMAGE_GENERATION_FAILED', message: error.message });
        throw error;
      } finally {
        reply.raw.off('close', onClose);
      }
    });
    scope.get<{ Params: { filename: string }; Querystring: { thumbnail?: string } }>('/api/ext/ai-video/assets/:filename', async (request, reply) => {
      const path = `assets/${request.params.filename}`;
      const match = assetPattern.exec(path);
      const notFound = () => reply.code(404).send({ code: 'IMAGE_NOT_FOUND', message: '图片不存在' });
      if (!match) return notFound();
      let bytes: Buffer;
      try { bytes = await readFile(resolve(directory, path)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return notFound();
        throw error;
      }
      reply.header('X-Content-Type-Options', 'nosniff');
      if (request.query.thumbnail === '1') {
        try {
          const thumbnail = await sharp(bytes).rotate()
            .resize({ width: 512, height: 320, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 75 }).toBuffer();
          return reply.type('image/webp').send(thumbnail);
        } catch {
          return reply.code(422).send({ code: 'INVALID_IMAGE', message: '无法读取参考图片' });
        }
      }
      return reply.type(imageMime[match[1] as keyof typeof imageMime]).send(bytes);
    });
  });
}
