FROM python:3.11-slim-bookworm

# Install system dependencies including Node.js and ffmpeg
RUN apt-get update && apt-get install -y \
    curl \
    ffmpeg \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install latest yt-dlp binary from GitHub
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# Ensure JS runtimes are linked for yt-dlp
RUN ln -s /usr/bin/node /usr/bin/js || true && \
    ln -s /usr/bin/node /usr/bin/nodejs || true

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install App dependencies (Node.js part)
RUN npm ci --omit=dev

# Copy app source
COPY . .

# Create temp directory
RUN mkdir -p /tmp/fetchy-downloads && chmod 777 /tmp/fetchy-downloads

EXPOSE 8080

CMD ["npm", "start"]
