const $ = selector => document.querySelector(selector);
const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
const views = {
  screen: ['Front door', 'Choose who gets your attention. A decision here applies to future messages from the same address.', '⌁', 'MAKE A LITTLE ROOM'],
  inbox: ['Inbox', 'People and conversations worth making time for.', '↗', 'A LITTLE BREATHING ROOM'],
  reading: ['Reading room', 'Newsletters and longer reads, ready when you are.', '≋', 'SOMETHING GOOD TO READ'],
  records: ['Records', 'Receipts, confirmations, and useful details, kept together.', '▤', 'THE LITTLE DETAILS'],
  later: ['Reply later', 'Conversations you want to come back to.', '◷', 'WHEN YOU HAVE A MOMENT'],
  saved: ['Keep close', 'A small shelf for messages worth keeping handy.', '◇', 'WORTH HOLDING ON TO'],
  blocked: ['Screened out', 'These senders stay out of your other Letterlane views. Gmail is unchanged.', '⊘', 'A QUIETER WORKSPACE']
};
const destinations = { screen: 'Ask me first', inbox: 'Inbox', reading: 'Reading room', records: 'Records', blocked: 'Screen out' };
let status, mailbox = { messages: [], rules: {} }, view = 'inbox', activeMessage, replyId, busy = false, syncBusy = false, sending = false;
const displayName = from => from?.replace(/\s*<[^>]+>/g, '').replace(/^"|"$/g, '') || 'Unknown sender';
const initials = from => displayName(from).split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase();
const gmailURL = id => `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(status.owner)}#all/${encodeURIComponent(id)}`;
function notice(message, error = false) { $('#notice').hidden = false; $('#notice').textContent = message; $('#notice').className = `notice${error ? ' error' : status?.demo ? ' demo' : ''}`; }
async function api(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': status.csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Something went wrong.');
  return result;
}
async function action(fn) {
  if (busy) return;
  busy = true;
  try { await fn(); } catch (error) { notice(error.message, true); } finally { busy = false; }
}
function belongs(message, target) {
  if (target === 'later') return message.later && message.destination !== 'blocked' && message.destination !== 'screen';
  if (target === 'saved') return message.saved && message.destination !== 'blocked' && message.destination !== 'screen';
  return message.destination === target;
}
function nav() {
  const node = $('#navigation'); node.replaceChildren();
  for (const [key, [name, , icon]] of Object.entries(views)) {
    if (key === 'later') node.append(el('div', 'nav-divider'));
    const count = key === 'screen' ? new Set(mailbox.messages.filter(m => belongs(m, key)).map(m => m.address)).size : mailbox.messages.filter(m => belongs(m, key) && (key === 'inbox' ? !m.seen : true)).length;
    const button = el('button', 'nav-button'); button.setAttribute('aria-current', key === view ? 'page' : 'false');
    button.append(el('span', 'nav-icon', icon), el('span', '', name));
    if (count) button.append(el('span', 'nav-count', count));
    button.addEventListener('click', () => { view = key; $('#search').value = ''; render(); }); node.append(button);
  }
}
function dateLabel(ms) {
  const date = new Date(ms);
  return new Date().toDateString() === date.toDateString() ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function avatar(from) { return el('span', 'avatar', initials(from)); }
function messageRow(message) {
  const row = el('article', `message-row${message.seen ? ' seen' : ''}`), button = el('button', 'message-main');
  const top = el('span', 'message-top'); top.append(el('span', 'sender', displayName(message.from)), el('time', 'message-date', dateLabel(message.date)));
  button.append(top, el('span', 'subject', message.subject), el('span', 'preview', message.snippet));
  button.setAttribute('aria-label', `${message.seen ? '' : 'Unread: '}${message.from}: ${message.subject}`);
  button.addEventListener('click', () => action(() => openMessage(message.id)));
  row.append(avatar(message.from), button); return row;
}
function screenCard(messages) {
  const first = messages[0], card = el('article', 'screen-card'), top = el('div', 'screen-top'), identity = el('div');
  identity.append(el('h2', '', displayName(first.from)), el('p', '', `${first.address || 'Unrecognized email address'} · ${messages.length} message${messages.length === 1 ? '' : 's'}`));
  top.append(avatar(first.from), identity); card.append(top, el('p', 'screen-subject', first.subject), el('p', 'screen-snippet', first.snippet));
  const controls = el('div', 'screen-actions');
  for (const destination of ['inbox', 'reading', 'records', 'blocked']) {
    const button = el('button', '', destination === 'inbox' ? 'Welcome in' : destinations[destination]); button.disabled = !first.address;
    button.addEventListener('click', () => action(async () => { mailbox = await api('/api/rule', { email: first.address, destination }); render(); notice(`${displayName(first.from)} → ${destinations[destination]}`); })); controls.append(button);
  }
  const preview = el('button', '', 'Read first'); preview.addEventListener('click', () => action(() => openMessage(first.id))); controls.append(preview); card.append(controls); return card;
}
function render() {
  nav(); const [title, description, symbol, eyebrow] = views[view];
  $('#view-title').textContent = title; $('#view-description').textContent = description; $('#view-symbol').textContent = symbol; $('#eyebrow').textContent = eyebrow;
  const query = $('#search').value.trim().toLowerCase();
  const messages = mailbox.messages.filter(m => belongs(m, view) && (!query || `${m.from} ${m.subject} ${m.snippet}`.toLowerCase().includes(query)));
  $('#loaded-count').textContent = `${mailbox.messages.length} loaded`; $('#older').hidden = !mailbox.hasMore;
  const list = $('#messages'); list.replaceChildren();
  if (!messages.length) {
    const empty = el('div', 'empty'); empty.append(el('span', 'empty-symbol', view === 'screen' ? '⌁' : '◇'), el('h2', '', query ? 'Nothing here matches yet.' : view === 'screen' ? 'A welcoming front door.' : 'A little space to breathe.'), el('p', '', query ? 'Try a different name or subject. Search covers the messages loaded into Letterlane.' : view === 'screen' ? 'New senders will appear here. You decide where their messages belong.' : mailbox.messages.length ? 'Screen a sender in Front door, or choose another view.' : 'Refresh mail to load your recent Gmail messages.')); list.append(empty);
  } else if (view === 'screen') {
    const groups = new Map(); for (const m of messages) { if (!groups.has(m.address)) groups.set(m.address, []); groups.get(m.address).push(m); }
    for (const group of groups.values()) list.append(screenCard(group));
  } else if (view === 'reading') {
    for (const m of messages) { const card = el('article', 'reading-card'), button = el('button', 'quiet-button', 'Settle in & read →'); card.append(el('p', 'eyebrow', displayName(m.from)), el('h2', '', m.subject), el('p', '', m.snippet), button); button.addEventListener('click', () => action(() => openMessage(m.id))); list.append(card); }
  } else {
    const newMessages = messages.filter(m => !m.seen), seen = messages.filter(m => m.seen);
    if (newMessages.length) { list.append(el('div', 'section-label', 'WAITING FOR YOU')); newMessages.forEach(m => list.append(messageRow(m))); }
    if (seen.length) { list.append(el('div', 'section-label', 'ALREADY READ')); seen.forEach(m => list.append(messageRow(m))); }
  }
  $('#compose').disabled = !mailbox.canSend; $('#refresh').disabled = syncBusy;
}
async function sync(older = false) {
  if (syncBusy) return; syncBusy = true; $('#refresh').disabled = true; $('#refresh').textContent = 'Refreshing…'; $('#older').disabled = true;
  try { mailbox = await api('/api/sync', { older }); render(); notice(status.demo ? 'Demo mailbox · fictional messages. Sending is simulated.' : 'Mail refreshed. Gmail folders and read status are unchanged.'); }
  finally { syncBusy = false; $('#refresh').disabled = false; $('#refresh').textContent = 'Refresh mail'; $('#older').disabled = false; }
}
async function changeState(id, field, value) { mailbox = await api('/api/message-state', { id, field, value }); render(); }
async function openMessage(id) {
  const message = await api(`/api/message/${encodeURIComponent(id)}`); activeMessage = message;
  await changeState(id, 'seen', true);
  const content = $('#reader-content'); content.replaceChildren();
  const header = el('div', 'reader-header'); header.append(el('p', 'eyebrow', 'A LETTER FOR YOU'), el('h1', '', message.subject), el('p', 'reader-meta', `${message.from}\nTo: ${message.to}\n${new Date(message.date).toLocaleString()}`)); content.append(header);
  if (message.htmlFallback) content.append(el('p', 'subtle', 'Text-only preview of an HTML email. Open Gmail for the original formatting.'));
  content.append(el('div', 'reader-body', message.text));
  if (message.attachments?.length) content.append(el('p', 'attachment-note', `Attachments: ${message.attachments.join(', ')}. Open in Gmail to download.`));
  const actions = el('div', 'reader-actions'), state = mailbox.messages.find(m => m.id === id);
  const reply = el('button', 'primary-button', 'Reply'); reply.disabled = !mailbox.canSend;
  reply.addEventListener('click', () => { $('#reader').close(); compose(message); }); actions.append(reply);
  for (const [field, label, active] of [['later', 'Reply later', 'Remove from later'], ['saved', 'Keep close', 'Remove from saved']]) {
    const button = el('button', 'quiet-button', state[field] ? active : label); button.addEventListener('click', () => action(async () => { await changeState(id, field, !state[field]); $('#reader').close(); notice('Saved in Letterlane. Gmail is unchanged.'); })); actions.append(button);
  }
  const select = el('select'); select.setAttribute('aria-label', 'Move all mail from this sender');
  for (const [value, label] of Object.entries(destinations)) { const option = el('option', '', label); option.value = value; select.append(option); }
  select.value = state.destination; select.disabled = !message.address;
  select.addEventListener('change', () => action(async () => { mailbox = await api('/api/rule', { email: message.address, destination: select.value }); render(); $('#reader').close(); notice('Sender rule updated.'); })); actions.append(select); content.append(actions);
  $('#reader-gmail').href = gmailURL(id); $('#reader').showModal();
}
function compose(reply) {
  replyId = reply?.id || null; $('#compose-form').hidden = false; $('#send-review').hidden = true;
  $('#compose-title').textContent = reply ? 'Write a reply' : 'A new letter';
  $('#compose-to').value = reply?.replyTo || ''; $('#compose-subject').value = reply ? (/^re:/i.test(reply.subject) ? reply.subject : `Re: ${reply.subject}`) : ''; $('#compose-body').value = '';
  $('#compose-help').textContent = status.demo ? 'Demo mode. No actual email will be sent.' : `Sending as ${status.owner}. You’ll review the message before sending.`;
  $('#composer').showModal(); (reply ? $('#compose-body') : $('#compose-to')).focus();
}
async function previewSend(event) {
  event.preventDefault();
  await action(async () => {
    const draft = await api('/api/send-preview', { to: $('#compose-to').value, subject: $('#compose-subject').value, body: $('#compose-body').value, replyId });
    const review = $('#send-review'); review.replaceChildren(); review.append(el('h3', '', status.demo ? 'Review your simulated letter' : 'Ready to send?'), el('p', 'review-meta', `From: ${draft.from}\nTo: ${draft.to}`), el('h4', '', draft.subject), el('div', 'review-body', draft.body));
    const actions = el('div', 'review-actions'), edit = el('button', 'quiet-button', 'Keep editing'), send = el('button', 'primary-button', status.demo ? 'Simulate sending' : 'Send through Gmail');
    edit.addEventListener('click', () => { $('#compose-form').hidden = false; review.hidden = true; });
    send.addEventListener('click', async () => {
      if (sending) return; sending = true; send.disabled = true; edit.disabled = true; send.textContent = 'Sending…';
      try { const result = await api('/api/send', { intent: draft.intent }); $('#composer').close(); notice(result.demo ? 'Demo letter sent. No real email left this app.' : 'Sent through Gmail. A copy is in Gmail Sent.'); }
      catch (error) { send.textContent = 'Check Gmail Sent'; review.append(el('p', 'notice error', error.message)); }
      finally { sending = false; }
    }); actions.append(edit, send); review.append(actions); $('#compose-form').hidden = true; review.hidden = false;
  });
}
function settings() {
  $('#connection-description').textContent = status.demo ? 'Fictional demo mailbox. No Google account is connected.' : `Connected as ${status.owner}. ${mailbox.canSend ? 'Reading and sending enabled.' : 'Read-only Gmail access.'}`;
  $('#enable-send').hidden = mailbox.canSend || status.demo; $('#disconnect').hidden = status.demo; $('#logout').hidden = status.demo;
  const rules = $('#rules'); rules.replaceChildren();
  for (const [email, destination] of Object.entries(mailbox.rules)) {
    const row = el('div', 'rule-row'), select = el('select'); select.setAttribute('aria-label', `Rule for ${email}`);
    for (const [value, label] of Object.entries(destinations)) { const option = el('option', '', label); option.value = value; select.append(option); }
    select.value = destination; select.addEventListener('change', () => action(async () => { mailbox = await api('/api/rule', { email, destination: select.value }); render(); })); row.append(el('span', '', email), select); rules.append(row);
  }
  if (!Object.keys(mailbox.rules).length) rules.append(el('p', 'subtle', 'No rules yet. Start at the Front door.'));
  $('#settings').showModal();
}
async function connect(send = false) { const result = await api('/api/connect', { send }); window.location.assign(result.url); }
$('#search').addEventListener('input', render);
$('#refresh').addEventListener('click', () => action(() => sync()));
$('#older').addEventListener('click', () => action(() => sync(true)));
$('#connect').addEventListener('click', () => action(() => connect()));
$('#compose').addEventListener('click', () => compose());
$('#compose-form').addEventListener('submit', previewSend);
$('#settings-button').addEventListener('click', () => { if (status?.authenticated) settings(); });
$('#close-reader').addEventListener('click', () => $('#reader').close());
$('#close-settings').addEventListener('click', () => $('#settings').close());
$('#close-composer').addEventListener('click', () => { if (!sending && (!$('#compose-body').value.trim() || window.confirm('Discard this unsent message?'))) $('#composer').close(); });
$('#composer').addEventListener('cancel', event => { if (sending || ($('#compose-body').value.trim() && !window.confirm('Discard this unsent message?'))) event.preventDefault(); });
$('#enable-send').addEventListener('click', () => action(() => connect(true)));
$('#logout').addEventListener('click', () => action(async () => { await api('/api/logout', {}); window.location.reload(); }));
$('#disconnect').addEventListener('click', () => action(async () => { if (window.confirm('Disconnect Letterlane and revoke its Google access? Your Gmail messages will remain unchanged.')) { await api('/api/disconnect', {}); window.location.reload(); } }));
try {
  status = await api('/api/status');
  $('#mode-label').textContent = status.demo ? 'DEMO · FICTIONAL MAILBOX' : 'PRIVATE GMAIL WORKSPACE';
  $('#welcome').hidden = status.authenticated; $('#mailbox').hidden = !status.authenticated;
  if (!status.authenticated) {
    nav(); $('#connect').disabled = !status.configured;
    if (!status.configured) $('#setup-copy').textContent = 'This server is ready. Add your own Google OAuth credentials to config.local.json on your Mac, following the README, then restart to connect.';
  } else {
    mailbox = await api('/api/mail'); render();
    if (status.demo) notice('Demo mailbox · fictional messages. Sending is simulated.');
    else if (!mailbox.messages.length) await sync();
  }
} catch (error) { notice(error.message, true); }
