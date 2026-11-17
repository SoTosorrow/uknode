import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { nanoid } from 'nanoid';
import type { FastifyInstance } from 'fastify';
import { WriteError } from '../../runtime/errors.js';
import { assetPattern } from './model.js';

export const maxImageBytes = 20 * 1024 * 1024;
function imageType(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { extension: 'png', mime: 'image/png' };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { extension: 'jpg', mime: 'image/jpeg' };
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return { extension: 'webp', mime: 'image/webp' };
  throw new WriteError(400, 'INVALID_IMAGE', '仅支持 PNG、JPEG、WebP 图片');
}

export function registerVideoRoutes(app: FastifyInstance, directory: string) {
  // Raw binary upload uses Axios and Fastify directly; no multipart dependency.
  app.register(async scope => {
    scope.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: maxImageBytes }, (_, body, done) => done(null, body));
    scope.post<{ Body: Buffer; Querystring: { name: string } }>('/api/ext/ai-video/images', {
      bodyLimit: maxImageBytes,
      schema: { querystring: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 255 } } } },
    }, async (request, reply) => {
      if (!Buffer.isBuffer(request.body)) throw new WriteError(400, 'INVALID_IMAGE', '请上传图片文件');
      const type = imageType(request.body), path = `assets/${nanoid(12)}.${type.extension}`;
      await mkdir(resolve(directory, 'assets'), { recursive: true });
      await writeFile(resolve(directory, path), request.body, { flag: 'wx' });
      return reply.code(201).send({ path, name: request.query.name.split(/[\\/]/).at(-1)! });
    });
    scope.get<{ Params: { filename: string } }>('/api/ext/ai-video/assets/:filename', async (request, reply) => {
      const path = `assets/${request.params.filename}`;
      if (!assetPattern.test(path)) throw new WriteError(404, 'MISSING_IMAGE', '图片不存在');
      let bytes: Buffer;
      try { bytes = await readFile(resolve(directory, path)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new WriteError(404, 'MISSING_IMAGE', '图片不存在');
        throw error;
      }
      return reply.header('X-Content-Type-Options', 'nosniff').type(imageType(bytes).mime).send(bytes);
    });
  });
}
