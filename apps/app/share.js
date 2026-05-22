/**
 * share.js — avvia il server preview e stampa un QR code nel terminale.
 * Uso: npm run share
 * Il Rabbit R1 (o qualsiasi dispositivo sulla stessa rete) può scansionare
 * il QR code e aprire/installare il gioco direttamente nel browser.
 */

import { networkInterfaces } from 'os';
import { spawn } from 'child_process';
import qrcode from 'qrcode-terminal';

const PORT = 4173;

// Ricava tutti gli IP IPv4 locali non-loopback
function getLocalIPs() {
  const nets = networkInterfaces();
  const results = [];
  for (const [name, ifaces] of Object.entries(nets)) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        results.push({ ip: iface.address, name });
      }
    }
  }
  return results;
}

const localIPs = getLocalIPs();

// Avvia vite preview sull'host 0.0.0.0 (raggiungibile da rete locale)
// Su Windows usa cmd /c per evitare problemi con .cmd
const isWin = process.platform === 'win32';
const [cmd, args] = isWin
  ? ['cmd', ['/c', 'npx', 'vite', 'preview', '--host', '0.0.0.0', '--port', String(PORT)]]
  : ['npx', ['vite', 'preview', '--host', '0.0.0.0', '--port', String(PORT)]];

const preview = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

preview.stdout.on('data', (data) => process.stdout.write(data));
preview.stderr.on('data', (data) => process.stderr.write(data));
preview.on('error', (err) => { console.error('Errore avvio server:', err.message); process.exit(1); });
preview.on('close', (code) => process.exit(code ?? 0));

// Dopo che il server è pronto, stampa istruzioni + QR code
setTimeout(() => {
  console.log('\n');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║      🦄  UNICORN CLOUD JUMP           ║');
  console.log('  ║      Pronto per il Rabbit R1          ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('\n  1. Connetti il Rabbit R1 alla stessa rete WiFi');
  console.log('  2. Scansiona il QR code con la camera del R1\n');

  if (localIPs.length === 0) {
    console.log('  Nessun IP di rete trovato. Apri: http://localhost:' + PORT + '/');
  } else {
    for (const { ip, name } of localIPs) {
      const url = `http://${ip}:${PORT}/`;
      console.log(`  [${name}]  ${url}\n`);
      qrcode.generate(url, { small: true });
    }
  }

  console.log('\n  Per installare il gioco offline: apri il link nel browser');
  console.log('  del R1 e usa "Aggiungi alla schermata home" / "Install app".');
  console.log('\n  (premi Ctrl+C per fermare il server)\n');
}, 1800);
