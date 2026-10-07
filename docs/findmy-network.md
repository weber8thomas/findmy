# Fournisseur « réseau Find My » (AirTags et balises DIY)

> **Désactivé par défaut.** À activer en connaissance de cause : `FEATURE_FINDMY=true`.

## Ce que ça fait

Le réseau Find My d'Apple est participatif : des centaines de millions d'iPhone captent
en Bluetooth les balises qui passent près d'eux et envoient leur position, chiffrée, aux
serveurs d'Apple. Seul le propriétaire de la clé privée de la balise peut déchiffrer ces
positions.

Oukilé s'appuie sur la bibliothèque open source
[FindMy.py](https://github.com/malmeloo/FindMy.py) (MIT) pour :

- se connecter avec un identifiant Apple (double authentification comprise) ;
- télécharger et déchiffrer les rapports de position de vos balises ;
- les afficher dans l'onglet **Objets**, avec historique et zones, comme les autres appareils.

Deux sortes de balises sont prises en charge :

| Type | Ce qu'il faut |
|---|---|
| **Balise DIY OpenHaystack** (ESP32, nRF51/52…) | Dans Oukilé : *Générer une clé de balise DIY*. Flashez la **clé d'annonce** affichée avec le firmware [OpenHaystack](https://github.com/seemoo-lab/openhaystack) ou [macless-haystack](https://github.com/dchristl/macless-haystack). La clé privée reste sur le serveur. Vous pouvez aussi importer une clé privée existante. |
| **AirTag officiel** | Le fichier `.plist` de l'accessoire, extrait d'un Mac où l'AirTag est associé. Depuis macOS 14, ces fichiers sont chiffrés : suivez la [documentation de FindMy.py](https://docs.mikealmel.ooo/FindMy.py/) pour récupérer la clé et les déchiffrer. Le fichier « key alignment » est facultatif mais accélère la première recherche. |

## Délai des positions

Les positions **ne sont pas en temps réel** :

- une position n'existe que si un appareil Apple passe près de la balise ;
- les iPhone qui la captent l'envoient par lots ;
- Oukilé interroge Apple toutes les `FINDMY_POLL_INTERVAL_S` secondes (300 par défaut, 120 minimum), et le bouton **Actualiser** déclenche une interrogation immédiate.

Il faut donc compter **de quelques minutes à plus d'une heure** selon le passage
autour de la balise. Les zones (géorepérage) confirment un changement dès le premier
rapport, puisque ces positions sont rares.

## Configuration

```env
FEATURE_FINDMY=true
FINDMY_POLL_INTERVAL_S=300
# Facultatif : serveur anisette externe (sinon anisette est émulé localement par FindMy.py).
# docker compose --profile findmy up  démarre dadoum/anisette-v3-server sur le réseau interne.
ANISETTE_URL=http://anisette:6969
```

## Risques — à lire

- **Conditions d'utilisation d'Apple.** Cet accès n'est ni officiel ni autorisé par Apple.
  Apple peut le casser à tout moment et **peut verrouiller l'identifiant Apple utilisé**.
  Utilisez un **identifiant Apple dédié**, pas votre compte principal.
- **Secrets.** L'état du compte (qui contient le mot de passe Apple) et les clés des
  balises sont chiffrés en base (Fernet, clé dérivée de `SECRET_KEY`). L'administrateur
  du serveur reste en mesure de les lire : n'hébergez que pour des personnes de confiance.
  Si `SECRET_KEY` (ou `data/secret_key`) est perdu, il faut reconnecter le compte et
  réimporter les balises.
- **Pistage abusif.** Les balises DIY peuvent échapper aux alertes anti-pistage d'Apple
  et de Google. Suivre quelqu'un à son insu est **illégal** dans la plupart des pays
  (en France : article 226-1 du Code pénal). N'utilisez ce module que pour **vos objets**.
