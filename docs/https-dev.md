# Tester sur téléphone (HTTPS)

Les navigateurs n'autorisent la géolocalisation, les service workers et les notifications
push que dans un **contexte sécurisé** : `https://…` ou `http://localhost`. Sur un
téléphone, il faut donc du HTTPS.

## Option 1 — Tunnel temporaire (le plus rapide)

```bash
docker compose --profile tunnel up -d
docker compose logs tunnel | grep trycloudflare.com
```

Ouvrez l'URL `https://….trycloudflare.com` affichée sur le téléphone. Le tunnel
Cloudflare « quick tunnel » ne demande pas de compte ; l'URL change à chaque démarrage.
Pour des cookies `Secure`, ajoutez `BASE_URL=<cette URL>` et `TRUST_PROXY=true` dans
`.env`, puis `docker compose up -d app`.

## Option 2 — Réseau local avec Caddy

```bash
echo "SITE_ADDRESS=192.168.1.20" >> .env      # l'IP du serveur sur votre réseau
echo "BASE_URL=https://192.168.1.20" >> .env
echo "TRUST_PROXY=true" >> .env
docker compose --profile https up -d
```

Caddy émet un certificat depuis sa propre autorité locale. Il faut la faire accepter
par chaque téléphone :

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./locus-root.crt
```

- **iPhone** : envoyez-vous `locus-root.crt` (AirDrop, e-mail), installez le profil
  (Réglages › Profil téléchargé), puis activez la confiance totale dans
  Réglages › Général › Informations › Réglages des certificats.
- **Android** : Paramètres › Sécurité › Chiffrement et identifiants › Installer un
  certificat › Certificat CA.

## Option 3 — Nom de domaine public

Faites pointer `find.example.com` vers le serveur, ouvrez les ports 80 et 443, puis
`SITE_ADDRESS=find.example.com`, `BASE_URL=https://find.example.com`, `TRUST_PROXY=true`.
Caddy obtient automatiquement un certificat Let's Encrypt.

## Checklist manuelle (non couverte par les tests automatiques)

Les tests Playwright simulent la géolocalisation dans Chromium. À vérifier à la main
sur de vrais appareils :

1. **iPhone (Safari)** : ouvrez Oukilé, *Partager › Sur l'écran d'accueil*, ouvrez l'icône.
   Dans *Moi › Réglages*, « Utiliser ce navigateur comme appareil », acceptez la localisation.
2. Depuis un autre appareil, « Faire sonner » : le son joue et l'écran plein s'affiche.
3. Verrouillez l'iPhone : le partage se met en pause (limitation d'iOS). Activez les
   notifications dans *Moi › Réglages* puis relancez « Faire sonner » : une notification push arrive ;
   la toucher ouvre Oukilé et lance le son.
4. **Android (Chrome)** : mêmes étapes ; vérifiez la vibration et le niveau de batterie.
5. **OwnTracks** : créez des identifiants dans *Moi › Réglages*, configurez l'application en mode
   HTTP, verrouillez le téléphone et marchez : les positions continuent d'arriver. Vos lieux
   apparaissent dans l'application (Android : *Points de passage* ; iPhone : onglet
   *Zones*), et entrer dans l'un d'eux donne l'alerte aussitôt.
6. **Zones** : créez un lieu autour de vous, éloignez-vous de quelques centaines de mètres
   puis revenez : notifications « a quitté » / « est arrivé(e) ».
