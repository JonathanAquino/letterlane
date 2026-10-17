# Letterlane

A personal Gmail workspace with a front door for unfamiliar senders, a focused inbox, a reading room, and a place for receipts. Original code and design. Not affiliated with Google, HEY, or 37signals.

**Prototype, for one person's private use.** Source availability does not make the running app public: host it on localhost or behind a private Tailscale connection. No Gmail credentials or personal email are included in this repository. No Gmail account was connected during development.

## Try the fictional mailbox

Requires Node.js 24 or later (tested with Node 26). No third-party runtime dependencies or package installation required.

```sh
git clone https://github.com/JonathanAquino/letterlane.git
cd letterlane
npm run demo
```

Open **http://127.0.0.1:4317**. Demo mail is fictional. The demo send button simulates delivery; it cannot send real mail. Demo and live data use separate local directories.

```sh
npm test
npm run check
```

## What works

- Sender-level screening: Inbox, Reading room, Records, or Screen out. Rules apply to exact addresses, including alias addresses as received.
- New and already-read sections, local Reply later and Keep close lists, sender-rule management, search of loaded messages, and pagination through the last 90 days.
- Text-only message reading with attachment names and an Open in Gmail link. Raw email HTML never executes in the app.
- Optional plain-text composing and replies through Gmail, with a separate Google send permission and a review screen before every send.
- A mobile layout, web app manifest, and original icon for use from a Mac browser or iPhone Home Screen.

Read status, screening, and organization are **local to Letterlane**. They do not mark messages read, archive, label, trash, block, or delete anything in Gmail. Gmail continues to receive and filter mail normally. Replies sent through Gmail appear in Gmail Sent.

## Connect your Gmail on a Mac

Use your own Google Cloud project and OAuth web application credentials. Do not reuse tokens from another app, an automation, or a password manager.

1. Enable the Gmail API in your Google Cloud project.
2. Configure Google OAuth consent for your own account. Add yourself as a test user while developing.
3. Create an OAuth client of type **Web application**. For local use, register the exact redirect URI `http://127.0.0.1:4317/auth/callback`.
4. Copy `config.example.json` to `config.local.json`. Set `ownerEmail`, `googleClientId`, and `googleClientSecret`. Keep its file permissions private:

   ```sh
   cp config.example.json config.local.json
   chmod 600 config.local.json
   ```

5. Start `npm start`. Open the configured origin, click **Connect Gmail**, and complete Google's consent screen. Only the exact configured owner email is accepted after server-side verification with Google.
6. Initially grant `gmail.readonly` plus basic identity scopes. In Settings, **Enable sending through Gmail** requests the additional `gmail.send` permission. Declining send permission leaves sending unavailable.

Gmail authorization tokens are saved only in **macOS Keychain**, under service `Letterlane Gmail OAuth` and your configured owner email. First-time Keychain access may prompt you. There is no plaintext token-file fallback. Configuration files and `.data/` are git-ignored. The client secret in `config.local.json` is a local secret; never commit or upload it.

Google's external OAuth **Testing** mode normally expires refresh tokens after seven days for Gmail scopes. For ongoing personal use, review Google's production/personal-use exception requirements rather than treating Testing as permanent deployment. An unverified-app warning is possible. Follow Google's legitimate consent flow; this app does not bypass verification or Workspace administrator controls.

## Access privately from an iPhone with Tailscale

Install Tailscale on your Mac and iPhone and sign them into your private tailnet. Enable HTTPS for the tailnet. Configure a grant that limits this Mac's app port to your intended identity/devices; the default tailnet policy can be broader. Consider device approval.

1. Set up Tailscale Serve (not Funnel) to proxy the local server:

   ```sh
   tailscale serve --bg http://127.0.0.1:4317
   ```

