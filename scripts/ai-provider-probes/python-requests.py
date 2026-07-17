"""
Generated-only Python requests probe.

Set NVIDIA_API_KEY or NEMOTRON_API_KEY to the same stored provider key before
running. This script intentionally does not decrypt Supabase AES-GCM secrets,
because the project has no Python crypto/Supabase runtime dependency.
"""

import json
import os
import time

import requests


URL = "https://integrate.api.nvidia.com/v1/chat/completions"
TIMEOUT_SECONDS = int(os.environ.get("AI_PROBE_TIMEOUT_SECONDS", "45"))


def log(event, **payload):
    print(json.dumps({
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "event": event,
        **payload,
    }, indent=2))


api_key = os.environ.get("NVIDIA_API_KEY") or os.environ.get("NEMOTRON_API_KEY")
if not api_key:
    raise SystemExit("Set NVIDIA_API_KEY or NEMOTRON_API_KEY before running this probe.")

body = {
    "model": "z-ai/glm-5.2",
    "messages": [
        {
            "role": "user",
            "content": "Respond with a short plain-text acknowledgement.",
        }
    ],
    "temperature": 0,
    "max_tokens": 64,
}

headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {api_key}",
}

started = time.time()
log("python_requests:start", url=URL, timeout_seconds=TIMEOUT_SECONDS, headers={
    "Content-Type": "application/json",
    "Authorization": "[redacted]",
}, body=body)

try:
    response = requests.post(URL, headers=headers, json=body, timeout=TIMEOUT_SECONDS)
    log("python_requests:response", elapsed_ms=round((time.time() - started) * 1000),
        status=response.status_code, headers=dict(response.headers),
        body=response.text.replace("\n", " ")[:1000])
except Exception as exc:
    log("python_requests:error", elapsed_ms=round((time.time() - started) * 1000),
        error_type=type(exc).__name__, message=str(exc))
