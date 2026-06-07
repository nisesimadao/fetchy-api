import express from 'express';
import { addDownloadJob, getJobStatus, processDownload } from '../workers/downloadWorker.js';
import axios from 'axios';

const router = express.Router();

/**
 * POST /api/download
 router.post('/download', async (req, res) => {
   console.log(`[API] POST /download - URL: ${req.body.url}`);
   try {
     const { url, quality = '1080p' } = req.body;

     if (!url) {
       console.error('[API] Download error: URL is required for POST /download');
       return res.status(400).json({ error: 'URL is required' });
     }

     // 1. Check for existing completed job with the same URL
     const { data: existingJob } = await (await import('../utils/supabase.js')).supabase
       .from('jobs')
       .select('id, status')
       .eq('url', url)
       .eq('status', 'completed')
       .order('created_at', { ascending: false })
       .limit(1)
       .single();

     if (existingJob) {
       console.log(`[API] Found existing completed job: ${existingJob.id}. Reusing.`);
       return res.json({
         jobId: String(existingJob.id),
         status: 'completed'
       });
     }

     // 2. Create the job entry first if no cache found
     const jobId = await addDownloadJob(url, quality);
    console.log(`[API] Job created: ${jobId}. Starting synchronous processing...`);

    await processDownload(jobId, url, quality);

    res.json({
      jobId: String(jobId),
      status: 'completed'
    });
  } catch (error) {
    console.error('[API] Download error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/status/:jobId
 */
router.get('/status/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const status = await getJobStatus(jobId);
  
  if (status.status === 'not_found') {
    return res.status(404).json({ error: 'Job not found' });
  }

  const response = {
    status: status.status,
    progress: status.progress,
    message: status.message
  };

  if (status.status === 'completed' && status.file_path) {
    response.downloadUrl = `/api/download/${jobId}`;
    response.title = status.title;
  }

  res.json(response);
});

/**
 * GET /api/download/:jobId
 * Proxy the file from Supabase to keep headers clean for Swift client
 */
router.get('/download/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { supabase, BUCKET_NAME } = await import('../utils/supabase.js');
    const status = await getJobStatus(jobId);

    if (status.status !== 'completed' || !status.file_path) {
      return res.status(404).json({ error: 'File not ready or not found' });
    }

    // Get signed URL
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(status.file_path, 3600);

    if (error) throw error;

    // Stream the file from Supabase through Vercel to the client
    // This ensures the client sees it as a direct download from our API
    console.log(`[API] Proxying download from: ${data.signedUrl}`);
    
    const fileRes = await axios({
      method: 'get',
      url: data.signedUrl,
      responseType: 'stream'
    });

    // Set appropriate headers for video preview
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(status.title || 'video.mp4')}"`);
    
    // Pipe the stream
    fileRes.data.pipe(res);
  } catch (error) {
    console.error('[API] File download proxy error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/log/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const status = await getJobStatus(jobId);

  if (status.status === 'not_found') {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    log: status.log || 'No log available'
  });
});

export default router;
