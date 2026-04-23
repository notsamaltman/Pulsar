from langgraph.graph import StateGraph, START, END
from pydantic import BaseModel
from typing import Optional
import bullmq
import sys
import os

parent_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.append(parent_dir)

from tools.scrape import run_scraper
from models.gemini import GeminiModel

class CompanyState(BaseModel):
    job:bullmq.Job
    website_content:Optional[str] = None
    summary:Optional[str] = None
    
class CompanyBuilder:
    def __init__(self, job:bullmq.Job):
        self.job = job
        job.updateProgress({"status": "initializing", "message": "Recieved Profile"})
        graph = StateGraph(CompanyState)
        graph.add_node("route_company", route_company)
        graph.add_node("scrape_website", scrape_website)
        graph.add_node("generate_summary", generate_summary)
        graph.add_edge(START, "route_company")
        graph.add_edge("route_company", "scrape_website")
        graph.add_edge("scrape_website", "generate_summary")
        graph.add_edge("generate_summary", END)
        self.graph = graph.compile()

    def run(self):
        self.graph.invoke({"job": self.job})

def route_company(state:CompanyState):
    if state.job.data["website"]:
        return "scrape_website"
    else:
        return "generate_summary"

def scrape_website(state:CompanyState):
    url = state.job.data["url"]
    content = run_scraper(url)
    state.job.updateProgress({"status": "scraping", "message": "Scraped Website"})
    return {"website_content": content}

def generate_summary(state: CompanyState):
    """
    Generates a summary for the company based on scraped website content.
    Returns 'INVALID_CONTENT' if the content is not representative of a professional entity.
    """
    model = GeminiModel()
    
    company_name = state.job.data.get("name", "Unknown Company")
    website_url = state.job.data.get("url", "No URL provided")
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
    
    state.job.updateProgress({"status": "summarizing", "message": "Analyzing Content"})
    
    try:
        summary = model.run(prompt)
        # Clean up the response just in case
        summary = summary.strip()
        
        if "INVALID_CONTENT" in summary:
            summary = "INVALID_CONTENT"
            
        state.job.updateProgress({"status": "completed", "message": "Summary Generated" if summary != "INVALID_CONTENT" else "Content Invalidated"})
        return {"summary": summary}
    except Exception as e:
        state.job.updateProgress({"status": "failed", "message": f"Summary failed: {str(e)}"})
        return {"summary": "Error generating summary."}


