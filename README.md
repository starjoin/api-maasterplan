# Maasterplan — GTFS et NeTEx sur Coolify

L’API sert une version publiée pendant qu’un processus séparé prépare la suivante. Le changement intervient uniquement après import, validation des références, contrôle SQLite et calcul des résumés des lignes. Chaque requête conserve la même version jusqu’à sa réponse. Un import invalide, trop gourmand, interrompu ou tué conserve la version précédente.

## Déployer sur un serveur de 4 Go

Utiliser le Dockerfile ou le Compose fourni. Conserver **un volume persistant `/app/data`** et une seule instance de l’application : les fichiers SQLite et le verrou d’import ne sont pas conçus pour plusieurs réplicas. Les URL des bases GTFS et NeTEx doivent être distinctes. Les chemins historiques `maasterplan.db` et `netex.db` restent compatibles.

Le Dockerfile ne contient pas de directive `VOLUME`. Cette omission est volontaire : sans montage fourni par Coolify, Docker créerait un volume anonyme neuf à chaque remplacement de conteneur et le présenterait comme un montage valide. En production, `REQUIRE_PERSISTENT_STORAGE=true` refuse désormais de démarrer si `/app/data` n’est pas un montage explicite. Un rolling update mal configuré échoue donc sans remplacer le conteneur encore en service par une base vide.

Au démarrage, l’application lit d’abord `_prisma_migrations`. Si les migrations présentes dans l’image sont déjà appliquées, elle ne lance pas `prisma migrate deploy` : cela évite de demander un verrou SQLite exclusif pendant que l’ancien conteneur termine le rolling update. Un déploiement qui ajoute réellement une migration de schéma doit être effectué sans chevauchement des deux conteneurs, ou pendant une courte fenêtre de maintenance.

Configurer `RFU_API_TOKEN` et, si nécessaire, `RFU_API_TOKEN_NETEX`. Ajouter aussi `NAVITIA_TOKEN` dans les variables **runtime** de Coolify pour récupérer les tracés de `fr-se-sytral` ; le nom historique `REACT_APP_NAVITIA_TOKEN` reste accepté. Les variables définies par Coolify priment sur `.env.local`. Ne pas copier de `.env.local` dans l’image.

| Réglage | Valeur fournie |
| --- | --- |
| Mémoire totale du conteneur Compose | 2 300 Mo |
| Réservation mémoire | 512 Mo |
| CPU du conteneur Compose | 1 CPU |
| Heap HTTP | 384 Mo |
| Heap du worker | 768 Mo |
| Seuil RSS du worker | 1 400 Mo |
| Lots d’insertion | 500 lignes maximum |
| Imports simultanés | 1 |
| Priorité CPU du worker | nice +10 |
| Délai maximum d’import | 360 minutes |
| Répertoire temporaire | `/app/data/tmp` sur disque |

En mode **Dockerfile Coolify**, renseigner également la limite mémoire 2 300 Mo et 1 CPU dans les paramètres de ressources : un Dockerfile ne fixe pas ces limites. Garder de la mémoire pour Coolify, son proxy et le système. Le build et le runtime sont séparés ; éviter de construire d’autres applications simultanément sur cette petite machine.

`IMPORT_HEAP_MB` est borné à 1 536 Mo, `IMPORT_RSS_MB` à 2 048 Mo. La surveillance RSS Linux inclut les buffers et allocations natives ; un dépassement arrête le worker. Ce sont des budgets de fonctionnement, pas une garantie absolue contre l’OOM global si d’autres applications saturent l’hôte.

L’import automatique au premier démarrage est désactivé dans l’image. Lancer les premiers imports depuis le dashboard, puis les imports planifiés suivent `IMPORT_CRON` (défaut 03:00, fuseau du processus). `/health` reste léger et ne compte pas les tables. La première base vide ne peut évidemment pas fournir de données avant son premier import réussi.

