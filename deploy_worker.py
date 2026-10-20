#!/usr/bin/env python3
"""Deploy parlaykings.net worker (script name 'ai') via Cloudflare API.

Replicates wrangler.jsonc exactly: KV SAM_BETS, R2 AVATARS, browser BROWSER,
send_email EMAIL, observability on, cron */5 * * * * *. Worker secrets are NOT
touched by a script upload (they live separately). Run from the repo root.
"""
import json
import sys
import urllib.request

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

ACCOUNT_ID = "2c63cf041ed339e91ac730f313a1dc26"
SCRIPT_NAME = "ai"
BASE = "https://api.cloudflare.com/client/v4"

with open("src/index.js", "rb") as f:
    script = f.read()
print(f"script bytes: {len(script)}", flush=True)

metadata = {
    "main_module": "index.js",
    "compatibility_date": "2026-08-04",
    "bindings": [
        {"type": "kv_namespace", "name": "SAM_BETS",
         "namespace_id": "de1fea6598a74ff2820fcf4bb930933c"},
        {"type": "r2_bucket", "name": "AVATARS",
         "bucket_name": "parlaykings-avatars"},
        {"type": "browser", "name": "BROWSER"},
        {"type": "send_email", "name": "EMAIL"},
    ],
    "observability": {"enabled": True},
    "triggers": {"crons": ["*/5 * * * *"]},
}

boundary = "----muse-deploy-7f3a9c2d"
parts = []
parts.append(
    f"--{boundary}\r\n"
    'Content-Disposition: form-data; name="metadata"\r\n'
    "Content-Type: application/json\r\n\r\n"
    + json.dumps(metadata) + "\r\n"
)
parts.append(
    f"--{boundary}\r\n"
    'Content-Disposition: form-data; name="index.js"; filename="index.js"\r\n'
    "Content-Type: application/javascript+module\r\n\r\n"
)
body = "".join(parts).encode() + script + f"\r\n--{boundary}--\r\n".encode()

url = f"{BASE}/accounts/{ACCOUNT_ID}/workers/scripts/{SCRIPT_NAME}"
req = urllib.request.Request(url, data=body, method="PUT")
req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
add_surrogate_to_request(req, "custom.cloudflare", allowed_hosts=["api.cloudflare.com"])
resp = urllib.request.urlopen(req, timeout=120)
payload = read_json_response(resp)
if not payload.get("success"):
    print(json.dumps(payload.get("errors", payload), indent=2))
    sys.exit(1)
r = payload["result"]
print(json.dumps({"id": r.get("id"), "etag": r.get("etag"),
                  "modified_on": r.get("modified_on"),
                  "deployment_id": r.get("deployment_id")}, indent=2))
print("DEPLOY OK")
