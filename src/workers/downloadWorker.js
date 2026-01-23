import { downloadVideo } from '../utils/ytdlp.js';

// In-memory job storage (no Redis required)
const jobStatus = new Map();
let jobIdCounter = 0;

/**
 * Add download job (in-memory, no queue)
 */
export async function addDownloadJob(url, quality = '1080p') {
    const jobId = `job-${Date.now()}-${jobIdCounter++}`;

    jobStatus.set(jobId, {
        status: 'queued',
        progress: 0,
        message: 'Queued...',
        log: ''
    });

    // Start download immediately in background
    processDownload(jobId, url, quality);

    return jobId;
}

/**
 * Get job status
 */
export function getJobStatus(jobId) {
    return jobStatus.get(jobId) || { status: 'not_found' };
}

/**
 * Process download (no queue, direct execution)
 */
async function processDownload(jobId, url, quality) {
    console.log(`[WORKER] Starting job ${jobId} for ${url}`);
    try {
        // Update status to downloading
        jobStatus.set(jobId, {
            status: 'downloading',
            progress: 0,
            message: 'Starting download...',
            log: ''
        });

        // Download video with progress tracking
        const result = await downloadVideo(url, quality, (progress, status, log) => {
            jobStatus.set(jobId, {
                status: 'downloading',
                progress,
                message: status,
                log
            });
        });

        console.log(`[WORKER] Job ${jobId} completed successfully`);

        // Update to completed
        jobStatus.set(jobId, {
            status: 'completed',
            progress: 1,
            message: 'Download complete',
            filePath: result.filePath,
            title: result.title,
            log: result.log
        });

        // Cleanup after 1 hour
        setTimeout(() => {
            jobStatus.delete(jobId);
        }, 60 * 60 * 1000);

    } catch (error) {
        jobStatus.set(jobId, {
            status: 'failed',
            progress: 0,
            message: error.message,
            log: error.stack
        });
    }
}

console.log('[WORKER] In-memory job storage initialized (no Redis)');