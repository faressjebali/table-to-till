"""Fausse LegacyPOS en mémoire pour tester `agent.legacy` sans Windows (contrat `Ecran`)."""

from agent.ui.ecran import Article, Etat, Ligne

PAGES = {
    'page1': {
        'Cafes': [Article('10', 'Express'), Article('14', 'Latte macchiato')],
        'FRESH BLENDS': [Article('40', 'Iced Matcha')],
        'EAU': [Article('11', 'CARAFE EAU 1L ')],
        'Soupes': [],
    },
    'page2': {'Kids Menu': [Article('64', 'Mini Burger Cookie')]},
}


class FausseLegacy:
    def __init__(self, pin: str = '4321', etat: Etat = 'pin'):
        self.pin = pin
        self._etat: Etat = etat
        self.page = 'page1'
        self.categorie: str | None = None
        self.table: str | None = None
        self.lignes_: list[Ligne] = []
        self.commandes: list[tuple[str, list[Ligne]]] = []
        self.actions: list[str] = []
        self.message_: str | None = None
        self.tables = {'5', '7'}
        self.plusieurs_tickets: set[str] = set()
        # Nombre de connexions où « FRESH BLENDS » s'affiche « Express ».
        self.bug_fresh_blends = 0
        self.choix_option = False
        self.choix_ticket = False
        # Codes qui n'ajoutent pas de ligne (ex. caisse figée).
        self.sans_effet: set[str] = set()
        self._bug = False
        self._pave = ''

    def etat(self) -> Etat:
        return self._etat

    def message(self) -> str | None:
        return self.message_

    def taper_pin(self, pin: str) -> None:
        self.actions.append('pin')
        if pin == self.pin:
            self._etat = 'plan'
            self._bug = self.bug_fresh_blends > 0
            self.bug_fresh_blends = max(0, self.bug_fresh_blends - 1)

    def toucher_table(self, numero: str) -> bool:
        if self._etat != 'plan' or numero not in self.tables:
            return False
        self.actions.append(f'table {numero}')
        if numero in self.plusieurs_tickets:
            self.choix_ticket = True
            return True
        self.table = numero
        self._etat = 'saisie'
        return True

    def choix_ticket_ouvert(self) -> bool:
        return self.choix_ticket

    def fermer_choix_ticket(self) -> None:
        self.choix_ticket = False

    def table_ouverte(self) -> str | None:
        return self.table if self._etat == 'saisie' else None

    def categories(self) -> list[str]:
        noms = list(PAGES[self.page])
        if self._bug and self.page == 'page1':
            noms = ['Express' if n == 'FRESH BLENDS' else n for n in noms]
        return [*noms, 'Page 2', 'Paiement'] if self.page == 'page1' else [*noms, 'Page 1']

    def toucher_categorie(self, texte: str) -> bool:
        if texte not in self.categories():
            return False
        self.actions.append(f'catégorie {texte}')
        if texte == 'Page 2':
            self.page = 'page2'
        elif texte == 'Page 1':
            self.page = 'page1'
        elif texte != 'Paiement':
            self.categorie = 'FRESH BLENDS' if texte == 'Express' else texte
        return True

    def articles(self) -> list[Article]:
        if self.categorie is None:
            return []
        for page in PAGES.values():
            if self.categorie in page:
                return list(page[self.categorie])
        return []

    def toucher_article(self, code: str) -> bool:
        article = next((a for a in self.articles() if a.code == code), None)
        if article is None:
            return False
        self.actions.append(f'article {code}')
        if code not in self.sans_effet:
            quantite = self._pave or '1'
            self.lignes_.append(Ligne(quantite, article.nom, True))
        self._pave = ''
        return True

    def ecrire_pave(self, valeur: str) -> None:
        self._pave = valeur

    def lignes(self) -> list[Ligne]:
        return list(self.lignes_)

    def commander(self) -> None:
        self.actions.append('VALIDER')
        assert self.table is not None
        self.commandes.append((self.table, [ligne for ligne in self.lignes_ if ligne.active]))
        self.lignes_ = [Ligne(ligne.quantite, ligne.article, False) for ligne in self.lignes_]
        self.choix_option = True

    def choix_option_ouvert(self) -> bool:
        return self.choix_option

    def choisir_plan(self) -> None:
        self.choix_option = False
        self.lignes_ = []
        self._etat = 'plan'

    def sortir(self) -> None:
        self.actions.append('QUITTER')
        self.lignes_ = []
        self.table = None
        self._etat = 'pin'
