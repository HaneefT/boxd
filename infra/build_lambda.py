"""Stage the process_upload package into infra/build/pkg for zipping.

Terraform's archive_file then zips build/pkg so the deployment archive keeps the
`process_upload/` directory (the handler uses package-relative imports). Run via
the null_resource in lambda.tf; safe to run by hand too.
"""
import os
import shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(ROOT, "..", "backend", "process_upload"))
PKG_DIR = os.path.join(ROOT, "build", "pkg")
DST = os.path.join(PKG_DIR, "process_upload")

if os.path.isdir(PKG_DIR):
    shutil.rmtree(PKG_DIR)
os.makedirs(PKG_DIR, exist_ok=True)
shutil.copytree(SRC, DST, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "out"))
print(f"staged {SRC} -> {DST}")
