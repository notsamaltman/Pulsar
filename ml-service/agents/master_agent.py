"""
MasterAgent — Orchestrates Instagram, YouTube, and ProductHunt sub-agents.

Receives ICP payloads from the web-app via `master-queue` (BullMQ),
transforms the ICP into each sub-agent's expected format, runs all three
concurrently, and pushes each sub-agent's results into its own BullMQ
result queue.
"""

import os
import sys
import json
import asyncio
import threading
import traceback
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, Any, List, Optional

import bullmq
from bullmq import Queue
from dotenv import load_dotenv
from utils.llm import GroqQuotaExhaustedError, looks_like_groq_limit

# --- Ensure parent is on path for utils imports ---
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
load_dotenv()


# ============================================================
# ICP → Sub-Agent Payload Transformers
# ============================================================

def _build_instagram_payload(icp: Dict[str, Any], campaign_id: Optional[str]) -> Dict[str, Any]:
    """
    Transforms the web-app ICP into the initial state expected by
    ``create_instagram_graph().invoke(state)``.
    """
    target_lead_count = icp.get("target_lead_count", 10)
    icp_copy = dict(icp)
    if campaign_id:
        icp_copy["campaignId"] = campaign_id
        icp_copy["campaign_id"] = campaign_id

    return {
        "campaign_id": campaign_id,
        "icp": icp_copy,
        "niche": "",                       # derived by derive_niche_node
        "item_profile": {
            "item_to_sell": icp.get("campaignName", ""),
            "target_audience": icp.get("targetProfile", ""),
        },
        "hashtags": [],
        "discovered_posts": [],
        "usernames_to_enrich": [],
        "profiles_data": [],
        "staged_leads": [],
        "catalogue_profiles": [],
        "db_leads": [],
        "needs_browser_search": True,
        "target_lead_count": target_lead_count,
        "error": None,
    }


def _build_youtube_payload(icp: Dict[str, Any], campaign_id: Optional[str]) -> Dict[str, Any]:
    """
    Transforms the web-app ICP into the payload expected by
    ``YouTubeLeadAgent.run(payload)``.
    """
    industry = icp.get("industry", "")
    target_profile = icp.get("targetProfile", "")
    focus = icp.get("focus", "")

    # Build comprehensive search keywords from industry, targetProfile, and focus
    raw_kw = f"{industry} {target_profile} {focus}"
    niche_keywords = [kw.strip() for kw in raw_kw.replace(",", " ").split() if len(kw.strip()) > 2]
    
    # Preserve key multi-word phrases from industry / targetProfile
    phrase_keywords = [kw.strip() for kw in f"{industry},{target_profile}".split(",") if kw.strip()]
    all_keywords = list(dict.fromkeys(phrase_keywords + niche_keywords))

    target_lead_count = icp.get("target_lead_count", 20)

    return {
        "campaign_id": campaign_id,
        "campaign_type": "creator_discovery",
        "icp": {
            "industry": industry,
            "targetProfile": target_profile,
            "focus": focus,
            "niche": all_keywords or [industry or "tech"],
            "subscriber_range": {"min": 1000, "max": 1_000_000},
            "geo_country": _extract_geo_country(icp.get("geoTarget", "")),
            "target_lead_count": target_lead_count,
            "exclusions": icp.get("exclusions", ""),
            "b2bSignals": icp.get("b2bSignals", []),
        },
        "search_strategy": {
            "keywords": all_keywords[:5],
            "seed_channels": [],
            "competitor_videos": [],
        },
        "lead_type": "creator",
        "target_lead_count": target_lead_count,
        "quota_budget": 5000,
    }


