import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cookie, cookies, constantEqual, email, headers, randomToken, readJSON, safeOrigin } from './security.js';
import { prepareMessage } from './mail.js';
import { destinations } from './store.js';
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '../public');
const assets = new Map([['/', ['index.html', 'text/html']], ['/privacy', ['privacy.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']], ['/icon.svg', ['icon.svg', 'image/svg+xml']], ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']]]);

export function createApp({ config, gmail, store, demo = false }) {
  const origin = safeOrigin(config.origin);
  const sessions = new Map();
  const freshSession = () => ({ csrf: randomToken(), expires: Date.now() + 7 * 86400000, authenticated: demo, intents: new Map() });
  const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  const snapshot = () => {
    const rules = store.rules(), states = store.states();
    const messages = [...gmail.messages.values()].map(({ text, ...m }) => ({ ...m, ...(states[m.id] || { seen: false, later: false, saved: false }), destination: rules[m.address] || 'screen' })).sort((a, b) => b.date - a.date);
    return { messages, rules, hasMore: !!gmail.nextPage, lastSync: gmail.lastSync || null, canSend: gmail.canSend(), demo };
  };
  const server = createServer(async (req, res) => {
    for (const [name, value] of Object.entries(headers(origin))) res.setHeader(name, value);
    try {
      // Validate Host rather than trusting arbitrary proxy or Tailscale identity headers.
      if (req.headers.host !== new URL(origin).host) return json(res, { error: 'Unrecognized host.' }, 403);
      const url = new URL(req.url, origin);
      if (url.origin !== origin) return json(res, { error: 'Invalid URL.' }, 403);
      let sid = cookies(req).letterlane_session, session = sessions.get(sid);
      if (!session || session.expires < Date.now()) {
        if (sid) sessions.delete(sid);
        sid = randomToken(); session = freshSession(); sessions.set(sid, session);
        res.setHeader('Set-Cookie', cookie(sid, origin.startsWith('https:')));
      }
      // Periodic cleanup caps memory from abandoned sessions and expired previews.
      for (const [key, s] of sessions) if (s.expires < Date.now()) sessions.delete(key);
      for (const [key, p] of session.intents) if (p.expires < Date.now()) session.intents.delete(key);
      if (sessions.size > 1000) return json(res, { error: 'Too many sessions. Restart the private server.' }, 503);
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [file, type] = assets.get(url.pathname); res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(await readFile(join(publicDir, file))); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/status') return json(res, { authenticated: session.authenticated, configured: demo || !!(config.googleClientId && config.googleClientSecret && config.ownerEmail), demo, csrf: session.csrf, owner: session.authenticated ? config.ownerEmail : null });
      if (req.method === 'GET' && url.pathname === '/auth/callback') {
        const oauth = session.oauth; delete session.oauth;
        if (!oauth || oauth.expires < Date.now() || !constantEqual(oauth.state, url.searchParams.get('state'))) throw Object.assign(new Error('Authorization expired or invalid. Start again.'), { status: 400 });
        if (url.searchParams.has('error') || !url.searchParams.get('code')) throw new Error('Google authorization was cancelled.');
        await gmail.complete(url.searchParams.get('code'), oauth);
        sessions.delete(sid); sid = randomToken(); session = freshSession(); session.authenticated = true; sessions.set(sid, session);
        res.setHeader('Set-Cookie', cookie(sid, origin.startsWith('https:'))); res.writeHead(303, { Location: '/' }); res.end(); return;
      }
      if (req.method !== 'GET') {
        if (req.headers.origin !== origin || !constantEqual(req.headers['x-csrf-token'], session.csrf)) return json(res, { error: 'Request origin or security token invalid. Reload the app.' }, 403);
      }
      if (req.method === 'POST' && url.pathname === '/api/connect') {
        if (demo) return json(res, { error: 'Demo never connects to Google.' }, 400);
        if (!config.googleClientId || !config.googleClientSecret || !config.ownerEmail) throw new Error('Configure your Google OAuth credentials on this Mac first. See README.');
        const body = await readJSON(req);
        if (body.send && !session.authenticated) throw Object.assign(new Error('Connect read-only first.'), { status: 403 });
        return json(res, { url: gmail.authorization(session, body.send === true) });
      }
      if (!session.authenticated) return json(res, { error: 'Sign in to your configured Google account first.' }, 401);
      if (req.method === 'GET' && url.pathname === '/api/mail') return json(res, snapshot());
      if (req.method === 'GET' && /^\/api\/message\/[a-zA-Z0-9_-]+$/.test(url.pathname)) return json(res, await gmail.message(url.pathname.split('/').pop()));
      if (req.method === 'POST' && url.pathname === '/api/sync') { const body = await readJSON(req); await gmail.sync(body.older === true); return json(res, snapshot()); }
      if (req.method === 'POST' && url.pathname === '/api/rule') {
        const body = await readJSON(req); store.rule(email(body.email), body.destination); return json(res, snapshot());
      }
      if (req.method === 'POST' && url.pathname === '/api/message-state') {
        const body = await readJSON(req);
        if (!gmail.messages.has(body.id)) return json(res, { error: 'Unknown message.' }, 404);
        store.state(body.id, body.field, body.value); return json(res, snapshot());
      }
      if (req.method === 'POST' && url.pathname === '/api/send-preview') {
        if (!gmail.canSend()) return json(res, { error: 'Enable Gmail sending before composing.' }, 403);
        const body = await readJSON(req);
        const reply = body.replyId ? await gmail.message(body.replyId) : null;
        const prepared = prepareMessage(body, config.ownerEmail, reply);
        const intent = randomToken(); session.intents.set(intent, { ...prepared, expires: Date.now() + 600000 });
        if (session.intents.size > 20) session.intents.delete(session.intents.keys().next().value);
        return json(res, { intent, ...prepared.preview, demo });
      }
      if (req.method === 'POST' && url.pathname === '/api/send') {
        const { intent } = await readJSON(req);
        if (typeof intent !== 'string') throw new Error('Missing send confirmation.');
        const previous = store.receipt(intent);
        if (previous) return json(res, previous.status === 'sent' ? { id: previous.gmail_id, demo } : { error: 'Delivery is uncertain. Check Gmail Sent before composing another copy.' }, previous.status === 'sent' ? 200 : 409);
        const prepared = session.intents.get(intent);
        if (!prepared || prepared.expires < Date.now()) return json(res, { error: 'Preview expired. Review the message again.' }, 400);
        store.reserveSend(intent); session.intents.delete(intent);
        try {
          const sent = await gmail.send(prepared.gmail); store.sent(intent, sent.id); return json(res, { id: sent.id, demo });
        } catch { return json(res, { error: 'Delivery could not be confirmed. Do not retry blindly: check Gmail Sent first.' }, 502); }
      }
      if (req.method === 'POST' && url.pathname === '/api/disconnect') {
        await readJSON(req); await gmail.disconnect(); sessions.clear(); return json(res, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/logout') { await readJSON(req); sessions.delete(sid); return json(res, { ok: true }); }
      return json(res, { error: 'Not found.' }, 404);
    } catch (error) {
      // No request URLs, tokens, headers or mail contents in logs or error responses.
      const expected = error.status || /valid|Enter |Subject|Write a|Unknown destination|message are required/.test(error.message);
      json(res, { error: expected ? error.message : 'Operation failed. Check configuration or reconnect Gmail. No credentials were logged.' }, error.status || (expected ? 400 : 500));
    }
  });
  server.requestTimeout = 60000; server.headersTimeout = 15000;
  return { server, sessions, snapshot };
}
