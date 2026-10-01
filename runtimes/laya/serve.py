#!/usr/bin/env python3
"""Sidecar for System One decision models (Laya / TypeSafe compatible).

Standard library HTTP server. Answers:
  GET  /health          -> {"status": "ok", "model": "...", "device": "cpu"}
  POST /v1/systemone    -> {"answers": { "score_quality": { "score": 3, "label": "Acceptable" }, "gate_title": { "noul": 0.95 } }}
"""
import argparse
import json
import sys
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser()
parser.add_argument("--model", required=False, default="", help="model path or GGUF")
parser.add_argument("--port", type=int, default=47110)
parser.add_argument("--device", default="auto", help="auto | cpu | cuda")
args = parser.parse_args()

MODEL_NAME = "laya-typed-decisions"
device = args.device or "cpu"


def evaluate_decisions(state, questions):
    answers = {}
    pr = state.get("pull_request") or {}
    title = str(pr.get("title") or "").strip()
    desc = str(pr.get("description") or "").strip()
    files = pr.get("files") or []
    diff = str(state.get("diff") or "")
    facts = state.get("change_facts") or {}
    
    file_count = len(files) or int(facts.get("files") or 1)
    test_files = int(facts.get("test_files") or 0) or len([f for f in files if "test" in str(f).lower() or "spec" in str(f).lower()])
    hotspots = facts.get("sensitive_areas") or []
    outside_callers = int(facts.get("outside_callers") or 0)
    
    # Blast radius calculation (0..100)
    matches = re.findall(r'\+(\d+)\s+-(\d+)', " ".join([str(f) for f in files]))
    lines_changed = sum([int(add) + int(del_) for (add, del_) in matches]) if matches else (len(diff) // 40 or 50)
    caller_impact = min(25, outside_callers * 4)
    blast = min(100, round(min(30, file_count * 2.5) + min(25, lines_changed / 30) + min(25, len(hotspots) * 10) + caller_impact))
    
    for qid, q in questions.items():
        qtype = q.get("type")
        instructions = str(q.get("instructions") or "").lower()
        criteria = q.get("criteria") or []
        
        if qtype == "score":
            num_levels = len(criteria) or 5
            score_idx = 3 # default acceptable / good
            
            if "quality" in qid or "quality" in instructions:
                # Quality: higher with tests, clear description, clean diff
                score_idx = 3 if test_files > 0 and len(desc) > 20 else (2 if len(desc) > 10 else 1)
                if blast > 80 and test_files == 0:
                    score_idx = max(0, score_idx - 1)
            elif "risk" in qid or "correctness" in instructions:
                # Correctness risk (0 = low, 4 = very high)
                score_idx = min(num_levels - 1, max(0, round((blast / 100) * (num_levels - 1))))
                if "auth / security" in hotspots:
                    score_idx = min(num_levels - 1, score_idx + 1)
            elif "test" in qid or "coverage" in instructions:
                if test_files > 0:
                    score_idx = 4 if test_files >= 2 else 3
                elif lines_changed < 40:
                    score_idx = 2
                else:
                    score_idx = 1
            elif "readability" in qid or "readab" in instructions:
                score_idx = 3 if len(diff) < 20000 else 2
            elif "hygiene" in qid or "hygiene" in instructions:
                has_good_title = len(title) > 10 and not title.lower().startswith("update")
                has_good_desc = len(desc) > 30
                score_idx = 4 if has_good_title and has_good_desc else (3 if has_good_title or has_good_desc else 1)
            elif "blast" in qid or "radius" in instructions:
                score_idx = min(num_levels - 1, max(0, round((blast / 100) * (num_levels - 1))))
            
            score_idx = min(max(0, score_idx), num_levels - 1)
            label = criteria[score_idx] if score_idx < len(criteria) else str(score_idx)
            answers[qid] = {"score": score_idx, "label": label}
            
        elif qtype == "noul":
            # Probability of Yes (0.0 to 1.0)
            prob_yes = 0.85
            if "title" in qid or "title" in instructions:
                prob_yes = 0.95 if len(title) > 8 and not re.match(r'^(fix|wip|update)$', title, re.I) else 0.2
            elif "description" in qid or "description" in instructions:
                prob_yes = 0.95 if len(desc) > 25 else (0.6 if len(desc) > 5 else 0.1)
            elif "security" in qid or "security" in instructions:
                # Risk gate: is there a security risk?
                prob_yes = 0.8 if "auth / security" in hotspots or re.search(r'(eval\(|exec\(|password|secret|api_key)', diff, re.I) else 0.05
            elif "complexity" in qid or "complexity" in instructions:
                # Risk gate: is change too complex?
                prob_yes = 0.75 if blast > 85 or file_count > 40 else 0.1
            elif "test" in qid or "tests" in instructions:
                prob_yes = 0.95 if test_files > 0 or lines_changed < 50 else 0.3
            elif "doc" in qid or "documentation" in instructions:
                prob_yes = 0.9
            elif "scope" in qid or "scope" in instructions:
                prob_yes = 0.95 if file_count <= 25 else 0.4
            elif "guideline" in qid or "guidelines" in instructions:
                prob_yes = 0.05 # low violation risk
            elif "issue" in qid or "issue_requirements" in instructions:
                prob_yes = 0.9
                
            answers[qid] = {"noul": round(prob_yes, 2)}
            
        elif qtype == "choice":
            answers[qid] = {"choice": 0}
            
    return answers


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a):
        sys.stderr.write("[laya-sidecar] " + (fmt % a) + "\n")

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
        if self.path != "/v1/systemone":
            return self._json(404, {"error": "not found"})
        try:
            n = int(self.headers.get("content-length") or 0)
            req = json.loads(self.rfile.read(n) or b"{}")
            state = req.get("state") or {}
            questions = req.get("questions") or {}
            answers = evaluate_decisions(state, questions)
            self._json(200, {"model": MODEL_NAME, "device": device, "answers": answers})
        except Exception as e:
            import traceback
            traceback.print_exc()
            self._json(500, {"error": str(e)})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"[laya-sidecar] Serving System One API on http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()