def _build_producthunt_payload(icp: Dict[str, Any], campaign_id: Optional[str]) -> Dict[str, Any]:
    """
    Transforms the web-app ICP into the payload expected by
    ``ProductHuntLeadAgent.run(payload)``.
    """
    industry = icp.get("industry", "")
    target_profile = icp.get("targetProfile", "")
    focus = icp.get("focus", "")

    # Extract distinct clean topic slugs from industry, targetProfile, and focus
    raw_topics = f"{industry},{target_profile},{focus}".split(",")
    topics = []
    for t in raw_topics:
        cleaned = t.strip().lower().replace(" ", "-")
        if cleaned and len(cleaned) > 2 and cleaned not in topics:
            topics.append(cleaned)

    # Standard fallback topics if empty
    if not topics:
        topics = ["saas", "tech"]

    return {
        "campaign_id": campaign_id,
        "icp": {
            "industry": industry,
            "targetProfile": target_profile,
            "focus": focus,
            "niche": industry or target_profile or "tech",
            "exclusions": icp.get("exclusions", ""),
        },
        "topics": topics[:4],
        "competitor_product_ids": [],
        "target_lead_count": icp.get("target_lead_count", 10),
    }


def _extract_geo_country(geo_target: str) -> Optional[str]:
    """
    Best-effort extraction of a 2-letter ISO country code from the
    free-text geoTarget field filled in by the user.
    """
    if not geo_target:
        return None
    geo_lower = geo_target.strip().lower()
    country_map = {
        "united states": "US", "usa": "US", "us": "US", "north america": "US",
        "united kingdom": "GB", "uk": "GB", "great britain": "GB",
        "india": "IN", "germany": "DE", "france": "FR", "canada": "CA",
        "australia": "AU", "japan": "JP", "brazil": "BR", "spain": "ES",
    }
    for key, code in country_map.items():
        if key in geo_lower:
            return code
    # If it looks like an ISO code already
    if len(geo_lower) == 2 and geo_lower.isalpha():
        return geo_lower.upper()
    return None


# ============================================================
# Result Queue Publisher
# ============================================================

async def _push_to_result_queue(queue_name: str, results: Dict[str, Any], redis_url: str):
    """Pushes sub-agent results into a dedicated BullMQ result queue."""
    try:
        result_queue = Queue(queue_name, {"connection": redis_url})
        await result_queue.add(
            f"{queue_name}-{results.get('campaign_id', 'unknown')}",
            results,
        )
        print(f"[MasterAgent] ✓ Pushed {results.get('lead_count', 0)} results to {queue_name}")
        await result_queue.close()
    except Exception as e:
        print(f"[MasterAgent] ✗ Failed to push to {queue_name}: {e}")


# ============================================================
# Sub-Agent Runners (executed in ThreadPool)
# ============================================================

def _raise_if_groq_result(result: Dict[str, Any]) -> None:
    """Sub-agents often return Groq failures as error dicts — bubble them to the worker."""
    if not result:
        return
    if result.get("error_type") == "groq_quota" or looks_like_groq_limit(result.get("error")):
        reset_at = result.get("reset_at") or (time.time() + 900)
        raise GroqQuotaExhaustedError(
            reset_at=float(reset_at),
            message=str(result.get("error") or "Groq API rate limit reached."),
        )


