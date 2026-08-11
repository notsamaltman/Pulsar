import os
import dotenv
from typing import List
from huggingface_hub import InferenceClient

dotenv.load_dotenv()

def get_huggingface_client() -> InferenceClient:
    token = os.getenv("HUGGING_KEY") or os.getenv("HF_TOKEN")
    return InferenceClient(token=token)

def generate_embedding(text: str, target_dim: int = 1536) -> List[float]:
    """
    Generates text embedding using Hugging Face InferenceClient with BAAI/bge-small-en-v1.5
    and expands/pads the vector to target_dim (default 1536) to match Postgres vector(1536).
    """
    client = get_huggingface_client()
    model_id = "BAAI/bge-small-en-v1.5"
    
    try:
        emb = client.feature_extraction(text=text, model=model_id)
        if hasattr(emb, "tolist"):
            emb = emb.tolist()
        if isinstance(emb, list) and len(emb) > 0 and isinstance(emb[0], list):
            emb = emb[0]
            
        # Standardize floats
        float_vec = [float(x) for x in emb]
        
        # Expand vector to target_dim (1536) if needed
        if len(float_vec) < target_dim:
            factor = (target_dim // len(float_vec)) + 1
            float_vec = (float_vec * factor)[:target_dim]
        elif len(float_vec) > target_dim:
            float_vec = float_vec[:target_dim]
            
        return float_vec
    except Exception as e:
        print(f"[-] Error generating Hugging Face embedding: {e}")
        # Return fallback zero-vector of target_dim length in case of API error
        return [0.0] * target_dim
