from app.models import DeviceKind
from app.providers.base import Capability, Provider


class BrowserProvider(Provider):
    """The web app itself: the device reports its own position while the page is open."""

    kind = DeviceKind.BROWSER
    capabilities = frozenset({Capability.REALTIME, Capability.PLAY_SOUND, Capability.LOST_MODE})
    client_executed_commands = True
