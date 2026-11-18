import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { nanoid } from 'nanoid';
import type { FastifyInstance } from 'fastify';
import { WriteError } from '../../runtime/errors.js';
import { assetPattern } from './model.js';

export const maxImageBytes = 20 * 1024 * 1024;
const imageMime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;
function imageExtension(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw new WriteError('INVALID_IMAGE', '仅支持 PNG、JPEG、WebP 图片');
}

export function registerVideoRoutes(app: FastifyInstance, directory: string) {
  // Raw binary upload uses Axios and Fastify directly; no multipart dependency.
  app.register(async scope => {
    scope.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: maxImageBytes }, (_, body, done) => done(null, body));
    scope.post<{ Body: Buffer; Querystring: { name: string } }>('/api/ext/ai-video/images', {
      bodyLimit: maxImageBytes,
      schema: { querystring: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 255 } } } },
    }, async (request, reply) => {
      if (!Buffer.isBuffer(request.body)) throw new WriteError('INVALID_IMAGE', '请上传图片文件');
      const path = `assets/${nanoid(12)}.${imageExtension(request.body)}`;
      await mkdir(resolve(directory, 'assets'), { recursive: true });
      await writeFile(resolve(directory, path), request.body, { flag: 'wx' });
      return reply.code(201).send({ path, name: request.query.name.split(/[\\/]/).at(-1)! });
    });
    scope.get<{ Params: { filename: string } }>('/api/ext/ai-video/assets/:filename', async (request, reply) => {
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
      return reply.header('X-Content-Type-Options', 'nosniff').type(imageMime[match[1] as keyof typeof imageMime]).send(bytes);
    });
  });
}
