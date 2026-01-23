const express = require('express');
const downloadRoutes = require('./routes/download');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use('/api', downloadRoutes);

app.get('/', (req, res) => {
  res.send('Fetchy API is running!');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
