"""Réglages de l'agent, lus dans `pos-agent/.env` (modèle : `pos-agent/.env.example`)."""

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import dotenv_values

DOSSIER_AGENT = Path(__file__).resolve().parent.parent


class ConfigInvalide(Exception):
    pass


@dataclass(frozen=True)
class Config:
    server_url: str
    # Secrets : jamais affichés (repr) ni journalisés.
    agent_key: str = field(repr=False)
    legacy_pin: str = field(repr=False)
    idle_seconds: float = 5
    poll_seconds: float = 5
    heartbeat_seconds: float = 10
    logs_dir: Path = DOSSIER_AGENT / 'logs'

    @property
    def socket_url(self) -> str:
        """Socket.IO est à la racine du serveur, l'API sous `/api` (docs/api.md § 8)."""
        url = self.server_url.rstrip('/')
        return url[: -len('/api')] if url.endswith('/api') else url


def _nombre(valeurs: dict[str, str | None], nom: str, defaut: float) -> float:
    brut = valeurs.get(nom) or ''
    if brut.strip() == '':
        return defaut
    try:
        nombre = float(brut)
    except ValueError as err:
        raise ConfigInvalide(f'{nom} doit être un nombre') from err
    if nombre <= 0:
        raise ConfigInvalide(f'{nom} doit être positif')
    return nombre


def charger(env_path: Path | None = None) -> Config:
    """`pos-agent/.env` d'abord ; l'environnement ne complète qu'une valeur absente du fichier.

    Un éditeur peut charger le `.env` de la racine (serveur) dans ses terminaux : ses variables
    homonymes (`SERVER_URL` sans `/api`…) ne doivent pas remplacer celles de l'agent.
    """
    chemin = env_path or DOSSIER_AGENT / '.env'
    valeurs: dict[str, str | None] = dict(dotenv_values(chemin)) if chemin.exists() else {}
    for nom in ('SERVER_URL', 'AGENT_KEY', 'LEGACY_PIN', 'AGENT_IDLE_SECONDS', 'AGENT_POLL_SECONDS'):
        if not valeurs.get(nom) and os.environ.get(nom):
            valeurs[nom] = os.environ[nom]
    manquantes = [n for n in ('SERVER_URL', 'AGENT_KEY', 'LEGACY_PIN') if not valeurs.get(n)]
    if manquantes:
        raise ConfigInvalide(f'À remplir dans {chemin} : {", ".join(manquantes)}')
    return Config(
        server_url=str(valeurs['SERVER_URL']).rstrip('/'),
        agent_key=str(valeurs['AGENT_KEY']),
        legacy_pin=str(valeurs['LEGACY_PIN']),
        idle_seconds=_nombre(valeurs, 'AGENT_IDLE_SECONDS', 5),
        poll_seconds=_nombre(valeurs, 'AGENT_POLL_SECONDS', 5),
    )
