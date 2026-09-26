import bullmq
from bullmq import Worker
import asyncio
import signal
import os
import json
from agents.company_builder import CompanyBuilder
from agents.master_agent import MasterAgent

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

async def main():

    # Create an event that will be triggered for shutdown
    shutdown_event = asyncio.Event()

    def signal_handler(signal, frame):
        print("Signal received, shutting down.")
        shutdown_event.set()

    # Assign signal handlers to SIGTERM and SIGINT
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    # Use REDIS_URL environment variable, defaulting to localhost for local development
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
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