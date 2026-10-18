/** Jeton du lien imprimé sur le QR : `/t/<tableToken>` (docs/api.md § 3). */
export function tableTokenFromPath(pathname: string): string | null {
  const match = /^\/t\/([^/]+)\/?$/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}
