from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import yt_dlp
import uuid
import os
import time
import threading
from typing import Dict, Any

app = FastAPI(title="Fetchy API")

# CORS settings
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage for jobs
# {job_id: {status: str, progress: float, title: str, file_path: str, log: str}}
jobs: Dict[str, Any] = {}
TEMP_DIR = "/tmp/fetchy-downloads"
os.makedirs(TEMP_DIR, exist_ok=True)

import sys

class MyLogger:
    def __init__(self, job_id):
        self.job_id = job_id
        
    def debug(self, msg):
        if not msg.startswith('[debug] '):
            self.info(msg)
            
    def info(self, msg):
        jobs[self.job_id]["log"] += f"{msg}\n"
        print(f"[{self.job_id}] {msg}", flush=True)

    def warning(self, msg):
        jobs[self.job_id]["log"] += f"WARNING: {msg}\n"
        print(f"[{self.job_id}] WARNING: {msg}", flush=True)

    def error(self, msg):
        jobs[self.job_id]["log"] += f"ERROR: {msg}\n"
        print(f"[{self.job_id}] ERROR: {msg}", flush=True)

def progress_hook(d):
    job_id = d.get('info_dict', {}).get('job_id')
    if not job_id:
        # Check params if info_dict doesn't have it
        job_id = d.get('job_id')
        if not job_id and len(jobs) >= 1:
            job_id = list(jobs.keys())[-1] # Target most recent
        else:
            return
    
    if d['status'] == 'downloading':
        p_str = d.get('_percent_str', '0%').replace('%', '').strip()
        try:
            p = float(p_str) / 100
            jobs[job_id]["progress"] = p
            jobs[job_id]["status"] = "downloading"
            
            # Add speed and ETA to logs
            speed = d.get('_speed_str', 'N/A')
            eta = d.get('_eta_str', 'N/A')
            print(f"[{job_id}] Progress: {p_str}% | Speed: {speed} | ETA: {eta}", flush=True)
        except:
            pass
    elif d['status'] == 'finished':
        jobs[job_id]["progress"] = 1.0
        jobs[job_id]["status"] = "merging"
        print(f"[{job_id}] Download finished, merging...", flush=True)

