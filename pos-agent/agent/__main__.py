"""Lancement : `python -m agent` depuis `pos-agent/` (réglages dans `pos-agent/.env`)."""

import signal
import sys

from .boucle import Agent
from .caisse import CaisseNonSupportee
from .client import Client
from .config import ConfigInvalide, charger
from .journal import configurer
from .realtime import ecouter


def main() -> int:
    try:
        config = charger()
    except ConfigInvalide as err:
        print(err, file=sys.stderr)
        return 2
    journal = configurer(config.logs_dir)
    journal.info('agent démarré, serveur %s', config.server_url)
    client = Client(config.server_url, config.agent_key)
    agent = Agent(
        client,
        CaisseNonSupportee(),
        config.logs_dir / 'en-cours.json',
        journal,
        poll_seconds=config.poll_seconds,
        heartbeat_seconds=config.heartbeat_seconds,
    )
    signal.signal(signal.SIGINT, lambda *_: agent.arreter())
    signal.signal(signal.SIGTERM, lambda *_: agent.arreter())
    ecouter(config.socket_url, config.agent_key, agent.reveil, journal)
    try:
        agent.tourner()
    finally:
        client.fermer()
        journal.info('agent arrêté')
    return 0


if __name__ == '__main__':
    sys.exit(main())
