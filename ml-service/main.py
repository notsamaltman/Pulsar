import bullmq
from bullmq import Worker
import asyncio
import signal
import os
import json

async def company_profile_builder(job:bullmq.Job, job_token:str):
    # job.data will include the data added to the queue
    job.updateProgress()
    print(f"recieved job {json.dumps(job.data, indent=2)} with id {job_token}")
    

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

    # Wait until the shutdown event is set
    await shutdown_event.wait()

    # close the worker
    print("Cleaning up worker...")
    await company_profile_worker.close()
    print("Worker shut down successfully.")

if __name__ == "__main__":
    asyncio.run(main())