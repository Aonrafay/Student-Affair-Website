const db = require('../config/db');

// @desc    Get all societies
// @route   GET /api/societies
// @access  Public
const getSocieties = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM societies ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'Server Error', error });
  }
};

// @desc    Get single society
// @route   GET /api/societies/:id
// @access  Public
const getSocietyById = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM societies WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Society not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Server Error', error });
  }
};

// @desc    Create a society
// @route   POST /api/societies
// @access  Private/Admin
const createSociety = async (req, res) => {
  const { name, description, president_name, vice_president_name, member_count, icon_class } = req.body;
  try {
    const [result] = await db.execute(
      'INSERT INTO societies (name, description, president_name, vice_president_name, member_count, icon_class) VALUES (?, ?, ?, ?, ?, ?)',
      [name, description, president_name, vice_president_name, member_count, icon_class]
    );
    res.status(201).json({ id: result.insertId, message: 'Society created' });
  } catch (error) {
    res.status(500).json({ message: 'Server Error', error });
  }
};

// @desc    Update a society
// @route   PUT /api/societies/:id
// @access  Private/Admin
const updateSociety = async (req, res) => {
  const { name, description, president_name, vice_president_name, member_count, icon_class } = req.body;
  try {
    const [result] = await db.execute(
      'UPDATE societies SET name = ?, description = ?, president_name = ?, vice_president_name = ?, member_count = ?, icon_class = ? WHERE id = ?',
      [name, description, president_name, vice_president_name, member_count, icon_class, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Society not found' });
    res.json({ message: 'Society updated' });
  } catch (error) {
    res.status(500).json({ message: 'Server Error', error });
  }
};

// @desc    Delete a society
// @route   DELETE /api/societies/:id
// @access  Private/Admin
const deleteSociety = async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM societies WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Society not found' });
    res.json({ message: 'Society removed' });
  } catch (error) {
    res.status(500).json({ message: 'Server Error', error });
  }
};

module.exports = {
  getSocieties,
  getSocietyById,
  createSociety,
  updateSociety,
  deleteSociety
};