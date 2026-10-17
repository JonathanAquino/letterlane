import { email, senderAddress } from './security.js';
const b64 = value => Buffer.from(value).toString('base64');
const wrap = value => value.match(/.{1,76}/g)?.join('\r\n') || '';
export function decodeHeader(value = '') {
  return value.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_, charset, type, data) => {
    try {
      const bytes = type.toLowerCase() === 'b' ? Buffer.from(data, 'base64') : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
      return new TextDecoder(charset).decode(bytes);
    } catch { return '[unreadable header]'; }
  });
}
export function metadata(message) {
  const h = name => decodeHeader(message.payload?.headers?.find(h => h.name.toLowerCase() === name)?.value || '');
  const from = h('from');
  return { id: message.id, threadId: message.threadId, from, address: senderAddress(from), subject: h('subject') || '(No subject)', to: h('to'), replyTo: senderAddress(h('reply-to')) || senderAddress(from), date: Number(message.internalDate) || 0, snippet: message.snippet || '', labels: message.labelIds || [], messageId: h('message-id'), references: h('references') };
}
export function plainBody(payload) {
  const collect = (part, mime) => {
    if (part.filename) return [];
    return [...(part.mimeType === mime && part.body?.data ? [Buffer.from(part.body.data, 'base64url').toString('utf8')] : []), ...(part.parts || []).flatMap(p => collect(p, mime))];
  };
  const text = collect(payload, 'text/plain');
  if (text.length) return { text: text.join('\n\n').slice(0, 300000), htmlFallback: false };
  // HTML is NEVER inserted into a DOM. Only a lossy text conversion is returned.
  const html = collect(payload, 'text/html').join('\n');
  return { text: html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<(br|\/p|\/div|\/tr)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').slice(0, 300000) || 'No text preview available. Open this message in Gmail to view it.', htmlFallback: !!html };
}
export function prepareMessage({ to, subject, body }, owner, reply) {
  if (typeof to !== 'string' || typeof subject !== 'string' || typeof body !== 'string') throw new Error('Recipient, subject and message are required.');
  const recipients = to.split(',').map(x => email(x.trim()));
  if (!recipients.length || recipients.length > 10) throw new Error('Use between 1 and 10 recipients.');
  if (/[\r\n]/.test(subject) || subject.length > 300) throw new Error('Subject must be one line, at most 300 characters.');
  if (!body.trim() || body.length > 40000) throw new Error('Write a message of at most 40,000 characters.');
  const preview = { from: email(owner), to: recipients.join(', '), subject, body, replyId: reply?.id || null };
  const lines = [`From: ${preview.from}`, `To: ${preview.to}`, `Subject: =?UTF-8?B?${b64(subject)}?=`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'];
  // Thread headers only come from the original message, never from browser input.
  const messageId = reply?.messageId;
  if (messageId && /^<[^<>\s\r\n]+>$/.test(messageId)) {
    lines.push(`In-Reply-To: ${messageId}`);
    const refs = (reply.references?.match(/<[^<>\s\r\n]+>/g) || []).slice(-15);
    lines.push(`References: ${[...refs, messageId].join(' ')}`);
  }
  lines.push('', wrap(b64(body.replace(/\r?\n/g, '\r\n'))));
  return { preview, gmail: { raw: Buffer.from(lines.join('\r\n')).toString('base64url'), ...(reply?.threadId ? { threadId: reply.threadId } : {}) } };
}
