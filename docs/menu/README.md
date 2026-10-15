# Menu — données

`menu.csv` a été recopié depuis le menu papier actuel (boissons + nourriture) et vérifié ligne par ligne le 15/10/2026 : 97 articles (les 94 du menu papier, avec le Kids Menu et le Cookie en deux articles chacun comme en caisse, + le Plat de la semaine), prix conformes. Il sert à remplir la base de données (`npm run seed`) et à l'émulateur.

## Colonnes

| Colonne | Contenu |
| --- | --- |
| `category` / `category_en` | Catégorie en français / en anglais (ordre d'affichage = ordre du fichier) |
| `name_fr` / `name_en` | Nom en français / en anglais |
| `description_fr` / `description_en` | Description en français / en anglais |
| `price_dt` | Prix en dinars (`5.5` = 5,5 DT) — converti en millimes au chargement |
| `pos_code` | Code produit LegacyPOS |
| `availability` | Vide = toujours ; `until 12:00` ; `until 15:00` ; `mon-fri 08:00-15:00`. « until » part de l'ouverture du café (8h00) |
| `suggested_extras` | Noms d'extras suggérés sous l'article, séparés par `;` |
| `note_hint_fr` / `note_hint_en` | Aide facultative affichée au client au-dessus de la note libre (ex. « Sans sucre ? » / « No sugar? ») : les deux langues ou aucune. Ce n'est pas la note du client. Vide pour les formules, dont les choix passent par `choice_groups` |
| `choice_groups` | Groupes de choix obligatoires, séparés par `;` (voir `docs/api.md` § ChoiceGroup) : `hot_drink`, `eggs`, `eggs_with_benedict`, `seasonal_juice`. Seulement pour les formules petit-déjeuner et le Kids Menu |
| `photo` | Nom du fichier photo |
| `station` | Poste qui marque la rupture : `bar` (barista), `kitchen` (chef), `both` (barista ou chef : Carrot cake, Fondant, Cookie, Granola, Fruits, Extras sucrés, Formules, Kids Menu). Le serveur et la manager peuvent marquer tout article |

## À compléter

- [ ] `pos_code` pour **chaque** article (visite au café)
- [x] `name_en` et `description_en` (menu anglais) : traduits le 15/10/2026 ; les noms propres ou déjà anglais (Early Bird, Cheese Burger…) et « مرطبات اليوم » restent tels quels — à faire relire par la manager
- [ ] `photo` pour chaque article
- [ ] **Plat de la semaine** : absent du menu papier, la manager le met à jour chaque semaine dans l'app
- [x] Extras suggérés sous les **Œufs** : confirmés
- [x] Poste des Formules et du Kids Menu : `both`
- [x] Poste des Extras sucrés, de Granola et Fruits : `both` (confirmé le 15/10/2026)
- [x] Prix du **Carrot cake** : 9,5 DT (confirmé sur le menu)
- [x] **Jus de saison** : vendu seul aussi (ex. Grenade dans « Jus »), en plus des formules et du Kids Menu (confirmé le 15/10/2026)
