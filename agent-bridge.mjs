#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 8787;
const HOST = '127.0.0.1';
const TOKEN = crypto.randomBytes(32).toString('hex');
const PROJECT_ROOT = __dirname;
const BACKUPS_DIR = path.join(PROJECT_ROOT, 'backups');

// Белый список команд
const ALLOWED_COMMANDS = [
  { regex: /^npx tsc --noEmit$/, desc: 'Type check' },
  { regex: /^npm run build$/, desc: 'Build project' },
  { regex: /^node --test .+\.test\.(js|mjs|ts)$/, desc: 'Run test' },
  { regex: /^npm run preview -- --port=\d+$/, desc: 'Preview server' },
];

// Создаём папку бэкапов
if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║         WASTELAND FORGE — AI AGENT BRIDGE                      ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');
console.log(`🔐 Bridge Token (copy to editor):\n`);
console.log(`   ${TOKEN}\n`);
console.log(`🌐 Listening on: http://${HOST}:${PORT}`);
console.log(`📁 Project root: ${PROJECT_ROOT}`);
console.log(`💾 Backups: ${BACKUPS_DIR}\n`);
console.log('Press Ctrl+C to stop the bridge.\n');

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function isPathSafe(filepath) {
  const resolved = path.resolve(PROJECT_ROOT, filepath);
  if (!resolved.startsWith(PROJECT_ROOT)) return false;
  const rel = path.relative(PROJECT_ROOT, resolved);
  if (rel.includes('node_modules')) return false;
  if (rel.includes('.git')) return false;
  if (rel.startsWith('dist')) return false;
  return true;
}

function listFiles(dir = '.') {
  const fullPath = path.join(PROJECT_ROOT, dir);
  if (!isPathSafe(dir)) return { error: 'Path not allowed' };
  if (!fs.existsSync(fullPath)) return { error: 'Directory not found' };
  
  const entries = [];
  try {
    const items = fs.readdirSync(fullPath, { withFileTypes: true });
    for (const item of items) {
      const itemPath = path.join(dir, item.name);
      if (isPathSafe(itemPath)) {
        entries.push({
          name: item.name,
          type: item.isDirectory() ? 'dir' : 'file',
          path: itemPath,
        });
      }
    }
    return { entries };
  } catch (err) {
    return { error: err.message };
  }
}

function readFile(filepath) {
  if (!isPathSafe(filepath)) return { error: 'Path not allowed' };
  const fullPath = path.join(PROJECT_ROOT, filepath);
  if (!fs.existsSync(fullPath)) return { error: 'File not found' };
  try {
    const content = fs.readFileSync(fullPath, 'utf8');
    return { content };
  } catch (err) {
    return { error: err.message };
  }
}

function writeFile(filepath, content) {
  if (!isPathSafe(filepath)) return { error: 'Path not allowed' };
  const fullPath = path.join(PROJECT_ROOT, filepath);
  
  // Бэкап существующего файла
  if (fs.existsSync(fullPath)) {
    try {
      const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
      const backupName = `${path.basename(filepath)}.${timestamp}.bak`;
      const backupPath = path.join(BACKUPS_DIR, backupName);
      fs.copyFileSync(fullPath, backupPath);
      log(`📦 Backup created: ${backupName}`);
    } catch (err) {
      log(`⚠️  Backup failed: ${err.message}`);
    }
  }
  
  try {
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, 'utf8');
    log(`✏️  File written: ${filepath}`);
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
}

function runCommand(cmd) {
  const allowed = ALLOWED_COMMANDS.find(({ regex }) => regex.test(cmd));
  if (!allowed) {
    return Promise.resolve({ error: `Command not allowed: ${cmd}` });
  }
  
  log(`⚙️  Running: ${cmd}`);
  
  return new Promise((resolve) => {
    const child = spawn(cmd, [], { shell: true, cwd: PROJECT_ROOT });
    let stdout = '';
    let stderr = '';
    
    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      log(`✅ Command finished with code ${code}`);
      resolve({
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
    
    child.on('error', (err) => {
      log(`❌ Command error: ${err.message}`);
      resolve({ error: err.message });
    });
  });
}

const server = http.createServer(async (req, res) => {
  // CORS для localhost
  const origin = req.headers.origin || '';
  if (!origin.includes('localhost') && !origin.includes('127.0.0.1')) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden origin' }));
    return;
  }
  
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Bridge-Token');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }
  
  // Проверка токена
  const token = req.headers['x-bridge-token'];
  if (token !== TOKEN) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid token' }));
    return;
  }
  
  let body = '';
  req.on('data', (chunk) => {
    body += chunk.toString();
  });
  
  req.on('end', async () => {
    let request;
    try {
      request = JSON.parse(body);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }
    
    const { tool, args } = request;
    let result;
    
    switch (tool) {
      case 'ping':
        result = { pong: true, project: path.basename(PROJECT_ROOT) };
        break;
      
      case 'list_files':
        result = listFiles(args?.dir);
        break;
      
      case 'read_file':
        result = readFile(args?.path);
        break;
      
      case 'write_file':
        result = writeFile(args?.path, args?.content);
        break;
      
      case 'run_command':
        result = await runCommand(args?.cmd);
        break;
      
      default:
        result = { error: 'Unknown tool' };
    }
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  });
});

server.listen(PORT, HOST, () => {
  log(`🚀 Bridge server started on ${HOST}:${PORT}`);
});

process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down bridge...');
  server.close(() => {
    console.log('✅ Bridge stopped.\n');
    process.exit(0);
  });
});
