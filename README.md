# AnounisGaming

L'actu jeux vidéo du monde entier, traduite en français, avec les rumeurs repérées, la lecture à voix haute et le prix PC le plus bas tous pays confondus. Usage personnel.

## Comment ça marche

| Pièce | Rôle |
|---|---|
| **Robot** (`robot/`) | Tourne tout seul sur GitHub, une fois par heure de 7 h à 23 h et deux fois la nuit. Il lit les sources, traduit, regroupe les doublons, repère les rumeurs et enregistre l'audio avec une voix neuronale. Il publie le résultat sur la branche `data`. |
| **Appli** (`src/`) | Lit la branche `data`, affiche le fil, joue l'audio, cherche les prix PC. |
| **Construction** (`.github/workflows/android.yml`) | Chaque modification de l'appli produit un APK dans **Releases**. |

## Installer l'appli

1. Ouvre l'onglet **Actions** du dépôt et attends que « Construire l'APK » soit vert (environ 5 minutes).
2. Va dans **Releases** et télécharge `AnounisGaming.apk` depuis ton téléphone, puis installe-le.
3. Au premier lancement, l'appli te guide pour créer un **code d'accès GitHub en lecture seule** (le dépôt est privé).
4. Pour les prix, crée une clé gratuite sur [IsThereAnyDeal](https://isthereanydeal.com/apps/my/) et colle-la dans l'onglet **Prix PC**.

Les nouvelles versions s'installent par-dessus l'ancienne sans perdre tes réglages (même clé de signature, mot de passe : `anounisgaming`).

## Réglages du robot

- **Sources** : `robot/sources.json`. Ajoute ou retire une ligne, c'est pris en compte au passage suivant.
- **Traduction** : Google Traduction gratuit par défaut. Pour une meilleure qualité, crée une clé gratuite [DeepL API Free](https://www.deepl.com/pro-api) et ajoute-la dans **Settings → Secrets and variables → Actions** sous le nom `DEEPL_KEY`.
- **Lancer le robot à la main** : **Actions → Robot d'actu → Run workflow**.
- **Quota gratuit** : un dépôt privé dispose de 2 000 minutes d'Actions par mois, partagées entre tes dépôts. Le robot en consomme environ 1 200. Si tu ajoutes des passages, surveille **Settings → Billing**.

GitHub met en pause les tâches planifiées d'un dépôt sans activité pendant 60 jours : si le fil ne se met plus à jour, relance le robot à la main une fois.

## Options gratuites du robot (facultatives)

Dans **Settings → Secrets and variables → Actions → New repository secret** :

| Secret | À quoi il sert | Où l'obtenir |
|---|---|---|
| `GEMINI_KEY` | Les rumeurs sont rédigées comme de vrais articles (sinon : assemblées à partir des sources) | Google AI Studio, clé API gratuite |
| `TWITCH_CLIENT_ID` et `TWITCH_CLIENT_SECRET` | Images officielles et trailers des jeux (IGDB) | dev.twitch.tv → Your Console → Register Your Application |
| `DEEPL_KEY` | Traduction de meilleure qualité | DeepL API Free |

## Favoris et widget

- **Favoris** : touche l'étoile ★ d'un jeu (fiche jeu, article, résultats de recherche). Chaque favori a ses trucs et astuces (Gemini avec recherche web : colle ta clé Gemini dans **Réglages → Accès**), ses guides Reddit, ses notes de patch Steam et son actu.
- **Widget** : appui long sur l'écran d'accueil → Widgets → AnounisGaming. Il affiche les 3 dernières infos et se rafraîchit toutes les 30 minutes environ (Android impose ce minimum).
