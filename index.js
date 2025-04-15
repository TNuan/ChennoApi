import express from 'express';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes.js';
import workspaceRoutes from './routes/workspaceRoutes.js';
import boardRoutes from './routes/boardRoutes.js';
import columnRoutes from './routes/columnRoutes.js';

dotenv.config();

const app = express();
const port = 3000;

app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/boards', boardRoutes);
app.use('/api/columns', columnRoutes);

app.listen(port, () => {
    console.log(`Server chạy tại http://localhost:${port}`);
});