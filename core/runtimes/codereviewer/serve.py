#!/usr/bin/env python3
"""Sidecar for Microsoft CodeReviewer (T5, arXiv:2203.09095) and its fine-tunes.

Standard library HTTP server. Loads the checkpoint with Transformers once, then answers:

  GET  /health                 -> {"status": "ok", "model": "...", "device": "cpu"}
  POST /v1/review              -> {"comments": [{"index": i, "comment": "..."}]}
       body: {"hunks": [{"file": "path", "diff": "<hunk body, +/-/space prefixed lines>"}], "max_new_tokens": 96}

Diff encoding follows the paper's comment-generation task: each line is prefixed with <add>, <del> or <keep>,
the source is truncated to 512 tokens, and generation starts from the <msg> token.

One review runs at a time (the model is not re-entrant). A request that cannot take the lock within
LOCK_TIMEOUT seconds gets 503; bodies over MAX_BODY bytes get 413. /health never takes the lock.
"""
import argparse
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser()
parser.add_argument("--model", required=True, help="directory with config.json, pytorch_model.bin and tokenizer files")
parser.add_argument("--port", type=int, default=47130)
parser.add_argument("--device", default="auto", help="auto | cpu | cuda")
parser.add_argument("--max-source", type=int, default=512)
args = parser.parse_args()

import torch  # noqa: E402
from transformers import AutoTokenizer, T5ForConditionalGeneration  # noqa: E402

MAX_BODY = 2 * 1024 * 1024  # 2 MB
LOCK_TIMEOUT = 600  # seconds a request waits for the model before giving up with 503

device = args.device
if device == "auto":
    device = "cuda" if torch.cuda.is_available() else "cpu"
torch.set_num_threads(max(1, torch.get_num_threads()))

t0 = time.time()
tokenizer = AutoTokenizer.from_pretrained(args.model)
model = T5ForConditionalGeneration.from_pretrained(args.model).to(device).eval()
SPECIAL = {k: tokenizer.convert_tokens_to_ids(k) for k in ("<add>", "<del>", "<keep>", "<msg>", "<start>", "<end>")}
# A checkpoint without the task's special tokens maps them to <unk>; every prompt would then be garbage.
_missing = [k for k, v in SPECIAL.items() if v is None or v == tokenizer.unk_token_id]
if _missing:
    sys.stderr.write(
        f"[codereviewer] tokenizer at {args.model} lacks the CodeReviewer special tokens {_missing} "
        "(they resolve to <unk>); this is not a CodeReviewer checkpoint or its tokenizer files are missing.\n"
    )
    sys.stderr.flush()
    sys.exit(1)
MODEL_NAME = args.model.replace("\\", "/").rstrip("/").split("/")[-1]
print(f"[codereviewer] loaded {MODEL_NAME} on {device} in {time.time() - t0:.1f}s", flush=True)
lock = threading.Lock()


def encode_hunk(diff: str) -> str:
    """Prefix every diff line with the task's markers (SimpleGenDataset in the reference code)."""
    out = []
    for line in diff.splitlines():
        if not line:
            continue
        if line.startswith("+"):
            out.append("<add>" + line[1:])
        elif line.startswith("-"):
            out.append("<del>" + line[1:])
        else:
            out.append("<keep>" + (line[1:] if line.startswith(" ") else line))
    return "".join(out)


def review(hunks, max_new_tokens=96):
    """Caller holds `lock`."""
    results = []
    for i, h in enumerate(hunks):
        src = encode_hunk(h.get("diff", "") if isinstance(h, dict) else "")
        if not src.strip():
            results.append({"index": i, "comment": ""})
            continue
        ids = tokenizer(src, max_length=args.max_source, truncation=True, return_tensors="pt").input_ids.to(device)
        with torch.no_grad():
            out = model.generate(
                ids,
                decoder_input_ids=torch.tensor([[SPECIAL["<msg>"]]], device=device),
                max_new_tokens=max_new_tokens,
                num_beams=4,
                early_stopping=True,
                no_repeat_ngram_size=3,
            )
        text = tokenizer.decode(out[0], skip_special_tokens=True).strip()
        for tok in ("<msg>", "<start>", "<end>"):
            text = text.replace(tok, "")
        text = text.strip()
        results.append({"index": i, "comment": text})
    return results


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a):  # quiet
        sys.stderr.write("[codereviewer] " + (fmt % a) + "\n")

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"status": "ok", "model": MODEL_NAME, "device": device})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/v1/review":
            return self._json(404, {"error": "not found"})
        try:
            n = int(self.headers.get("content-length") or 0)
        except ValueError:
            return self._json(400, {"error": "invalid content-length"})
        if n < 0:
            return self._json(400, {"error": "invalid content-length"})
        if n > MAX_BODY:
            return self._json(413, {"error": f"request body too large ({n} bytes; limit {MAX_BODY})"})
        try:
            req = json.loads(self.rfile.read(n) or b"{}")
        except ValueError as e:
            return self._json(400, {"error": f"invalid JSON: {e}"})
        if not isinstance(req, dict):
            return self._json(400, {"error": "request body must be a JSON object"})
        hunks = req.get("hunks") or []
        if not isinstance(hunks, list):
            return self._json(400, {"error": "'hunks' must be a list"})
        if not lock.acquire(timeout=LOCK_TIMEOUT):
            return self._json(503, {"error": f"model busy: no slot within {LOCK_TIMEOUT}s"})
        try:
            t = time.time()
            comments = review(hunks[:64], int(req.get("max_new_tokens") or 96))
            self._json(200, {"model": MODEL_NAME, "device": device, "comments": comments, "latency_ms": round((time.time() - t) * 1000)})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})
        finally:
            lock.release()


ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
