import bullmq
from bullmq import Worker
import asyncio
import signal
import os
import json
from agents.company_builder import CompanyBuilder

async def company_profile_builder(job:bullmq.Job, job_token:str):
    # job.data will include the data added to the queue
    print(f"received job {json.dumps(job.data, indent=2)} with id {job.id}")
    
    try:
        builder = CompanyBuilder(job)
        # Since CompanyBuilder.run is likely synchronous (invoking a graph), 
        # and we are in an async function, we can run it in a thread or just call it if it's fast.
        # However, langgraph might be async-friendly. 
        # Let's check if we should await it or not. 
        # The current implementation of run() is sync.
        await builder.run()
        print(f"Job {job.id} completed successfully")
    except Exception as e:
        print(f"Error processing job {job.id}: {str(e)}")
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

    # Wait until the shutdown event is set
    await shutdown_event.wait()

    # close the worker
    print("Cleaning up worker...")
    await company_profile_worker.close()
    print("Worker shut down successfully.")

if __name__ == "__main__":
    asyncio.run(main())