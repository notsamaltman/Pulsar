FROM python:3.12-slim

WORKDIR /ml-service

# Install system dependencies needed by Prisma/Node
RUN apt-get update && apt-get install -y \
    libatomic1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt


COPY . .
RUN DATABASE_URL="postgresql://user:pass@localhost:5432/db" prisma generate
# Generates the Prisma client layer inside the image using the new config system

EXPOSE 8000

CMD ["python", "main.py"]
