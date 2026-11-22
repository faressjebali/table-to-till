// Construit le site de démo statique : page d'accueil, menu QR (menu/) et app staff (staff/),
// en mode `demo` (faux serveur dans le navigateur, aucune requête vers un backend).
//   node demo/scripts/build-site.mjs [base]   base : `/` en local, `/<dépôt>/` sur GitHub Pages
// Sortie : demo/dist/. Il faut `npm ci` dans customer-web/ et staff-app/.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const base = (process.argv[2] ?? '/').replace(/\/?$/, '/');
const out = join(root, 'demo', 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const [app, dir] of [
  ['customer-web', 'menu'],
  ['staff-app', 'staff'],
]) {
  execFileSync(
    'npx',
    ['vite', 'build', '--mode', 'demo', '--base', `${base}${dir}/`, '--outDir', join(out, dir)],
    { cwd: join(root, app), stdio: 'inherit', shell: process.platform === 'win32' },
  );
}

const hub = readFileSync(join(root, 'demo', 'site', 'index.html'), 'utf8').replaceAll(
  '%BASE%',
  base,
);
writeFileSync(join(out, 'index.html'), hub);
cpSync(join(root, 'demo', 'site', 'assets'), join(out, 'assets'), { recursive: true });
// GitHub Pages renvoie 404.html pour toute adresse inconnue : les liens de table du menu QR
// (`menu/t/<jeton>`) s'ouvrent donc avec l'app du menu, qui lit le jeton dans l'adresse.
cpSync(join(out, 'menu', 'index.html'), join(out, '404.html'));
writeFileSync(join(out, '.nojekyll'), '');
console.log(`Démo construite dans demo/dist/ (base ${base})`);
