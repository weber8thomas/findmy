# Vie privée et usage responsable

Oukilé manipule des positions de personnes : des données sensibles. Choix de conception :

- **Consentement d'abord.** Un appareil ne peut être enregistré **que depuis l'appareil
  lui-même** (*Moi › Réglages › Cet appareil*). Le partage avec une autre personne est
  **initié par la personne localisée** et doit être **accepté** par le destinataire. Il
  peut être limité dans le temps (1 h, fin de journée) et arrêté en un geste.
- **Visibilité.** Tant que le navigateur partage sa position, un **bandeau permanent**
  l'indique sur la carte, avec la liste des personnes qui la voient (*Moi › Votre
  position est visible par…*).
- **Moindre accès.** Une personne avec qui vous partagez ne voit que **votre position**,
  prise sur l'une de vos sources (*Moi › Ma position* ; l'appareil principal par défaut),
  et le nom de cet appareil : ni historique, ni batterie, ni commandes, ni la liste de vos
  appareils.
  Toute ressource non autorisée renvoie un 404. Une photo de profil n'est visible que par
  les personnes avec qui un partage est en cours, dans un sens ou dans l'autre (et par
  celle que vous invitez).
- **Rétention.** L'historique est purgé après `LOCATION_RETENTION_DAYS` jours (30 par défaut).
- **Secrets.** Mots de passe hachés (Argon2) ; jetons de session et d'appareil stockés
  hachés (SHA-256) ; secrets Apple chiffrés (Fernet).
- **Pas de chiffrement de bout en bout.** L'administrateur du serveur peut lire toutes les
  positions. N'hébergez Oukilé que pour des personnes qui vous font confiance.
- **Mode perdu.** Dans l'application web, c'est un écran plein qui s'affiche quand Oukilé
  est ouvert sur l'appareil : il ne verrouille rien. Seul le fournisseur iCloud déclenche
  le vrai mode Perdu d'Apple.

**Dans l'application.** La page *Confidentialité* (`/privacy`, lisible sans compte, liée
depuis la page de connexion et le pied de chaque panneau) résume ces points en français
et en anglais, avec la durée de rétention et les services tiers réellement utilisés par
le serveur (fond de carte, Apple si iCloud ou le réseau Find My est activé, service push
du navigateur, fournisseur SSO). Le site demande aussi à ne pas être indexé (`robots.txt`,
`X-Robots-Tag`, balise `robots`).

**Interdit :** utiliser Oukilé, OwnTracks ou des balises DIY pour suivre quelqu'un à son
insu. C'est illégal dans la plupart des pays (en France : atteinte à la vie privée, art.
226-1 et suivants du Code pénal).
