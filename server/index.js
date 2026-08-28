const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');

// Load env vars
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Temporary test route
app.get('/api/test', (req, res) => {
  res.json({ message: 'Welcome to Student Affairs API' });
});

// Authentication Routes
app.use('/api/auth', require('./routes/authRoutes'));

// Resource Routes
app.use('/api/societies', require('./routes/societyRoutes'));
// app.use('/api/events', require('./routes/eventRoutes'));
// app.use('/api/ambassadors', require('./routes/ambassadorRoutes'));
// app.use('/api/partners', require('./routes/partnerRoutes'));

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
