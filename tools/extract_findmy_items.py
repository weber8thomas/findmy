#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["cryptography>=42"]
# ///
"""Decrypt the Find My items of this Mac (AirTags, third-party tags) into .plist files
to import in Oukilé (Items > Find My network > Import an AirTag).

Run it yourself, on a Mac signed in to the Apple account that owns the items:

    uv run tools/extract_findmy_items.py            # writes ~/oukile-items/
    uv run tools/extract_findmy_items.py --list     # only list the items

macOS asks for your login password (twice) to release the "BeaconStore" key from the
keychain: click "Allow", not "Always Allow". If reading the Find My folder fails with
"Operation not permitted", give your terminal Full Disk Access (System Settings >
Privacy & Security), and take it back afterwards.

The files hold each item's PRIVATE key: anyone with them can follow the item. Keep them
out of synced folders (Desktop, Documents, iCloud Drive), import them, then delete them.
Based on FindMy.py (findmy/plist.py, MIT), itself based on OpenTagViewer.
"""

from __future__ import annotations

import argparse
import os
import plistlib
import re
import subprocess
import sys
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

SOURCE = Path.home() / "Library" / "com.apple.icloud.searchpartyd"


def beaconstore_key() -> bytes:
    """The key Find My encrypts its records with, from the login keychain."""
    cmd = ["/usr/bin/security", "find-generic-password", "-l", "BeaconStore"]
    out = subprocess.run([*cmd, "-w"], capture_output=True, text=True).stdout.strip()
    if re.fullmatch(r"(?:[0-9a-fA-F]{2}){16,32}", out):
        return bytes.fromhex(out)
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    m = re.search(r'"gena"<blob>=0x([0-9A-Fa-f]+)', out)
    if not m:
        sys.exit("No BeaconStore key in the keychain (access refused, or Find My never ran here).")
    return bytes.fromhex(m.group(1))


def decrypt(path: Path, key: bytes) -> dict:
    """A .record file is a plist [nonce, tag, ciphertext] (AES-GCM) holding a plist."""
    nonce, tag, ciphertext = plistlib.loads(path.read_bytes())[:3]
    data = plistlib.loads(AESGCM(key).decrypt(nonce, ciphertext + tag, None))
    if not isinstance(data, dict):
        raise ValueError(f"{path.name}: unexpected content")
    return data


def first_record(folder: Path) -> Path | None:
    return next(iter(sorted(folder.glob("*.record"))), None) if folder.is_dir() else None


def item_name(source: Path, uid: str, beacon: dict, key: bytes) -> str:
    parts = []
    group = beacon.get("groupIdentifier")
    if group and (source / "OwnedBeaconGroups" / f"{group}.record").exists():
        parts.append(decrypt(source / "OwnedBeaconGroups" / f"{group}.record", key).get("name"))
    naming = first_record(source / "BeaconNamingRecord" / uid)
    if naming:
        record = decrypt(naming, key)
        parts.append(" ".join(p for p in (record.get("emoji"), record.get("name")) if p))
    return " - ".join(p for p in parts if p) or uid


def safe(name: str) -> str:
    return re.sub(r"[^\w\- ]+", "", name, flags=re.UNICODE).strip() or "item"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", type=Path, default=Path.home() / "oukile-items")
    parser.add_argument("--list", action="store_true", help="list the items, write nothing")
    parser.add_argument("--source", type=Path, default=SOURCE, help=argparse.SUPPRESS)
    parser.add_argument("--key", help=argparse.SUPPRESS)  # hex, for tests
    args = parser.parse_args()

    try:
        records = sorted((args.source / "OwnedBeacons").glob("*.record"))
    except PermissionError:
        sys.exit("Operation not permitted: give your terminal Full Disk Access, then retry.")
    if not records:
        sys.exit(f"No item found in {args.source}/OwnedBeacons.")
    key = bytes.fromhex(args.key) if args.key else beaconstore_key()

    if not args.list:
        args.out.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(args.out, 0o700)
    for rec in records:
        uid = rec.stem
        beacon = decrypt(rec, key)
        name = item_name(args.source, uid, beacon, key)
        model = beacon.get("model", "?")
        line = f"{name}  (model {model})"
        if not args.list:
            base = args.out / safe(name)
            files = [(base.with_name(f"{base.name}.plist"), beacon)]
            alignment = first_record(args.source / "KeyAlignmentRecords" / uid)
            if alignment:
                files.append(
                    (base.with_name(f"{base.name} - alignment.plist"), decrypt(alignment, key))
                )
            for path, content in files:
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(fd, "wb") as f:
                    plistlib.dump(content, f)
            line += "  ->  " + ", ".join(p.name for p, _ in files)
        print(line)
    if not args.list:
        print(f"\nWritten to {args.out} (private keys: delete the folder after the import).")


if __name__ == "__main__":
    main()
