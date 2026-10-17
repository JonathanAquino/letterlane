import test from 'node:test';
import { request as httpRequest } from 'node:http';

// Node fetch reserves Host; use HTTP directly to exercise host validation.
function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, options, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { email, safeOrigin, senderAddress, constantEqual } from '../server/security.js';
import { prepareMessage, plainBody, metadata } from '../server/mail.js';
import { createApp } from '../server/app.js';
import { DemoGmail } from '../server/demo.js';
import { Gmail, READ_SCOPE, SEND_SCOPE } from '../server/gmail.js';

test('email header injection and unsafe origins are rejected', () => {
  for (const address of ['x@example.com\r\nBcc: victim@example.com', '"x" <x@example.com>', 'a@localhost', 'javascript:alert(1)']) assert.throws(() => email(address));
  for (const origin of ['http://public.example.com', 'https://owner:password@example.com', 'https://example.com/path', 'https://example.com/?a=b']) assert.throws(() => safeOrigin(origin));
  assert.equal(safeOrigin('http://127.0.0.1:4317'), 'http://127.0.0.1:4317');
  assert.equal(safeOrigin('https://my-mac.example.ts.net'), 'https://my-mac.example.ts.net');
  assert.equal(senderAddress('"A real name" <NAME@example.com>'), 'name@example.com');
  assert.equal(constantEqual('abc', 'abc'), true);
  assert.equal(constantEqual('é', 'a'), false);
});

