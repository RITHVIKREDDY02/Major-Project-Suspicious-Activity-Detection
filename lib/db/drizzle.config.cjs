'use strict';

const path = require('path');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set. Ensure the database is provisioned.');
}

/** @type {import('drizzle-kit').Config} */
module.exports = {
  schema: path.join(__dirname, './src/schema/index.ts'),
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
};
