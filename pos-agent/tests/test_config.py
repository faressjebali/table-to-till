import pytest

from agent.config import ConfigInvalide, charger


@pytest.fixture(autouse=True)
def sans_variables(monkeypatch):
    for nom in (
        'SERVER_URL',
        'AGENT_KEY',
        'LEGACY_PIN',
        'AGENT_IDLE_SECONDS',
        'AGENT_POLL_SECONDS',
    ):
        monkeypatch.delenv(nom, raising=False)


def test_lecture_du_env_et_adresse_du_temps_reel(tmp_path):
    env = tmp_path / '.env'
    env.write_text(
        'SERVER_URL=http://localhost:3000/api/\nAGENT_KEY=cle-secrete\nLEGACY_PIN=1234\n'
        'AGENT_IDLE_SECONDS=3\n'
    )
    config = charger(env)
    assert config.server_url == 'http://localhost:3000/api'
    assert config.socket_url == 'http://localhost:3000'
    assert config.idle_seconds == 3
    assert config.poll_seconds == 5
    # Les secrets ne s'affichent jamais.
    assert 'cle-secrete' not in repr(config)
    assert '1234' not in repr(config)


def test_le_env_de_l_agent_l_emporte_sur_l_environnement(tmp_path, monkeypatch):
    env = tmp_path / '.env'
    env.write_text('SERVER_URL=http://a/api\nAGENT_KEY=k\n')
    # Ex. le .env du serveur chargé par l'éditeur dans le terminal.
    monkeypatch.setenv('SERVER_URL', 'http://localhost:3000')
    monkeypatch.setenv('LEGACY_PIN', '1')
    config = charger(env)
    assert config.server_url == 'http://a/api'
    # L'environnement complète seulement ce qui manque au fichier.
    assert config.legacy_pin == '1'


def test_reglages_manquants_ou_faux(tmp_path):
    env = tmp_path / '.env'
    env.write_text('SERVER_URL=http://a/api\nAGENT_KEY=\n')
    with pytest.raises(ConfigInvalide, match='AGENT_KEY, LEGACY_PIN'):
        charger(env)
    env.write_text('SERVER_URL=http://a/api\nAGENT_KEY=k\nLEGACY_PIN=1\nAGENT_POLL_SECONDS=vite\n')
    with pytest.raises(ConfigInvalide, match='AGENT_POLL_SECONDS'):
        charger(env)
