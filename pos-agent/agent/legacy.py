"""Saisie d'une commande dans LegacyPOS (`enter_order`), d'après `docs/pos.md`.

L'agent ne tape jamais de code : il ouvre la catégorie de chaque article et touche le bouton qui
porte son code (`posCode`). Notes et choix des formules ne vont jamais en caisse. Avant chaque
étape il vérifie l'écran ; sinon il s'arrête sans deviner. Une saisie interrompue avant VALIDER
est abandonnée par QUITTER, pour ne jamais laisser de lignes non envoyées.
"""

import logging
import time
from collections.abc import Callable

from .caisse import EchecCaisse
from .client import Tache
from .ui.ecran import Article, Ecran, Ligne

PAGE_1 = 'page1'
PAGE_2 = 'page2'
# Boutons de catégorie qui ne sont pas des catégories d'articles.
NAVIGATION = {'Paiement', 'Page 2', 'Page 1'}
FRESH_BLENDS = 'FRESH BLENDS'


def regrouper(lignes: list[dict]) -> list[tuple[str, int]]:
    """Une touche par code : quantités additionnées, dans l'ordre de la commande."""
    total: dict[str, int] = {}
    for ligne in lignes:
        code = str(ligne['posCode'])
        total[code] = total.get(code, 0) + int(ligne['quantity'])
    return list(total.items())


