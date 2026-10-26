"""Faux serveur pour les tests : la file caisse comme `server/src/pos/routes.ts`, sans réseau."""

import json
import re

import httpx

CLE = 'cle-de-test'


class FauxServeur:
    def __init__(self, taches: list[dict] | None = None):
        self.taches = {t['id']: {**t, 'status': t.get('status', 'queued')} for t in taches or []}
        self.appels: list[tuple[str, str, dict | None]] = []
        self.heartbeats: list[dict] = []
        # Nombre de prochains appels qui échouent comme si le serveur était arrêté.
        self.coupures = 0
        # Tâches que le serveur refuse au `start` (409), comme si une autre avait été prise.
        self.refus_start: set[int] = set()

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._repondre)

    def statut(self, tache_id: int) -> str:
        return self.taches[tache_id]['status']

    def chemins(self) -> list[str]:
        return [f'{m} {c}' for m, c, _ in self.appels if c != '/pos/heartbeat']

    def _repondre(self, requete: httpx.Request) -> httpx.Response:
        if self.coupures > 0:
            self.coupures -= 1
            raise httpx.ConnectError('serveur arrêté', request=requete)
        if requete.headers.get('X-Agent-Key') != CLE:
            return httpx.Response(401, json={'error': {'code': 'UNAUTHORIZED'}})
        chemin = requete.url.path.removeprefix('/api')
        corps = json.loads(requete.content) if requete.content else None
        self.appels.append((requete.method, chemin, corps))

        if chemin == '/pos/heartbeat':
            self.heartbeats.append(corps or {})
            return httpx.Response(204)
        if chemin == '/pos/jobs/next':
            if any(t['status'] == 'in_progress' for t in self.taches.values()):
                return httpx.Response(204)
            prete = next((t for t in self.taches.values() if t['status'] == 'queued'), None)
            return httpx.Response(200, json=prete) if prete else httpx.Response(204)
        action = re.fullmatch(r'/pos/jobs/(\d+)/(start|done|fail)', chemin)
        if not action:
            return httpx.Response(404, json={'error': {'code': 'NOT_FOUND'}})
        tache = self.taches.get(int(action.group(1)))
        if tache is None:
            return httpx.Response(404, json={'error': {'code': 'NOT_FOUND'}})
        verbe = action.group(2)
        statut = tache['status']
        if verbe == 'start':
            if statut == 'in_progress':
                return httpx.Response(200, json=tache)
            if statut != 'queued' or tache['id'] in self.refus_start:
                return httpx.Response(409, json={'error': {'code': 'INVALID_STATUS'}})
            tache['status'] = 'in_progress'
        elif verbe == 'done':
            if statut not in ('in_progress', 'done'):
                return httpx.Response(409, json={'error': {'code': 'INVALID_STATUS'}})
            tache['status'] = 'done'
        else:
            if statut not in ('in_progress', 'failed'):
                return httpx.Response(409, json={'error': {'code': 'INVALID_STATUS'}})
            tache['status'] = 'failed'
            tache['lastError'] = (corps or {}).get('error')
            tache['lastStep'] = (corps or {}).get('step')
        return httpx.Response(200, json=tache)
