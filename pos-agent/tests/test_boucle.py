import json
import logging
import threading

import pytest

from agent import boucle
from agent.boucle import Agent
from agent.caisse import CaisseNonSupportee, EchecCaisse
from agent.client import Client

from .faux_serveur import CLE, FauxServeur

JOURNAL = logging.getLogger('test-agent')


@pytest.fixture(autouse=True)
def sans_attente(monkeypatch):
    # Les nouveaux essais se font tout de suite dans les tests.
    monkeypatch.setattr(boucle, 'DELAIS', (0,))


class FausseCaisse:
    def __init__(self, serveur: FauxServeur, echec: Exception | None = None):
        self.serveur = serveur
        self.echec = echec
        self.faites: list[int] = []

    def executer(self, tache):
        # Pendant la saisie, le serveur voit l'agent occupé sur cette tâche.
        assert self.serveur.heartbeats[-1] == {'state': 'busy', 'jobId': tache['id']}
        self.faites.append(tache['id'])
        if self.echec:
            raise self.echec


def agent(serveur: FauxServeur, caisse, tmp_path) -> Agent:
    client = Client('http://serveur.test/api', CLE, transport=serveur.transport())
    return Agent(client, caisse, tmp_path / 'en-cours.json', JOURNAL)


def test_taches_faites_une_a_une_dans_l_ordre(tmp_path):
    serveur = FauxServeur([{'id': 1, 'type': 'enter_order'}, {'id': 2, 'type': 'print_bill'}])
    caisse = FausseCaisse(serveur)
    a = agent(serveur, caisse, tmp_path)
    assert a.un_tour() and a.un_tour()
    assert not a.un_tour()
    assert caisse.faites == [1, 2]
    assert serveur.statut(1) == serveur.statut(2) == 'done'
    assert serveur.heartbeats[-1] == {'state': 'idle'}
    assert not (tmp_path / 'en-cours.json').exists()


def test_echec_de_la_caisse_signale_avec_erreur_et_etape(tmp_path):
    serveur = FauxServeur([{'id': 5, 'type': 'pay_table'}])
    a = agent(
        serveur, FausseCaisse(serveur, EchecCaisse('TOTAL_MISMATCH', 'lecture de fieldTotal')), tmp_path
    )
    a.un_tour()
    assert serveur.statut(5) == 'failed'
    assert serveur.taches[5]['lastError'] == 'TOTAL_MISMATCH'
    assert serveur.taches[5]['lastStep'] == 'lecture de fieldTotal'


def test_erreur_de_l_agent_signalee_sans_l_arreter(tmp_path):
    serveur = FauxServeur([{'id': 6, 'type': 'enter_order'}, {'id': 7, 'type': 'enter_order'}])
    a = agent(serveur, FausseCaisse(serveur, KeyError('lines')), tmp_path)
    assert a.un_tour() and a.un_tour()
    assert serveur.taches[6]['lastError'] == 'AGENT_ERROR'
    assert serveur.statut(7) == 'failed'


def test_avant_46_chaque_tache_echoue_unsupported_job(tmp_path):
    serveur = FauxServeur([{'id': 8, 'type': 'enter_order'}])
    agent(serveur, CaisseNonSupportee(), tmp_path).un_tour()
    assert serveur.taches[8]['lastError'] == 'UNSUPPORTED_JOB'
    assert serveur.taches[8]['lastStep'] == 'type enter_order'


def test_tache_refusee_au_demarrage_jamais_faite(tmp_path):
    serveur = FauxServeur([{'id': 9, 'type': 'enter_order'}])
    caisse = FausseCaisse(serveur)
    serveur.refus_start.add(9)
    assert not agent(serveur, caisse, tmp_path).un_tour()
    assert caisse.faites == []
    assert not (tmp_path / 'en-cours.json').exists()


def test_fin_renvoyee_jusqu_a_ce_que_le_serveur_revienne(tmp_path):
    serveur = FauxServeur([{'id': 10, 'type': 'enter_order'}])

    class CaisseQuiCoupeLeServeur(FausseCaisse):
        def executer(self, tache):
            super().executer(tache)
            # Le serveur tombe juste après la saisie : les 4 premiers envois de `done` sont perdus.
            self.serveur.coupures = 4

    caisse = CaisseQuiCoupeLeServeur(serveur)
    a = agent(serveur, caisse, tmp_path)
    a.un_tour()
    assert caisse.faites == [10]
    assert serveur.statut(10) == 'done'
    assert serveur.chemins().count('POST /pos/jobs/10/done') == 1


def test_redemarrage_pendant_une_tache_signale_l_echec_sans_la_refaire(tmp_path):
    serveur = FauxServeur([{'id': 11, 'type': 'enter_order', 'status': 'in_progress'}])
    (tmp_path / 'en-cours.json').write_text(json.dumps({'id': 11, 'type': 'enter_order'}))
    caisse = FausseCaisse(serveur)
    a = agent(serveur, caisse, tmp_path)
    a.reprendre()
    assert serveur.statut(11) == 'failed'
    assert serveur.taches[11]['lastError'] == 'AGENT_RESTARTED'
    assert not (tmp_path / 'en-cours.json').exists()
    assert not a.un_tour()
    assert caisse.faites == []


def test_redemarrage_tache_deja_reglee_cote_serveur(tmp_path):
    serveur = FauxServeur([{'id': 12, 'type': 'pay_table', 'status': 'manual'}])
    (tmp_path / 'en-cours.json').write_text(json.dumps({'id': 12}))
    agent(serveur, FausseCaisse(serveur), tmp_path).reprendre()
    assert serveur.statut(12) == 'manual'
    assert not (tmp_path / 'en-cours.json').exists()


def test_tourner_reprend_apres_une_coupure_puis_s_arrete(tmp_path):
    serveur = FauxServeur([{'id': 13, 'type': 'enter_order'}])
    serveur.coupures = 3
    caisse = FausseCaisse(serveur)
    a = agent(serveur, caisse, tmp_path)
    a._poll = 0.01
    fil = threading.Thread(target=a.tourner, daemon=True)
    fil.start()
    for _ in range(200):
        if serveur.statut(13) == 'done':
            break
        threading.Event().wait(0.01)
    a.arreter()
    fil.join(timeout=2)
    assert not fil.is_alive()
    assert caisse.faites == [13]
    assert serveur.statut(13) == 'done'
