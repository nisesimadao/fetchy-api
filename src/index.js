import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import downloadRoutes from './routes/download.js';
import { cleanupOldFiles } from './utils/ytdlp.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api', downloadRoutes);

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Cleanup old files every hour
setInterval(cleanupOldFiles, 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`[SERVER] Fetchy API running on port ${PORT}`);
  console.log(`[SERVER] Environment: ${process.env.NODE_ENV || 'development'}`);
});
