import { createServer } from 'node:http';
import { createApp } from './app.js';
import { ensureFirstManager } from './auth/bootstrap.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { startExpirySweep } from './orders/expiry.js';
import { webPushSender } from './push/send.js';
import { createRealtime } from './realtime.js';
import { startShiftAutoEnd } from './shifts/auto-end.js';

const port = Number(process.env.PORT ?? 3000);
const config = loadConfig();
const db = createPool();

if ((await ensureFirstManager(db, config)) === 'created') {
  console.log(`Premier compte manager créé : ${config.firstManagerLogin}`);
}
if (config.agentKey === '') console.warn("AGENT_KEY vide : l'agent caisse sera refusé");

// Un seul serveur HTTP pour l'API et Socket.IO (docs/api.md § 8). Socket.IO ne transmet
// /socket.io qu'à lui-même : l'API doit être l'écouteur `request` déjà en place quand il s'attache.
const server = createServer((req, res) => {
  app(req, res);
});
const realtime = createRealtime(server, { db, config });
const push = webPushSender(config);
if (!push) console.warn('Clés VAPID absentes : aucune notification push');
const app = createApp({ db, config, realtime, ...(push ? { push } : {}) });

// Commandes QR non confirmées à temps → expirées.
startExpirySweep(db, realtime);
// Shifts oubliés → terminés dans la nuit.
startShiftAutoEnd(db, realtime, config.shiftAutoEndTime);

server.listen(port, () => {
  console.log(`API sur http://localhost:${String(port)}/api`);
});
