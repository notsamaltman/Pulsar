from langgraph.graph import StateGraph, START, END
from pydantic import BaseModel, ConfigDict
from typing import Optional, Dict, Any
import bullmq
from bullmq import Queue
import sys
import os
import asyncio

parent_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.append(parent_dir)

from tools.scrape import run_scraper
from models.gemini import GeminiModel

class CompanyState(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    job: bullmq.Job
    website_content: Optional[str] = None
    summary: Optional[str] = None
    
class CompanyBuilder:
    def __init__(self, job: bullmq.Job):
        self.job = job
        graph = StateGraph(CompanyState)
        
        # Add nodes
        graph.add_node("scrape_website", scrape_website)
        graph.add_node("generate_summary", generate_summary)
        
        # Define flow
        # Start by deciding whether to scrape or generate summary
        graph.add_conditional_edges(
            START,
            router,
            {
                "scrape": "scrape_website",
                "generate": "generate_summary"
            }
        )
        
        graph.add_edge("scrape_website", "generate_summary")
        graph.add_edge("generate_summary", END)
        
        self.graph = graph.compile()

    async def run(self):
        await self.job.updateProgress({"status": "initializing", "message": "Starting Build..."})
        await self.graph.ainvoke({"job": self.job})

def router(state: CompanyState) -> str:
    """Router function to decide the next node."""
    if state.job.data.get("website"):
        return "scrape"
    else:
        return "generate"

async def scrape_website(state: CompanyState):
    url = state.job.data.get("website")
    if not url:
        return {"website_content": "No website provided."}
        
    await state.job.updateProgress({"status": "scraping", "message": "Scraping Website..."})
    
    # run_scraper is likely sync, so we run it in a thread to keep things async
    loop = asyncio.get_event_loop()
    content = await loop.run_in_executor(None, run_scraper, url)
    
    await state.job.updateProgress({"status": "summarizing", "message": "Website Scraped"})
    return {"website_content": content}

async def generate_summary(state: CompanyState):
    model = GeminiModel()
    
    company_name = state.job.data.get("name", "Unknown Company")
    website_url = state.job.data.get("website", "No URL provided")
    scraped_content = state.website_content or "No content scraped."
    
    prompt = f"""
    You are an expert business analyst. Your task is to analyze the following information and provide a concise, professional summary of the company.
    
    Company Name: {company_name}
    Website URL: {website_url}
    Scraped Website Content:
    ---
    {scraped_content}
    ---
    
    Instructions:
    1. Provide a professional summary (2-3 sentences) of what this business does, their core services, and their target audience.
    2. CRITICAL: If the provided information (name, url, or content) does not appear to belong to a legitimate company, agency, organization, or business (e.g., it looks like random text, gibberish, personal blog irrelevant to business, or placeholder text), you MUST return EXACTLY the string 'INVALID_CONTENT'.
    3. Do not include any preamble or self-references. Just return the summary or 'INVALID_CONTENT'.
    """
    
    await state.job.updateProgress({"status": "summarizing", "message": "Analyzing Content..."})
    
    try:
        # model.run might be sync
        loop = asyncio.get_event_loop()
        summary = await loop.run_in_executor(None, model.run, prompt)
        summary = summary.strip()
        
        if "INVALID_CONTENT" in summary:
            summary = "INVALID_CONTENT"
            
        final_status = "completed" if summary != "INVALID_CONTENT" else "failed"
        final_msg = "Summary Generated" if summary != "INVALID_CONTENT" else "Content Invalidated"
        
        await state.job.updateProgress({
            "status": final_status, 
            "message": final_msg,
            "result": {
                "summary": summary,
                "name": company_name,
                "website": website_url,
                "description": state.job.data.get("description")
            }
        })
        return {"summary": summary}
    except Exception as e:
        await state.job.updateProgress({"status": "failed", "message": f"Summary failed: {str(e)}"})
        return {"summary": f"Error: {str(e)}"}

async def publish_result(state: CompanyState):
    result = Queue("company_builder-queue-result")
    await result.add(state)
