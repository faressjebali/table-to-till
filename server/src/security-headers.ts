import type { RequestHandler } from 'express';

// En-têtes de sécurité sur toutes les réponses : API, menu QR et app staff.
// Les deux apps ne chargent rien d'ailleurs (scripts, photos, temps réel : même adresse).
// 'unsafe-inline' pour les styles seulement : React pose des attributs style={…}.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const securityHeaders: RequestHandler = (req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  // Le jeton de table est dans l'adresse du menu QR (/t/<jeton>) : jamais envoyé ailleurs.
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // HTTPS seulement (staging, production) ; derrière l'hébergeur, req.secure dépend de TRUST_PROXY.
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
};
