"""Saisie d'une commande (`enter_order`), encaissement (`pay_table`) et addition (`print_bill`)
dans LegacyPOS, d'après `docs/pos.md`.

L'agent ne tape jamais de code : il ouvre la catégorie de chaque article et touche le bouton qui
porte son code (`posCode`). Notes et choix des formules ne vont jamais en caisse. Avant chaque
étape il vérifie l'écran ; sinon il s'arrête sans deviner. Une saisie interrompue avant VALIDER
est abandonnée par QUITTER, pour ne jamais laisser de lignes non envoyées.
"""

import logging
import re
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
# Boutons de la page « Paiement ». Pour UI Automation, ils ressemblent à des
# catégories ; la caisse garde la page affichée d'une table à l'autre. L'agent ne les prend
# jamais pour des catégories, et ne touche CARTE que pour un encaissement demandé.
REGLEMENT = {
    'ESPECES',
    'CARTE',
    'ESPECES_AUTRE',
    'REMISE STAFF',
    'TRANSFERT',
    'CHANGER',
    'PARTAGE',
    'PASSATION',
    'MULTI_PAIEMENT',
}
# Ligne affichée après le bouton (SolderAsync) : nom du règlement.
LIGNE_APRES = {'cash': 'CASH', 'card': 'CARD', 'bill': 'TMP'}


def millimes(texte: str | None) -> int | None:
    """`fieldTotal` : « 17,000 TND » → 17000 ; None si illisible."""
    trouve = re.fullmatch(r'\s*(-?)(\d+),(\d{3})\s*TND\s*', texte or '')
    if trouve is None:
        return None
    montant = int(trouve.group(2)) * 1000 + int(trouve.group(3))
    return -montant if trouve.group(1) else montant


def en_dinars(montant: int) -> str:
    signe = '-' if montant < 0 else ''
    return f'{signe}{abs(montant) // 1000},{abs(montant) % 1000:03d} TND'


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
        type_ = tache.get('type')
        if type_ == 'enter_order':
            self._saisir_commande(tache)
        elif type_ == 'pay_table' and tache.get('method') in ('cash', 'card'):
            self._regler(tache, str(tache['method']))
        elif type_ == 'print_bill':
            self._regler(tache, 'bill')
        else:
            raise EchecCaisse(
                'UNSUPPORTED_JOB', f'type {type_} {tache.get("method") or ""}'.strip()
            )

    def _categories(self) -> list[str]:
        """Catégories affichées, sans les boutons de « Paiement »."""
        return [c for c in self._ecran.categories() if c not in REGLEMENT]

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
            categories = self._categories()
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
        categories = self._categories()
        if page == PAGE_1 and 'Page 1' in categories:
            self._ecran.toucher_categorie('Page 1')
        elif page == PAGE_2 and 'Page 2' in categories:
            self._ecran.toucher_categorie('Page 2')
        else:
            return
        bouton = 'Page 2' if page == PAGE_1 else 'Page 1'
        self._attendre(lambda: bouton in self._categories(), 'SCREEN_UNEXPECTED', f'page {page}')

    def _afficher(self, categorie: str) -> list[Article]:
        """Touche la catégorie et rend ses articles (une catégorie peut être vide)."""
        if categorie in REGLEMENT:
            raise EchecCaisse('SCREEN_UNEXPECTED', f"« {categorie} » n'est pas une catégorie")
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
            for categorie in self._categories():
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

    # --- Encaissement et addition ------------------------------------------------------------

    def _regler(self, tache: Tache, mode: str) -> None:
        """`cash` (Espèces), `card` (Paiement → CARTE) ou `bill` (NOTE). Avant de
        toucher l'argent : table avec des lignes, toutes envoyées, et `fieldTotal` = `expectedTotal` ;
        sinon QUITTER, rien n'est encaissé."""
        table = str(tache['tableNumber'])
        attendu = int(tache['expectedTotal'])
        quoi = 'addition' if mode == 'bill' else f'encaissement {mode}'
        self._vers_plan()
        self._ouvrir_table(table)
        try:
            self._verifier_avant_reglement(table, attendu)
            if mode == 'card':
                self._ecran.toucher_categorie('Paiement')
                self._attendre(
                    lambda: 'CARTE' in self._ecran.categories(),
                    'SCREEN_UNEXPECTED',
                    'page Paiement',
                )
        except EchecCaisse:
            self._journal.warning('%s de la table %s abandonné (QUITTER)', quoi, table)
            self._sortir()
            raise
        if mode == 'cash':
            # Un nombre resté au pavé compterait comme montant donné (monnaie rendue).
            self._ecran.ecrire_pave('')
            self._ecran.especes()
        elif mode == 'card':
            self._ecran.toucher_categorie('CARTE')
        else:
            self._ecran.addition()
        # Le bouton est touché : plus de QUITTER, un humain vérifie en cas de doute.
        erreur = 'BILL_UNCONFIRMED' if mode == 'bill' else 'PAYMENT_UNCONFIRMED'
        etape = f'{quoi} de la table {table}'
        self._attendre(self._ecran.choix_option_ouvert, erreur, etape)
        ligne = LIGNE_APRES[mode]

        def confirme() -> bool:
            lignes = self._ecran.lignes()
            return bool(lignes) and lignes[-1].article.strip() == ligne

        self._attendre(confirme, erreur, f'{etape} : ligne « {ligne} » absente')
        self._ecran.choisir_plan()
        self._attendre(lambda: self._ecran.etat() == 'plan', erreur, f'{etape} : retour au plan')
        self._journal.info('%s de la table %s fait (%s)', quoi, table, en_dinars(attendu))

    def _verifier_avant_reglement(self, table: str, attendu: int) -> None:
        try:
            self._attendre(lambda: bool(self._ecran.lignes()), 'EMPTY_TABLE', f'table {table}')
        except EchecCaisse as err:
            if err.erreur != 'EMPTY_TABLE':
                raise
            raise EchecCaisse('EMPTY_TABLE', f'table {table} sans article en caisse') from err
        if any(ligne.active for ligne in self._ecran.lignes()):
            raise EchecCaisse('UNSENT_LINES', f'table {table} : lignes pas encore envoyées')
        texte = self._ecran.net()
        net = millimes(texte)
        if net is None:
            raise EchecCaisse('SCREEN_UNEXPECTED', f'fieldTotal illisible : {texte!r}')
        if net != attendu:
            raise EchecCaisse(
                'TOTAL_MISMATCH', f'fieldTotal {en_dinars(net)} ≠ attendu {en_dinars(attendu)}'
            )