def run_download(job_id: str, url: str, quality: str, audio_only: bool = False, ext: str = "mp4", bitrate: str = "192", embed_metadata: bool = True, embed_thumbnail: bool = True, remove_sponsors: bool = False, embed_subtitles: bool = False, embed_chapters: bool = False):
    print(f"[WORKER] Starting job {job_id} for {url} (Quality: {quality}, AudioOnly: {audio_only}, Ext: {ext}, Bitrate: {bitrate}, Metadata: {embed_metadata}, Thumb: {embed_thumbnail}, RemoveSponsors: {remove_sponsors}, Subs: {embed_subtitles}, Chapters: {embed_chapters})", flush=True)
    jobs[job_id]["status"] = "analyzing"
    
    # Base options
    ydl_opts = {
        'outtmpl': f'{TEMP_DIR}/%(id)s.%(ext)s',
        'logger': MyLogger(job_id),
        'progress_hooks': [progress_hook],
        'nocheckcertificate': True,
        'quiet': False,
        'no_warnings': False,
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'add_metadata': embed_metadata,
        'writethumbnail': embed_thumbnail,
        'ignore_no_formats_error': True, # Important for photo-only posts
        'allow_unplayable_formats': True,
    }

    if embed_subtitles:
        ydl_opts.update({
            'writesubtitles': True,
            'allsubtitles': True, 
            'embedsubtitles': True,
        })
    
    # Chapters are embedded via add_metadata usually, but ensuring it's on if requested
    if embed_chapters:
        ydl_opts['add_metadata'] = True

    if remove_sponsors:
        ydl_opts['sponsorblock_remove'] = 'all'

    # Note: We don't set 'format' yet, we'll do it after initial extraction
    # to avoid premature "No formats found" errors on image-only posts.
    
    # Service specific bypassing
    url_lower = url.lower()
    if "youtube" in url_lower or "youtu.be" in url_lower:
        ydl_opts['referer'] = 'https://www.youtube.com/'
        ydl_opts['user_agent'] = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        ydl_opts.setdefault('extractor_args', {})['youtube'] = {
            'player_client': ['ios', 'tv', 'android', 'mweb'],
            'skip': ['dash', 'hls']
        }
        ydl_opts['geo_bypass'] = True
        ydl_opts['youtube_include_dash_manifest'] = False
        ydl_opts['youtube_include_hls_manifest'] = False
    elif "x.com" in url_lower or "twitter.com" in url_lower:
        ydl_opts['referer'] = 'https://x.com/'
    
    info = None
    final_path = None
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            print(f"[YDL] Extracting: {url}", flush=True)
            ydl.params['job_id'] = job_id 
            
            # 1. Fetch metadata with error handling
            try:
                info = ydl.extract_info(url, download=False)
            except Exception as e:
                print(f"[YDL] Primary extraction failed: {e}. Trying flat extraction...", flush=True)
                try:
                    info = ydl.extract_info(url, download=False, process=False)
                except:
                    print("[YDL] Flat extraction also failed.", flush=True)

            if info:
                # Set Title for UI
                title = info.get('title') or info.get('id') or "Downloaded Media"
                jobs[job_id]["title"] = title
                jobs[job_id]["extractor"] = info.get('extractor_key') or info.get('extractor')

                # 2. Decide if we can proceed with standard download or skip to photo
                formats = info.get('formats', [])
                has_video_or_audio = any(f.get('vcodec') != 'none' or f.get('acodec') != 'none' for f in formats)
                
                if has_video_or_audio:
                    # Apply format constraints now
                    if audio_only:
                        ydl.params['format'] = 'bestaudio/best'
                        ydl.params['postprocessors'] = [{
                            'key': 'FFmpegExtractAudio',
                            'preferredcodec': ext if ext in ['mp3', 'm4a', 'wav'] else 'm4a',
                            'preferredquality': bitrate,
                        }]
                    else:
                        if quality == "MAX":
                            ydl.params['format'] = f'bestvideo[ext={ext if ext in ["mp4", "webm"] else "mp4"}]+bestaudio[ext=m4a]/best[ext={ext if ext in ["mp4", "webm"] else "mp4"}]/best/bestaudio/best'
                        else:
                            target_h = int(quality.replace("p", ""))
                            # Smart format picking
                            valid_h = [f for f in formats if f.get('height')]
                            if valid_h:
                                best_f = min(valid_h, key=lambda f: abs(f.get('height') - target_h))
                                print(f"[YDL] Target: {target_h}p | Closest: {best_f.get('height')}p", flush=True)
                                ydl.params['format'] = best_f['format_id']
                            else:
                                ydl.params['format'] = f'bestvideo[height<={target_h}][ext={ext if ext in ["mp4", "webm"] else "mp4"}]+bestaudio[ext=m4a]/best[height<={target_h}][ext={ext if ext in ["mp4", "webm"] else "mp4"}]/best/bestaudio/best'
                        
                        ydl.params['merge_output_format'] = ext if ext in ['mp4', 'mkv', 'webm'] else 'mp4'

                    # Perform actual download
                    try:
                        info = ydl.extract_info(url, download=True)
                        filename = ydl.prepare_filename(info)
                        
                        # File check logic
                        base_path = filename.rsplit('.', 1)[0]
                        possible_files = [
                            filename, f"{base_path}.{ext}", f"{base_path}.mp4", f"{base_path}.mp3", 
                            f"{base_path}.m4a", f"{base_path}.mkv", f"{base_path}.webm",
                            f"{base_path}.jpg", f"{base_path}.png", f"{base_path}.webp", f"{base_path}.jpeg"
                        ]
                        for p in possible_files:
                            if os.path.exists(p):
                                final_path = p
                                break
                    except Exception as de:
                        print(f"[YDL] Download stage failed: {de}, checking fallback.", flush=True)
            
            # 3. PHOTO FALLBACK (using yt-dlp info)
            if not final_path and info:
                print(f"[WORKER] Trying photo fallback with yt-dlp info...", flush=True)
                image_url = None
                
                # Twitter/X handle: Could be a playlist/gallery
                effective_info = info
                if info.get('_type') == 'playlist' and info.get('entries'):
                    effective_info = info['entries'][0]

                # Priority: url -> thumbnails -> formats
                if effective_info.get('url') and ('.jpg' in effective_info['url'] or '.png' in effective_info['url'] or '.webp' in effective_info['url'] or 'format=jpg' in effective_info['url']):
                    image_url = effective_info['url']
                elif effective_info.get('thumbnails'):
                    sorted_subs = sorted(effective_info['thumbnails'], key=lambda x: (x.get('width', 0) * x.get('height', 0)), reverse=True)
                    if sorted_subs: image_url = sorted_subs[0]['url']
                elif effective_info.get('formats'):
                    image_formats = [f for f in effective_info['formats'] if f.get('ext') in ['jpg', 'png', 'webp', 'jpeg'] or (f.get('vcodec') == 'none' and f.get('width'))]
                    if image_formats:
                        best_f = max(image_formats, key=lambda x: (x.get('width', 0) * x.get('height', 0)))
                        image_url = best_f.get('url')
                
                if image_url:
                    img_ext = 'jpg'
                    if '.png' in image_url: img_ext = 'png'
                    elif '.webp' in image_url: img_ext = 'webp'
                    target_img = f"{TEMP_DIR}/{effective_info.get('id', uuid.uuid4().hex)}.{img_ext}"
                    import subprocess
                    subprocess.run(['curl', '-L', '-s', '-o', target_img, image_url])
                    if os.path.exists(target_img): final_path = target_img

        # 4. SUPER FALLBACK: Scraping if everything else failed
        if not final_path:
            print(f"[WORKER] Super Fallback: Scraping OG tags for {url}...", flush=True)
            import subprocess, re
            try:
                # Use curl to get page source (impersonating iPhone to get simple mobile layout if possible)
                ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
                raw_html = subprocess.check_output(['curl', '-L', '-s', '-A', ua, url]).decode('utf-8', errors='ignore')
                
                # Look for og:image
                og_image_match = re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']', raw_html)
                if not og_image_match:
                    og_image_match = re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']', raw_html)
                
                if og_image_match:
                    image_url = og_image_match.group(1)
                    print(f"[WORKER] Found og:image: {image_url}", flush=True)
                    
                    # Also try to get title
                    if not jobs[job_id]["title"]:
                        title_match = re.search(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']', raw_html)
                        if title_match: jobs[job_id]["title"] = title_match.group(1)
                    
                    # Download it
                    target_img = f"{TEMP_DIR}/{uuid.uuid4().hex}.jpg"
                    subprocess.run(['curl', '-L', '-o', target_img, image_url])
                    if os.path.exists(target_img):
                        final_path = target_img
            except Exception as se:
                print(f"[WORKER] Super Fallback failed: {se}", flush=True)

        if not final_path:
            raise Exception("Failed to locate or download media (Video/Audio/Photo).")
            
        jobs[job_id]["file_path"] = final_path
        jobs[job_id]["filename"] = os.path.basename(final_path)
        jobs[job_id]["status"] = "completed"
        jobs[job_id]["message"] = "Completed successfully"
        jobs[job_id]["progress"] = 1.0
        print(f"[WORKER] Finished job {job_id} -> {final_path}", flush=True)

    except Exception as e:
        jobs[job_id]["status"] = "failed"
        err_msg = str(e)
        jobs[job_id]["message"] = f"Error: {err_msg}"
        jobs[job_id]["log"] += f"CRITICAL ERROR: {err_msg}\n"
        print(f"[{job_id}] Failed: {err_msg}", flush=True)

