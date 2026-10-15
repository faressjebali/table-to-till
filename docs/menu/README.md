# Menu — données

`menu.csv` a été recopié depuis le menu papier actuel (boissons + nourriture). Il sert à remplir la base de données (`npm run seed`) et à l'émulateur.

## Colonnes

| Colonne | Contenu |
| --- | --- |
| `category` | Catégorie (ordre d'affichage = ordre du fichier) |
| `name_fr` / `name_en` | Nom en français / en anglais |
| `description_fr` / `description_en` | Description en français / en anglais |
| `price_dt` | Prix en dinars (`5.5` = 5,5 DT) — converti en millimes au chargement |
| `pos_code` | Code produit LegacyPOS |
| `availability` | Vide = toujours ; `until 12:00` ; `until 15:00` ; `mon-fri 08:00-15:00` |
| `suggested_extras` | Noms d'extras suggérés sous l'article, séparés par `;` |
| `note_hint` | Aide affichée au client pour préciser son choix dans la note |
| `photo` | Nom du fichier photo |

## À compléter

- [ ] `pos_code` pour **chaque** article (visite au café)
- [ ] `name_en` et `description_en` (menu anglais)
- [ ] `photo` pour chaque article
- [ ] Prix et contenu du **Plat de la semaine**
- [ ] Vérifier les extras suggérés sous les **Œufs** : sur le menu papier, la section Extras est à côté des œufs, j'ai supposé qu'ils s'appliquent aux œufs
- [ ] Vérifier le prix du **Carrot cake** (9,5 DT dans le texte du PDF)
- [ ] Vérifier si **Jus de saison** est vendu seul (prix ?)
