import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { Store } from './store.js';
import { Gmail } from './gmail.js';
import { Keychain } from './keychain.js';
import { DemoGmail } from './demo.js';
import { email, safeOrigin } from './security.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const demo = process.argv.includes('--demo');
let config = {};
try { config = JSON.parse(readFileSync(resolve(root, 'config.local.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('config.local.json is invalid JSON.'); }
config = { port: 4317, origin: 'http://127.0.0.1:4317', ...config };
if (process.env.PORT) { config.port = Number(process.env.PORT); if (!config.origin.includes('.ts.net')) config.origin = `http://127.0.0.1:${config.port}`; }
if (demo) { config.ownerEmail = 'you@example.com'; config.origin = `http://127.0.0.1:${config.port}`; }
else if (config.ownerEmail) config.ownerEmail = email(config.ownerEmail);
config.origin = safeOrigin(config.origin);
if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('Choose a port from 1024 to 65535.');
const store = new Store(resolve(root, '.data', demo ? 'demo' : 'live'));
const gmail = demo ? new DemoGmail() : new Gmail(config, new Keychain(config.ownerEmail || 'unconfigured'));
if (!demo && config.ownerEmail) await gmail.init();
if (demo && Object.keys(store.rules()).length === 0) {
  store.rule('maya@example.com', 'inbox'); store.rule('luca@example.net', 'inbox'); store.rule('editor@example.org', 'reading'); store.rule('orders@example.com', 'records'); store.rule('avery@example.org', 'inbox'); store.rule('jun@example.com', 'inbox'); store.state('e1', 'later', true); store.state('f1', 'saved', true); store.state('a2', 'seen', true);
}
const { server } = createApp({ config, gmail, store, demo });
server.listen(config.port, '127.0.0.1', () => {
  console.log(`Letterlane ${demo ? 'DEMO (fictional messages)' : 'private Gmail workspace'}: ${config.origin}`);
  if (!demo && !config.ownerEmail) console.log('No Gmail account configured. Follow README setup before connecting.');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(() => { store.close(); process.exit(0); }); server.closeIdleConnections(); });
