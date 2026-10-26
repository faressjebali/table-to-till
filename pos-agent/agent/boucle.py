"""Boucle de l'agent : file unique, heartbeat, reprise après une coupure (docs/api.md § 7).

Règle d'or : une tâche commencée n'est **jamais** refaite. Si l'agent s'arrête en pleine tâche
(plantage, PC redémarré), il la signale en échec au démarrage suivant ; les serveurs la
réessaient ou la marquent faite à la main.
"""

import json
import logging
import threading
from collections.abc import Callable
from pathlib import Path

from .caisse import Caisse, EchecCaisse
from .client import Client, ReponseInattendue, ServeurInjoignable, Tache

# Délais entre deux essais quand le serveur ne répond pas (secondes).
DELAIS = (1, 2, 5, 10, 30)


class Agent:
    def __init__(
        self,
        client: Client,
        caisse: Caisse,
        fichier_en_cours: Path,
        journal: logging.Logger,
        poll_seconds: float = 5,
        heartbeat_seconds: float = 10,
        arret: threading.Event | None = None,
        reveil: threading.Event | None = None,
    ):
        self._client = client
        self._caisse = caisse
        self._fichier = fichier_en_cours
        self._journal = journal
        self._poll = poll_seconds
        self._battement = heartbeat_seconds
        self.arret = arret or threading.Event()
        # `pos:job` (Socket.IO) le lève : la boucle demande tout de suite la tâche suivante.
        self.reveil = reveil or threading.Event()
        self._verrou = threading.Lock()
        self._etat = 'idle'
        self._tache_id: int | None = None

    def arreter(self) -> None:
        self.arret.set()
        self.reveil.set()

    # --- Heartbeat -----------------------------------------------------------------------

    def _changer_etat(self, etat: str, tache_id: int | None) -> None:
        with self._verrou:
            self._etat = etat
            self._tache_id = tache_id
        self.battre()

    def battre(self) -> None:
        """Un heartbeat : `busy` avec la tâche en cours, sinon `idle`. Sans serveur : rien."""
        with self._verrou:
            etat, tache_id = self._etat, self._tache_id
        try:
            self._client.heartbeat(etat, tache_id)
        except ServeurInjoignable:
            pass
        except ReponseInattendue as err:
            self._journal.error('heartbeat refusé : %s', err)

    def _battre_en_continu(self) -> None:
        while not self.arret.wait(self._battement):
            self.battre()

    # --- Envoi au serveur ----------------------------------------------------------------

    def _jusqu_a_reussite(self, quoi: str, envoi: Callable[[], None]) -> bool:
        """Réessaie tant que le serveur ne répond pas. False si l'agent s'arrête avant."""
        essai = 0
        while True:
            try:
                envoi()
                return True
            except ServeurInjoignable as err:
                delai = DELAIS[min(essai, len(DELAIS) - 1)]
                essai += 1
                self._journal.warning(
                    '%s : serveur injoignable (%s), nouvel essai dans %ss', quoi, err, delai
                )
                if self.arret.wait(delai):
                    return False

    # --- Tâche en cours (fichier) ----------------------------------------------------------

    def _noter_en_cours(self, tache: Tache) -> None:
        self._fichier.parent.mkdir(parents=True, exist_ok=True)
        self._fichier.write_text(
            json.dumps({'id': tache['id'], 'type': tache.get('type')}), encoding='utf-8'
        )

    def _oublier_en_cours(self) -> None:
        self._fichier.unlink(missing_ok=True)

    def reprendre(self) -> None:
        """Au démarrage : une tâche restée en cours est signalée en échec, jamais refaite."""
        if not self._fichier.exists():
            return
        try:
            tache_id = int(json.loads(self._fichier.read_text(encoding='utf-8'))['id'])
        except (ValueError, KeyError, TypeError):
            self._journal.error('fichier de tâche en cours illisible, ignoré : %s', self._fichier)
            self._oublier_en_cours()
            return
        self._journal.error(
            "tâche %s interrompue par un arrêt de l'agent : signalée en échec", tache_id
        )
        try:
            if not self._jusqu_a_reussite(
                f'échec de la tâche {tache_id}',
                lambda: self._client.echouer(tache_id, 'AGENT_RESTARTED', "redémarrage de l'agent"),
            ):
                return
        except ReponseInattendue as err:
            # Déjà réglée (AGENT_TIMEOUT, faite à la main…) : rien de plus à faire.
            self._journal.warning('tâche %s déjà réglée côté serveur : %s', tache_id, err)
        self._oublier_en_cours()

    # --- File ------------------------------------------------------------------------------

    def un_tour(self) -> bool:
        """Prend et fait la tâche suivante. False s'il n'y en a pas (ou plus de prête)."""
        tache = self._client.prochaine_tache()
        if tache is None:
            return False
        tache_id = int(tache['id'])
        if not self._client.commencer(tache_id):
            self._journal.info('tâche %s refusée au démarrage (plus prête)', tache_id)
            return False
        self._noter_en_cours(tache)
        self._changer_etat('busy', tache_id)
        self._journal.info(
            'tâche %s commencée : %s, table %s',
            tache_id,
            tache.get('type'),
            tache.get('tableNumber'),
        )
        try:
            self._caisse.executer(tache)
        except EchecCaisse as err:
            resultat = err
        except Exception as err:  # une erreur de l'agent ne doit pas l'arrêter
            self._journal.exception("erreur de l'agent pendant la tâche %s", tache_id)
            resultat = EchecCaisse('AGENT_ERROR', type(err).__name__)
        else:
            resultat = None
        self._signaler(tache_id, resultat)
        self._oublier_en_cours()
        self._changer_etat('idle', None)
        return True

    def _signaler(self, tache_id: int, echec: EchecCaisse | None) -> None:
        if echec is None:
            quoi, envoi = (f'fin de la tâche {tache_id}', lambda: self._client.terminer(tache_id))
            self._journal.info('tâche %s faite', tache_id)
        else:
            quoi = f'échec de la tâche {tache_id}'

            def envoi() -> None:
                self._client.echouer(tache_id, echec.erreur, echec.etape)

            self._journal.warning('tâche %s en échec : %s', tache_id, echec)
        try:
            self._jusqu_a_reussite(quoi, envoi)
        except ReponseInattendue as err:
            # Ex. passée AGENT_TIMEOUT pendant une longue coupure : à vérifier par un humain.
            self._journal.error('%s refusée par le serveur (%s) : à vérifier en caisse', quoi, err)

    def tourner(self) -> None:
        """Jusqu'à `arret` : reprise, heartbeat en continu, puis la file."""
        self.reprendre()
        self.battre()
        threading.Thread(target=self._battre_en_continu, name='heartbeat', daemon=True).start()
        essai = 0
        while not self.arret.is_set():
            try:
                while not self.arret.is_set() and self.un_tour():
                    pass
                essai = 0
                attente = self._poll
            except ServeurInjoignable as err:
                attente = DELAIS[min(essai, len(DELAIS) - 1)]
                essai += 1
                self._journal.warning(
                    'serveur injoignable (%s), nouvel essai dans %ss', err, attente
                )
            except ReponseInattendue as err:
                attente = DELAIS[-1]
                self._journal.error('file refusée par le serveur (%s) : vérifier AGENT_KEY', err)
            self.reveil.wait(attente)
            self.reveil.clear()
