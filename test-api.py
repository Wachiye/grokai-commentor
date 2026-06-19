#!/usr/bin/env python3
"""Diagnose xAI Grok API auth/model errors."""
import json
import os
import sys
import urllib.error
import urllib.request

API_URL = "https://api.x.ai/v1/chat/completions"
MODELS_URL = "https://api.x.ai/v1/models"


def request(url, api_key, payload=None):
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="GET" if payload is None else "POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, body
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return e.code, body


def key_profile(api_key):
    if not api_key:
        return "missing"
    if api_key.startswith("xai-"):
        return "xai-api-key"
    if api_key.startswith("eyJ"):
        return "jwt-session-token (WRONG for api.x.ai)"
    return "unknown-format"


def main():
    api_key = os.environ.get("XAI_API_KEY", "").strip()
    if len(sys.argv) > 1:
        api_key = sys.argv[1].strip()

    print("Grok API Diagnostics")
    print("====================")
    print(f"Key profile: {key_profile(api_key)}")
    if api_key:
        print(f"Key prefix: {api_key[:12]}...")
    else:
        print("No API key provided. Pass as arg or set XAI_API_KEY.")
        return 1

    print("\n1) List models")
    status, body = request(MODELS_URL, api_key)
    print(f"   HTTP {status}")
    print(f"   {body[:500]}")

    models_to_try = ["grok-4.3", "grok-3-fast", "grok-3", "grok-3-mini", "grok-4-0709"]
    print("\n2) Chat completion probe")
    for model in models_to_try:
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": "Say OK"}],
            "max_completion_tokens": 16,
        }
        status, body = request(API_URL, api_key, payload)
        print(f"   model={model} -> HTTP {status}")
        try:
            parsed = json.loads(body)
            err = parsed.get("error")
            if err:
                if isinstance(err, dict):
                    print(f"      error: {err.get('message') or err}")
                else:
                    print(f"      error: {err}")
            elif status == 200:
                content = parsed["choices"][0]["message"]["content"]
                print(f"      success: {content[:80]!r}")
        except json.JSONDecodeError:
            print(f"      body: {body[:200]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())