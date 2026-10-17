const now = Date.now();
const fixtures = [
  ['a1', 'Maya Chen <maya@example.com>', 'maya@example.com', 'A walk on Saturday?', 'The forecast looks promising. Would you like to meet at the park around ten?', 12],
  ['a2', 'Luca Patel <luca@example.net>', 'luca@example.net', 'A small thing that made me think of you', 'I found that old photograph from our trip. I will bring it when we get together.', 47],
  ['b1', 'The Weekend Journal <editor@example.org>', 'editor@example.org', 'Small discoveries for a slower weekend', 'This week: a good book, a quiet trail, and an unexpectedly excellent soup.', 90],
  ['c1', 'Cedar Books <orders@example.com>', 'orders@example.com', 'Your books are on their way', 'Your order has shipped. Your receipt and delivery details are available in your account.', 130],
  ['d1', 'Morgan Ellis <morgan@example.net>', 'morgan@example.net', 'The neighbourhood garden', 'Hello! I help organize the community garden. We would love to hear your ideas.', 24],
  ['d2', 'Morgan Ellis <morgan@example.net>', 'morgan@example.net', 'One more detail about the garden', 'Our next gathering is next month. There is no rush to reply.', 60],
  ['e1', 'Avery Wilson <avery@example.org>', 'avery@example.org', 'Notes for our next conversation', 'Here are three ideas to consider before we meet. Looking forward to catching up.', 180],
  ['f1', 'Jun Park <jun@example.com>', 'jun@example.com', 'A recipe worth keeping', 'Roast the vegetables, simmer with stock, and finish with a little lemon. Simple and lovely.', 220]
];
export class DemoGmail {
  constructor() {
    this.messages = new Map(fixtures.map(([id, from, address, subject, text, minutes]) => [id, { id, from, address, subject, text, replyTo: address, to: 'you@example.com', threadId: id, date: now - minutes * 60000, snippet: text, messageId: `<${id}@example.com>`, references: '', labels: ['INBOX'], attachments: [] }]));
    this.lastSync = now; this.nextPage = null; this.sent = [];
  }
  canSend() { return true; }
  async sync() { this.lastSync = Date.now(); }
  async message(id) { if (!this.messages.has(id)) throw Object.assign(new Error('Message not found.'), { status: 404 }); return this.messages.get(id); }
  async send(gmail) { const receipt = { id: `demo${this.sent.length + 1}` }; this.sent.push({ ...gmail, ...receipt }); return receipt; }
  async disconnect() {}
}
