import bullmq
from bullmq import Worker
import asyncio
import signal
import os
import json
from dotenv import load_dotenv
from agents.company_builder import CompanyBuilder
from agents.master_agent import MasterAgent

import urllib.request
import urllib.error

load_dotenv()

async def company_profile_builder(job:bullmq.Job, job_token:str):
    try:
        builder = CompanyBuilder(job)
        await builder.run()
        print(f"Job {job.id} completed successfully")
    except Exception as e:
        err_str = str(e)
        if "Groq" in err_str or "rate limit" in err_str.lower() or "429" in err_str:
            print(f"[!] Job {job.id} paused due to Groq rate limit: {err_str}")
            await job.updateProgress({"status": "waiting_for_groq", "message": "Groq API temporarily rate-limited. Job safely paused."})
        else:
            print(f"Error processing job {job.id}: {err_str}")
            await job.updateProgress({"status": "failed", "message": f"Error: {err_str}"})

async def master_agent_handler(job:bullmq.Job, job_token:str):
    """Handles jobs from master-queue — fans out ICP to all sub-agents."""
    job_data = job.data or {}
    campaign_id = job_data.get("jobId") or job_data.get("campaignId") or job_data.get("campaign_id")
    print(f"[master-queue] Received job {job.id} for campaign {campaign_id}")
    
    if campaign_id:
        try:
            from utils.lead_db import update_campaign_status
            await update_campaign_status(campaign_id, "ongoing")
        except Exception as st_err:
            print(f"[!] Warning setting campaign {campaign_id} status to ongoing: {st_err}")

    try:
        agent = MasterAgent(job)
        await agent.run()
        print(f"[master-queue] Job {job.id} completed successfully")
        if campaign_id:
            try:
                from utils.lead_db import update_campaign_status
                await update_campaign_status(campaign_id, "complete")
            except Exception as st_err:
                print(f"[!] Warning setting campaign {campaign_id} status to complete: {st_err}")
    except Exception as e:
        err_str = str(e)
        if "Groq" in err_str or "rate limit" in err_str.lower() or "429" in err_str:
            print(f"[master-queue] Job {job.id} paused due to Groq rate limit: {err_str}")
            await job.updateProgress({"status": "waiting_for_groq", "message": "Groq API temporarily rate-limited. Job safely paused."})
        else:
            print(f"[master-queue] Error processing job {job.id}: {err_str}")
            await job.updateProgress({"status": "failed", "message": f"Error: {err_str}"})
            if campaign_id:
                try:
                    from utils.lead_db import update_campaign_status
                    await update_campaign_status(campaign_id, "complete")
                except Exception as st_err:
                    print(f"[!] Warning setting campaign {campaign_id} status to complete on error: {st_err}")

def get_redis_url() -> str:
    url = os.getenv("REDIS_URL") or os.getenv("UPSTASH_REDIS_URL")
    if url:
        return url
    return "redis://localhost:6379"

async def heartbeat_poller(shutdown_event: asyncio.Event):
    app_url = os.getenv("NEXT_PUBLIC_APP_URL") or os.getenv("APP_URL") or "http://localhost:3000"
    health_endpoint = f"{app_url.rstrip('/')}/api/service-health"
    print(f"[+] Heartbeat poller started. Target: {health_endpoint}")

    def send_pulse():
        try:
            req = urllib.request.Request(
                health_endpoint,
                data=b'{}',
                headers={'Content-Type': 'application/json', 'User-Agent': 'Pulsar-MLService-Heartbeat'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=5) as response:
                return response.status == 200
        except Exception as e:
            return False

    while not shutdown_event.is_set():
        await asyncio.to_thread(send_pulse)
        try:
            await asyncio.wait_for(shutdown_event.wait(), timeout=10.0)
        except asyncio.TimeoutError:
            pass

async def main():
    shutdown_event = asyncio.Event()

    def signal_handler(signal, frame):
        print("Signal received, shutting down.")
        shutdown_event.set()

    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    redis_url = get_redis_url()
    concurrency = int(os.getenv("PULSAR_WORKER_CONCURRENCY", "2"))
    print(f"[+] Initializing BullMQ workers with concurrency={concurrency}...")

    company_profile_worker = Worker(
        "company_build-queue",
        company_profile_builder,
        {"connection": redis_url, "concurrency": concurrency, "attempts": 3}
    )
    master_agent_worker = Worker(
        "master-queue",
        master_agent_handler,
        {"connection": redis_url, "concurrency": concurrency, "attempts": 3}
    )
    print(f"[+] Workers active: company_build-queue, master-queue (concurrency={concurrency}, max_attempts=3)")


    # Close Instagram browser when master-queue drains (no more pending/active jobs)
    def _on_master_drained():
        print("[+] master-queue drained — closing Instagram browser resources.")
        try:
            from agents.instagram.instagram_agent import cleanup_browser_resources
            cleanup_browser_resources()
        except Exception as e:
            print(f"[!] Warning closing browser on idle: {e}")

    master_agent_worker.on("drained", _on_master_drained)

    heartbeat_task = asyncio.create_task(heartbeat_poller(shutdown_event))

    await shutdown_event.wait()

    print("Cleaning up workers...")
    await heartbeat_task
    await company_profile_worker.close()
    await master_agent_worker.close()
    print("Workers shut down successfully.")


if __name__ == "__main__":
    asyncio.run(main())