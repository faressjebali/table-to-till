"""`Ecran` réalisé avec pywinauto (backend `uia`), sous Windows seulement.

Contrôles et fenêtres de `docs/pos.md` : trouvés par AutomationId, nom ou texte contenu, jamais
par coordonnées. Les boutons de table, de catégorie et d'article n'ont pas de nom : on les
reconnaît à leurs textes.
"""

from pywinauto import Desktop
from pywinauto.base_wrapper import BaseWrapper
from pywinauto.findwindows import ElementNotFoundError

from .ecran import Article, Etat, Ligne

PRINCIPALE = 'Caisse principale'
PLAN = 'Sélection de table'
CHOIX_OPTION = 'Choisir une action'
OUVRIR_TICKET = 'Choisir un ticket'
CONNUES = {PRINCIPALE, PLAN, CHOIX_OPTION, OUVRIR_TICKET}


def _textes(element: BaseWrapper) -> list[str]:
    return [t.window_text() for t in element.children(control_type='Text')]


class EcranUia:
    def __init__(self) -> None:
        self._bureau = Desktop(backend='uia')

    # --- Fenêtres ----------------------------------------------------------------------------

    def _principale(self) -> BaseWrapper | None:
        fenetres = self._bureau.windows(title=PRINCIPALE, control_type='Window')
        return fenetres[0] if fenetres else None

    def _fenetres_du_processus(self) -> list[BaseWrapper]:
        principale = self._principale()
        if principale is None:
            return []
        return self._bureau.windows(process=principale.process_id())

    def _fenetre(self, titre: str) -> BaseWrapper | None:
        return next((f for f in self._fenetres_du_processus() if f.window_text() == titre), None)

    def _possedees(self) -> list[BaseWrapper]:
        """« Choisir une action » et les messages : sous la principale dans UI Automation."""
        principale = self._principale()
        return principale.children(control_type='Window') if principale else []

    def _controle(self, auto_id: str, parent: BaseWrapper | None = None) -> BaseWrapper | None:
        racine = parent or self._principale()
        if racine is None:
            return None
        spec = self._bureau.window(handle=racine.handle).child_window(auto_id=auto_id)
        try:
            return spec.wrapper_object() if spec.exists(timeout=0) else None
        except ElementNotFoundError:
            return None

    # --- État --------------------------------------------------------------------------------

    def etat(self) -> Etat:
        if self._principale() is None:
            return 'fermee'
        if self._fenetre(PLAN) is not None:
            return 'plan'
        if self._controle('labelTable') is not None:
            return 'saisie'
        if self._controle('fieldPin') is not None:
            return 'pin'
        return 'inconnu'

    def message(self) -> str | None:
        for fenetre in self._possedees():
            if fenetre.window_text() == CHOIX_OPTION:
                continue
            texte = self._controle('labelMessage', fenetre)
            titre = self._controle('labelTitle', fenetre)
            morceaux = [w.window_text() for w in (titre, texte) if w is not None]
            return ' — '.join(m for m in morceaux if m) or 'fenêtre inattendue'
        for fenetre in self._fenetres_du_processus():
            if fenetre.window_text() not in CONNUES:
                textes = [t.window_text() for t in fenetre.descendants(control_type='Text')]
                return ' — '.join([fenetre.window_text(), *[t for t in textes if t]])
        return None

    # --- PIN et plan -------------------------------------------------------------------------

    def taper_pin(self, pin: str) -> None:
        champ = self._controle('fieldPin')
        bouton = self._controle('btnSignIn')
        if champ is None or bouton is None:
            return
        champ.iface_value.SetValue(pin)
        bouton.invoke()

    def toucher_table(self, numero: str) -> bool:
        plan = self._fenetre(PLAN)
        if plan is None:
            return False
        for bouton in plan.descendants(control_type='Button'):
            if numero in _textes(bouton):
                bouton.invoke()
                return True
        return False

    def choix_ticket_ouvert(self) -> bool:
        return self._fenetre(OUVRIR_TICKET) is not None

    def fermer_choix_ticket(self) -> None:
        fenetre = self._fenetre(OUVRIR_TICKET)
        bouton = self._controle('btnCancel', fenetre) if fenetre else None
        if bouton is not None:
            bouton.invoke()

    # --- Saisie ------------------------------------------------------------------------------

    def table_ouverte(self) -> str | None:
        titre = self._controle('labelTable')
        return titre.window_text() if titre is not None else None

    def _boutons_sans_nom(self) -> list[tuple[BaseWrapper, list[str]]]:
        """Catégories et articles : sans nom **et sans AutomationId**. VALIDER, NOTE, NOTE et
        Espèces n'ont pas de nom non plus, mais un AutomationId (`btnSend`…) : jamais touchés ici."""
        principale = self._principale()
        if principale is None:
            return []
        resultat = []
        for bouton in principale.descendants(control_type='Button'):
            if bouton.window_text() != '' or bouton.element_info.automation_id != '':
                continue
            textes = _textes(bouton)
            if textes:
                resultat.append((bouton, textes))
        return resultat

    def categories(self) -> list[str]:
        return [textes[0] for _, textes in self._boutons_sans_nom() if len(textes) == 1]

    def toucher_categorie(self, texte: str) -> bool:
        for bouton, textes in self._boutons_sans_nom():
            if textes == [texte]:
                bouton.invoke()
                return True
        return False

    def articles(self) -> list[Article]:
        return [Article(t[0], t[1]) for _, t in self._boutons_sans_nom() if len(t) == 2]

    def toucher_article(self, code: str) -> bool:
        for bouton, textes in self._boutons_sans_nom():
            if len(textes) == 2 and textes[0] == code:
                bouton.invoke()
                return True
        return False

    def ecrire_pave(self, valeur: str) -> None:
        champ = self._controle('fieldKeypad')
        if champ is not None:
            champ.iface_value.SetValue(valeur)

    def lignes(self) -> list[Ligne]:
        grille = self._controle('gridLines')
        if grille is None:
            return []
        lignes = []
        for rangee in grille.children(control_type='DataItem'):
            cellules = rangee.children(control_type='Custom')
            if len(cellules) < 2:
                continue
            quantite = cellules[0].children()
            article = cellules[1].children()
            lignes.append(
                Ligne(
                    quantite[0].window_text() if quantite else '',
                    article[0].window_text() if article else '',
                    rangee.is_enabled(),
                )
            )
        return lignes

    def commander(self) -> None:
        bouton = self._controle('btnSend')
        if bouton is not None:
            bouton.invoke()

    def net(self) -> str | None:
        champ = self._controle('fieldTotal')
        return champ.window_text() if champ is not None else None

    def especes(self) -> None:
        bouton = self._controle('btnCash')
        if bouton is not None:
            bouton.invoke()

    def addition(self) -> None:
        bouton = self._controle('btnBill')
        if bouton is not None:
            bouton.invoke()

    def choix_option_ouvert(self) -> bool:
        return any(f.window_text() == CHOIX_OPTION for f in self._possedees())

    def choisir_plan(self) -> None:
        fenetre = next((f for f in self._possedees() if f.window_text() == CHOIX_OPTION), None)
        bouton = self._controle('btnFloorPlan', fenetre) if fenetre else None
        if bouton is not None:
            bouton.invoke()

    def sortir(self) -> None:
        bouton = self._controle('btnQuit')
        if bouton is not None:
            bouton.invoke()
