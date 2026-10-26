import logging

import pytest

from agent.caisse import EchecCaisse
from agent.legacy import CaisseLegacy, regrouper
from agent.ui.ecran import Article, Ligne

from .fausse_legacy import PAGES, FausseLegacy

JOURNAL = logging.getLogger('test-legacy')


def caisse(legacy: FausseLegacy) -> CaisseLegacy:
    return CaisseLegacy(legacy, '4321', JOURNAL, delai=0.2, pause=lambda _: None)


def commande(table: int, *lignes: tuple[str, int]) -> dict:
    return {
        'id': 1,
        'type': 'enter_order',
        'tableNumber': table,
        'lines': [
            {'orderLineId': i, 'posCode': c, 'quantity': q} for i, (c, q) in enumerate(lignes)
        ],
    }


def echec(legacy: FausseLegacy, tache: dict) -> EchecCaisse:
    with pytest.raises(EchecCaisse) as err:
        caisse(legacy).executer(tache)
    return err.value


def test_regrouper_une_touche_par_code_dans_l_ordre():
    lignes = [
        {'posCode': '10', 'quantity': 2},
        {'posCode': '11', 'quantity': 1},
        {'posCode': '10', 'quantity': 1},
    ]
    assert regrouper(lignes) == [('10', 3), ('11', 1)]


def test_pin_puis_commande_puis_retour_au_plan():
    legacy = FausseLegacy()
    caisse(legacy).executer(commande(7, ('10', 2), ('11', 1), ('10', 1), ('64', 1)))
    assert legacy.commandes == [
        (
            '7',
            [
                Ligne('3', 'Express', True),
                Ligne('1', 'CARAFE EAU 1L ', True),
                Ligne('1', 'Mini Burger Cookie', True),
            ],
        )
    ]
    assert legacy.etat() == 'plan'
    assert legacy.actions[:2] == ['pin', 'table 7']
    # Jamais VALIDER avant la fin de la saisie, ni QUITTER.
    assert legacy.actions.count('VALIDER') == 1
    assert 'QUITTER' not in legacy.actions


def test_depuis_le_plan_sans_pin_et_index_garde_d_une_commande_a_l_autre():
    legacy = FausseLegacy(etat='plan')
    agent = caisse(legacy)
    agent.executer(commande(5, ('11', 1)))
    nb = len(legacy.actions)
    agent.executer(commande(5, ('14', 1)))
    assert 'pin' not in legacy.actions
    # Deuxième commande : pas de nouveau tour des catégories.
    assert legacy.actions[nb:] == ['table 5', 'catégorie Cafes', 'article 14', 'VALIDER']


def test_autre_type_de_tache_non_supporte():
    erreur = echec(FausseLegacy(), {'id': 1, 'type': 'pay_table', 'tableNumber': 5})
    assert erreur.erreur == 'UNSUPPORTED_JOB'


@pytest.mark.parametrize(
    ('etat', 'message', 'code'),
    [
        ('fermee', None, 'POS_CLOSED'),
        ('saisie', None, 'SCREEN_UNEXPECTED'),
        (
            'plan',
            'Warning — La table sélectionné est ouvert par autre serveur.',
            'SCREEN_UNEXPECTED',
        ),
    ],
)
def test_ecran_inattendu_avant_la_tache(etat, message, code):
    legacy = FausseLegacy(etat=etat)
    legacy.message_ = message
    erreur = echec(legacy, commande(5, ('10', 1)))
    assert erreur.erreur == code
    assert legacy.actions == []


def test_pin_refuse():
    legacy = FausseLegacy(pin='0000')
    assert echec(legacy, commande(5, ('10', 1))).erreur == 'PIN_REFUSED'


def test_table_absente_ou_a_plusieurs_tickets():
    legacy = FausseLegacy(etat='plan')
    assert echec(legacy, commande(99, ('10', 1))).erreur == 'TABLE_NOT_FOUND'
    legacy.plusieurs_tickets.add('5')
    assert echec(legacy, commande(5, ('10', 1))).erreur == 'MULTIPLE_TICKETS'
    assert not legacy.choix_ticket_ouvert()
    assert legacy.commandes == []


def test_fresh_blends_affiche_express_sortir_et_nouveau_pin():
    legacy = FausseLegacy()
    legacy.bug_fresh_blends = 1
    caisse(legacy).executer(commande(7, ('40', 1)))
    assert legacy.actions[:4] == ['pin', 'table 7', 'QUITTER', 'pin']
    assert legacy.commandes == [('7', [Ligne('1', 'Iced Matcha', True)])]


def test_fresh_blends_toujours_express_echec_sans_rien_taper():
    legacy = FausseLegacy()
    legacy.bug_fresh_blends = 2
    assert echec(legacy, commande(7, ('40', 1))).erreur == 'CATEGORY_LABEL_BUG'
    assert not any(a.startswith('article') for a in legacy.actions)
    assert legacy.etat() == 'pin'


def test_code_inconnu_index_refait_une_fois_puis_abandon():
    legacy = FausseLegacy(etat='plan')
    erreur = echec(legacy, commande(5, ('11', 1), ('999', 1)))
    assert erreur.erreur == 'UNKNOWN_CODE'
    # Deux tours des catégories (index, puis index refait), puis QUITTER : rien n'est commandé.
    assert legacy.actions.count('catégorie Soupes') == 2
    assert legacy.actions[-1] == 'QUITTER'
    assert legacy.commandes == []


def test_nouvel_article_trouve_en_refaisant_l_index(monkeypatch):
    legacy = FausseLegacy(etat='plan')
    agent = caisse(legacy)
    agent.executer(commande(5, ('10', 1)))
    # La manager crée un article en caisse après le démarrage de l'agent.
    nouveaux = {**PAGES['page1'], 'Soupes': [Article('77', 'Soupe')]}
    monkeypatch.setitem(PAGES, 'page1', nouveaux)
    agent.executer(commande(5, ('77', 1)))
    assert legacy.commandes[-1] == ('5', [Ligne('1', 'Soupe', True)])


def test_ligne_qui_n_apparait_pas_abandon():
    legacy = FausseLegacy(etat='plan')
    legacy.sans_effet.add('11')
    assert echec(legacy, commande(5, ('10', 1), ('11', 1))).erreur == 'LINE_NOT_ADDED'
    assert legacy.actions[-1] == 'QUITTER'
    assert legacy.commandes == []


def test_commande_sans_choisissez_une_option_pas_de_sortir():
    legacy = FausseLegacy(etat='plan')
    legacy.choix_option_ouvert = lambda: False
    assert echec(legacy, commande(5, ('10', 1))).erreur == 'COMMANDE_UNCONFIRMED'
    # Après VALIDER, un humain vérifie : l'agent ne sort pas.
    assert 'QUITTER' not in legacy.actions
