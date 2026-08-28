const express = require('express');
const router = express.Router();
const { getSocieties, getSocietyById, createSociety, updateSociety, deleteSociety } = require('../controllers/societyController');
const { protect, admin } = require('../middleware/authMiddleware');

router.route('/')
  .get(getSocieties)
  .post(protect, admin, createSociety);

router.route('/:id')
  .get(getSocietyById)
  .put(protect, admin, updateSociety)
  .delete(protect, admin, deleteSociety);

module.exports = router;