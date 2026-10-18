import { createApp } from './app.js';
import { ensureFirstManager } from './auth/bootstrap.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { startExpirySweep } from './orders/expiry.js';

const port = Number(process.env.PORT ?? 3000);
const config = loadConfig();
const db = createPool();

if ((await ensureFirstManager(db, config)) === 'created') {
  console.log(`Premier compte manager créé : ${config.firstManagerLogin}`);
}

// Commandes QR non confirmées à temps → expirées.
startExpirySweep(db);

createApp({ db, config }).listen(port, () => {
  console.log(`API sur http://localhost:${String(port)}/api`);
});
