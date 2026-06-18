"""Supabase Storage access for the worker (stdlib only, service-role key).

The export ZIP is uploaded by the SPA to the private `exports` bucket under
exports/<user_id>/..., then the worker downloads it here (service role bypasses
Storage RLS), processes it, and deletes it — we never retain the raw file.
"""
from __future__ import annotations

import os
import urllib.error
import urllib.request

BUCKET = "exports"


class StorageError(Exception):
    pass


def _base_and_key() -> tuple[str, str]:
    try:
        base = os.environ["SUPABASE_URL"].rstrip("/") + "/storage/v1"
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    except KeyError as e:
        raise StorageError(f"missing env var {e}") from e
    return base, key


def _request(method: str, path: str, timeout: float = 30.0) -> bytes:
    base, key = _base_and_key()
    req = urllib.request.Request(
        f"{base}/object/{path}", method=method,
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        raise StorageError(f"Storage {e.code} on {method} {path}: {detail}") from e
    except urllib.error.URLError as e:
        raise StorageError(f"Storage network error on {method} {path}: {e}") from e


def download_export(object_path: str) -> bytes:
    """object_path is the key within the bucket, e.g. '<user_id>/export.zip'."""
    return _request("GET", f"{BUCKET}/{object_path}")


def delete_export(object_path: str) -> None:
    _request("DELETE", f"{BUCKET}/{object_path}")
