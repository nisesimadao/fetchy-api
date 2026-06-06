# Fetchy API - Vercel & Supabase Backend

Video download API for Fetchy iOS app using yt-dlp, migrated to Vercel and Supabase.

## Architecture

- **Vercel**: Handles API requests and `yt-dlp` execution (Node.js).
- **Supabase Database**: Stores job status and logs.
- **Supabase Storage**: Stores downloaded video files.

## Setup

1. **Supabase Setup**:
   - Create a new project on [Supabase](https://supabase.com/).
   - Create a table named `jobs` with the following columns:
     - `id`: int8 (Identity)
     - `status`: text
     - `progress`: float8
     - `message`: text
     - `title`: text
     - `file_path`: text
     - `log`: text
     - `url`: text
     - `created_at`: timestamptz (default: now())
   - Create a storage bucket named `downloads` (set it to public or private as needed).

2. **Environment Variables**:
   Copy `.env.example` to `.env` and fill in your Supabase credentials.

3. **Install Dependencies**:
```bash
npm install
```

## Deployment to Vercel

1. Install Vercel CLI: `npm i -g vercel`
2. Deploy: `vercel`
3. Add Environment Variables in Vercel Dashboard:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_BUCKET_NAME` (optional, defaults to `downloads`)

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

### GET /api/status/:jobId
Get job status and progress.

### GET /api/download/:jobId
Redirects to a signed URL for the completed file.

### GET /api/log/:jobId
Get raw yt-dlp log output.