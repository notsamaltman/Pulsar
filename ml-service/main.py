import bullmq
from bullmq import Worker
import asyncio
import signal
import os
import json
from dotenv import load_dotenv
from agents.company_builder import CompanyBuilder
from agents.master_agent import MasterAgent

load_dotenv()

async def company_profile_builder(job:bullmq.Job, job_token:str):
    # job.data will include the data added to the queue
    try:
        builder = CompanyBuilder(job)
        await builder.run()
        print(f"Job {job.id} completed successfully")
    except Exception as e:
        print(f"Error processing job {job.id}: {str(e)}")
        await job.updateProgress({"status": "failed", "message": f"Error: {str(e)}"})

async def master_agent_handler(job:bullmq.Job, job_token:str):
    """Handles jobs from master-queue — fans out ICP to all sub-agents."""
    print(f"[master-queue] Received job {job.id}")
    try:
        agent = MasterAgent(job)
        await agent.run()
        print(f"[master-queue] Job {job.id} completed successfully")
    except Exception as e:
        print(f"[master-queue] Error processing job {job.id}: {str(e)}")
        await job.updateProgress({"status": "failed", "message": f"Error: {str(e)}"})

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

async def main():
    # Create an event that will be triggered for shutdown
    shutdown_event = asyncio.Event()

    def signal_handler(signal, frame):
        print("Signal received, shutting down.")
        shutdown_event.set()

    # Assign signal handlers to SIGTERM and SIGINT
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    redis_url = get_redis_url()
    company_profile_worker = Worker("company_build-queue", company_profile_builder, {"connection": redis_url})
    master_agent_worker = Worker("master-queue", master_agent_handler, {"connection": redis_url})
    print("[+] Workers started: company_build-queue, master-queue")

    # Wait until the shutdown event is set
    await shutdown_event.wait()

    # close the worker
    print("Cleaning up workers...")
    await company_profile_worker.close()
    await master_agent_worker.close()
    print("Workers shut down successfully.")

if __name__ == "__main__":
    asyncio.run(main())