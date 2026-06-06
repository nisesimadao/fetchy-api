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

    // In Vercel, we can't truly run in background after response is sent 
    // without using Vercel Functions or Edge Functions properly.
    // However, for this implementation, we start it and hope it finishes
    // before the function timeout.
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
 * Process download and update Supabase
 */
async function processDownload(jobId, url, quality) {
    console.log(`[WORKER] Starting job ${jobId} for ${url}`);
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
        const result = await downloadVideo(url, quality, async (progress, status, log) => {
            // Throttling updates might be good, but for now update every time
            await supabase
                .from('jobs')
                .update({
                    progress,
                    message: status,
                    log
                })
                .eq('id', jobId);
        });

        console.log(`[WORKER] Job ${jobId} completed successfully`);

        // Update to completed
        await supabase
            .from('jobs')
            .update({
                status: 'completed',
                progress: 1,
                message: 'Download complete',
                file_path: result.storagePath,
                title: result.title,
                log: result.log
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
