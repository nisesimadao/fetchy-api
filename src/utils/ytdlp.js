import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import ffmpeg from 'ffmpeg-static';
import { supabase, BUCKET_NAME } from './supabase.js';

const TEMP_DIR = path.join(tmpdir(), 'fetchy-downloads');
const YTDLP_PATH = path.join(process.cwd(), 'yt-dlp');

const ensureDir = async () => {
    try {
        await fs.mkdir(TEMP_DIR, { recursive: true });
    } catch (err) {
        if (err.code !== 'EEXIST') throw err;
    }
};

export async function downloadVideo(url, quality = '1080p', progressCallback) {
    await ensureDir();
    console.log(`[YTDLP] URL: ${url}`);

    const fileId = `vid_${Date.now()}`;
    const outputTemplate = path.join(TEMP_DIR, `${fileId}.%(ext)s`);
    
    return new Promise((resolve, reject) => {
        const args = [
            url,
            '-o', outputTemplate,
            '-f', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best',
            '--merge-output-format', 'mp4',
            '--no-playlist',
            '--no-check-certificates',
            '--ffmpeg-location', ffmpeg,
            '--newline',
            '--progress',
            '--referer', 'https://www.youtube.com/embed/',
            '--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            '--extractor-args', 'youtube:player-client=android_tv_embedded,ios,mweb;player-skip=web,tv',
            '--js-runtime', 'node'
        ];

        console.log(`[YTDLP] Spawning: ${YTDLP_PATH} ${args.join(' ')}`);
        
        const process = spawn(YTDLP_PATH, args);
        let stdoutData = '';
        let stderrData = '';

        const handleOutput = (data) => {
            const out = data.toString();
            stdoutData += out;
            
            if (progressCallback) {
                // Better regex to catch 0%, 0.1%, 100% etc.
                const match = out.match(/(\d+(\.\d+)?)%/);
                let status = 'Downloading...';
                
                if (out.toLowerCase().includes('merging')) {
                    status = 'Merging...';
                } else if (out.toLowerCase().includes('extracting')) {
                    status = 'Analyzing...';
                }

                if (match) {
                    const progress = parseFloat(match[1]) / 100;
                    progressCallback(progress, status, out);
                } else if (out.trim()) {
                    // Even if no % match, update status if text changed
                    progressCallback(null, status, out);
                }
            }
        };

        process.stdout.on('data', handleOutput);
        process.stderr.on('data', (data) => {
            const err = data.toString();
            stderrData += err;
            console.error(`[YTDLP STDERR] ${err.trim()}`);
            // Sometimes progress/status is in stderr
            handleOutput(data);
        });

        process.on('close', async (code) => {
            if (code !== 0) {
                return reject(new Error(`yt-dlp exited with code ${code}. Stderr: ${stderrData}`));
            }

            try {
                console.log(`[YTDLP] Done. Checking /tmp...`);
                const files = await fs.readdir(TEMP_DIR);
                const videoFile = files.find(f => f.includes(fileId));

                if (!videoFile) {
                    throw new Error(`File not found in ${TEMP_DIR}. Stdout: ${stdoutData.slice(-100)}`);
                }

                const filePath = path.join(TEMP_DIR, videoFile);
                const fileContent = await fs.readFile(filePath);

                const storagePath = `downloads/${videoFile}`;
                const { error } = await supabase.storage.from(BUCKET_NAME).upload(storagePath, fileContent, {
                    contentType: 'video/mp4',
                    upsert: true
                });

                if (error) throw error;
                await fs.unlink(filePath).catch(() => {});

                resolve({ storagePath, title: videoFile, log: stdoutData });
            } catch (err) {
                reject(err);
            }
        });

        process.on('error', (err) => {
            reject(new Error(`Failed to start yt-dlp: ${err.message}`));
        });
    });
}

export async function cleanupOldFiles() {
    console.log('[CLEANUP] Managed by Supabase.');
}