@app.post("/api/download")
async def create_download(data: Dict[str, Any], background_tasks: BackgroundTasks):
    url = data.get("url")
    quality = data.get("quality", "1080p")
    audio_only = data.get("audioOnly", False)
    ext = data.get("format", "mp4")
    bitrate = str(data.get("bitrate", "192"))
    embed_metadata = data.get("embedMetadata", True)
    embed_thumbnail = data.get("embedThumbnail", True)
    remove_sponsors = data.get("removeSponsors", False)
    embed_subtitles = data.get("embedSubtitles", False)
    embed_chapters = data.get("embedChapters", False)
    
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    
    job_id = f"job-{int(time.time() * 1000)}-{uuid.uuid4().hex[:4]}"
    jobs[job_id] = {
        "status": "queued",
        "progress": 0.0,
        "title": "",
        "extractor": None,
        "file_path": "",
        "filename": "",
        "log": "",
        "url": url,
        "message": "Queued..."
    }
    
    background_tasks.add_task(run_download, job_id, url, quality, audio_only, ext, bitrate, embed_metadata, embed_thumbnail, remove_sponsors, embed_subtitles, embed_chapters)
    return {"jobId": job_id, "status": "queued"}

@app.get("/api/status/{job_id}")
async def get_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = jobs[job_id]
    return {
        "status": job["status"],
        "progress": job["progress"],
        "message": job.get("message", job["status"]),
        "title": job["title"],
        "extractor": job.get("extractor"),
        "filename": job.get("filename", ""),
        "downloadUrl": f"/api/download/{job_id}" if job["status"] == "completed" else None
    }

@app.get("/api/download/{job_id}")
async def download_file(job_id: str):
    if job_id not in jobs or not jobs[job_id]["file_path"]:
        raise HTTPException(status_code=404, detail="File not found")
    
    path = jobs[job_id]["file_path"]
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Physical file missing")
        
    return FileResponse(path, filename=os.path.basename(path))

@app.get("/api/log/{job_id}")
async def get_log(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return {"log": jobs[job_id]["log"]}

@app.get("/health")
async def health():
    return {"status": "ok", "backend": "python/fastapi", "version": "1.1"}

# Cleanup thread
def cleanup_worker():
    while True:
        now = time.time()
        to_delete = []
        for jid, job in jobs.items():
            # Delete if older than 1 hour
            if now - float(jid.split('-')[1])/1000 > 3600:
                if job["file_path"] and os.path.exists(job["file_path"]):
                    try: os.remove(job["file_path"])
                    except: pass
                to_delete.append(jid)
        
        for jid in to_delete:
            del jobs[jid]
        time.sleep(600)

threading.Thread(target=cleanup_worker, daemon=True).start()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
