import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const service = 'Letterlane Gmail OAuth';

// No shell; token data travels through stdin, never in command arguments or a file.
export class Keychain {
  constructor(account) { this.account = account; }
  async read() {
    if (process.platform !== 'darwin') throw new Error('Live Gmail mode requires macOS Keychain.');
    try {
      const { stdout } = await exec('/usr/bin/security', ['find-generic-password', '-a', this.account, '-s', service, '-w']);
      return JSON.parse(Buffer.from(stdout.trim(), 'base64').toString('utf8'));
    } catch (error) {
      if (error.code === 44) return null;
      throw new Error('Could not read Gmail authorization from Keychain. Unlock your login Keychain and try again.');
    }
  }
  async write(tokens) {
    if (process.platform !== 'darwin') throw new Error('Live Gmail mode requires macOS Keychain.');
    if (!/^[A-Za-z0-9.@_+-]+$/.test(this.account)) throw new Error('Invalid Keychain account.');
    const encoded = Buffer.from(JSON.stringify(tokens)).toString('base64');
    await new Promise((resolve, reject) => {
      const child = execFile('/usr/bin/security', ['-i'], { maxBuffer: 1024 * 1024 }, error => error ? reject(new Error('Could not save authorization to Keychain.')) : resolve());
      child.stdin.end(`add-generic-password -U -a "${this.account}" -s "${service}" -w "${encoded}"\n`);
    });
  }
  async clear() {
    try { await exec('/usr/bin/security', ['delete-generic-password', '-a', this.account, '-s', service]); }
    catch (error) { if (error.code !== 44) throw new Error('Could not remove Gmail authorization from Keychain.'); }
  }
}
