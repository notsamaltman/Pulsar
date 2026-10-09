from langgraph.graph import StateGraph, START, END
from pydantic import BaseModel, ConfigDict
from typing import Optional
import bullmq
import sys
import os
import asyncio

parent_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.append(parent_dir)

from tools.scrape import run_scraper
from models.groq_model import GroqModel
from utils.llm import (
    check_groq_availability,
    looks_like_groq_limit,
    raise_groq_quota_from_error,
)


class CompanyState(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    job: bullmq.Job
    website_content: Optional[str] = None
    summary: Optional[str] = None


class CompanyBuilder:
    def __init__(self, job: bullmq.Job):
        self.job = job
        graph = StateGraph(CompanyState)

        graph.add_node("scrape_website", scrape_website)
        graph.add_node("generate_summary", generate_summary)

        graph.add_conditional_edges(
            START,
            router,
            {
                "scrape": "scrape_website",
                "generate": "generate_summary",
            },
        )

        graph.add_edge("scrape_website", "generate_summary")
        graph.add_edge("generate_summary", END)

        self.graph = graph.compile()

    async def run(self):
        await self.job.updateProgress({"status": "initializing", "message": "Starting Build..."})
        await self.graph.ainvoke({"job": self.job})


def router(state: CompanyState) -> str:
    if state.job.data.get("website"):
        return "scrape"
    return "generate"


async def scrape_website(state: CompanyState):
    url = state.job.data.get("website")
    if not url:
        return {"website_content": "No website provided."}

    await state.job.updateProgress({"status": "scraping", "message": "Scraping Website..."})
    loop = asyncio.get_event_loop()
    content = await loop.run_in_executor(None, run_scraper, url)
    await state.job.updateProgress({"status": "summarizing", "message": "Website Scraped"})
    return {"website_content": content}


async def generate_summary(state: CompanyState):
    # Check Groq availability before doing any work — raises GroqQuotaExhaustedError
    # if the Redis block is still active. main.py catches this and requeues.
    check_groq_availability()

    company_name = state.job.data.get("name", "Unknown Company")
    website_url = state.job.data.get("website", "No URL provided")
    scraped_content = state.website_content or "No content scraped."

    prompt = f"""You are an expert business analyst. Analyze the information below and return a concise, professional 2-3 sentence summary of what this company does, their core services, and their target audience.

Company Name: {company_name}
Website URL: {website_url}
Company Description (provided by founder): {state.job.data.get("description") or "No description provided."}
Scraped Website Content:
---
{scraped_content}
---

Rules:
1. Return ONLY the summary paragraph. No preamble, no labels, no self-references.
2. Return EXACTLY the string INVALID_CONTENT (nothing else) only when ALL three of these are simultaneously true:
   - The company name is obvious gibberish or random characters (e.g. "asdfgh")
   - AND the description is also gibberish or completely empty (e.g. "qwerty uiop")
   - AND there is no usable scraped content
   Startups, early-stage companies, SaaS tools, AI products, side projects, and informally-described businesses are all legitimate — summarize them."""

    await state.job.updateProgress({"status": "summarizing", "message": "Analyzing Content..."})

    try:
        loop = asyncio.get_event_loop()
        model = GroqModel()
        raw = await loop.run_in_executor(None, model.run, prompt)
        summary = raw.strip()

        # Guard against Groq wrapping the token in extra text
        if summary == "INVALID_CONTENT" or summary.startswith("INVALID_CONTENT\n"):
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
                "description": state.job.data.get("description"),
            },
        })
        return {"summary": summary}

    except Exception as e:
        # Let Groq quota errors bubble up to main.py's requeue handler
        if looks_like_groq_limit(e):
            raise_groq_quota_from_error(e)

        await state.job.updateProgress({"status": "failed", "message": f"Summary failed: {str(e)}"})
        return {"summary": f"Error: {str(e)}"}
