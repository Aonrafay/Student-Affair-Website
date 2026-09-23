'use strict';

require('dotenv').config({ path: require('./paths').root + '/.env' });

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || 'sa',
  database: process.env.DB_NAME || 'student_affairs',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  timezone: 'Z'
});

/** Run a query and return the rows (or result object for writes). */
async function q(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/** Run a query and return the first row (or null). */
async function qOne(sql, params) {
  const rows = await q(sql, params);
  return rows[0] || null;
}

module.exports = { pool, q, qOne };