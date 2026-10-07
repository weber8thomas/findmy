# Journal des modifications

Les changements notables d'Oukilé. Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
numérotation : [SemVer](https://semver.org/lang/fr/). La version est celle de
`backend/pyproject.toml` et de `frontend/package.json` (identiques, vérifié par un test) ;
l'application l'affiche dans *Moi › Réglages › À propos*, avec la révision déployée.

## [Non publié]

### Ajouté

- **Lieux par adresse** : l'éditeur de lieu a un champ *Adresse* (« Stephansplatz 1,
  Wien ») qui propose jusqu'à cinq résultats. En choisir un place le lieu, lui donne
  ce nom s'il n'en a pas encore et recentre la carte sur son cercle ; *Utiliser la position
  de cet appareil* recentre aussi la carte. Le serveur interroge OpenStreetMap Nominatim à la
  place de l'utilisateur (`GET /api/geocode`) : seul le texte tapé sort, pas l'adresse IP. Il
  suit la politique d'usage de Nominatim : User-Agent qui nomme Oukilé, une requête par
  seconde au plus pour tout le serveur, réponses en cache, recherche à la validation
  seulement, et limite chaque compte. `GEOCODER_URL` désigne un autre serveur Nominatim ;
  vide, il désactive la recherche (`features.geocode` dans `GET /api/config`). La page
  *Confidentialité* le mentionne.
- **Ma position, de plusieurs appareils** : dans *Moi › Ma position*, on choisit jusqu'à
  cinq de ses appareils ou objets, par ordre de priorité (un téléphone, puis un objet…).
  La première source à jour (moins de 30 min) donne la position, sinon la plus récente.
  Les personnes avec qui on partage voient cette position et le nom de l'appareil, en
  direct, jamais la liste. La ligne *Moi* de *Personnes* dit d'où vient la position. Les
  alertes de lieux suivent seulement la première source.
- **OwnTracks connaît vos lieux** : en réponse à ses envois, l'application reçoit vos
  propres lieux (jamais ceux des autres) et les surveille elle-même, sur Android comme sur
  iPhone : vos arrivées et départs sont signalés aussitôt, et l'alerte part dès cet
  événement. Un lieu ajouté, modifié ou supprimé lui est renvoyé. Sur Android, elle envoie
  moins de positions quand vous êtes dans l'un de vos lieux (après 500 m, 5 min au plus
  souvent) et redevient réactive dehors (100 m, 1 min). Le QR code active pour cela les
  commandes et la configuration à distance : une application configurée avec un ancien
  code doit l'être à nouveau (*Moi › Réglages › OwnTracks › Nouveau QR code OwnTracks*).

### Modifié

- **La carte suit l'onglet**, comme dans *Localiser* : *Personnes* ne montre que les
  visages (le vôtre et celui des personnes qui partagent avec vous), *Appareils* les
  appareils, *Objets* les objets, *Moi* et les Réglages votre visage seul. Changer
  d'onglet recadre la carte en douceur ; toucher son visage ouvre *Ma position*.

- **Comptes Apple dans les Réglages** : l'onglet *Objets* ne fait plus que lister les
  AirTags et balises, comme dans *Localiser*. Les comptes Apple se connectent et se
  déconnectent dans *Moi › Réglages*, une page par source : *Appareils Apple (iCloud)*,
  avec les appareils à suivre, et *Objets (réseau Localiser)*, où l'on génère une clé de
  balise ou importe une clé privée ou un AirTag. Chaque ligne montre l'état du compte ;
  *Objets* renvoie vers sa page s'il n'y a rien à montrer ou si Apple demande de se
  reconnecter.
- Sur téléphone et tablette, les petits boutons et le choix de la langue font au moins
  40 px de haut ; le bouton retour se touche plus facilement ; les champs de fichier
  (.plist) ont un bouton dans le style de l'application.

### Corrigé

- Un objet ouvert depuis *Objets* y revient, et c'est l'onglet *Objets* qui reste en
  surbrillance (pas *Appareils*).

## [0.2.0] - 2026-10-07

### Ajouté

- **Connexion unique (SSO)** avec un fournisseur OpenID Connect, testée avec Authentik :
  code d'autorisation + PKCE, comptes retrouvés par e-mail, création à la première
  connexion selon `OIDC_REGISTRATION`, `PASSWORD_LOGIN=false` pour n'offrir que le SSO.
  Voir [docs/sso.md](docs/sso.md).
- **Page de connexion** illustrée (une petite ville dessinée comme la carte), avec le
  bouton SSO, et nouvelle icône : un « é » dont l'accent est une épingle.
