"""Ce que l'agent fait d'une tâche dans LegacyPOS.

Le pilotage de l'interface (pywinauto) arrive plus tard derrière cette interface ; les tests
utilisent une fausse caisse.
"""

from typing import Protocol

from .client import Tache


class EchecCaisse(Exception):
    """La tâche n'a pas pu être faite : code envoyé au serveur (`error`) et étape (`step`)."""

    def __init__(self, erreur: str, etape: str):
        super().__init__(f'{erreur} ({etape})')
        self.erreur = erreur
        self.etape = etape


class Caisse(Protocol):
    def executer(self, tache: Tache) -> None:
        """Fait la tâche dans la caisse, ou lève EchecCaisse sans jamais deviner."""
        ...


class CaisseNonSupportee:
    """Pour l’instant : aucun type de tâche n'est saisi, chaque tâche échoue proprement."""

    def executer(self, tache: Tache) -> None:
        raise EchecCaisse('UNSUPPORTED_JOB', f'type {tache.get("type")}')
