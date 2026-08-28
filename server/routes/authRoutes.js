const express = require('express');
const router = express.Router();
const { loginUser, setupAdmin } = require('../controllers/authController');

router.post('/login', loginUser);
router.post('/setup-admin', setupAdmin); // Keep this temporarily to create your first admin

module.exports = router;