- **OwnTracks par QR code** ou par lien `owntracks:///config` : mode HTTP, URL,
  identifiants et identifiant d'appareil importés en une étape sur iOS et Android.
- **OwnTracks, c'est votre téléphone** : le configurer à nouveau donne un nouveau mot de
  passe au même appareil, qui devient l'appareil principal et apparaît sous *Personnes*
  (« Moi ») plutôt que sous *Appareils*.
- **Un seul exemplaire par appareil** d'un onglet à l'autre : « Cet appareil » peut être
  un appareil iCloud déjà listé (le même Mac ou iPad) ; les AirPods passent dans *Objets*.
- **iCloud** : tous les appareils du compte Apple sont suivis automatiquement
  (`ICLOUD_AUTO_TRACK`).
- **Objets du réseau Find My** : `tools/extract_findmy_items.py` extrait d'un Mac les
  AirTags et balises à importer (.plist), et chaque objet peut prendre une icône (clés,
  voiture, sac, portefeuille, valise, vélo, animal).
- **Photos de profil**, téléversées (recadrées à 256 px dans le navigateur) ou reprises du
  fournisseur SSO, visibles seulement des personnes avec qui un partage est en cours.
- **Historique** : choisir un moment en touchant le tracé ou avec un curseur (heure,
  précision, position précédente ou suivante).
- **Langue** du compte choisie après connexion ; `DEFAULT_LOCALE` fixe celle de la page de
  connexion, des nouveaux comptes SSO et du `<html lang>` servi.
- **Réglages** (engrenage dans *Moi*) : cet appareil, notifications push, OwnTracks,
  langue, compte et *À propos* (version, révision, sources de position).
- **Page Confidentialité** (`/privacy`), lisible sans compte, en français et en anglais :
  ce qui est conservé (avec la durée de rétention du serveur), qui voit quoi, les
  services tiers réellement utilisés. Version et lien en pied de page, dans l'application
  et sur la page de connexion.
- Version et révision git dans `GET /api/config` ; la révision vient du fichier `REVISION`
  écrit par `deploy/proxmox/deploy.sh` (nouveau : déploiement sur le CT Proxmox).
- Aperçus de liens (Open Graph) ; manifeste avec `id`, `lang`, catégories et raccourcis
  vers *Personnes*, *Appareils* et *Objets*.

### Modifié

- L'application s'appelle **Oukilé** (anciennement Locus). Les identifiants internes
  (base `locus.db`, cookie de session, stockage du navigateur) ne changent pas ; la
  variable du port devient `OUKILE_PORT` et l'image `oukile:latest`.
- Carte vectorielle OpenFreeMap, claire ou sombre selon l'appareil ; distances mesurées
  depuis l'appareil principal.
- Finitions dans l'esprit de *Localiser* : couleur stable par personne, retour en chevron,
  lieux en violet, charge de la batterie en éclair.
- L'application se recharge d'elle-même quand un déploiement installe un nouveau service
  worker.
- *Moi* garde le profil (photo, nom), le partage, les lieux et les notifications reçues ;
  les réglages passent dans *Réglages*.
- Images Docker de base épinglées par empreinte.

### Sécurité

- En-têtes `Cross-Origin-Resource-Policy` et `Cross-Origin-Opener-Policy` ; uvicorn
  n'envoie plus d'en-tête `Server`.
- Derrière un proxy, l'adresse du client est la dernière entrée de `X-Forwarded-For`
  (celle ajoutée par le proxy) : la limitation de débit ne se contourne plus en la forgeant.
- Documentation interactive de l'API désactivée, sauf `API_DOCS=true`.
- Pas d'indexation par les moteurs de recherche : `robots.txt`, en-tête `X-Robots-Tag` et
  balise `robots`.

### Corrigé

- Les journaux INFO de l'application étaient perdus.
- Les tuiles OpenStreetMap étaient refusées faute d'en-tête `Referer`.

## [0.1.0] - 2026-10-06

Première version, sous le nom de Locus.

- Serveur FastAPI + SQLite : comptes, appareils, positions en temps réel (WebSocket),
  partage de position sur invitation et pour une durée choisie, lieux et alertes,
  notifications Web Push, réception OwnTracks.
- Application web installable (PWA, React + Leaflet), en français et en anglais : carte,
  faire sonner, mode perdu, historique.
- Fournisseurs Apple facultatifs, désactivés par défaut : iCloud et réseau Find My.
- Docker Compose (Caddy, tunnel Cloudflare, serveur anisette) et tests Playwright.

[Non publié]: https://github.com/weber8thomas/findmy/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/weber8thomas/findmy/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/weber8thomas/findmy/releases/tag/v0.1.0
