// Les tests tournent sous Node (Vitest), l'app non : seulement ce dont les tests ont besoin, sans
// ajouter les types de Node à toute l'app.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
