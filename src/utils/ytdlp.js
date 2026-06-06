import { create } from 'youtube-dl-exec';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { supabase, BUCKET_NAME } from './supabase.js';

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

    const fileId = `vid_${Date.now()}`;
    // Vercel handles /tmp better without subdirectories sometimes, but let's stick to absolute path
    const outputTemplate = path.join(TEMP_DIR, `${fileId}.%(ext)s`);
    
    try {
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

        console.log(`[YTDLP] Running download for ${url} with output ${outputTemplate}`);
        
        // youtube-dl-exec automatically handles binary downloading/location
        const subprocess = create()(url, args);

        let fullLog = '';

        if (subprocess.stdout) {
            subprocess.stdout.on('data', (data) => {
                const output = data.toString();
                fullLog += output;
                console.log(`[YTDLP] ${output.trim()}`);
                if (progressCallback) {
                    const match = output.match(/(\d+\.\d+)%/);
                    if (match) {
                        const percent = parseFloat(match[1]);
                        progressCallback(percent / 100, 'Downloading...', fullLog);
                    }
                }
            });
        }

        if (subprocess.stderr) {
            subprocess.stderr.on('data', (data) => {
                fullLog += data.toString();
                console.error(`[YTDLP ERROR] ${data.toString().trim()}`);
            });
        }

        await subprocess;
        console.log(`[YTDLP] Process finished. Searching for file with ID: ${fileId}`);

        // 2. Find the file
        // Sometimes yt-dlp might not follow the template exactly if merging fails
        const files = await fs.readdir(TEMP_DIR);
        console.log(`[YTDLP] Files in temp dir: ${files.join(', ')}`);
        
        const videoFile = files.find(f => f.includes(fileId));

        if (!videoFile) {
            throw new Error(`Downloaded file not found on disk. Log: ${fullLog.slice(-500)}`);
        }

        const filePath = path.join(TEMP_DIR, videoFile);
        console.log(`[YTDLP] Found file: ${filePath}`);
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
            log: fullLog
        };

    } catch (error) {
        console.error(`[YTDLP] Error:`, error);
        throw error;
    }
}

/**
 * Placeholder for cleanup
 */
export async function cleanupOldFiles() {
    console.log('[CLEANUP] Supabase storage cleanup should be handled by a scheduled job or TTL policy.');
}
