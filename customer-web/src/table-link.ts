/**
 * Jeton du lien imprimé sur le QR : `/t/<tableToken>` (docs/api.md § 3), sous le chemin de l'app
 * (`base`, `/` sauf pour la démo en ligne).
 */
export function tableTokenFromPath(
  pathname: string,
  base: string = import.meta.env.BASE_URL,
): string | null {
  const path =
    base !== '/' && pathname.startsWith(base) ? pathname.slice(base.length - 1) : pathname;
  const match = /^\/t\/([^/]+)\/?$/.exec(path);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}
