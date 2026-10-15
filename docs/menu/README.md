# Menu — données

`menu.csv` a été recopié depuis le menu papier actuel (boissons + nourriture) et vérifié ligne par ligne le 15/10/2026 : 97 articles (les 94 du menu papier, avec le Kids Menu et le Cookie en deux articles chacun comme en caisse, + le Plat de la semaine), prix conformes. Il sert à remplir la base de données (`npm run seed`) et à l'émulateur.

## Colonnes

| Colonne | Contenu |
| --- | --- |
| `category` | Catégorie (ordre d'affichage = ordre du fichier) |
| `name_fr` / `name_en` | Nom en français / en anglais |
| `description_fr` / `description_en` | Description en français / en anglais |
| `price_dt` | Prix en dinars (`5.5` = 5,5 DT) — converti en millimes au chargement |
| `pos_code` | Code produit LegacyPOS |
| `availability` | Vide = toujours ; `until 12:00` ; `until 15:00` ; `mon-fri 08:00-15:00`. « until » part de l'ouverture du café (8h00) |
| `suggested_extras` | Noms d'extras suggérés sous l'article, séparés par `;` |
| `note_hint` | Aide affichée au client pour préciser son choix dans la note |
| `photo` | Nom du fichier photo |
| `station` | Poste qui marque la rupture : `bar` (barista), `kitchen` (chef), `both` (barista ou chef : Carrot cake, Fondant, Cookie, Formules, Kids Menu). Le serveur et la manager peuvent marquer tout article |

## À compléter

- [ ] `pos_code` pour **chaque** article (visite au café)
- [ ] `name_en` et `description_en` (menu anglais)
- [ ] `photo` pour chaque article
- [ ] **Plat de la semaine** : absent du menu papier, la manager le met à jour chaque semaine dans l'app
- [x] Extras suggérés sous les **Œufs** : confirmés
- [x] Poste des Formules et du Kids Menu : `both`
- [ ] Vérifier le poste (`station`) des Extras sucrés, de Granola et Fruits (mis en `kitchen`)
- [x] Prix du **Carrot cake** : 9,5 DT (confirmé sur le menu)
- [x] **Jus de saison** : pas vendu seul (seulement dans les formules et le Kids Menu)
