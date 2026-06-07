import { downloadVideo } from '../utils/ytdlp.js';
import { supabase } from '../utils/supabase.js';

/**
 * Add download job to Supabase
 */
export async function addDownloadJob(url, quality = '1080p') {
    const { data, error } = await supabase
        .from('jobs')
        .insert([{
            status: 'queued',
            progress: 0,
            message: 'Queued...',
            url: url
        }])
        .select()
        .single();

    if (error) throw error;
    
    const jobId = data.id;

    // Start download in background
    processDownload(jobId, url, quality);

    return jobId;
}

/**
 * Get job status from Supabase
 */
export async function getJobStatus(jobId) {
    const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', jobId)
        .single();

    if (error || !data) return { status: 'not_found' };
    return data;
}

/**
 * Process download and update Supabase with throttling
 */
async function processDownload(jobId, url, quality) {
    console.log(`[WORKER] Starting job ${jobId} for ${url}`);
    
    let lastUpdate = 0;
    const THROTTLE_MS = 2000; // Update Supabase every 2 seconds max

    try {
        // Update status to downloading
        await supabase
            .from('jobs')
            .update({
                status: 'downloading',
                message: 'Starting download...'
            })
            .eq('id', jobId);

        // Download video with progress tracking
        const result = await downloadVideo(url, quality, (progress, status, logChunk) => {
            const now = Date.now();
            
            // Only update if progress changed significantly or enough time passed
            if (now - lastUpdate > THROTTLE_MS || progress === 1) {
                lastUpdate = now;
                
                const updateData = { message: status };
                if (progress !== null) updateData.progress = progress;
                
                // We don't update the full log here to save bandwidth/rate limits
                // but we could update a small portion if needed.
                
                supabase
                    .from('jobs')
                    .update(updateData)
                    .eq('id', jobId)
                    .then(({ error }) => {
                        if (error) console.error(`[WORKER] Throttled update error:`, error);
                    });
            }
        });

        console.log(`[WORKER] Job ${jobId} completed successfully`);

        // Update to completed (final update, no throttle)
        await supabase
            .from('jobs')
            .update({
                status: 'completed',
                progress: 1,
                message: 'Download complete',
                file_path: result.storagePath,
                title: result.title,
                log: result.log.slice(-5000) // Keep only last 5KB of log
            })
            .eq('id', jobId);

    } catch (error) {
        console.error(`[WORKER] Job ${jobId} failed:`, error);
        await supabase
            .from('jobs')
            .update({
                status: 'failed',
                message: error.message,
                log: error.stack
            })
            .eq('id', jobId);
    }
}
