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

class MyLogger:
    def __init__(self, job_id):
        self.job_id = job_id
        
    def debug(self, msg):
        if not msg.startswith('[debug] '):
            self.info(msg)
            
    def info(self, msg):
        jobs[self.job_id]["log"] += f"{msg}\n"
        print(f"[{self.job_id}] {msg}")

    def warning(self, msg):
        jobs[self.job_id]["log"] += f"WARNING: {msg}\n"
        print(f"[{self.job_id}] WARNING: {msg}")

    def error(self, msg):
        jobs[self.job_id]["log"] += f"ERROR: {msg}\n"
        print(f"[{self.job_id}] ERROR: {msg}")

def progress_hook(d):
    job_id = d.get('info_dict', {}).get('job_id')
    if not job_id: return
    
    if d['status'] == 'downloading':
        p = d.get('_percent_str', '0%').replace('%', '').strip()
        try:
            jobs[job_id]["progress"] = float(p) / 100
            jobs[job_id]["status"] = "downloading"
        except:
            pass
    elif d['status'] == 'finished':
        jobs[job_id]["progress"] = 1.0
        jobs[job_id]["status"] = "merging"

def run_download(job_id: str, url: str, quality: str):
    jobs[job_id]["status"] = "analyzing"
    
    ydl_opts = {
        'format': f'bestvideo[height<={quality.replace("p", "")}][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        'outtmpl': f'{TEMP_DIR}/%(id)s.%(ext)s',
        'merge_output_format': 'mp4',
        'logger': MyLogger(job_id),
        'progress_hooks': [progress_hook],
        'nocheckcertificate': True,
        'referer': 'https://www.youtube.com/embed/',
        # Bypassing measures
        'extractor_args': {
            'youtube': {
                'player_client': ['tv', 'web'],
                'skip': ['dash', 'hls']
            }
        }
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # We need to pass job_id to the hook via info_dict
            info = ydl.extract_info(url, download=True)
            filename = ydl.prepare_filename(info)
            # If merged, the extension might change to .mp4 explicitly
            if not os.path.exists(filename) and os.path.exists(filename.rsplit('.', 1)[0] + '.mp4'):
                filename = filename.rsplit('.', 1)[0] + '.mp4'
                
            jobs[job_id]["file_path"] = filename
            jobs[job_id]["title"] = info.get('title', 'video')
            jobs[job_id]["status"] = "completed"
            jobs[job_id]["progress"] = 1.0
    except Exception as e:
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["log"] += f"CRITICAL ERROR: {str(e)}\n"
        print(f"[{job_id}] Failed: {str(e)}")

@app.post("/api/download")
async def create_download(data: Dict[str, str], background_tasks: BackgroundTasks):
    url = data.get("url")
    quality = data.get("quality", "1080p")
    
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    
    job_id = f"job-{int(time.time() * 1000)}-{uuid.uuid4().hex[:4]}"
    jobs[job_id] = {
        "status": "queued",
        "progress": 0.0,
        "title": "",
        "file_path": "",
        "log": "",
        "url": url
    }
    
    background_tasks.add_task(run_download, job_id, url, quality)
    return {"jobId": job_id}

@app.get("/api/status/{job_id}")
async def get_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = jobs[job_id]
    return {
        "jobId": job_id,
        "status": job["status"],
        "progress": job["progress"],
        "title": job["title"]
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
    return {"status": "ok", "backend": "python/fastapi"}

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
