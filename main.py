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

def run_download(job_id: str, url: str, quality: str, audio_only: bool = False, ext: str = "mp4"):
    print(f"[WORKER] Starting job {job_id} for {url} (Quality: {quality}, AudioOnly: {audio_only}, Ext: {ext})", flush=True)
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
    }

    if audio_only:
        ydl_opts.update({
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': ext if ext in ['mp3', 'm4a', 'wav'] else 'm4a',
                'preferredquality': '192',
            }],
        })
    else:
        ydl_opts.update({
            'format': f'bestvideo[height<={quality.replace("p", "")}][ext={ext if ext in ["mp4", "webm"] else "mp4"}]+bestaudio[ext=m4a]/best[ext={ext if ext in ["mp4", "webm"] else "mp4"}]/best',
            'merge_output_format': ext if ext in ['mp4', 'mkv', 'webm'] else 'mp4',
        })
    
    # Service specific bypassing
    if "youtube.com" in url or "youtu.be" in url:
        ydl_opts['referer'] = 'https://www.youtube.com/embed/'
        ydl_opts.setdefault('extractor_args', {})['youtube'] = {
            'player_client': ['tv', 'mweb'],
            'skip': ['dash', 'hls']
        }
    elif "x.com" in url or "twitter.com" in url:
        ydl_opts['referer'] = 'https://x.com/'
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            print(f"[YDL] Extracting: {url}", flush=True)
            ydl.params['job_id'] = job_id 
            
            # Fetch metadata first to ensure title is available even if download is fast
            info = ydl.extract_info(url, download=True)
            filename = ydl.prepare_filename(info)
            
            title = info.get('title') or info.get('id') or "Downloaded Media"
            jobs[job_id]["title"] = title
            jobs[job_id]["message"] = f"Finalizing {title}..."
            
            # Handle post-processing rename (e.g. merging to mp4 or converting to mp3)
            base_path = filename.rsplit('.', 1)[0]
            possible_files = [filename, f"{base_path}.{ext}", f"{base_path}.mp4", f"{base_path}.mp3", f"{base_path}.m4a", f"{base_path}.mkv", f"{base_path}.webm"]
            
            final_path = None
            for p in possible_files:
                if os.path.exists(p):
                    final_path = p
                    break
            
            if not final_path:
                raise Exception(f"Failed to locate file. Checked: {possible_files}")
                
            jobs[job_id]["file_path"] = final_path
            jobs[job_id]["status"] = "completed"
            jobs[job_id]["message"] = "Completed successfully"
            jobs[job_id]["progress"] = 1.0
            print(f"[WORKER] Finished job {job_id} -> {final_path}", flush=True)
    except Exception as e:
        jobs[job_id]["status"] = "failed"
        err_msg = str(e)
        jobs[job_id]["log"] += f"CRITICAL ERROR: {err_msg}\n"
        print(f"[{job_id}] Failed: {err_msg}", flush=True)

@app.post("/api/download")
async def create_download(data: Dict[str, Any], background_tasks: BackgroundTasks):
    url = data.get("url")
    quality = data.get("quality", "1080p")
    audio_only = data.get("audioOnly", False)
    ext = data.get("format", "mp4")
    
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    
    job_id = f"job-{int(time.time() * 1000)}-{uuid.uuid4().hex[:4]}"
    jobs[job_id] = {
        "status": "queued",
        "progress": 0.0,
        "title": "",
        "file_path": "",
        "log": "",
        "url": url,
        "message": "Queued..."
    }
    
    background_tasks.add_task(run_download, job_id, url, quality, audio_only, ext)
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
