FROM python:3.12-slim

WORKDIR /ml-service

# ── System deps ────────────────────────────────────────────────────────────
# Playwright (Chromium) needs these at runtime.
# All installed in one layer to keep the image lean.
RUN apt-get update && apt-get install -y --no-install-recommends \
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

# ── Python deps ────────────────────────────────────────────────────────────
# Copy only requirements first so this layer is cached as long as
# requirements.txt doesn't change — the most expensive layer.
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt

# ── Playwright browser binaries ────────────────────────────────────────────
# Must run AFTER pip install (playwright CLI comes from the package).
RUN playwright install chromium --with-deps

# ── Pre-download fastembed ONNX model ─────────────────────────────────────
# Bakes the local fallback embedding model into the image so the container
# never needs internet access for the fallback path.
# fastembed caches to ~/.cache/fastembed by default.
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5')"

# ── Application code ───────────────────────────────────────────────────────
# Copied LAST so code changes don't bust the expensive layers above.
COPY . .
RUN prisma generate

EXPOSE 8000
CMD ["python", "main.py"]
