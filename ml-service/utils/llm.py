import os
import json
import time
import dotenv
from typing import Optional, Dict, Any
from langchain_groq import ChatGroq

dotenv.load_dotenv()

DEFAULT_MODEL = os.getenv("GROQ_MODEL", "allam-2-7b")

def get_groq_llm(model_name: Optional[str] = None, temperature: float = 0.1) -> ChatGroq:
    """
    Returns a ChatGroq LLM instance using the global model configuration (or specified model_name).
    """
    model = model_name or os.getenv("GROQ_MODEL") or DEFAULT_MODEL
    api_key = os.getenv("GROQ_API_KEY")
    return ChatGroq(
        model_name=model,
        api_key=api_key,
        temperature=temperature
    )

def invoke_groq_json(prompt: str, model_name: Optional[str] = None, temperature: float = 0.1, retries: int = 3) -> Optional[Dict[str, Any]]:
    """
    Invokes Groq LLM with automatic retries and parses JSON response.
    """
    llm = get_groq_llm(model_name=model_name, temperature=temperature)
    for attempt in range(retries):
        try:
            res = llm.invoke(prompt)
            content = res.content if hasattr(res, "content") else str(res)
            # Find JSON boundaries
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1:
                json_str = content[start:end+1]
                return json.loads(json_str)
        except Exception as e:
            print(f"[-] Groq LLM JSON attempt {attempt+1}/{retries} failed: {e}")
            time.sleep(1.0)
    return None
