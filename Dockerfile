FROM node:20-bookworm-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install latest yt-dlp binary from GitHub
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
RUN chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install app dependencies
RUN npm ci --omit=dev

# Copy app source
COPY . .

# Create temp directory
RUN mkdir -p /tmp/fetchy-downloads && chmod 777 /tmp/fetchy-downloads

EXPOSE 8080

CMD ["npm", "start"]
