"""Socket.IO : le serveur prévient l'agent d'une nouvelle tâche (`pos:job`, docs/api.md § 8).

Ce n'est qu'un réveil : la boucle redemande aussi la file toutes les quelques secondes, au cas où
la connexion temps réel serait coupée.
"""

import logging
import threading

import socketio


def ecouter(url: str, agent_key: str, reveil: threading.Event, journal: logging.Logger) -> None:
    """Connecte en arrière-plan ; python-socketio se reconnecte seul après une coupure."""
    sio = socketio.Client(reconnection=True, reconnection_delay_max=30, logger=False)

    @sio.on('pos:job')
    def _tache(_donnees: object) -> None:
        reveil.set()

    @sio.event
    def connect() -> None:
        journal.info('temps réel connecté')
        # Une tâche a pu arriver pendant la coupure.
        reveil.set()

    @sio.event
    def disconnect(*_raison: object) -> None:
        journal.warning('temps réel déconnecté')

    def connecter() -> None:
        try:
            sio.connect(url, auth={'agentKey': agent_key}, retry=True)
        except socketio.exceptions.ConnectionError as err:
            journal.error(
                'temps réel indisponible (%s) : la file est relue toutes les quelques secondes', err
            )

    threading.Thread(target=connecter, name='temps-reel', daemon=True).start()