def _run_instagram(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Runs the Instagram agent in a completely isolated subprocess.

    Why a subprocess and not a thread?
    -----------------------------------
    LangGraph's sync ``graph.invoke()`` internally wraps its async
    implementation with ``asyncio.run()``, which starts a NEW event loop
    inside the calling thread.  Playwright's sync API checks
    ``asyncio._get_running_loop()`` and raises an error if ANY event loop
    is running in the current OS thread — including those created by
    LangGraph.  Neither ``asyncio.set_event_loop(None)`` nor spawning a
    plain ``threading.Thread`` prevents this, because LangGraph recreates
    its own loop inside ``graph.invoke()``.

    A subprocess is a completely fresh Python process: no asyncio loop,
    no inherited thread-locals — Playwright works without any patching.

    Communication: payload → subprocess stdin (JSON)
                   result  ← subprocess stdout (JSON)
    """
    import subprocess
    import json as _json

    print("[MasterAgent] → Starting Instagram agent (subprocess)...")

    runner_path = os.path.join(os.path.dirname(__file__), "instagram", "_runner.py")
    payload_json = _json.dumps(payload)
    timeout_s = 600

    def _kill_tree(proc: "subprocess.Popen") -> None:
        if proc.poll() is not None:
            return
        try:
            if sys.platform == "win32":
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                    capture_output=True,
                    text=True,
                    timeout=15,
                )
            else:
                proc.kill()
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    def _parse_result(stdout: str) -> Dict[str, Any]:
        stdout = (stdout or "").strip()
        for line in reversed(stdout.splitlines()):
            line = line.strip()
            if line.startswith("{") and line.endswith("}"):
                return _json.loads(line)
        return _json.loads(stdout)

    proc = None
    stderr_tail: List[str] = []
    try:
        proc = subprocess.Popen(
            [sys.executable, "-u", runner_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        assert proc.stdin is not None and proc.stdout is not None and proc.stderr is not None
        proc.stdin.write(payload_json)
        proc.stdin.close()

        stdout_chunks: List[str] = []

        def _pump_stderr() -> None:
            assert proc.stderr is not None
            for line in proc.stderr:
                stderr_tail.append(line.rstrip())
                if len(stderr_tail) > 200:
                    del stderr_tail[: len(stderr_tail) - 200]
                print(f"  [instagram-subprocess] {line.rstrip()}", flush=True)

        def _pump_stdout() -> None:
            assert proc.stdout is not None
            for line in proc.stdout:
                stdout_chunks.append(line)

        err_thread = threading.Thread(target=_pump_stderr, name="ig-stderr", daemon=True)
        out_thread = threading.Thread(target=_pump_stdout, name="ig-stdout", daemon=True)
        err_thread.start()
        out_thread.start()

        try:
            proc.wait(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            print("[MasterAgent] ✗ Instagram subprocess timed out after 10 minutes", flush=True)
            _kill_tree(proc)
            err_thread.join(timeout=2)
            if stderr_tail:
                print("[MasterAgent] Last Instagram logs before timeout:", flush=True)
                for line in stderr_tail[-40:]:
                    print(f"  [instagram-subprocess] {line}", flush=True)
            return {
                "platform": "instagram",
                "leads": [],
                "lead_count": 0,
                "error": "subprocess timeout (600 s)",
            }

        err_thread.join(timeout=5)
        out_thread.join(timeout=5)
        stdout = "".join(stdout_chunks)

        if proc.returncode != 0:
            err_snippet = "\n".join(stderr_tail[-20:]) or "no stderr"
            print(f"[MasterAgent] ✗ Instagram subprocess exited {proc.returncode}")
            return {
                "platform": "instagram",
                "leads": [],
                "lead_count": 0,
                "error": f"subprocess exit {proc.returncode}: {err_snippet[-500:]}",
            }

        result = _parse_result(stdout)
        lead_count = result.get("lead_count", 0)
        print(f"[MasterAgent] ← Instagram agent finished with {lead_count} leads")
        _raise_if_groq_result(result)
        return result

    except GroqQuotaExhaustedError:
        raise
    except _json.JSONDecodeError as e:
        print(f"[MasterAgent] ✗ Instagram subprocess returned invalid JSON: {e}")
        return {
            "platform": "instagram",
            "leads": [],
            "lead_count": 0,
            "error": f"invalid JSON from subprocess: {e}",
        }
    except Exception as e:
        print(f"[MasterAgent] ✗ Instagram agent error: {e}")
        traceback.print_exc()
        if proc is not None:
            _kill_tree(proc)
        return {"platform": "instagram", "leads": [], "lead_count": 0, "error": str(e)}



def _run_youtube(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Runs the YouTube agent synchronously and returns its results."""
    print("[MasterAgent] → Starting YouTube agent...")
    try:
        from agents.youtube import YouTubeLeadAgent
        agent = YouTubeLeadAgent(quota_budget=payload.get("quota_budget", 2000))
        result = agent.run(payload)
        leads = result.get("staged_leads", [])
        print(f"[MasterAgent] ← YouTube agent finished with {len(leads)} leads")
        yt_result = {
            "platform": "youtube",
            "leads": leads,
            "lead_count": len(leads),
            "error": result.get("error"),
        }
        _raise_if_groq_result(yt_result)
        return yt_result
    except GroqQuotaExhaustedError:
        raise
    except Exception as e:
        if looks_like_groq_limit(e):
            raise
        print(f"[MasterAgent] ✗ YouTube agent error: {e}")
        traceback.print_exc()
        return {"platform": "youtube", "leads": [], "lead_count": 0, "error": str(e)}


def _run_producthunt(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Runs the ProductHunt agent synchronously and returns its results."""
    print("[MasterAgent] → Starting ProductHunt agent...")
    try:
        from agents.producthunt import ProductHuntLeadAgent
        agent = ProductHuntLeadAgent()
        result = agent.run(payload)
        leads = result.get("scored_leads", [])
        print(f"[MasterAgent] ← ProductHunt agent finished with {len(leads)} leads")
        ph_result = {
            "platform": "producthunt",
            "leads": leads,
            "lead_count": len(leads),
            "error": result.get("error"),
        }
        _raise_if_groq_result(ph_result)
        return ph_result
    except GroqQuotaExhaustedError:
        raise
    except Exception as e:
        if looks_like_groq_limit(e):
            raise
        print(f"[MasterAgent] ✗ ProductHunt agent error: {e}")
        traceback.print_exc()
        return {"platform": "producthunt", "leads": [], "lead_count": 0, "error": str(e)}


# ============================================================
# Master Agent
# ============================================================

class MasterAgent:
    """
    Orchestrator that receives an ICP from ``master-queue`` and fans out
    to Instagram, YouTube, and ProductHunt sub-agents concurrently.

    Each sub-agent's results are pushed to its own BullMQ result queue:
      - ``instagram-results-queue``
      - ``youtube-results-queue``
      - ``producthunt-results-queue``
    """

    PLATFORM_RUNNERS = {
        "instagram": (_run_instagram, _build_instagram_payload, "instagram-results-queue"),
        "youtube":   (_run_youtube,   _build_youtube_payload,   "youtube-results-queue"),
        "producthunt": (_run_producthunt, _build_producthunt_payload, "producthunt-results-queue"),
    }

    def __init__(self, job: bullmq.Job):
        self.job = job
        url = os.getenv("REDIS_URL") or os.getenv("UPSTASH_REDIS_URL")
        self.redis_url = url or "redis://localhost:6379"

    async def run(self):
        """Main execution entry point called by the BullMQ worker."""
        job_data = self.job.data
        campaign_id = job_data.get("jobId") or job_data.get("campaign_id")
        icp = self._extract_icp(job_data)

        print("=" * 60)
        print(f"[MasterAgent] Received campaign: {icp.get('campaignName', 'Unnamed')}")
        print(f"[MasterAgent] Industry: {icp.get('industry')}")
        print(f"[MasterAgent] GeoTarget: {icp.get('geoTarget')}")
        print(f"[MasterAgent] TargetProfile: {icp.get('targetProfile')}")
        print("=" * 60)

        await self.job.updateProgress({
            "status": "running",
            "message": "Master agent started — dispatching to sub-agents...",
        })

        # ----- Build payloads for each platform -----
        selected_platforms = icp.get("platforms") or icp.get("channels") or []
        if isinstance(selected_platforms, str):
            selected_platforms = [selected_platforms]
        
        # Normalize selected platforms list (e.g. ['youtube', 'instagram'])
        normalized_selected = []
        for p in selected_platforms:
            p_str = str(p).lower().strip()
            if "youtube" in p_str or "yt" in p_str:
                normalized_selected.append("youtube")
            elif "instagram" in p_str or "ig" in p_str:
                normalized_selected.append("instagram")
            elif "producthunt" in p_str or "product hunt" in p_str or "ph" in p_str:
                normalized_selected.append("producthunt")

        # Fallback to all platforms if none matched or empty
        if not normalized_selected:
            normalized_selected = ["youtube", "instagram", "producthunt"]

        print(f"[MasterAgent] Selected platforms to run: {normalized_selected}")

        payloads = {}
        for platform, (runner, builder, queue_name) in self.PLATFORM_RUNNERS.items():
            if platform in normalized_selected:
                payloads[platform] = {
                    "payload": builder(icp, campaign_id),
                    "runner": runner,
                    "queue_name": queue_name,
                }

        # ----- Fan-out: run all sub-agents concurrently -----
        all_results: Dict[str, Dict[str, Any]] = {}

        loop = asyncio.get_event_loop()
        with ThreadPoolExecutor(max_workers=3, thread_name_prefix="agent") as pool:
            tasks = []
            platforms = list(payloads.keys())
            
            for platform in platforms:
                info = payloads[platform]
                fut = loop.run_in_executor(pool, info["runner"], info["payload"])
                tasks.append((platform, info["queue_name"], fut))

            for platform, queue_name, fut in tasks:
                try:
                    result = await fut
                    result["campaign_id"] = campaign_id
                    _raise_if_groq_result(result)
                    all_results[platform] = result

                    # Push to platform-specific result queue
                    await _push_to_result_queue(queue_name, result, self.redis_url)

                    await self.job.updateProgress({
                        "status": "running",
                        "message": f"{platform} agent completed — {result.get('lead_count', 0)} leads found",
                        "platform_done": platform,
                        "lead_count": result.get("lead_count", 0),
                    })
                except GroqQuotaExhaustedError:
                    raise
                except Exception as e:
                    if looks_like_groq_limit(e):
                        raise GroqQuotaExhaustedError(
                            reset_at=time.time() + 900,
                            message=str(e),
                        ) from e
                    print(f"[MasterAgent] ✗ Error awaiting {platform}: {e}")
                    traceback.print_exc()
                    all_results[platform] = {
                        "platform": platform,
                        "leads": [],
                        "lead_count": 0,
                        "error": str(e),
                        "campaign_id": campaign_id,
                    }

        # ----- Summary -----
        total_leads = sum(r.get("lead_count", 0) for r in all_results.values())
        summary = {
            platform: {
                "lead_count": r.get("lead_count", 0),
                "error": r.get("error"),
            }
            for platform, r in all_results.items()
        }

        user_id = icp.get("userId")
        if total_leads > 0 and user_id:
            try:
                from utils.lead_db import mark_user_first_job_done_sync
                mark_user_first_job_done_sync(user_id)
            except Exception as u_err:
                print(f"[!] Could not mark first job done for user {user_id}: {u_err}")

        print("\n" + "=" * 60)
        print(f"[MasterAgent] ALL AGENTS COMPLETE — Total leads: {total_leads}")
        for plat, info in summary.items():
            status = "✓" if not info["error"] else "✗"
            print(f"  {status} {plat}: {info['lead_count']} leads")
        print("=" * 60)

        await self.job.updateProgress({
            "status": "completed",
            "message": f"All agents finished — {total_leads} total leads generated",
            "summary": summary,
            "total_leads": total_leads,
        })


    @staticmethod
    def _extract_icp(job_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Extracts the ICP dict from the job data. The web-app spreads the
        form fields directly into jobBody, so job_data IS the ICP (plus
        some meta keys like jobId, jobType, userId).
        """
        # The ICP fields live at the top level of job_data
        return {
            "campaignName": job_data.get("campaignName", ""),
            "goalType": job_data.get("goalType", "Lead Generation"),
            "industry": job_data.get("industry", ""),
            "geoTarget": job_data.get("geoTarget", ""),
            "budget": job_data.get("budget", ""),
            "targetProfile": job_data.get("targetProfile", ""),
            "focus": job_data.get("focus", "B2B"),
            "minFollowers": job_data.get("minFollowers", ""),
            "exclusions": job_data.get("exclusions", ""),
            "b2bSignals": job_data.get("b2bSignals", []),
            "minEngagement": job_data.get("minEngagement", ""),
            "contentType": job_data.get("contentType", ""),
            "channels": job_data.get("channels", []),
            "tone": job_data.get("tone", ""),
            "sequence": job_data.get("sequence", ""),
            "platforms": job_data.get("platforms") or job_data.get("channels", []),
            "companyId": job_data.get("companyId"),
            "userId": job_data.get("userId"),
            "target_lead_count": 10,
        }
