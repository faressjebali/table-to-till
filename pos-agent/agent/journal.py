"""Journal horodaté de l'agent, un fichier par jour dans `pos-agent/logs/` (ignoré par Git)."""

import logging
import sys
from datetime import date
from pathlib import Path


def configurer(dossier: Path) -> logging.Logger:
    dossier.mkdir(parents=True, exist_ok=True)
    # La console Windows n'est pas toujours en UTF-8 : sans cela, les accents s'abîment.
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    journal = logging.getLogger('agent')
    journal.setLevel(logging.INFO)
    journal.handlers.clear()
    format_ = logging.Formatter('%(asctime)s %(levelname)s %(message)s')
    for handler in (
        logging.FileHandler(dossier / f'agent-{date.today().isoformat()}.log', encoding='utf-8'),
        logging.StreamHandler(sys.stdout),
    ):
        handler.setFormatter(format_)
        journal.addHandler(handler)
    return journal
