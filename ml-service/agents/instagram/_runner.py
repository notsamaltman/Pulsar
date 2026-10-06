"""
Standalone subprocess runner for the Instagram agent.

This module is executed as a child process by master_agent.py to work around
the incompatibility between Playwright's sync API and LangGraph's internal
asyncio event loop.

Flow:
    master_agent._run_instagram()
        → subprocess.run([sys.executable, "_runner.py"])
            → reads JSON payload from stdin
            → graph.invoke(payload)  # no asyncio loop present here
            → writes JSON result to stdout

Because this is a fresh Python process, there is NO running asyncio event loop
when sync_playwright().start() is called, so Playwright works correctly.
"""

import sys
import os
import json
import traceback

# Ensure project root and ml-service root are on the path
_file_dir = os.path.dirname(os.path.abspath(__file__))
_mlservice_root = os.path.abspath(os.path.join(_file_dir, "..", ".."))
sys.path.insert(0, _mlservice_root)

from dotenv import load_dotenv
load_dotenv(os.path.join(_mlservice_root, ".env"))


def main() -> None:
    try:
        sys.stderr.reconfigure(line_buffering=True)
    except Exception:
        pass
    print("[instagram-runner] starting", flush=True, file=sys.stderr)

    # Read payload JSON from stdin (written by master_agent._run_instagram)
    raw = sys.stdin.read().strip()
    if not raw:
        _fail("No payload received on stdin")
        return

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        _fail(f"Invalid JSON payload: {e}")
        return

    try:
        from agents.instagram.instagram_agent import create_instagram_graph, cleanup_browser_resources

        # Agent print() logs must not mix with the JSON result on stdout.
        real_stdout = sys.stdout
        sys.stdout = sys.stderr
        try:
            graph = create_instagram_graph()
            final_state = graph.invoke(payload)
        finally:
            sys.stdout = real_stdout

        leads = final_state.get("staged_leads", [])

        result = {
            "platform": "instagram",
            "leads": leads,
            "lead_count": len(leads),
            "error": final_state.get("error"),
        }
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        result = {
            "platform": "instagram",
            "leads": [],
            "lead_count": 0,
            "error": str(e),
        }
    finally:
        try:
            from agents.instagram.instagram_agent import cleanup_browser_resources
            cleanup_browser_resources()
        except Exception:
            pass

    # Write result JSON to stdout so master_agent can read it
    print(json.dumps(result), flush=True)


def _fail(message: str) -> None:
    print(json.dumps({"platform": "instagram", "leads": [], "lead_count": 0, "error": message}), flush=True)


if __name__ == "__main__":
    main()
