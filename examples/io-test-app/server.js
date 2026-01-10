const express = require('express');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = 3000;

// Data directories
const DATA_DIR = '/tmp/io-test-data';
const LOG_DIR = path.join(DATA_DIR, 'logs');
const DB_PATH = path.join(DATA_DIR, 'metrics.db');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Initialize SQLite database
const db = new Database(DB_PATH);
db.exec(`
    CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        metric_type TEXT NOT NULL,
        value REAL NOT NULL,
        metadata TEXT
    );
    
    CREATE TABLE IF NOT EXISTS file_operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        operation TEXT NOT NULL,
        filename TEXT NOT NULL,
        size INTEGER
    );
    
    CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);
    CREATE INDEX IF NOT EXISTS idx_file_ops_timestamp ON file_operations(timestamp);
`);

console.log('[IO-Test] Database initialized at:', DB_PATH);

// Metrics
let stats = {
    filesWritten: 0,
    filesRead: 0,
    bytesWritten: 0,
    bytesRead: 0,
    dbWrites: 0,
    dbReads: 0,
    logsGenerated: 0
};

// Background I/O operations
function generateFileIO() {
    const filename = path.join(DATA_DIR, `data_${Date.now()}.txt`);
    const data = Buffer.alloc(1024 * 10, 'A'); // 10KB of data
    
    // Write file
    fs.writeFileSync(filename, data);
    stats.filesWritten++;
    stats.bytesWritten += data.length;
    
    // Read file back
    const readData = fs.readFileSync(filename);
    stats.filesRead++;
    stats.bytesRead += readData.length;
    
    // Delete file
    fs.unlinkSync(filename);
    
    // Log to database
    const stmt = db.prepare('INSERT INTO file_operations (timestamp, operation, filename, size) VALUES (?, ?, ?, ?)');
    stmt.run(Date.now(), 'write-read-delete', filename, data.length);
    stats.dbWrites++;
}

function generateDatabaseIO() {
    const timestamp = Date.now();
    const metricTypes = ['cpu', 'memory', 'network', 'disk'];
    const metricType = metricTypes[Math.floor(Math.random() * metricTypes.length)];
    const value = Math.random() * 100;
    
    // Insert metric
    const stmt = db.prepare('INSERT INTO metrics (timestamp, metric_type, value, metadata) VALUES (?, ?, ?, ?)');
    stmt.run(timestamp, metricType, value, JSON.stringify({ source: 'io-test-app' }));
    stats.dbWrites++;
    
    // Read recent metrics
    const query = db.prepare('SELECT * FROM metrics ORDER BY timestamp DESC LIMIT 10');
    const rows = query.all();
    stats.dbReads++;
    
    return rows;
}

function generateLogFile() {
    const logFile = path.join(LOG_DIR, `app_${new Date().toISOString().split('T')[0]}.log`);
    const logEntry = `[${new Date().toISOString()}] INFO: Generated I/O operation #${stats.logsGenerated}\n`;
    
    fs.appendFileSync(logFile, logEntry);
    stats.logsGenerated++;
}

function performBulkIO() {
    const bulkFile = path.join(DATA_DIR, `bulk_${Date.now()}.dat`);
    const bulkData = Buffer.alloc(1024 * 100, 'B'); // 100KB
    
    // Write large file
    fs.writeFileSync(bulkFile, bulkData);
    stats.filesWritten++;
    stats.bytesWritten += bulkData.length;
    
    // Read in chunks
    const fd = fs.openSync(bulkFile, 'r');
    const chunkSize = 1024 * 10; // 10KB chunks
    const buffer = Buffer.alloc(chunkSize);
    let bytesRead = 0;
    
    while (true) {
        const read = fs.readSync(fd, buffer, 0, chunkSize, bytesRead);
        if (read === 0) break;
        bytesRead += read;
        stats.bytesRead += read;
    }
    
    fs.closeSync(fd);
    stats.filesRead++;
    
    // Delete bulk file
    fs.unlinkSync(bulkFile);
}

// Continuous I/O generation
setInterval(() => {
    generateFileIO();
}, 500); // Every 500ms

setInterval(() => {
    generateDatabaseIO();
}, 300); // Every 300ms

setInterval(() => {
    generateLogFile();
}, 1000); // Every 1s

setInterval(() => {
    performBulkIO();
}, 2000); // Every 2s

// API Endpoints
app.get('/', (req, res) => {
    res.json({
        app: 'IO Test Application',
        status: 'running',
        purpose: 'Generate disk I/O metrics for eBPF monitoring',
        endpoints: {
            '/': 'This info',
            '/stats': 'I/O statistics',
            '/metrics': 'Recent database metrics',
            '/trigger/write': 'Trigger file write',
            '/trigger/read': 'Trigger file read',
            '/trigger/bulk': 'Trigger bulk I/O',
            '/health': 'Health check'
        }
    });
});

app.get('/stats', (req, res) => {
    const dbSize = fs.statSync(DB_PATH).size;
    const logFiles = fs.readdirSync(LOG_DIR).length;
    
    res.json({
        timestamp: new Date().toISOString(),
        io_stats: stats,
        database: {
            path: DB_PATH,
            size_bytes: dbSize,
            size_mb: (dbSize / 1024 / 1024).toFixed(2)
        },
        logs: {
            directory: LOG_DIR,
            file_count: logFiles
        }
    });
});

app.get('/metrics', (req, res) => {
    const recentMetrics = db.prepare('SELECT * FROM metrics ORDER BY timestamp DESC LIMIT 50').all();
    const recentFileOps = db.prepare('SELECT * FROM file_operations ORDER BY timestamp DESC LIMIT 20').all();
    
    res.json({
        timestamp: new Date().toISOString(),
        recent_metrics: recentMetrics,
        recent_file_operations: recentFileOps
    });
});

app.get('/trigger/write', (req, res) => {
    const count = parseInt(req.query.count) || 1;
    for (let i = 0; i < count; i++) {
        generateFileIO();
    }
    res.json({ message: `Triggered ${count} file write operations`, stats });
});

app.get('/trigger/read', (req, res) => {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.txt'));
    let readCount = 0;
    
    files.forEach(file => {
        const data = fs.readFileSync(path.join(DATA_DIR, file));
        stats.bytesRead += data.length;
        readCount++;
    });
    
    res.json({ message: `Read ${readCount} files`, stats });
});

app.get('/trigger/bulk', (req, res) => {
    performBulkIO();
    res.json({ message: 'Bulk I/O operation completed', stats });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        stats
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[IO-Test] Server running on port ${PORT}`);
    console.log(`[IO-Test] Data directory: ${DATA_DIR}`);
    console.log(`[IO-Test] Database: ${DB_PATH}`);
    console.log(`[IO-Test] Continuous I/O generation started`);
    console.log(`[IO-Test] Visit http://localhost:${PORT} for endpoints`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('[IO-Test] Received SIGTERM, closing database...');
    db.close();
    process.exit(0);
});

