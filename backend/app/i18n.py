"""Server-side strings (push notifications). The web UI has its own catalogue."""

from __future__ import annotations

MESSAGES: dict[str, dict[str, str]] = {
    "en": {
        "zone_enter.title": "{who} arrived",
        "zone_enter.body": "{who} arrived at {zone}",
        "zone_exit.title": "{who} left",
        "zone_exit.body": "{who} left {zone}",
        "share_invite.title": "Location sharing",
        "share_invite.body": "{name} wants to share their location with you",
        "share_accepted.title": "Location sharing",
        "share_accepted.body": "{name} can now see your location",
        "share_stopped.title": "Location sharing",
        "share_stopped.body": "{name} stopped sharing their location with you",
        "provider_error.title": "Account needs attention",
        "provider_error.body": "{provider}: {error}",
        "play_sound.title": "Oukilé: playing a sound",
        "play_sound.body": "Someone is looking for this device. Tap to stop.",
        "lost_mode_on.title": "This device is lost",
        "lost_mode_on.body": "{message}",
    },
    "fr": {
        "zone_enter.title": "{who} est arrivé(e)",
        "zone_enter.body": "{who} est arrivé(e) à {zone}",
        "zone_exit.title": "{who} est parti(e)",
        "zone_exit.body": "{who} a quitté {zone}",
        "share_invite.title": "Partage de position",
        "share_invite.body": "{name} souhaite partager sa position avec vous",
        "share_accepted.title": "Partage de position",
        "share_accepted.body": "{name} peut maintenant voir votre position",
        "share_stopped.title": "Partage de position",
        "share_stopped.body": "{name} ne partage plus sa position avec vous",
        "provider_error.title": "Compte à vérifier",
        "provider_error.body": "{provider} : {error}",
        "play_sound.title": "Oukilé : sonnerie en cours",
        "play_sound.body": "Quelqu'un cherche cet appareil. Touchez pour arrêter.",
        "lost_mode_on.title": "Cet appareil est perdu",
        "lost_mode_on.body": "{message}",
    },
}


def t(locale: str | None, key: str, **params: object) -> str:
    catalogue = MESSAGES.get(locale or "en", MESSAGES["en"])
    template = catalogue.get(key) or MESSAGES["en"].get(key, key)
    try:
        return template.format(**params)
    except (KeyError, IndexError):
        return template
