import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use system temp directory
const TEMP_DIR = path.join(tmpdir(), 'fetchy-downloads');
console.log(`[YTDLP] Temp directory: ${TEMP_DIR}`);

// Ensure temp directory exists
await fs.mkdir(TEMP_DIR, { recursive: true }).catch((err) => {
    console.error(`[YTDLP] Failed to create temp dir: ${err.message}`);
});

/**
 * Download video using yt-dlp binary directly
 * @param {string} url - Video URL
 * @param {string} quality - Quality preference (1080p, 720p, etc.)
 * @param {Function} progressCallback - Progress update callback
 * @returns {Promise<{filePath: string, title: string, log: string}>}
 */
export async function downloadVideo(url, quality = '1080p', progressCallback) {
    console.log(`[YTDLP] Starting download: ${url}, quality: ${quality}`);

    const outputTemplate = path.join(TEMP_DIR, '%(id)s.%(ext)s');
    let rawLog = '';

    return new Promise((resolve, reject) => {
        const args = [
            url,
            '-o', outputTemplate,
            '--format', `bestvideo[height<=${quality.replace('p', '')}]+bestaudio/best`,
            '--merge-output-format', 'mp4',
            '--no-playlist',
            '--newline',
            '--progress'
        ];

        console.log(`[YTDLP] Spawning: yt-dlp ${args.join(' ')}`);

        const ytDlpProcess = spawn('yt-dlp', args);

        ytDlpProcess.stdout.on('data', (data) => {
            const output = data.toString();
            rawLog += output;
            console.log(`[YTDLP] stdout: ${output.trim()}`);

            if (progressCallback) {
                const match = output.match(/(\d+\.\d+)%/);
                if (match) {
                    const percent = parseFloat(match[1]);
                    const status = getStatusFromLog(output);
                    progressCallback(percent / 100, status, output);
                }
            }
        });

        ytDlpProcess.stderr.on('data', (data) => {
            const output = data.toString();
            rawLog += output;
            console.error(`[YTDLP] stderr: ${output.trim()}`);
        });

        ytDlpProcess.on('close', async (code) => {
            console.log(`[YTDLP] Process exited with code ${code}`);
            if (code === 0) {
                try {
                    // Find the newly created file in TEMP_DIR
                    // Note: This relies on the output template using ID
                    // A more robust way might be --get-filename first, but let's try this
                    const files = await fs.readdir(TEMP_DIR);
                    // Filter by mtime to get the latest file might be better
                    // For now, look for any video file
                    const videoFile = files.find(f => f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.webm'));

                    if (!videoFile) {
                        return reject(new Error('Downloaded file not found on disk'));
                    }

                    resolve({
                        filePath: path.join(TEMP_DIR, videoFile),
                        title: videoFile,
                        log: rawLog
                    });
                } catch (err) {
                    reject(err);
                }
            } else {
                reject(new Error(`yt-dlp failed with code ${code}`));
            }
        });

        ytDlpProcess.on('error', (err) => {
            console.error(`[YTDLP] Failed to start process:`, err);
            reject(err);
        });
    });
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