2. Use the HTTPS `.ts.net` origin printed by Tailscale as `origin` in `config.local.json` (no path or trailing slash). Register that origin's exact `/auth/callback` URI in your Google OAuth client. Restart Letterlane. Tailscale's proxy must preserve the configured Host header; requests with other hosts are rejected.
3. Open that private HTTPS address in Safari on the iPhone with Tailscale connected. Sign in to the configured owner account, then use **Share > Add to Home Screen**. On the Mac, Safari supports **Add to Dock**.

No router port forwarding or public tunnel is needed. `tailscale funnel` would expose the service publicly and is not this deployment design. The Mac must stay awake, online, and running Letterlane. Turning the screen off is fine. If the Mac is unavailable, Gmail remains usable normally.

Only the web app shell is installable; this version has no offline mail cache, service worker, or background push notifications. The iPhone fetches from the Mac while the app is open. Use Gmail notifications if desired. Manual Refresh loads recent mail; loading 100 new messages can take time.

## Security design and limits

Read the [privacy policy](public/privacy.html), also available at `/privacy` on your server before signing in.

- Loopback-only server binding. Explicit configured Host checks reduce DNS rebinding exposure. Tailscale is an access layer, not a replacement for application authentication.
- Owner-only Google identity verification, expiring one-use OAuth state and PKCE, server-side sessions, CSRF validation, same-origin requests, and HttpOnly/SameSite cookies (Secure over HTTPS).
- Read-only Gmail scope and a separate optional send scope. No Gmail modify/delete scope. No automatic email sending or AI-driven actions.
- Tokens stay out of browser storage, source code, URLs, logs, and the local database. The Keychain CLI receives token material over stdin, not command arguments.
- No external scripts, fonts, analytics, or message tracking images. Strict Content Security Policy. All received content is rendered with `textContent`; HTML-only mail receives a deliberately limited plain-text conversion.
- No message bodies stored on disk. Loaded message headers/snippets are held in memory until the process exits. Sender addresses, Gmail message IDs, local flags, and minimal send receipts persist in a SQLite file with owner-only permissions. This database is **not application-encrypted**: use FileVault and encrypted backups. Resetting the local database removes your screening decisions.
- Sending requires a server-generated preview followed by a one-use confirmation. A send reservation is persisted before calling Google. Network errors are treated as uncertain delivery, and the same intent is never retried. Check Gmail Sent before composing another copy after an uncertain result.
- Sender approval is not authentication proof. A spoofed From address can still be misleading. Gmail's authentication and spam filtering remain important.
- Disconnect revokes the app's Google grant and removes its Keychain item. Signing out only closes the current browser session; it leaves the server's grant intact. Remove Letterlane in Google Account > Third-party connections if the app is inaccessible.

Before relying on this for sensitive daily mail, review the implementation and test with your own account. Automated tests cover the application boundary and mock Gmail behavior; they do not establish that the real Google/Keychain/Tailscale setup works on your machines. Deployment and actual Gmail consent are intentionally separate from building the app.

## Current boundaries

No calendar, contact import, rich HTML composer, attachments in outgoing mail, offline mail, automatic background sync, native app, Gmail send-as aliases, or full Gmail search. Refresh loads received mail from the last 90 days; it excludes Sent, Spam, Trash, and Drafts. Already-loaded metadata may remain until restart even if Gmail changes elsewhere. A fresh process reloads current Gmail metadata. Rule and local status persistence do not depend on keeping a browser open.

The app uses generic workflow concepts with independent naming, copy, visual design, icon, and implementation. Private/public repository visibility does not itself determine copyright compliance. The Letterlane name has not received a formal trademark clearance.

## Sources

- [Gmail API overview](https://developers.google.com/workspace/gmail/api/guides)
- [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Google OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)
- [OAuth personal-use verification exceptions](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)
- [Canadian software IP guidance](https://ised-isde.canada.ca/site/canadian-intellectual-property-office/en/intellectual-property-rights-software-canada)

## License

MIT. See [LICENSE](LICENSE).
