FROM python:3.11-slim-bookworm

# Install system dependencies including ffmpeg
RUN apt-get update && apt-get install -y \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
RUN pip install --no-cache-dir fastapi uvicorn yt-dlp

# Copy app source
COPY main.py .

# Create temp directory
RUN mkdir -p /tmp/fetchy-downloads && chmod 777 /tmp/fetchy-downloads

EXPOSE 8080

CMD ["python", "main.py"]
