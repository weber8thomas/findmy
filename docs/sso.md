# Connexion unique (SSO) avec OpenID Connect

Oukilé peut déléguer la connexion à un fournisseur OpenID Connect : Authentik, Keycloak,
Zitadel, Google… La page de connexion affiche alors **« Continuer avec Authentik »**.

## Côté fournisseur (exemple Authentik)

1. **Applications → Providers → Create → OAuth2/OpenID Provider**
   - Client type : **Confidential**
   - Redirect URI (strict) : `https://oukile.example.com/api/auth/oidc/callback`
   - Scopes : `openid`, `email`, `profile` (ceux par défaut)
   - Grant types : au moins **Authorization Code**. Par l'API ou un blueprint, renseignez
     `grant_types: [authorization_code]` : vide, Authentik refuse la connexion
     (`invalid_request`, « Invalid grant_type for provider » dans ses logs).
2. **Applications → Applications → Create** : nom « Oukilé », slug `oukile`, ce provider.
   Pour limiter l'accès à certaines personnes, liez un groupe à l'application
   (« Policy / Group / User Bindings »).
3. Notez le **Client ID**, le **Client Secret** et l'**OpenID Configuration Issuer**
   (`https://auth.example.com/application/o/oukile/`).

## Côté Oukilé

```env
BASE_URL=https://oukile.example.com
TRUST_PROXY=true
OIDC_ISSUER=https://auth.example.com/application/o/oukile/
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
OIDC_NAME=Authentik
```

`BASE_URL` donne l'adresse de retour (`/api/auth/oidc/callback`), qui doit être
identique à celle déclarée chez le fournisseur. Le serveur Oukilé doit pouvoir joindre
l'issuer (DNS et pare-feu) : il y lit la configuration et y échange le code de connexion.

## Comptes

À la première connexion SSO, Oukilé cherche, dans l'ordre :

1. le compte déjà lié à cette identité (elle reste liée même si l'email change ensuite) ;
2. un compte existant **avec le même email** : il est lié, l'historique est conservé ;
3. sinon il crée un compte, si les inscriptions sont ouvertes (`ALLOW_REGISTRATION`, ou
   `OIDC_REGISTRATION=true` pour n'autoriser que les nouveaux comptes SSO). Le tout premier
   compte devient administrateur.

Sinon la page de connexion indique qu'aucun compte Oukilé ne correspond.

Avec `PASSWORD_LOGIN=false`, le formulaire email / mot de passe disparaît : seule la
connexion SSO reste. OwnTracks n'est pas concerné (il utilise le jeton de l'appareil).

## Photo de profil

Si le fournisseur envoie la claim standard `picture` (dans l'ID token ou via userinfo),
Oukilé la télécharge à chaque connexion et en fait la photo de profil, sauf si la
personne a choisi sa propre photo dans *Moi › Profil*. Seules les images PNG,
JPEG, WebP ou GIF de 300 Ko au plus sont prises, en `https://` (5 s maximum) ou en
`data:` base64 ; un SVG est ignoré. En cas d'échec, la connexion se fait sans photo.
Authentik n'envoie pas `picture` par défaut : il faut l'ajouter par un scope mapping.

## Sécurité

- Flux « authorization code » avec PKCE (S256), `state` et `nonce` dans un cookie chiffré
  valable 10 minutes.
- L'ID token est reçu directement du fournisseur, en HTTPS, contre le secret client : sa
  signature n'est pas vérifiée (OpenID Connect Core 3.1.3.7), mais l'émetteur, l'audience,
  l'expiration et le nonce le sont.
- Le lien par email suppose que le fournisseur est de confiance (c'est vous qui gérez les
  emails dans Authentik). Une seconde identité du même fournisseur ne peut pas prendre un
  compte déjà lié.
- La déconnexion d'Oukilé ne ferme pas la session Authentik.
