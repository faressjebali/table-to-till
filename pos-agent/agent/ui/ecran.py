"""Contrat de la couche d'interface. Chaque méthode correspond à un contrôle de `docs/pos.md`."""

from dataclasses import dataclass
from typing import Literal, Protocol

Etat = Literal['fermee', 'pin', 'plan', 'saisie', 'inconnu']


@dataclass(frozen=True)
class Article:
    """Bouton d'article : sans nom, deux textes (le code, puis le nom en caisse)."""

    code: str
    nom: str


@dataclass(frozen=True)
class Ligne:
    """Ligne de `gridLines` : quantité, article, active (pas encore envoyée)."""

    quantite: str
    article: str
    active: bool


class Ecran(Protocol):
    def etat(self) -> Etat:
        """`fermee` (pas de LegacyPOS), `plan` (fenêtre « Sélection de table »), `pin` (`fieldPin`),
        `saisie` (`labelTable`), sinon `inconnu`."""
        ...

    def message(self) -> str | None:
        """Texte d'une fenêtre inattendue (message de la caisse, « Warning »…), sinon None."""
        ...

    def taper_pin(self, pin: str) -> None: ...

    def toucher_table(self, numero: str) -> bool:
        """Bouton du plan dont un texte vaut le numéro ; False s'il n'existe pas."""
        ...

    def choix_ticket_ouvert(self) -> bool:
        """« Choisir un ticket » : la table a plusieurs tickets ouverts."""
        ...

    def fermer_choix_ticket(self) -> None: ...

    def table_ouverte(self) -> str | None:
        """Texte de `labelTable`."""
        ...

    def categories(self) -> list[str]:
        """Textes des boutons de catégorie affichés (page « Page 1 » ou « Page 2 »)."""
        ...

    def toucher_categorie(self, texte: str) -> bool: ...

    def articles(self) -> list[Article]:
        """Boutons d'article de la catégorie affichée."""
        ...

    def toucher_article(self, code: str) -> bool: ...

    def ecrire_pave(self, valeur: str) -> None:
        """Écrit dans `fieldKeypad` (le pavé ne répond pas à Invoke)."""
        ...

    def lignes(self) -> list[Ligne]: ...

    def commander(self) -> None:
        """VALIDER (`btnSend`)."""
        ...

    def choix_option_ouvert(self) -> bool:
        """« Choisir une action » (fenêtre possédée par la principale)."""
        ...

    def choisir_plan(self) -> None:
        """`btnFloorPlan` de « Choisir une action »."""
        ...

    def sortir(self) -> None:
        """QUITTER (`btnQuit`) : lignes non envoyées abandonnées, retour à l'écran PIN."""
        ...
