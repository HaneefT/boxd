"""Daily Supabase keep-alive"""
import os
import urllib.request


def handler(event, context):
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    req = urllib.request.Request(
        f"{base}/rest/v1/films?select=tmdb_id&limit=1",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return {"ok": True, "status": resp.status}
