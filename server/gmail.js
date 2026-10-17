import { createHash } from 'node:crypto';
import { metadata, plainBody } from './mail.js';
import { randomToken } from './security.js';
export const READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export class Gmail {
  constructor(config, keychain) { this.config = config; this.keychain = keychain; this.tokens = null; this.messages = new Map(); this.nextPage = null; }
  async init() { this.tokens = await this.keychain.read(); }
  canSend() { return (this.tokens?.scope || '').split(' ').includes(SEND_SCOPE); }
  authorization(session, send = false) {
    const state = randomToken(), verifier = randomToken();
    session.oauth = { state, verifier, expires: Date.now() + 600000, send };
    const query = new URLSearchParams({ client_id: this.config.googleClientId, redirect_uri: `${this.config.origin}/auth/callback`, response_type: 'code', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', scope: `openid email ${READ_SCOPE}${send ? ' ' + SEND_SCOPE : ''}`, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', login_hint: this.config.ownerEmail });
    return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
  }
  async tokenRequest(values) {
    const response = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.config.googleClientId, client_secret: this.config.googleClientSecret, ...values }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Google authorization failed. Reconnect your account.');
    return response.json();
  }
  async complete(code, oauth) {
    const next = await this.tokenRequest({ code, code_verifier: oauth.verifier, redirect_uri: `${this.config.origin}/auth/callback`, grant_type: 'authorization_code' });
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${next.access_token}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Could not verify your Google account.');
    const identity = await response.json();
    if (!identity.email_verified || identity.email?.toLowerCase() !== this.config.ownerEmail) throw new Error('This app is restricted to its configured owner.');
    const granted = (next.scope || '').split(' ');
    if (!granted.includes(READ_SCOPE)) throw new Error('Gmail read permission was not granted.');
    // A declined optional send permission never enables the send API.
    const previous = this.tokens || {};
    const tokens = { ...next, refresh_token: next.refresh_token || previous.refresh_token, expires_at: Date.now() + next.expires_in * 1000 };
    if (!tokens.refresh_token) throw new Error('Google did not return offline authorization. Revoke the old grant and reconnect.');
    await this.keychain.write(tokens);
    this.tokens = tokens;
  }
  async accessToken() {
    if (!this.tokens) throw Object.assign(new Error('Connect Gmail first.'), { status: 401 });
    if (this.tokens.expires_at > Date.now() + 60000) return this.tokens.access_token;
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const next = await this.tokenRequest({ refresh_token: this.tokens.refresh_token, grant_type: 'refresh_token' });
        const tokens = { ...this.tokens, ...next, expires_at: Date.now() + next.expires_in * 1000 };
        await this.keychain.write(tokens); this.tokens = tokens;
        return tokens.access_token;
      })().finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }
  async request(path, options = {}) {
    const token = await this.accessToken();
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Object.assign(new Error(response.status === 401 ? 'Gmail authorization expired. Reconnect your account.' : `Gmail request failed (${response.status}).`), { status: response.status === 401 ? 401 : 502 });
    return response.json();
  }
  async sync(older = false) {
    if (this.syncing) return this.syncing;
    this.syncing = this.syncPage(older).finally(() => { this.syncing = null; });
    return this.syncing;
  }
  async syncPage(older) {
    if (older && !this.nextPage) return;
    const query = new URLSearchParams({ maxResults: '100', q: '-in:spam -in:trash -in:drafts -in:sent newer_than:90d', ...(older ? { pageToken: this.nextPage } : {}) });
    const result = await this.request(`messages?${query}`);
    const ids = result.messages || [];
    const fetched = [];
    // Five concurrent calls at most. Only metadata is retained in memory.
    for (let i = 0; i < ids.length; i += 5) {
      const chunk = await Promise.all(ids.slice(i, i + 5).map(async ({ id }) => metadata(await this.request(`messages/${id}?format=metadata`))));
      fetched.push(...chunk);
    }
    // Publish the page only after all calls succeed; retries cannot skip a page.
    for (const message of fetched) this.messages.set(message.id, message);
    this.nextPage = result.nextPageToken || null;
    this.lastSync = Date.now();
  }
  async message(id) {
    if (!this.messages.has(id)) throw Object.assign(new Error('Refresh your inbox to load this message.'), { status: 404 });
    const message = await this.request(`messages/${encodeURIComponent(id)}?format=full`);
    return { ...metadata(message), ...plainBody(message.payload), attachments: this.attachmentNames(message.payload) };
  }
  attachmentNames(part) { return [...(part?.filename ? [part.filename] : []), ...(part?.parts || []).flatMap(p => this.attachmentNames(p))]; }
  async send(gmail) {
    if (!this.canSend()) throw Object.assign(new Error('Enable Gmail sending first.'), { status: 403 });
    // Intentionally no automatic retry: a network timeout may follow a successful send.
    return this.request('messages/send', { method: 'POST', body: JSON.stringify(gmail) });
  }
  async disconnect() {
    if (this.tokens) {
      const response = await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: this.tokens.refresh_token }), signal: AbortSignal.timeout(15000) });
      if (!response.ok && response.status !== 400) throw new Error('Google could not revoke access. Try again, or remove Letterlane in your Google Account connections.');
    }
    await this.keychain.clear(); this.tokens = null; this.messages.clear(); this.nextPage = null;
  }
}
