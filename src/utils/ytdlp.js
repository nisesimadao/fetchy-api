import YTDlpWrap from 'yt-dlp-wrap';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use system temp directory instead of custom directory
const TEMP_DIR = path.join(tmpdir(), 'fetchy-downloads');
console.log(`[YTDLP] Temp directory: ${TEMP_DIR}`);

// Ensure temp directory exists
await fs.mkdir(TEMP_DIR, { recursive: true }).catch((err) => {
    console.error(`[YTDLP] Failed to create temp dir: ${err.message}`);
});

/**
 * Download video using yt-dlp
 * @param {string} url - Video URL
 * @param {string} quality - Quality preference (1080p, 720p, etc.)
 * @param {Function} progressCallback - Progress update callback
 * @returns {Promise<{filePath: string, title: string, log: string}>}
 */
export async function downloadVideo(url, quality = '1080p', progressCallback) {
    console.log(`[YTDLP] Starting download: ${url}, quality: ${quality}`);

    // Check if yt-dlp is in PATH
    try {
        const { execSync } = await import('child_process');
        const version = execSync('yt-dlp --version').toString().trim();
        console.log(`[YTDLP] Found yt-dlp version: ${version}`);
    } catch (err) {
        console.error(`[YTDLP] yt-dlp binary NOT found in PATH: ${err.message}`);
    }

    const ytDlp = new YTDlpWrap();
    const outputTemplate = path.join(TEMP_DIR, '%(id)s.%(ext)s');
    let rawLog = '';

    try {
        console.log(`[YTDLP] Executing yt-dlp with template: ${outputTemplate}`);
        const ytDlpProcess = ytDlp.exec([
            url,
            '-o', outputTemplate,
            '--format', `bestvideo[height<=${quality.replace('p', '')}]+bestaudio/best`,
            '--merge-output-format', 'mp4',
            '--no-playlist',
            '--newline',
            '--progress'
        ]);

        ytDlpProcess.stdout.on('data', (chunk) => {
            const data = chunk.toString();
            rawLog += data;

            if (progressCallback) {
                const match = data.match(/(\d+\.\d+)%/);
                if (match) {
                    const percent = parseFloat(match[1]);
                    const status = getStatusFromLog(data);
                    progressCallback(percent / 100, status, data);
                }
            }
        });

        ytDlpProcess.stderr.on('data', (chunk) => {
            console.error(`[YTDLP] stderr: ${chunk.toString()}`);
        });

        await new Promise((resolve, reject) => {
            ytDlpProcess.on('close', (code) => {
                console.log(`[YTDLP] yt-dlp exited with code ${code}`);
                if (code === 0) resolve();
                else reject(new Error(`yt-dlp exited with code ${code}`));
            });
            ytDlpProcess.on('error', (err) => {
                console.error(`[YTDLP] Process error:`, err);
                reject(err);
            });
        });

        // Find downloaded file
        const files = await fs.readdir(TEMP_DIR);
        const videoFile = files.find(f => f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mkv'));

        if (!videoFile) {
            throw new Error('Downloaded file not found');
        }

        const filePath = path.join(TEMP_DIR, videoFile);

        return {
            filePath,
            title: videoFile,
            log: rawLog
        };
    } catch (error) {
        console.error('[YTDLP] Error:', error);
        throw error;
    }
}

/**
 * Parse status from yt-dlp log output
 */
function getStatusFromLog(log) {
    const lower = log.toLowerCase();
    if (lower.includes('extracting') || lower.includes('webpage')) {
        return 'Analyzing...';
    } else if (lower.includes('merging')) {
        return 'Merging...';
    } else if (lower.includes('downloading')) {
        return 'Fetching...';
    }
    return 'Processing...';
}

/**
 * Clean up old files (older than 1 hour)
 */
export async function cleanupOldFiles() {
    try {
        const files = await fs.readdir(TEMP_DIR);
        const now = Date.now();
        const ONE_HOUR = 60 * 60 * 1000;

        for (const file of files) {
            const filePath = path.join(TEMP_DIR, file);
            const stats = await fs.stat(filePath);

            if (now - stats.mtimeMs > ONE_HOUR) {
                await fs.unlink(filePath);
                console.log(`[CLEANUP] Deleted old file: ${file}`);
            }
        }
    } catch (error) {
        console.error('[CLEANUP] Error:', error);
    }
}