import { createcore } from 'youtube-dl-exec';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { supabase, BUCKET_NAME } from './supabase.js';

const ytdlp = createcore();

// Use system temp directory
const TEMP_DIR = path.join(tmpdir(), 'fetchy-downloads');

// Ensure temp directory exists
const ensureDir = async () => {
    try {
        await fs.mkdir(TEMP_DIR, { recursive: true });
    } catch (err) {
        if (err.code !== 'EEXIST') throw err;
    }
};

/**
 * Download video and upload to Supabase Storage
 * @param {string} url - Video URL
 */
export async function downloadVideo(url, quality = '1080p', progressCallback) {
    await ensureDir();
    console.log(`[YTDLP] Starting download: ${url}, quality: ${quality}`);

    const fileId = `${Date.now()}`;
    const outputTemplate = path.join(TEMP_DIR, `${fileId}.%(ext)s`);
    
    try {
        // 1. Download to /tmp
        const args = {
            output: outputTemplate,
            format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            mergeOutputFormat: 'mp4',
            noPlaylist: true,
            newline: true,
            progress: true,
            noCheckCertificates: true,
            youtubeSkipDashManifest: true,
            referer: 'https://www.youtube.com/embed/',
        };

        console.log(`[YTDLP] Running download for ${url}`);
        
        // Note: youtube-dl-exec doesn't easily expose stdout for progress in the simple way
        // but we can use the promise/child process it returns.
        const subprocess = ytdlp(url, args);

        subprocess.stdout.on('data', (data) => {
            const output = data.toString();
            if (progressCallback) {
                const match = output.match(/(\d+\.\d+)%/);
                if (match) {
                    const percent = parseFloat(match[1]);
                    progressCallback(percent / 100, 'Downloading...', output);
                }
            }
        });

        const result = await subprocess;
        console.log(`[YTDLP] Download finished`);

        // 2. Find the file
        const files = await fs.readdir(TEMP_DIR);
        const videoFile = files.find(f => f.startsWith(fileId));

        if (!videoFile) {
            throw new Error('Downloaded file not found on disk');
        }

        const filePath = path.join(TEMP_DIR, videoFile);
        const fileContent = await fs.readFile(filePath);

        // 3. Upload to Supabase Storage
        const storagePath = `downloads/${videoFile}`;
        console.log(`[SUPABASE] Uploading to ${BUCKET_NAME}/${storagePath}`);
        
        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .upload(storagePath, fileContent, {
                contentType: 'video/mp4',
                upsert: true
            });

        if (error) throw error;

        // 4. Cleanup local file
        await fs.unlink(filePath).catch(err => console.error(`[CLEANUP] Failed to delete temp file: ${err.message}`));

        return {
            storagePath,
            title: videoFile,
            log: 'Download and upload completed successfully'
        };

    } catch (error) {
        console.error(`[YTDLP] Error:`, error);
        throw error;
    }
}

/**
 * Placeholder for cleanup - in Vercel, /tmp is ephemeral, 
 * but we might want to clean up Supabase storage eventually.
 */
export async function cleanupOldFiles() {
    console.log('[CLEANUP] Supabase storage cleanup should be handled by a scheduled job or TTL policy.');
}
