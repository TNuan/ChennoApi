import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import authRoutes from './routes/authRoutes.js';
import workspaceRoutes from './routes/workspaceRoutes.js';
import boardRoutes from './routes/boardRoutes.js';
import columnRoutes from './routes/columnRoutes.js';
import cardRoutes from './routes/cardRoutes.js';

dotenv.config();

const app = express();
const port = 3000;

app.use(cors({
  origin: 'http://localhost:3001', // Cho phép frontend từ port 3001
  credentials: true,
}));
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/boards', boardRoutes);
app.use('/api/columns', columnRoutes);
app.use('/api/cards', cardRoutes);

app.listen(port, () => {
  console.log(`Server chạy tại http://localhost:${port}`);
});