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
    print(f"[master-queue] Received job {job.id}")
    try:
        agent = MasterAgent(job)
        await agent.run()
        print(f"[master-queue] Job {job.id} completed successfully")
    except Exception as e:
        err_str = str(e)
        if "Groq" in err_str or "rate limit" in err_str.lower() or "429" in err_str:
            print(f"[master-queue] Job {job.id} paused due to Groq rate limit: {err_str}")
            await job.updateProgress({"status": "waiting_for_groq", "message": "Groq API temporarily rate-limited. Job safely paused."})
        else:
            print(f"[master-queue] Error processing job {job.id}: {err_str}")
            await job.updateProgress({"status": "failed", "message": f"Error: {err_str}"})

def get_redis_url() -> str:
    url = os.getenv("UPSTASH_REDIS_URL") or os.getenv("REDIS_URL")
    if url:
        return url
    rest_url = os.getenv("UPSTASH_REDIS_REST_URL")
    rest_token = os.getenv("UPSTASH_REDIS_REST_TOKEN", "")
    if rest_url:
        host = rest_url.replace("https://", "").replace("http://", "").strip("/")
        if rest_token:
            return f"rediss://default:{rest_token}@{host}:6379"
        return f"rediss://{host}:6379"
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

    company_profile_worker = Worker("company_build-queue", company_profile_builder, {"connection": redis_url, "concurrency": concurrency})
    master_agent_worker = Worker("master-queue", master_agent_handler, {"connection": redis_url, "concurrency": concurrency})
    print(f"[+] Workers active: company_build-queue, master-queue (concurrency={concurrency})")

    heartbeat_task = asyncio.create_task(heartbeat_poller(shutdown_event))

    await shutdown_event.wait()

    print("Cleaning up workers...")
    await heartbeat_task
    await company_profile_worker.close()
    await master_agent_worker.close()
    print("Workers shut down successfully.")


if __name__ == "__main__":
    asyncio.run(main())