// ---------------------------------------------------------------------------
// تونل ساختگی برای آزمون — جای cloudflared را می‌گیرد
//
// یک پروکسی TLS واقعی بالا می‌آورد که به پورت مقصد وصل می‌شود، دقیقاً مثل
// cloudflared یک آدرس https چاپ می‌کند (به‌همراه همان بنر پرحرفِ اصلی تا مطمئن
// شویم آدرس اشتباهی برداشته نمی‌شود) و روی پا می‌ماند.
//
//   node test/fake-tunnel.mjs <targetPort> <certDir>
// ---------------------------------------------------------------------------
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const targetPort = Number(process.argv[2]);
const certDir = process.argv[3];

const keyFile = path.join(certDir, 'key.pem');
const certFile = path.join(certDir, 'cert.pem');

if (!fs.existsSync(certFile)) {
  fs.mkdirSync(certDir, { recursive: true });
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyFile, '-out', certFile,
    '-days', '2', '-subj', '/CN=localhost',
  ], { stdio: 'ignore' });
}

const server = tls.createServer(
  { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) },
  (clientSocket) => {
    const upstream = net.connect(targetPort, '127.0.0.1', () => {
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  }
);

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  // همان بنری که cloudflared چاپ می‌کند — با آدرس‌هایی که نباید انتخاب شوند
  console.error('INF Thank you for trying Cloudflare Tunnel. See https://www.cloudflare.com/website-terms/');
  console.error('INF For production use a named tunnel: https://developers.cloudflare.com/cloudflare-one/');
  console.error('INF Requesting new quick Tunnel on trycloudflare.com...');
  console.error(`INF |  https://127.0.0.1:${port}  |`);
  console.error('INF Registered tunnel connection');
});

process.on('SIGTERM', () => process.exit(0));
