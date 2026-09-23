'use strict';

const path = require('path');

// Project layout:
//   <root>/
//     .env
//     server/        this directory tree
//     public/        static public site
//     admin/         admin area
//     uploads/       uploaded media (git-ignored)
module.exports = {
  root: path.resolve(__dirname, '..', '..'),
  server: path.resolve(__dirname, '..'),
  public: path.resolve(__dirname, '..', '..', 'public'),
  admin: path.resolve(__dirname, '..', '..', 'admin'),
  uploads: path.resolve(__dirname, '..', '..', 'uploads'),
  schema: path.resolve(__dirname, '..', 'schema.sql')
};