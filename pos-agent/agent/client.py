"""Appels de l'agent au serveur (docs/api.md § 7), avec l'en-tête `X-Agent-Key`."""

from typing import Any

import httpx

Tache = dict[str, Any]


class ServeurInjoignable(Exception):
    """Réseau coupé, serveur arrêté ou en erreur (5xx) : réessayer plus tard."""


class ReponseInattendue(Exception):
    """Le serveur refuse la demande (4xx) : la réessayer ne changera rien."""

    def __init__(self, statut: int, code: str):
        super().__init__(f'{statut} {code}')
        self.statut = statut
        self.code = code


class Client:
    def __init__(
        self,
        server_url: str,
        agent_key: str,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 10,
    ):
        self._http = httpx.Client(
            base_url=server_url.rstrip('/'),
            headers={'X-Agent-Key': agent_key},
            transport=transport,
            timeout=timeout,
        )

    def fermer(self) -> None:
        self._http.close()

    def _envoyer(self, methode: str, chemin: str, corps: Any = None) -> httpx.Response:
        try:
            reponse = self._http.request(methode, chemin, json=corps)
        except httpx.HTTPError as err:
            raise ServeurInjoignable(type(err).__name__) from err
        if reponse.status_code >= 500:
            raise ServeurInjoignable(f'HTTP {reponse.status_code}')
        return reponse

    @staticmethod
    def _refus(reponse: httpx.Response) -> ReponseInattendue:
        try:
            code = str(reponse.json().get('error', {}).get('code', ''))
        except ValueError:
            code = ''
        return ReponseInattendue(reponse.status_code, code)

    def prochaine_tache(self) -> Tache | None:
        """La tâche `queued` la plus ancienne, ou None (rien, ou une tâche déjà en cours)."""
        reponse = self._envoyer('GET', '/pos/jobs/next')
        if reponse.status_code == 204:
            return None
        if reponse.status_code != 200:
            raise self._refus(reponse)
        return reponse.json()

    def commencer(self, tache_id: int) -> bool:
        """False si le serveur la refuse (409 : plus prête, ou une autre est en cours)."""
        reponse = self._envoyer('POST', f'/pos/jobs/{tache_id}/start')
        if reponse.status_code == 409:
            return False
        if reponse.status_code != 200:
            raise self._refus(reponse)
        return True

    # `done` et `fail` sont rejouables côté serveur : les renvoyer après une coupure est sûr.
    def terminer(self, tache_id: int) -> None:
        reponse = self._envoyer('POST', f'/pos/jobs/{tache_id}/done')
        if reponse.status_code != 200:
            raise self._refus(reponse)

    def echouer(self, tache_id: int, erreur: str, etape: str) -> None:
        reponse = self._envoyer(
            'POST', f'/pos/jobs/{tache_id}/fail', {'error': erreur[:100], 'step': etape[:200]}
        )
        if reponse.status_code != 200:
            raise self._refus(reponse)

    def heartbeat(self, etat: str, tache_id: int | None = None) -> None:
        corps: dict[str, Any] = {'state': etat}
        if tache_id is not None:
            corps['jobId'] = tache_id
        reponse = self._envoyer('POST', '/pos/heartbeat', corps)
        if reponse.status_code != 204:
            raise self._refus(reponse)
