FROM python:3.12-slim

WORKDIR /ml-service

# Install system dependencies needed by Playwright (Chromium) and Prisma/Node
RUN apt-get update && apt-get install -y \
    libatomic1 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the local embedding model so it's baked into the image
# (used as fallback when HuggingFace Inference API quota is exhausted)
# Must match EMBEDDING_MODEL in utils/huggingface_embeddings.py
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')"

# Download Playwright browser binaries (Chromium headless shell)
RUN playwright install chromium

COPY . .
RUN prisma generate
# Generates the Prisma client layer inside the image using the new config system

EXPOSE 8000

CMD ["python", "main.py"]
