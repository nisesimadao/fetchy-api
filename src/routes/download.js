import express from 'express';
import { addDownloadJob, getJobStatus } from '../workers/downloadWorker.js';
import { promises as fs } from 'fs';
import path from 'path';

const router = express.Router();

/**
 * POST /api/download
 * Start a new download job
 */
router.post('/download', async (req, res) => {
  console.log(`[API] POST /download - URL: ${req.body.url}`);
  try {
    const { url, quality = '1080p' } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const jobId = await addDownloadJob(url, quality);
    console.log(`[API] Job created: ${jobId}`);

    res.json({
      jobId,
      status: 'queued'
    });
  } catch (error) {
    console.error('[API] Download error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/status/:jobId
 * Get download job status
 */
router.get('/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const status = getJobStatus(jobId);
  console.log(`[API] GET /status/${jobId} - Status: ${status.status}, Progress: ${status.progress}`);

  if (status.status === 'not_found') {
    return res.status(404).json({ error: 'Job not found' });
  }

  const response = {
    status: status.status,
    progress: status.progress,
    message: status.message
  };

  // Include download URL if completed
  if (status.status === 'completed' && status.filePath) {
    response.downloadUrl = `/api/download/${jobId}`;
    response.title = status.title;
  }

  res.json(response);
});

/**
 * GET /api/download/:jobId
 * Download completed file
 */
router.get('/download/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const status = getJobStatus(jobId);

    if (status.status !== 'completed' || !status.filePath) {
      return res.status(404).json({ error: 'File not ready or not found' });
    }

    // Check if file exists
    try {
      await fs.access(status.filePath);
    } catch {
      return res.status(404).json({ error: 'File not found on disk' });
    }

    // Stream file to client
    res.download(status.filePath, status.title, (err) => {
      if (err) {
        console.error('[API] Download stream error:', err);
      }
    });
  } catch (error) {
    console.error('[API] File download error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/log/:jobId
 * Get raw download log
 */
router.get('/log/:jobId', (req, res) => {
  const { jobId } = req.params;
  const status = getJobStatus(jobId);

  if (status.status === 'not_found') {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    log: status.log || 'No log available'
  });
});

export default router;
