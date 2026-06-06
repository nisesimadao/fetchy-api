import { create } from 'youtube-dl-exec';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import ffmpeg from 'ffmpeg-static';
import { supabase, BUCKET_NAME } from './supabase.js';

const TEMP_DIR = path.join(tmpdir(), 'fetchy-downloads');

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
    
    try {
        const args = {
            output: outputTemplate,
            format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            mergeOutputFormat: 'mp4',
            noPlaylist: true,
            noCheckCertificates: true,
            ffmpegLocation: ffmpeg,
            referer: 'https://www.youtube.com/embed/',
        };

        console.log(`[YTDLP] Spawning process...`);
        
        // Use the library's built-in execution
        // We'll use the promise-based API and catch errors explicitly
        const ytdlpProcess = create();
        
        let stdoutData = '';
        let stderrData = '';

        const subprocess = ytdlpProcess(url, args);

        if (subprocess.stdout) {
            subprocess.stdout.on('data', (data) => {
                const out = data.toString();
                stdoutData += out;
                if (progressCallback) {
                    const match = out.match(/(\d+\.\d+)%/);
                    if (match) progressCallback(parseFloat(match[1]) / 100, 'Downloading...', stdoutData);
                }
            });
        }

        if (subprocess.stderr) {
            subprocess.stderr.on('data', (data) => {
                stderrData += data.toString();
            });
        }

        try {
            await subprocess;
        } catch (execError) {
            console.error(`[YTDLP EXEC ERROR]`, execError);
            throw new Error(`yt-dlp failed: ${execError.message}. Stderr: ${stderrData}`);
        }

        console.log(`[YTDLP] Done. Checking /tmp...`);

        const files = await fs.readdir(TEMP_DIR);
        const videoFile = files.find(f => f.includes(fileId));

        if (!videoFile) {
            throw new Error(`File not found. Stdout: ${stdoutData.slice(-200)} | Stderr: ${stderrData.slice(-200)}`);
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

        return { storagePath, title: videoFile, log: stdoutData };

    } catch (error) {
        console.error(`[YTDLP] Fatal:`, error);
        throw error;
    }
}

export async function cleanupOldFiles() {
    console.log('[CLEANUP] Managed by Supabase.');
}
