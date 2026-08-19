# Locus Solo Web

Une adaptation web solo, tactile et responsive d’un jeu de placement de polyominos. Elle transpose fonctionnellement les cinq zones de la feuille de score dans une interface originale, sans intégrer les visuels du jeu physique. Le classement partagé utilise un Worker Cloudflare et une base D1.

## Hommage au jeu original

Ce projet est un **fan game amateur, non officiel et sans but lucratif**, réalisé par admiration pour **Locus**, un jeu de **Stan van Rooijen** édité par **Tucker’s Fun Factory** (2025).

Tous les droits sur le jeu Locus — son nom, ses règles, son matériel et ses illustrations — appartiennent à leurs auteurs et à leur éditeur.

Ce que ce projet **reprend** du jeu original : les règles, la composition du paquet de 48 cartes, les cinq zones et leurs modes de score, le tracé des grilles ainsi que l’emplacement des bonus, tous transposés depuis la feuille de score.

Ce qui est **original ici** : le code, la mise en page, la palette, la typographie, les icônes et les symboles à l’écran. Aucune illustration, police ni image du matériel physique n’a été copiée — mais la structure de jeu, elle, vient bien de Locus.

Si vous découvrez le jeu ici, **achetez la vraie boîte** : elle se joue de 1 à 5 joueurs et l’expérience autour d’une table vaut largement le détour. Rendez-vous chez [Tucker’s Fun Factory](https://www.tuckersfunfactory.nl) ou chez votre boutique de jeux locale.

### Contact

Contactez-moi à cette adresse : **ougl.dev@gmail.com**

## Installation locale

```bash
npm ci
npm run dev
```

Ouvrir ensuite l’adresse locale indiquée par Vite.

## Vérifier et produire

```bash
npm run check
npm run test
npm run build
```

Le contenu du dossier `dist/` est le site statique. Le leaderboard partagé exige toutefois le Worker fourni dans `worker/index.ts` et sa base D1 : un simple glisser-déposer du dossier ne suffit plus.

## Premier déploiement sur Cloudflare

1. Dans `wrangler.jsonc`, remplacer `locus-solo` par le nom exact du Worker à mettre à jour.
2. Se connecter à Cloudflare et créer la base partagée :

```bash
npx wrangler login
npm run db:create
```

La commande ajoute automatiquement le binding `DB` et l’identifiant de la base dans `wrangler.jsonc`.

3. Créer la table des scores puis déployer le Worker et les fichiers statiques :

```bash
npm run db:migrate
npm run deploy
```

Les déploiements suivants ne demandent plus que `npm run deploy`. Ne pas recréer la base : elle conserve les scores entre les versions.

### Mise à jour d’une base existante

Le compteur de parties terminées ajoute deux tables. Sur une base déjà en service, les créer une seule fois avant de déployer :

```bash
npx wrangler d1 execute locus-leaderboard --remote --file=./migrations/0002_create_stats.sql
```

La migration initialise le compteur à partir des scores déjà enregistrés et peut être relancée sans risque.

## Fonctionnalités

- partie solo de 16 tours avec les 48 cartes : U5, T5, Z5, W5, F5, V5, ligne de 3 et L de 3 dans chacune des 5 couleurs de zone, puis 2 T4, 2 L4, 2 N4 et 2 dominos multicolores ;
- cinq zones et cinq méthodes de score ;
- rotation, miroir et aperçu de placement ;
- bonus en chaîne et actions payées avec des pièces ;
- confirmation explicite des poses pour éviter les erreurs tactiles ;
- classement partagé avec détail, grille finale et replay pas à pas des nouvelles parties (les anciens scores conservent leur grille finale) ;
- compteur global des parties jouées jusqu’au bout, partagé par tous les joueurs ;
- sauvegarde automatique dans le navigateur ;
- mise en page adaptée à la souris, au tactile et aux petits écrans.
