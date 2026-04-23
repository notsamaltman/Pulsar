import os
import google.generativeai as genai
from typing import Optional
from dotenv import load_dotenv

# Load environment variables from .env if present
load_dotenv()

class GeminiModel:
    """
    A reusable model class for Gemini 2.5 Flash.
    
    This class handles authentication using the GEMINI_API_KEY from the environment.
    If the API key needs to be changed globally, it can be updated in the .env file
    or by modifying the default key logic in this class.
    """
    
    MODEL_NAME = "gemini-2.5-flash"
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initializes the Gemini model with an optional API key.
        If no key is provided, it defaults to the GEMINI_API_KEY environment variable.
        """
        # Centralized key management
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY environment variable is not set. Please add it to your .env file.")
        
        # Configure the generative AI library
        genai.configure(api_key=self.api_key)
        
        # Initialize the model instance
        self.model = genai.GenerativeModel(self.MODEL_NAME)

    def run(self, prompt: str) -> str:
        """
        Sends a prompt to the Gemini model and returns the text response.
        
        Args:
            prompt (str): The input text to send to the model.
            
        Returns:
            str: The generated text response.
        """
        try:
            response = self.model.generate_content(prompt)
            return response.text
        except Exception as e:
            # Re-raise with a more descriptive error or handle accordingly
            raise RuntimeError(f"Error calling Gemini model: {str(e)}")

if __name__ == "__main__":
    # Quick test if run directly
    try:
        model = GeminiModel()
        print(f"Model {GeminiModel.MODEL_NAME} initialized successfully.")
    except Exception as e:
        print(f"Initialization failed: {e}")
