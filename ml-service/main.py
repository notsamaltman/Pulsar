import bullmq
from bullmq import Worker, Queue
import asyncio
import signal
import os
import time
from dotenv import load_dotenv
from agents.company_builder import CompanyBuilder
from agents.master_agent import MasterAgent
from utils.llm import (
    GroqQuotaExhaustedError,
    check_groq_availability,
    clear_groq_status_if_reset,
    looks_like_groq_limit,
)

import urllib.request
import urllib.error

load_dotenv()

def _job_priority(job: bullmq.Job) -> int:
    opts = getattr(job, "opts", None) or {}
    if isinstance(opts, dict):
        return int(opts.get("priority") or 5)
    return int(getattr(opts, "priority", None) or 5)

def _campaign_id_from_job(job: bullmq.Job):
    job_data = job.data or {}
    return job_data.get("jobId") or job_data.get("campaignId") or job_data.get("campaign_id")

async def requeue_job_on_groq_exhaustion(job: bullmq.Job, queue_name: str, err: Exception):
    """Requeue the active job at a lower priority and mark the campaign as queued.

    Completes the current attempt so BullMQ does not retry at the original priority.
    The replacement job is delayed until Groq's reset window.
    """
    reset_at = getattr(err, "reset_at", None)
    now = time.time()
    if reset_at:
        delay_ms = max(int((reset_at - now) * 1000), 60_000)
    else:
        delay_ms = 15 * 60 * 1000

    current_priority = _job_priority(job)
    # BullMQ: higher number = lower priority. Cap at 20.
    new_priority = min(max(current_priority, 5) + 5, 20)
    campaign_id = _campaign_id_from_job(job)
    job_data = dict(job.data or {})
    job_data["groqRequeueCount"] = int(job_data.get("groqRequeueCount") or 0) + 1

    print(
        f"[!] Groq exhausted — requeueing job {job.id} on {queue_name} "
        f"priority {current_priority} → {new_priority}, delay {delay_ms}ms"
    )

    await job.updateProgress({
        "status": "queued",
        "message": "API limit exhausted. Job requeued at lower priority; system on idle check.",
        "groqIdle": True,
    })

    if campaign_id:
        try:
            from utils.lead_db import update_campaign_status
            await update_campaign_status(campaign_id, "queue")
        except Exception as st_err:
            print(f"[!] Warning setting campaign {campaign_id} status to queue: {st_err}")

    request_queue = Queue(queue_name, {"connection": get_redis_url()})
    try:
        await request_queue.add(
            f"{campaign_id or job.id}-{queue_name}-{int(now * 1000)}",
            job_data,
            {
                "priority": new_priority,
                "delay": delay_ms,
                "removeOnComplete": {"age": 3600, "count": 100},
                "removeOnFail": {"age": 86400, "count": 500},
            },
        )
    finally:
        await request_queue.close()

    try:
        from agents.instagram.instagram_agent import cleanup_browser_resources
        cleanup_browser_resources()
    except Exception as e:
        print(f"[!] Warning closing browser while Groq idle: {e}")

async def company_profile_builder(job:bullmq.Job, job_token:str):
    try:
        check_groq_availability()
        builder = CompanyBuilder(job)
        await builder.run()
        print(f"Job {job.id} completed successfully")
    except Exception as e:
        if looks_like_groq_limit(e):
            print(f"[!] Job {job.id} requeued due to Groq rate limit: {e}")
            await requeue_job_on_groq_exhaustion(job, "company_build-queue", e)
        else:
            print(f"Error processing job {job.id}: {e}")
            await job.updateProgress({"status": "failed", "message": f"Error: {e}"})

async def master_agent_handler(job:bullmq.Job, job_token:str):
    """Handles jobs from master-queue — fans out ICP to all sub-agents."""
    campaign_id = _campaign_id_from_job(job)
    print(f"[master-queue] Received job {job.id} for campaign {campaign_id}")

    try:
        check_groq_availability()
    except GroqQuotaExhaustedError as e:
        print(f"[master-queue] Groq idle — not starting job {job.id}: {e}")
        await requeue_job_on_groq_exhaustion(job, "master-queue", e)
        return

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
        if looks_like_groq_limit(e):
            print(f"[master-queue] Job {job.id} requeued due to Groq rate limit: {e}")
            await requeue_job_on_groq_exhaustion(job, "master-queue", e)
        else:
            print(f"[master-queue] Error processing job {job.id}: {e}")
            await job.updateProgress({"status": "failed", "message": f"Error: {e}"})
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

async def groq_idle_checker(shutdown_event: asyncio.Event):
    """While Groq is rate-limited, sit idle and poll until the window resets."""
    print("[+] Groq idle checker started.")
    while not shutdown_event.is_set():
        still_blocked = await asyncio.to_thread(clear_groq_status_if_reset)
        wait = 15.0 if still_blocked else 30.0
        try:
            await asyncio.wait_for(shutdown_event.wait(), timeout=wait)
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
    groq_idle_task = asyncio.create_task(groq_idle_checker(shutdown_event))

    await shutdown_event.wait()

    print("Cleaning up workers...")
    await heartbeat_task
    await groq_idle_task
    await company_profile_worker.close()
    await master_agent_worker.close()
    print("Workers shut down successfully.")


if __name__ == "__main__":
    asyncio.run(main())
