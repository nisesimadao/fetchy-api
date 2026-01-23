# Fetchy API - Railway Backend

Video download API for Fetchy iOS app using yt-dlp.

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

## Production

```bash
npm start
```

## Environment Variables

- `PORT`: Server port (default: 3000)
- `REDIS_URL`: Redis connection URL (Railway provides this automatically)
- `NODE_ENV`: Environment (production/development)

## API Endpoints

### POST /api/download
Start a download job.

**Request:**
```json
{
  "url": "https://youtube.com/watch?v=...",
  "quality": "1080p"
}
```

**Response:**
```json
{
  "jobId": "uuid",
  "status": "queued"
}
```

### GET /api/status/:jobId
Get job status and progress.

**Response:**
```json
{
  "status": "downloading",
  "progress": 0.75,
  "message": "Fetching...",
  "downloadUrl": "/api/download/:jobId"
}
```

### GET /api/download/:jobId
Download the completed file.

### GET /api/log/:jobId
Get raw yt-dlp log output.

## Railway Deployment

1. Install Railway CLI:
```bash
npm install -g @railway/cli
```

2. Login and initialize:
```bash
railway login
railway init
```

3. Add Redis service in Railway dashboard

4. Deploy:
```bash
railway up
```