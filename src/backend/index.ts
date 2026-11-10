import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { openDatabase } from './database.js';
import { createApp } from './routes.js';

const dev = process.argv.includes('--dev');
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');
const dataDir = resolve(process.env.UKNODE_DATA_DIR || 'data');
const database = openDatabase(resolve(dataDir, 'uknode.sqlite'));
const app = createApp(database, { dev, logger: true });

try {
  if (dev) {
    const { createServer } = await import('vite');
    const vite = await createServer();
    app.addHook('onClose', async () => { await vite.close(); });
    await vite.listen();
    vite.printUrls();
  } else {
    const { default: fastifyStatic } = await import('@fastify/static');
    const root = resolve('dist/frontend');
    if (!existsSync(resolve(root, 'index.html'))) throw new Error('Run npm run build before npm start');
    await app.register(fastifyStatic, { root });
  }
  await app.listen({ host: '127.0.0.1', port });
  console.log(`SQLite: ${resolve(dataDir, 'uknode.sqlite')}`);
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0), error => {
      console.error(error);
      process.exit(1);
    });
  });
}
