import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';

// Les deux apps construites (`npm run build`), servies par le serveur quand SERVE_WEB=true :
// une seule adresse pour le menu QR (racine, `/t/<jeton>`), l'app staff (staffBasePath) et l'API.
const ROOT = path.join(import.meta.dirname, '../..');
export type WebDirs = { customerWeb: string; staffApp: string };
const BUILT: WebDirs = {
  customerWeb: path.join(ROOT, 'customer-web/dist'),
  staffApp: path.join(ROOT, 'staff-app/dist'),
};

// Les fichiers construits portent un hash dans leur nom (assets/) : jamais modifiés, gardés un an.
// Le reste (index.html, sw.js, manifest) est revérifié à chaque fois : une nouvelle version arrive
// tout de suite.
function staticFiles(dir: string): express.Handler {
  return express.static(dir, {
    index: false,
    setHeaders: (res, file) => {
      const hashed = file.startsWith(path.join(dir, 'assets') + path.sep);
      res.setHeader('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
}

// Toute autre adresse d'une app (`/t/<jeton>`, `/staff/`…) : sa page, l'app lit l'adresse. Un
// fichier absent (`/assets/ancien.js` après un déploiement) reste une erreur 404.
function page(dir: string): express.Handler {
  const index = path.join(dir, 'index.html');
  return (req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || path.extname(req.path) !== '') {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  };
}

export function webRoutes(staffBasePath: string, dirs: WebDirs = BUILT): Router {
  for (const dir of [dirs.customerWeb, dirs.staffApp]) {
    if (!existsSync(path.join(dir, 'index.html'))) {
      throw new Error(`SERVE_WEB=true : ${dir} manquant (construire avec npm run build)`);
    }
  }
  const staff = staffBasePath.slice(0, -1); // « /staff »
  // strict : « /staff » est redirigé, pas « /staff/ ».
  const router = Router({ strict: true });
  router.get(staff, (_req, res) => {
    res.redirect(301, staffBasePath);
  });
  router.use(staff, staticFiles(dirs.staffApp), page(dirs.staffApp));
  router.use(staticFiles(dirs.customerWeb), page(dirs.customerWeb));
  return router;
}