Pendant un import, le dashboard actualise chaque seconde le pourcentage global et celui de la phase active : préparation, téléchargement, extraction, inventaire, projection, validation, optimisation puis publication. Il affiche l’élément courant, les volumes traités, les compteurs de fichiers, entités sources, lignes, arrêts, POI, courses, horaires, calendriers et tracés, ainsi qu’un journal borné aux 40 événements les plus récents. Le signal du worker et sa mémoire RSS permettent de distinguer un calcul long d’un processus arrêté. Les messages IPC sont plafonnés à cinq par seconde pour conserver un coût faible sur le petit serveur.

## Versions, échecs et stockage

Les bases historiques deviennent aussi les bases de contrôle : jobs et configuration API Designer restent stables pendant les imports. Les données nouvelles se trouvent dans `<base>.versions/<uuid>/dataset.db`, avec les fichiers originaux dans `sources/`. Le manifeste `<base>.active.json` est remplacé atomiquement après synchronisation disque. Ne jamais remplacer ou copier seulement un fichier SQLite pendant qu’il est ouvert.

La version courante et la précédente sont conservées. Au démarrage et avant le prochain import, les anciennes versions et préparations abandonnées sont supprimées ; une version encore utilisée par une requête reste conservée. Les anciennes bases historiques ne sont pas supprimées. Un redémarrage reprend la version publiée et marque les imports interrompus en échec ; une publication déjà validée sur disque est reconnue comme terminée.

Prévoir de l’espace pour **les deux dernières versions, la nouvelle base, les fichiers sources et le téléchargement/extraction**. L’archivage complet et l’indexation consomment davantage de disque qu’une projection partielle. `IMPORT_MAX_BYTES` limite les archives et les fichiers source à 20 Go par défaut ; ce n’est pas une limite de taille de la base résultante. Les erreurs de disque plein font échouer l’import sans publier la base partielle. Le volume ne doit pas être un tmpfs en RAM.

## Explorer et comparer

La page **GTFS ↔ NeTEx** affiche dates et URLs des publications, comptes par famille, champs renseignés, pagination des enregistrements et détails JSON complets. Tous les fichiers originaux sont téléchargeables avec leur empreinte SHA-256.

