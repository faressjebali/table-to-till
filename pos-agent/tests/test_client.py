import httpx
import pytest

from agent.client import Client, ReponseInattendue, ServeurInjoignable

from .faux_serveur import CLE, FauxServeur

URL = 'http://serveur.test/api'


def client(serveur: FauxServeur, cle: str = CLE) -> Client:
    return Client(URL, cle, transport=serveur.transport())


def test_rien_dans_la_file():
    assert client(FauxServeur()).prochaine_tache() is None


def test_tache_suivante_commencee_puis_faite():
    serveur = FauxServeur([{'id': 7, 'type': 'enter_order', 'tableNumber': 5}])
    c = client(serveur)
    tache = c.prochaine_tache()
    assert tache is not None and tache['id'] == 7
    assert c.commencer(7) is True
    # Une tâche déjà en cours : rien d'autre n'est donné.
    assert c.prochaine_tache() is None
    c.terminer(7)
    assert serveur.statut(7) == 'done'


def test_commencer_refuse_si_plus_prete():
    serveur = FauxServeur([{'id': 3, 'type': 'print_bill', 'status': 'failed'}])
    assert client(serveur).commencer(3) is False


def test_echec_envoye_avec_erreur_et_etape_tronquees():
    serveur = FauxServeur([{'id': 4, 'type': 'pay_table', 'status': 'in_progress'}])
    client(serveur).echouer(4, 'X' * 150, 'é' * 300)
    assert len(serveur.taches[4]['lastError']) == 100
    assert len(serveur.taches[4]['lastStep']) == 200


def test_heartbeat_avec_la_tache_en_cours():
    serveur = FauxServeur()
    c = client(serveur)
    c.heartbeat('idle')
    c.heartbeat('busy', 9)
    assert serveur.heartbeats == [{'state': 'idle'}, {'state': 'busy', 'jobId': 9}]


def test_mauvaise_cle_refusee():
    with pytest.raises(ReponseInattendue) as err:
        client(FauxServeur(), cle='autre').prochaine_tache()
    assert err.value.statut == 401
    assert err.value.code == 'UNAUTHORIZED'


def test_serveur_arrete_ou_en_erreur():
    serveur = FauxServeur()
    serveur.coupures = 1
    with pytest.raises(ServeurInjoignable):
        client(serveur).prochaine_tache()
    en_erreur = Client(URL, CLE, transport=httpx.MockTransport(lambda _: httpx.Response(503)))
    with pytest.raises(ServeurInjoignable):
        en_erreur.heartbeat('idle')