test('rules and local state persist without storing email bodies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'letterlane-store-'));
  let store = new Store(dir);
  try {
    store.rule('a@example.com', 'reading'); store.state('mail1', 'seen', true); store.close(); store = new Store(dir);
    assert.equal(store.rules()['a@example.com'], 'reading'); assert.equal(store.states().mail1.seen, true);
    assert.throws(() => store.rule('b@example.com', 'DELETE FROM rules'));
    assert.throws(() => store.state('mail1', 'seen=1', true));
    store.rule('a@example.com', 'screen'); assert.deepEqual(store.rules(), {});
    store.reserveSend('once'); assert.throws(() => store.reserveSend('once'));
    store.sent('once', 'gmail123'); assert.equal(store.receipt('once').gmail_id, 'gmail123');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('MIME send preserves Unicode and uses only trusted reply headers', () => {
  const result = prepareMessage({ to: 'friend@example.com', subject: 'Café', body: 'Hello\n世界' }, 'owner@example.com', { id: 'a', threadId: 'thread1', messageId: '<trusted@example.com>', references: '<earlier@example.com>\r\nBcc: bad@example.com' });
  const wire = Buffer.from(result.gmail.raw, 'base64url').toString();
  assert.match(wire, /In-Reply-To: <trusted@example.com>/);
  assert.match(wire, /References: <earlier@example.com> <trusted@example.com>/);
  assert.doesNotMatch(wire, /Bcc:/);
  assert.equal(Buffer.from(wire.split('\r\n\r\n')[1], 'base64').toString(), 'Hello\r\n世界');
  assert.equal(result.gmail.threadId, 'thread1');
  assert.throws(() => prepareMessage({ to: 'friend@example.com', subject: 'Hi\r\nBcc: a@example.com', body: 'x' }, 'owner@example.com'));
});

test('received HTML becomes inert text and attachments stay out of message text', () => {
  const body = plainBody({ mimeType: 'multipart/mixed', parts: [{ mimeType: 'text/html', body: { data: Buffer.from('<script>stealToken()</script><p>Hello &amp; goodbye</p><img src="https://tracker.example.com">').toString('base64url') } }, { mimeType: 'text/plain', filename: 'attachment.txt', body: { data: Buffer.from('attachment secret').toString('base64url') } }] });
  assert.equal(body.htmlFallback, true); assert.match(body.text, /Hello & goodbye/); assert.doesNotMatch(body.text, /stealToken|attachment secret|tracker/);
  const message = metadata({ id: 'a', payload: { headers: [{ name: 'Subject', value: '=?UTF-8?B?Q2Fmw6k=?=' }, { name: 'From', value: 'Maya <maya@example.com>' }] } });
  assert.equal(message.subject, 'Café'); assert.equal(message.address, 'maya@example.com');
});

test('Gmail sends only with a granted send scope and uses PKCE plus expiring state', () => {
  const gmail = new Gmail({ origin: 'http://127.0.0.1:4317', ownerEmail: 'owner@example.com', googleClientId: 'test' }, {});
  gmail.tokens = { scope: READ_SCOPE }; assert.equal(gmail.canSend(), false);
  gmail.tokens.scope += ` ${SEND_SCOPE}`; assert.equal(gmail.canSend(), true);
  const session = {}, url = new URL(gmail.authorization(session, true));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(url.searchParams.get('state'), session.oauth.state);
  assert.ok(session.oauth.expires > Date.now()); assert.ok(url.searchParams.get('scope').includes(SEND_SCOPE));
});

test('private HTTP boundary, CSRF, state changes and duplicate-send protection', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'letterlane-server-')), store = new Store(dir), gmail = new DemoGmail();
  const config = { origin: 'http://127.0.0.1:4317', ownerEmail: 'owner@example.com' };
  const { server } = createApp({ config, gmail, store, demo: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const target = `http://127.0.0.1:${server.address().port}`;
  let sessionCookie;
  const request = async (path, body, extra = {}) => {
    const response = await fetch(target + path, { method: body === undefined ? 'GET' : 'POST', headers: { Host: '127.0.0.1:4317', ...(sessionCookie ? { Cookie: sessionCookie } : {}), ...(body === undefined ? {} : { Origin: config.origin, 'Content-Type': 'application/json' }), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.headers.has('set-cookie')) sessionCookie = response.headers.get('set-cookie').split(';')[0];
    return response;
  };
  try {
    const response = await request('/api/status'), status = await response.json();
    assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await request('/api/mail', undefined, { Host: 'attacker.example.com' })).status, 403);
    assert.equal((await request('/api/rule', { email: 'maya@example.com', destination: 'inbox' })).status, 403);
    const auth = { 'X-CSRF-Token': status.csrf };
    assert.equal((await request('/api/rule', { email: 'maya@example.com', destination: 'inbox' }, { ...auth, Origin: 'https://attacker.example.com' })).status, 403);
    const changed = await (await request('/api/rule', { email: 'maya@example.com', destination: 'inbox' }, auth)).json();
    assert.equal(changed.messages.find(m => m.id === 'a1').destination, 'inbox');
    await request('/api/message-state', { id: 'a1', field: 'seen', value: true }, auth);
    assert.equal(store.states().a1.seen, true);
    const preview = await (await request('/api/send-preview', { to: 'friend@example.com', subject: 'Reviewed', body: 'A letter', replyId: 'a1' }, auth)).json();
    assert.ok(preview.intent); assert.equal(gmail.sent.length, 0);
    assert.equal((await request('/api/send', { intent: 'unreviewed' }, auth)).status, 400);
    const first = await (await request('/api/send', { intent: preview.intent }, auth)).json();
    const second = await (await request('/api/send', { intent: preview.intent }, auth)).json();
    assert.equal(first.id, second.id); assert.equal(gmail.sent.length, 1);
    gmail.send = async () => { throw new Error('Network timeout after possible delivery'); };
    const uncertain = await (await request('/api/send-preview', { to: 'friend@example.com', subject: 'Uncertain', body: 'A letter' }, auth)).json();
    assert.equal((await request('/api/send', { intent: uncertain.intent }, auth)).status, 502);
    assert.equal((await request('/api/send', { intent: uncertain.intent }, auth)).status, 409);
  } finally { await new Promise(resolve => server.close(resolve)); store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('live app never exposes mail before owner sign-in; OAuth state cannot be forged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'letterlane-live-')), store = new Store(dir), gmail = new DemoGmail();
  const { server } = createApp({ config: { origin: 'http://127.0.0.1:4317', ownerEmail: 'owner@example.com' }, gmail, store });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, opts = { headers: { Host: '127.0.0.1:4317' } };
  try {
    assert.equal((await fetch(base + '/api/mail', opts)).status, 401);
    assert.equal((await fetch(base + '/api/message/a1', opts)).status, 401);
    assert.equal((await fetch(base + '/auth/callback?code=bad&state=forged', opts)).status, 400);
    const html = await fetch(base, opts); assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  } finally { await new Promise(resolve => server.close(resolve)); store.close(); rmSync(dir, { recursive: true, force: true }); }
});