- GTFS : chaque ligne de chaque fichier `.txt`/`.csv` est indexée avec tous ses champs, y compris extensions et tarifs récents ; les autres fichiers sont archivés sans transformation. Les tables transport usuelles sont projetées dans l’API.
- À la fin de chaque import GTFS ou NeTEx, chaque ligne est rapprochée du catalogue Navitia `fr-se-sytral` par code, puis par nom normalisé lorsque le code est en doublon. Le GeoJSON Navitia est fusionné avec les informations de la ligne dans la nouvelle génération avant sa publication. L’API et la carte le préfèrent aux `shapes.txt` GTFS ; les données et géométries originales restent conservées et servent de repli. Un échec Navitia n’empêche donc pas la publication de la source. La liste `/api/v1/lines` omet ces tracés volumineux par défaut ; `?geojson=true`, le détail d’une ligne et `/geojson` les exposent.
- NeTEx : tous les XML sont parcourus récursivement, indépendamment de leurs noms. Chaque entité avec `id`, hors conteneurs `*Frame`, est indexée avec son contenu et ses attributs. Les métadonnées des conteneurs et éléments sans identifiant restent disponibles dans les fichiers originaux. Plusieurs occurrences d’un même identifiant restent visibles ; la projection transport utilise la dernière occurrence dans l’ordre des fichiers et déduplique les identifiants.
- Les lignes, arrêts, quais, POI, opérateurs, zones tarifaires, courses et horaires sont projetés. Les références de courses peuvent traverser plusieurs fichiers. Les décalages de jour sont conservés (`01:05` avec un décalage de 1 jour devient `25:05`).
- Pour les services avec un seul DayType, les affectations de jours avec date explicite, OperatingDay ou OperatingPeriod et jours de semaine sont converties en exceptions de calendrier. Les constructions NeTEx non prises en charge restent consultables à l’état brut. Le nombre de courses sans calendrier converti est indiqué ; aucune plage de dates fictive n’est créée. Les géométries, tarifs et extensions non projetés sont disponibles dans l’inventaire et les fichiers originaux.
- Un nœud GTFS `location_type=3` n’est pas un POI. Les vrais `PointOfInterest` NeTEx disposent d’un marqueur et d’un filtre propres. Référence : [GTFS Schedule](https://gtfs.org/documentation/schedule/reference/).

Les publications GTFS STANDARD et NeTEx RHONE peuvent avoir des périmètres différents. La matrice compare leur contenu observé ; elle ne prétend pas aligner automatiquement les identifiants ni déclarer les formats équivalents. Une absence ne prouve pas une limitation du format.

Le sélecteur GTFS / NeTEx définit la source active globale de l’API et de l’explorateur. En choisissant NeTEx, les endpoints dynamiques lisent uniquement la génération NeTEx publiée ; aucune donnée GTFS n’est fusionnée dans leurs réponses. La base GTFS reste intacte sur le volume et redevient immédiatement disponible en revenant sur GTFS. La page **GTFS ↔ NeTEx** interroge explicitement les deux bases et reste donc utilisable quelle que soit la source active. Le changement est refusé pendant un import pour conserver une vue cohérente.

Les listes sont paginées, y compris les anciens endpoints Designer sans pagination déclarée (100 résultats par défaut, maximum 500 ; `limit`/`offset` permettent de parcourir la suite). Les résumés de lignes sont calculés pendant l’import pour éviter des agrégations répétées dans le serveur HTTP. Les bases importées avant cette mise à jour utilisent temporairement l’ancien calcul : réimporter pour bénéficier de l’inventaire et des résumés.

Le point d’entrée d’import NeTEx local accepte seulement les dossiers dans `LOCAL_IMPORT_ROOT` (défaut `data/imports`). Les liens symboliques sont refusés.

## Développement et vérification

```sh
npm ci
npm run build
npm run client:dev
npm run dev:api
npm test
npm run build --prefix client
```

`npm test` utilise des bases et des flux synthétiques isolés ; il ne touche pas aux données de travail et ne télécharge pas les publications RFU. Les tests vérifient la disponibilité pendant import, la cohérence d’une requête traversant une publication, les erreurs CSV/XML, la conservation des extensions et fichiers, les POI, les heures après minuit et le changement de source.

Avant de qualifier les performances de production, mesurer un import RFU complet sur l’hôte Coolify cible et observer le pic RSS, la durée, l’espace disque et les latences des endpoints utilisés. Les tests synthétiques ne remplacent pas cette mesure.

Un benchmark synthétique reproductible est inclus dans l’image : `node scripts/benchmark-import.cjs` (100 000 horaires, ajustable avec `BENCH_ROWS` ; `BENCH_SOURCE=netex` teste un fichier XML volumineux). Il crée ses propres bases temporaires, prépare une version précédente puis réimporte en mesurant de vraies requêtes HTTP et la mémoire de l’arbre des processus sous Linux. Il ne lit ni ne modifie les bases de production. Lancer de préférence dans un conteneur de test séparé avec les mêmes limites de CPU et mémoire.

### Mesures de validation du 7 septembre 2026

Docker Linux ARM64 local, conteneur limité à 1 CPU et 2 300 Mo, 100 000 horaires synthétiques par format, API HTTP interrogée pendant le remplacement d’une version existante :

| Mesure | GTFS | NeTEx (un XML) |
| --- | --- | --- |
| Import et publication | 5,34 s | 7,67 s |
| Pic RSS mesuré, arbre des processus | 295,4 Mio | 333,8 Mio |
| `/health`, 95e percentile | 9,0 ms | 3,5 ms |
| `/health`, maximum | 48,3 ms | 46,2 ms |
| Liste des lignes, 95e percentile | 3,9 ms | 4,2 ms |
| Erreurs HTTP observées | 0 | 0 |

Ces mesures couvrent l’import local, l’indexation et la publication, sans téléchargement réseau. La mémoire est échantillonnée et ne constitue pas une borne garantie. Le matériel de l’hôte et la complexité des données RFU réelles peuvent changer les performances.
