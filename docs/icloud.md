# Fournisseur iCloud (iPhone, iPad, Mac, Apple Watch)

> **Désactivé par défaut.** À activer en connaissance de cause : `FEATURE_ICLOUD=true`.

## Ce que ça fait

Locus utilise [pyicloud](https://github.com/timlaing/pyicloud), qui parle à la même API
privée que **icloud.com/find**. Une fois votre compte Apple connecté dans l'onglet
**Objets → Appareils iCloud**, choisissez les appareils à **suivre**. Ils apparaissent
ensuite dans l'onglet **Appareils**, avec :

- une position mise à jour **toutes les 1 à 2 minutes** (`ICLOUD_POLL_INTERVAL_S`, 120 s
  par défaut, 60 s minimum), même quand l'appareil est verrouillé et sans que Locus y
  soit ouvert. Le bouton **Actualiser** demande une position immédiatement ;
- la **sonnerie native** d'Apple (fonctionne même en mode silencieux) ;
- le **mode Perdu natif** : l'appareil est **réellement verrouillé** et affiche votre
  message et votre numéro. Une confirmation est demandée. L'API iCloud ne permet pas de
  désactiver le mode Perdu : il prend fin quand l'appareil est déverrouillé avec son code.
  « Désactiver » dans Locus retire seulement l'indication.

Les AirTags ne sont **pas** visibles par cette API : utilisez le
[fournisseur réseau Find My](findmy-network.md).

## Configuration

```env
FEATURE_ICLOUD=true
ICLOUD_POLL_INTERVAL_S=120
```

La connexion demande l'identifiant Apple, le mot de passe, puis le code de double
authentification reçu sur un appareil de confiance (ou par SMS). La session est ensuite
marquée « de confiance » ; Apple redemande un code environ tous les deux mois. Locus
passe alors le compte en *reconnexion requise* et vous envoie une notification.

## Risques — à lire

- **Conditions d'utilisation d'Apple.** API privée, non documentée : elle peut cesser de
  fonctionner sans préavis et Apple peut bloquer le compte. Préférez un identifiant Apple
  de famille dédié si possible.
- **Secrets.** Le mot de passe Apple est chiffré en base ; les cookies de session sont
  stockés dans `DATA_DIR/icloud/<utilisateur>` (droits 0700). Toute personne ayant accès
  au volume `data` et à `SECRET_KEY` peut s'en servir.
- **Vie privée.** Avec le partage familial, l'API peut renvoyer les appareils des membres
  de la famille. Ne suivez que des appareils dont les propriétaires sont d'accord.
