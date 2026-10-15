#!/usr/bin/env python3
"""Safely materialize a sealed release candidate archive.

The archive is untrusted input.  Its manifest is used only to derive an
allow-list of candidate files; release-artifact.mjs remains the authority for
the complete candidate digest after extraction.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import tarfile
from pathlib import Path


MAX_DECOMPRESSED_BYTES = 512 * 1024 * 1024
MAX_MEMBER_COUNT = 10_000
MAX_MANIFEST_BYTES = 16 * 1024 * 1024
READ_CHUNK_BYTES = 1024 * 1024
SHA256_LENGTH = 64
CANDIDATE_MANIFEST = "candidate/artifacts/release-candidate-manifest.json"
ARCHIVE_RECEIPT = "release-archive-receipt.json"


class ArchiveExtractionError(Exception):
    """Raised when an archive cannot be safely extracted."""


def _error(message: str) -> None:
    raise ArchiveExtractionError(message)


def _safe_member_name(raw_name: str) -> str:
    if not isinstance(raw_name, str) or not raw_name or "\x00" in raw_name:
        _error("archive member name is invalid")
    if "\\" in raw_name or raw_name.startswith("/"):
        _error(f"archive member path is not a safe relative POSIX path: {raw_name!r}")
    name = raw_name[:-1] if raw_name.endswith("/") else raw_name
    parts = name.split("/")
    if not name or any(part in ("", ".", "..") for part in parts):
        _error(f"archive member path is not canonical: {raw_name!r}")
    canonical = "/".join(parts)
    if raw_name.rstrip("/") != canonical:
        _error(f"archive member path is not canonical: {raw_name!r}")
    return canonical


def _validate_member_kind(member: tarfile.TarInfo) -> None:
    if member.issym() or member.islnk():
        _error(f"archive links are not allowed: {member.name!r}")
    if not member.isdir() and not member.isreg():
        _error(f"archive special entries are not allowed: {member.name!r}")
    if member.isdir() and member.size != 0:
        _error(f"archive directory has a non-zero size: {member.name!r}")
    if member.isreg() and (member.size < 0 or member.size > MAX_DECOMPRESSED_BYTES):
        _error(f"archive member exceeds the decompressed size limit: {member.name!r}")


def _read_member(archive: tarfile.TarFile, member: tarfile.TarInfo, capture: bool = False):
    if not member.isreg():
        _error(f"archive member is not a regular file: {member.name!r}")
    stream = archive.extractfile(member)
    if stream is None:
        _error(f"archive member body is unavailable: {member.name!r}")
    hasher = hashlib.sha256()
    captured = bytearray() if capture else None
    remaining = member.size
    while remaining:
        chunk = stream.read(min(READ_CHUNK_BYTES, remaining))
        if not chunk:
            _error(f"archive member is truncated: {member.name!r}")
        remaining -= len(chunk)
        hasher.update(chunk)
        if captured is not None:
            captured.extend(chunk)
            if len(captured) > MAX_MANIFEST_BYTES:
                _error("release candidate manifest exceeds the size limit")
    if stream.read(1):
        _error(f"archive member contains more data than its header declares: {member.name!r}")
    if captured is not None:
        return bytes(captured), len(captured), hasher.hexdigest()
    return None, member.size, hasher.hexdigest()


def _safe_relative_path(value, label: str) -> str:
    if not isinstance(value, str) or not value or "\x00" in value:
        _error(f"{label} must be a non-empty relative path")
    if "\\" in value or value.startswith("/"):
        _error(f"{label} must be a safe relative POSIX path")
    parts = value.split("/")
    if any(part in ("", ".", "..") for part in parts):
        _error(f"{label} must be a canonical relative POSIX path")
    canonical = "/".join(parts)
    if value != canonical:
        _error(f"{label} must be a canonical relative POSIX path")
    return canonical


def _file_record(value, label: str, expected_path: str | None = None):
    if not isinstance(value, dict):
        _error(f"{label} must be an object")
    relative_path = _safe_relative_path(value.get("path"), f"{label}.path")
    if expected_path is not None and relative_path != expected_path:
        _error(f"{label}.path does not match its component path")
    byte_count = value.get("bytes")
    if isinstance(byte_count, bool) or not isinstance(byte_count, int) or byte_count < 0:
        _error(f"{label}.bytes must be a non-negative integer")
    if byte_count > MAX_DECOMPRESSED_BYTES:
        _error(f"{label}.bytes exceeds the decompressed size limit")
    checksum = value.get("sha256")
    if (
        not isinstance(checksum, str)
        or len(checksum) != SHA256_LENGTH
        or any(character not in "0123456789abcdef" for character in checksum)
    ):
        _error(f"{label}.sha256 must be a SHA-256 digest")
    return relative_path, byte_count, checksum


def _manifest_file_records(manifest: object) -> dict[str, tuple[int, str]]:
    if not isinstance(manifest, dict):
        _error("release candidate manifest must be an object")
    components = manifest.get("components")
    if not isinstance(components, dict) or not components:
        _error("release candidate manifest components must be a non-empty object")

    records: dict[str, tuple[int, str]] = {}
    for component_name, component in components.items():
        label = f"release candidate manifest component {component_name!r}"
        if not isinstance(component_name, str) or not component_name:
            _error("release candidate manifest component names must be non-empty strings")
        if not isinstance(component, dict):
            _error(f"{label} must be an object")
        component_path = _safe_relative_path(component.get("path"), f"{label}.path")
        files = component.get("files")
        if files is not None:
            if not isinstance(files, list) or not files:
                _error(f"{label}.files must be a non-empty array")
            for index, file_value in enumerate(files):
                relative_path, byte_count, checksum = _file_record(
                    file_value,
                    f"{label}.files[{index}]",
                )
                if relative_path == component_path or not relative_path.startswith(f"{component_path}/"):
                    _error(f"{label}.files[{index}].path is outside its component directory")
                if relative_path in records:
                    _error(f"release candidate manifest contains duplicate file paths: {relative_path}")
                records[relative_path] = (byte_count, checksum)
        else:
            relative_path, byte_count, checksum = _file_record(component, label, component_path)
            if relative_path in records:
                _error(f"release candidate manifest contains duplicate file paths: {relative_path}")
            records[relative_path] = (byte_count, checksum)
    return records


def _allowed_names(records: dict[str, tuple[int, str]]) -> tuple[set[str], set[str]]:
    files = {f"candidate/{relative_path}" for relative_path in records}
    files.add(CANDIDATE_MANIFEST)
    files.add(ARCHIVE_RECEIPT)
    directories = {"candidate"}
    for name in files:
        if not name.startswith("candidate/"):
            continue
        parts = name.split("/")[:-1]
        directories.update("/".join(parts[:index]) for index in range(1, len(parts) + 1))
    return files, directories


def _ready_output(output: Path) -> None:
    if output.is_symlink():
        _error("output directory must not be a symbolic link")
    if output.exists():
        if not output.is_dir():
            _error("output path must be a directory")
        try:
            next(output.iterdir())
        except StopIteration:
            return
        _error("output directory must be absent or empty")


def _destination(output: Path, name: str) -> Path:
    relative = Path(*name.split("/"))
    destination = output / relative
    output_root = output.resolve()
    candidate = destination.resolve()
    try:
        common = os.path.commonpath((str(output_root), str(candidate)))
    except ValueError:
        _error(f"archive member destination is outside the output directory: {name!r}")
    if common != str(output_root):
        _error(f"archive member destination is outside the output directory: {name!r}")
    return destination


def _validate_archive(archive: tarfile.TarFile):
    normalized: list[tuple[tarfile.TarInfo, str]] = []
    names: set[str] = set()
    total_bytes = 0
    for member_index, member in enumerate(archive, start=1):
        if member_index > MAX_MEMBER_COUNT:
            _error(f"archive contains more than {MAX_MEMBER_COUNT} members")
        _validate_member_kind(member)
        name = _safe_member_name(member.name)
        if name in names:
            _error(f"archive contains a duplicate member: {name!r}")
        names.add(name)
        normalized.append((member, name))
        if member.isreg():
            total_bytes += member.size
            if total_bytes > MAX_DECOMPRESSED_BYTES:
                _error(f"archive exceeds the {MAX_DECOMPRESSED_BYTES} byte decompressed size limit")

    manifest_member = next((member for member, name in normalized if name == CANDIDATE_MANIFEST), None)
    receipt_member = next((member for member, name in normalized if name == ARCHIVE_RECEIPT), None)
    if manifest_member is None:
        _error(f"archive is missing {CANDIDATE_MANIFEST}")
    if receipt_member is None:
        _error(f"archive is missing {ARCHIVE_RECEIPT}")

    manifest_bytes, _, _ = _read_member(archive, manifest_member, capture=True)
    try:
        manifest = json.loads(manifest_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        _error("release candidate manifest is not valid UTF-8 JSON")
    records = _manifest_file_records(manifest)
    allowed_files, allowed_directories = _allowed_names(records)

    member_by_name = {name: member for member, name in normalized}
    for member, name in normalized:
        if name in allowed_files:
            if not member.isreg():
                _error(f"allowed archive file is not regular: {name!r}")
        elif name in allowed_directories:
            if not member.isdir():
                _error(f"allowed archive directory is not a directory: {name!r}")
        else:
            _error(f"archive contains an unexpected member: {name!r}")

    for relative_path, (byte_count, checksum) in records.items():
        name = f"candidate/{relative_path}"
        member = member_by_name.get(name)
        if member is None:
            _error(f"archive is missing candidate member: {name!r}")
        _, actual_bytes, actual_checksum = _read_member(archive, member)
        if actual_bytes != byte_count or actual_checksum != checksum:
            _error(f"candidate member does not match its release manifest: {name!r}")

    # Read the receipt before extraction so a malformed tar stream cannot fail
    # after files have already been written.
    _read_member(archive, receipt_member)
    return normalized


def extract_release_archive(archive_path: Path, output: Path) -> None:
    if archive_path.is_symlink() or not archive_path.is_file():
        _error("archive path must be a regular file")
    _ready_output(output)
    try:
        with tarfile.open(archive_path, mode="r:*") as archive:
            members = _validate_archive(archive)
            _ready_output(output)
            output.mkdir(parents=True, exist_ok=True)
            for member, name in members:
                destination = _destination(output, name)
                if member.isdir():
                    destination.mkdir(parents=True, exist_ok=True)
                    continue
                destination.parent.mkdir(parents=True, exist_ok=True)
                stream = archive.extractfile(member)
                if stream is None:
                    _error(f"archive member body is unavailable: {name!r}")
                with destination.open("xb") as target:
                    shutil.copyfileobj(stream, target, length=READ_CHUNK_BYTES)
    except ArchiveExtractionError:
        raise
    except (OSError, tarfile.TarError, ValueError, EOFError) as error:
        _error(f"archive could not be read safely: {error}")


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(f"usage: {argv[0]} ARCHIVE OUTPUT_DIR", file=sys.stderr)
        return 2
    try:
        extract_release_archive(Path(argv[1]), Path(argv[2]))
    except ArchiveExtractionError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(f"extracted release archive to {argv[2]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
