# Locus

**Retrouvez vos appareils et vos proches depuis n'importe quel navigateur.**
Prototype autohébergé inspiré de *Localiser* (Find My) d'Apple, sous forme d'application
web installable (PWA). Il fonctionne sur iPhone, Android, Windows, Mac et Linux.

> Locus n'est ni affilié à Apple ni approuvé par Apple. Il n'utilise ni leur nom, ni leurs
> icônes, ni leurs sons.

## Fonctionnalités

| | |
|---|---|
| **Carte et appareils** | Dernière position, précision, batterie, « en ligne / vu il y a… », distance, itinéraire (Plans / Google Maps) |
| **Faire sonner** | Commande temps réel par WebSocket : son synthétisé + vibration + écran plein ; repli en notification push si l'appli est fermée |
| **Mode perdu** | Message et numéro en plein écran sur l'appareil, persistant après rechargement (vrai verrouillage Apple avec le fournisseur iCloud) |
| **Personnes** | Comptes multiples, partage de position avec invitation, durée (1 h, fin de journée, illimité), arrêt en un geste |
| **Historique** | Tracé sur la carte (1 h / 24 h / 7 j), sous-échantillonné côté serveur, purge après 30 jours |
| **Lieux et alertes** | Zones circulaires, alertes d'arrivée et de départ (hystérésis anti-faux positifs), dans l'appli et en Web Push |
| **Bilingue** | Français / anglais, mémorisé dans le compte |

### D'où viennent les positions

| Source | Délai | Remarques |
|---|---|---|
| **L'application web elle-même** | 1–5 s, en direct | Uniquement quand Locus est ouvert (limite des navigateurs, surtout sur iOS) |
| **OwnTracks** (appli native gratuite) | 30 s à quelques minutes | Fonctionne en arrière-plan, téléphone verrouillé |
| **iCloud** *(optionnel, non officiel)* | ~1–2 min | iPhone, iPad, Mac sans rien installer ; sonnerie et mode Perdu natifs. [docs/icloud.md](docs/icloud.md) |
| **Réseau Find My** *(optionnel, non officiel)* | minutes à 1 h+ | AirTags et balises DIY OpenHaystack. [docs/findmy-network.md](docs/findmy-network.md) |

Les deux fournisseurs Apple sont **désactivés par défaut**. Ils reposent sur des API
privées : cela enfreint les conditions d'utilisation d'Apple et expose le compte Apple à
un blocage. Lisez leur documentation avant de les activer.

## Démarrage rapide

```bash
docker compose up -d --build
# http://localhost:8000 : créez le premier compte (il devient administrateur)
```

Sur téléphone, il faut du HTTPS : voir [docs/https-dev.md](docs/https-dev.md)
(tunnel en une commande, Caddy en réseau local, ou nom de domaine).
La configuration se fait avec [.env.example](.env.example).

## Développement

Prérequis : Python 3.13 + [uv](https://docs.astral.sh/uv/), Node 22 + pnpm.

```bash
make setup     # dépendances backend, frontend et e2e
make dev       # API sur :8000 (rechargement auto) + Vite sur :5173 -> http://localhost:5173
make test      # ruff + pytest, tsc + vitest
make e2e       # build + Playwright (Chromium, 2 navigateurs, géolocalisation simulée)
make serve     # build + un seul processus comme en production -> http://localhost:8000
```

## Architecture

```
 Navigateur (PWA React)                         Serveur (FastAPI, 1 processus)
 ┌──────────────────────────┐   REST /api      ┌────────────────────────────────────┐
 │ Carte Leaflet, onglets    │ ───────────────▶ │ auth (cookies), appareils, partage │
 │ Reporter (watchPosition)  │ ── /report ────▶ │ ingest() ──▶ historique ──▶ zones  │
 │ DeviceRuntime (son, perdu)│ ◀── WebSocket ── │ hub temps réel ──▶ notifications   │
 │ Service worker (push)     │ ◀── Web Push ─── │ Web Push (VAPID)                   │
 └──────────────────────────┘                  │ fournisseurs : navigateur, OwnTracks│
 OwnTracks ── HTTP ──────────────────────────▶ │   iCloud*, réseau Find My*  (*opt.)│
                                               │ SQLite (WAL)                        │
                                               └────────────────────────────────────┘
```

- `backend/app/providers/` : chaque source de positions implémente `Provider` et passe par
  le même pipeline `services/locations.ingest()` (dédoublonnage, dernière position,
  zones, diffusion temps réel).
- `backend/app/access.py` : toutes les règles d'autorisation (une ressource non visible
  renvoie 404).
- `frontend/src/reporter/` : envoi de la position du navigateur (filtrage du bruit
  de mouvement, signal de vie toutes les 60 s, file d'attente hors ligne).
- `frontend/src/device-runtime/` : exécution des commandes sur l'appareil.

## Limites connues (prototype)

- Pas de géolocalisation en arrière-plan dans les navigateurs : utilisez OwnTracks ou iCloud.
- Web Push sur iPhone : seulement après « Sur l'écran d'accueil » (iOS 16.4+).
- Un seul processus (hub WebSocket et limitation de débit en mémoire) et SQLite :
  suffisant pour une famille, pas pour des milliers d'utilisateurs.
- Pas de chiffrement de bout en bout : l'administrateur voit les positions. Voir
  [docs/privacy.md](docs/privacy.md).
- Fond de carte OpenFreeMap (vectoriel, gratuit, sans clé), clair ou sombre selon
  l'appareil : configurable via `TILE_URL` et `TILE_URL_DARK` (style MapLibre ou tuiles
  raster `{z}/{x}/{y}`).

## Licence

Code de ce dépôt : à définir par le propriétaire du dépôt. Dépendances : FastAPI (MIT),
React (MIT), Leaflet (BSD-2), FindMy.py (MIT), pyicloud (MIT).
