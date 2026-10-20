import http from 'node:http';
import path from 'node:path';

// `npm run dev` uses `node --watch`. Next.js forks build workers with process.execArgv, and a worker
// in watch mode sends Node's internal watch IPC messages that Next's worker pool rejects. Workers
// must not inherit the watch flags or the env var that turns dependency reporting on (the watcher uses
// explicit --watch-path folders, so it still restarts on server code changes).
process.execArgv = process.execArgv.filter((arg) => !arg.startsWith('--watch'));
delete process.env.WATCH_REPORT_DEPENDENCIES;
import { REPO_ROOT, loadConfig } from './config/env.js';
import { connectDb, disconnectDb } from './db/connect.js';
import { createApp } from './app.js';
import { createMailer } from './email/mailer.js';
import { createStorage } from './storage/index.js';
import { RealtimeHub } from './realtime/hub.js';
import { attachSocketServer } from './realtime/socket.js';
import { startJobs } from './jobs.js';

/**
 * One process serves everything: the API, Socket.IO and the Next.js frontend. One URL, same-origin
 * cookies, no CORS — deployable as a single service on any host that runs Node with WebSockets.
 */
async function main() {
  const config = loadConfig();
  await connectDb(config);
  const [mailer, storage] = await Promise.all([createMailer(config), createStorage(config)]);
  const hub = new RealtimeHub();

  let webHandler;
  let nextApp;
  if (config.serveWeb) {
    const { default: next } = await import('next');
    nextApp = next({ dev: !config.isProd, dir: path.join(REPO_ROOT, 'apps/web') });
    await nextApp.prepare();
    webHandler = nextApp.getRequestHandler();
  }

  const app = createApp({ config, mailer, storage, hub, webHandler });
  const server = http.createServer(app);
  attachSocketServer(server, { config, hub });

  if (nextApp && !config.isProd) {
    // Next.js dev HMR uses its own websocket; hand it any upgrade that isn't Socket.IO.
    const upgrade = nextApp.getUpgradeHandler();
    server.on('upgrade', (req, socket, head) => {
      if (!req.url?.startsWith('/socket.io')) upgrade(req, socket, head);
    });
  }

  const stopJobs = startJobs({ hub, storage });

  server.listen(config.port, config.host, () => {
    console.log(`\n💞 Our Little World running at ${config.appOrigin}  (${config.env}, port ${config.port})`);
    console.log(`   email: ${mailer.kind} · storage: ${storage.kind} · registration: ${config.registrationMode}\n`);
  });

  const shutdown = async (signal) => {
    console.log(`\n${signal} received, shutting down…`);
    stopJobs();
    server.close();
    await disconnectDb().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
