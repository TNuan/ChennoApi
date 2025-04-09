const express = require('express');
const app = express();
const port = 3000;

// Middleware để parse JSON từ request
app.use(express.json());

// Route cơ bản để kiểm tra server
app.get('/', (req, res) => {
    res.send('Hello, Project Management Backend!');
});

// Khởi động server
app.listen(port, () => {
    console.log(`Server chạy tại http://localhost:${port}`);
});