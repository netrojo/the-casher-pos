// Main Express server for Cafe POS
const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const session = require('express-session');
const { stringify } = require('csv-stringify');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'pos.db');

// Local development wrapper for the Cafe POS Express app
const app = require('./api/index');
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`Local dev server running on http://localhost:${PORT}`));
const db = new sqlite3.Database(DB_PATH);
