import Fastify, { type FastifyError } from 'fastify';
import { WriteError, type GraphDatabase } from './database.js';
import { batchSchema, type ChangeBatch } from '../shared/protocol.js';

export function createApp(database: GraphDatabase, options: { dev?: boolean; logger?: boolean } = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 5 * 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  app.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host || '';
    const origin = request.headers.origin;
    const allowedOrigins = [`http://${host}`];
    if (options.dev) allowedOrigins.push('http://127.0.0.1:5173', 'http://localhost:5173');
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
      || (origin && !allowedOrigins.includes(origin))
      || request.headers['sec-fetch-site'] === 'cross-site') {
      return reply.code(403).send({ code: 'FORBIDDEN_ORIGIN', message: '仅接受本地页面请求' });
    }
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });
  app.get('/api/graph', () => database.readGraph());
  app.post<{ Body: ChangeBatch }>('/api/changes', { schema: { body: batchSchema } }, request => database.applyBatch(request.body));
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof WriteError) return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    if (error.validation) return reply.code(400).send({ code: 'INVALID_BATCH', message: '提交内容不符合接口定义，修改仍保留在本页' });
    const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    request.log.error(error);
    return reply.code(status).send({ code: 'REQUEST_FAILED', message: status === 500 ? '保存服务发生错误，请重试' : '请求无效，修改仍保留在本页' });
  });
  app.addHook('onClose', async () => database.close());
  return app;
}