class CaisseLegacy:
    def __init__(
        self,
        ecran: Ecran,
        pin: str,
        journal: logging.Logger,
        delai: float = 10,
        pause: Callable[[float], None] = time.sleep,
    ):
        self._ecran = ecran
        self._pin = pin
        self._journal = journal
        self._delai = delai
        self._pause = pause
        # Code → (page, catégorie), construit au premier besoin en parcourant les catégories.
        self._index: dict[str, tuple[str, str]] | None = None

    def executer(self, tache: Tache) -> None:
        if tache.get('type') != 'enter_order':
            raise EchecCaisse('UNSUPPORTED_JOB', f'type {tache.get("type")}')
        self._saisir_commande(tache)

    # --- Attente -----------------------------------------------------------------------------

    def _attendre(self, condition: Callable[[], bool], erreur: str, etape: str) -> None:
        fin = time.monotonic() + self._delai
        while True:
            if condition():
                return
            message = self._ecran.message()
            if message is not None:
                raise EchecCaisse('SCREEN_UNEXPECTED', f'{etape} : {message}')
            if time.monotonic() >= fin:
                raise EchecCaisse(erreur, etape)
            self._pause(0.1)

    # --- Commande ----------------------------------------------------------------------------

    def _saisir_commande(self, tache: Tache) -> None:
        table = str(tache['tableNumber'])
        lignes = regrouper(tache.get('lines') or [])
        if not lignes:
            raise EchecCaisse('EMPTY_ORDER', 'aucune ligne')
        self._vers_plan()
        self._ouvrir_table(table)
        try:
            self._verifier_fresh_blends(table)
            for code, quantite in lignes:
                self._saisir_ligne(code, quantite)
        except EchecCaisse:
            # Rien n'est encore envoyé : QUITTER abandonne les lignes tapées.
            self._journal.warning('saisie de la table %s abandonnée (QUITTER)', table)
            self._sortir()
            raise
        self._commander(table)

    def _vers_plan(self) -> None:
        etat = self._ecran.etat()
        message = self._ecran.message()
        if etat == 'fermee':
            raise EchecCaisse('POS_CLOSED', "LegacyPOS n'est pas ouvert")
        if message is not None:
            raise EchecCaisse('SCREEN_UNEXPECTED', f'avant la tâche : {message}')
        if etat == 'pin':
            self._ecran.taper_pin(self._pin)
            self._attendre(lambda: self._ecran.etat() == 'plan', 'PIN_REFUSED', 'écran PIN')
        elif etat != 'plan':
            raise EchecCaisse('SCREEN_UNEXPECTED', f'avant la tâche : écran {etat}')

    def _ouvrir_table(self, table: str) -> None:
        if not self._ecran.toucher_table(table):
            raise EchecCaisse('TABLE_NOT_FOUND', f'table {table} absente du plan')

        def ouverte() -> bool:
            return self._ecran.choix_ticket_ouvert() or (
                self._ecran.etat() == 'saisie' and self._ecran.table_ouverte() == table
            )

        self._attendre(ouverte, 'SCREEN_UNEXPECTED', f'ouverture de la table {table}')
        if self._ecran.choix_ticket_ouvert():
            # Plusieurs tickets : lequel compléter arrive plus tard. Le plan reste ouvert.
            self._ecran.fermer_choix_ticket()
            raise EchecCaisse('MULTIPLE_TICKETS', f'table {table} : plusieurs tickets ouverts')

    def _verifier_fresh_blends(self, table: str) -> None:
        """Bug connu : le bouton « FRESH BLENDS » s'affiche « Express ». Seul remède (Fares, 26/10) :
        QUITTER, retaper le PIN, rouvrir la table. Un essai, sinon échec."""
        for essai in range(2):
            self._page(PAGE_1)
            categories = self._ecran.categories()
            if FRESH_BLENDS in categories or 'Express' not in categories:
                return
            if essai == 1:
                raise EchecCaisse('CATEGORY_LABEL_BUG', '« FRESH BLENDS » toujours affiché « Express »')
            self._journal.warning('bouton FRESH BLENDS affiché « Express » : QUITTER et nouveau PIN')
            if not self._sortir():
                raise EchecCaisse('SCREEN_UNEXPECTED', "QUITTER sans retour à l'écran PIN")
            self._vers_plan()
            self._ouvrir_table(table)
            # L'index a pu être construit avec le bug : il est refait.
            self._index = None

    def _sortir(self) -> bool:
        """QUITTER, puis l'écran PIN attendu (True s'il revient)."""
        self._ecran.sortir()
        fin = time.monotonic() + self._delai
        while time.monotonic() < fin:
            if self._ecran.etat() == 'pin':
                return True
            self._pause(0.1)
        return False

    def _page(self, page: str) -> None:
        categories = self._ecran.categories()
        if page == PAGE_1 and 'Page 1' in categories:
            self._ecran.toucher_categorie('Page 1')
        elif page == PAGE_2 and 'Page 2' in categories:
            self._ecran.toucher_categorie('Page 2')
        else:
            return
        bouton = 'Page 2' if page == PAGE_1 else 'Page 1'
        self._attendre(
            lambda: bouton in self._ecran.categories(), 'SCREEN_UNEXPECTED', f'page {page}'
        )

    def _afficher(self, categorie: str) -> list[Article]:
        """Touche la catégorie et rend ses articles (une catégorie peut être vide)."""
        avant = self._ecran.articles()
        if not self._ecran.toucher_categorie(categorie):
            raise EchecCaisse('SCREEN_UNEXPECTED', f'catégorie « {categorie} » introuvable')
        fin = time.monotonic() + 1
        while time.monotonic() < fin:
            apres = self._ecran.articles()
            if apres != avant:
                return apres
            self._pause(0.05)
        return self._ecran.articles()

    def _construire_index(self) -> dict[str, tuple[str, str]]:
        index: dict[str, tuple[str, str]] = {}
        for page in (PAGE_1, PAGE_2):
            self._page(page)
            for categorie in self._ecran.categories():
                if categorie in NAVIGATION:
                    continue
                for article in self._afficher(categorie):
                    index.setdefault(article.code, (page, categorie))
        self._page(PAGE_1)
        self._journal.info('index des codes : %s articles', len(index))
        return index

    def _trouver(self, code: str) -> Article:
        """Affiche la catégorie de l'article et rend son bouton. Un code introuvable fait refaire
        l'index une fois (nouvel article créé en caisse), puis échoue."""
        refait = False
        while True:
            if self._index is None:
                self._index = self._construire_index()
                refait = True
            if code in self._index:
                page, categorie = self._index[code]
                self._page(page)
                article = next((a for a in self._afficher(categorie) if a.code == code), None)
                if article is not None:
                    return article
            if refait:
                raise EchecCaisse('UNKNOWN_CODE', f'code {code} absent de la caisse')
            self._index = None

    def _saisir_ligne(self, code: str, quantite: int) -> None:
        article = self._trouver(code)
        avant = self._ecran.lignes()
        if quantite > 1:
            self._ecran.ecrire_pave(str(quantite))
        if not self._ecran.toucher_article(code):
            raise EchecCaisse('UNKNOWN_CODE', f'bouton du code {code} disparu')
        attendue = Ligne(str(quantite), article.nom.strip(), True)

        def ajoutee() -> bool:
            lignes = self._ecran.lignes()
            if lignes == avant or not lignes:
                return False
            derniere = lignes[-1]
            return Ligne(derniere.quantite, derniere.article.strip(), derniere.active) == attendue

        self._attendre(ajoutee, 'LINE_NOT_ADDED', f'code {code} × {quantite}')
        self._journal.info('code %s × %s saisi', code, quantite)

    def _commander(self, table: str) -> None:
        self._ecran.commander()
        # Après VALIDER, les lignes sont peut-être envoyées : on ne SORT plus, un humain vérifie.
        self._attendre(
            self._ecran.choix_option_ouvert, 'COMMANDE_UNCONFIRMED', f'VALIDER de la table {table}'
        )
        self._ecran.choisir_plan()
        self._attendre(
            lambda: self._ecran.etat() == 'plan',
            'COMMANDE_UNCONFIRMED',
            f'retour au plan après la table {table}',
        )
