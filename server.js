const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// In-memory Database Structure
let db = {
  users: [],       // { id, email, name, password }
  nidos: [],       // { id, name, subject, adminId, tentativeDeadline, finalDeadline, members: [], subtasks: [ { id, title, assignedTo, completed, fileUrl, fileName, completedAt } ] }
  chats: [],       // { id, nidoId, senderName, senderEmail, message, type, fileUrl, fileName, timestamp }
  notifications: [] // { id, userId, title, message, type, timestamp, read: false }
};

// Seed mock data if DB file doesn't exist
const seedData = () => {
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      console.log('Database loaded successfully.');
    } catch (e) {
      console.error('Error parsing db.json, using default structure.', e);
    }
  } else {
    // Initial users
    db.users = [
      { id: '1', email: 'lucia@student.edu', name: 'Lucía Fernández', password: 'password123' },
      { id: '2', email: 'sofia@student.edu', name: 'Sofía Martínez', password: 'password123' },
      { id: '3', email: 'juan@student.edu', name: 'Juan Pérez', password: 'password123' }
    ];
    saveDb();
    console.log('Seed data initialized.');
  }
};

const saveDb = () => {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
};

// SSE Client list
let sseClients = [];

const broadcast = (data) => {
  const payload = JSON.stringify(data);
  sseClients.forEach(client => {
    client.write(`data: ${payload}\n\n`);
  });
};

// Background Alert Engine (runs every 30 seconds to check tentative deadlines)
setInterval(() => {
  const now = new Date();
  let dbChanged = false;

  db.nidos.forEach(nido => {
    if (!nido.tentativeDeadline) return;
    const tentativeDate = new Date(nido.tentativeDeadline);
    const diffHours = (tentativeDate - now) / (1000 * 60 * 60);

    // If within 24 hours and progress is not 100%
    if (diffHours > 0 && diffHours <= 24) {
      // Find team members who haven't uploaded their subtasks
      nido.subtasks.forEach(subtask => {
        if (!subtask.completed) {
          // Find matching member details
          const memberEmail = subtask.assignedTo;
          const memberUser = db.users.find(u => u.email === memberEmail || u.name === memberEmail);
          
          if (memberUser) {
            // Check if notification already exists
            const notifKey = `pressure-${nido.id}-${subtask.id}-${memberUser.id}`;
            const exists = db.notifications.some(n => n.id === notifKey);
            
            if (!exists) {
              const newNotif = {
                id: notifKey,
                userId: memberUser.id,
                title: '⚠️ Recordatorio Presión: ¡Faltas Tú!',
                message: `La fecha límite de control en el Nido "${nido.name}" es en menos de 24 horas y tu entrega de "${subtask.title}" está pendiente.`,
                type: 'pressure',
                timestamp: new Date().toISOString(),
                read: false
              };
              db.notifications.push(newNotif);
              dbChanged = true;

              // Mocking email sending
              console.log(`\n📧 [EMAIL SIMULADO ENVIADO A: ${memberUser.email}]`);
              console.log(`Asunto: ¡Faltas tú por subir tu parte al Nido "${nido.name}"!`);
              console.log(`Hola ${memberUser.name}, tu subtarea "${subtask.title}" vence pronto. Sube tus aportes para que el progreso grupal aumente.\n`);

              // Add a system chat message to the nido chat
              db.chats.push({
                id: crypto.randomUUID(),
                nidoId: nido.id,
                senderName: 'StudyNest Bot 🦉',
                senderEmail: 'bot@studynest.edu',
                message: `📢 Alerta de equipo: Faltan menos de 24 horas para el control y la asignación "${subtask.title}" de ${memberUser.name} sigue pendiente.`,
                type: 'alert',
                timestamp: new Date().toISOString()
              });

              // Broadcast update
              broadcast({ type: 'NOTIF_ALERTA', userId: memberUser.id, notification: newNotif });
            }
          }
        }
      });
    }
  });

  if (dbChanged) {
    saveDb();
    broadcast({ type: 'REFRESH_NIDOS' });
  }
}, 30000);

// MIME type map
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg'
};

// Main Server Handlers
const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // Handle Server-Sent Events (SSE) Stream
  if (pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    
    res.write('retry: 10000\n\n');
    sseClients.push(res);

    req.on('close', () => {
      sseClients = sseClients.filter(client => client !== res);
    });
    return;
  }

  // Handle API requests
  if (pathname.startsWith('/api/')) {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });

    req.on('end', () => {
      let data = {};
      if (body) {
        try {
          data = JSON.parse(body);
        } catch (e) {
          // Payload might not be JSON, skip
        }
      }

      res.setHeader('Content-Type', 'application/json');

      // --- USER REGISTER ---
      if (pathname === '/api/auth/register' && req.method === 'POST') {
        const { name, email, password } = data;
        if (!name || !email || !password) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Todos los campos son obligatorios.' }));
          return;
        }

        const userExists = db.users.find(u => u.email === email);
        if (userExists) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'El correo electrónico ya está registrado.' }));
          return;
        }

        const newUser = { id: crypto.randomUUID(), name, email, password };
        db.users.push(newUser);
        saveDb();

        res.writeHead(200);
        res.end(JSON.stringify({ success: true, user: { id: newUser.id, name: newUser.name, email: newUser.email } }));
        return;
      }

      // --- USER LOGIN ---
      if (pathname === '/api/auth/login' && req.method === 'POST') {
        const { email, password } = data;
        const user = db.users.find(u => u.email === email && u.password === password);
        
        if (!user) {
          res.writeHead(401);
          res.end(JSON.stringify({ error: 'Credenciales inválidas.' }));
          return;
        }

        res.writeHead(200);
        res.end(JSON.stringify({ success: true, user: { id: user.id, name: user.name, email: user.email } }));
        return;
      }

      // --- GET ALL USERS (FOR SEARCHING TEAM MEMBERS) ---
      if (pathname === '/api/users' && req.method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify(db.users.map(u => ({ id: u.id, name: u.name, email: u.email }))));
        return;
      }

      // --- GET NIDOS ---
      if (pathname === '/api/nidos' && req.method === 'GET') {
        const userId = parsedUrl.searchParams.get('userId');
        const userEmail = parsedUrl.searchParams.get('email');

        // Filter nidos where user is admin or member
        const userNidos = db.nidos.filter(nido => 
          nido.adminId === userId || 
          nido.members.some(m => m.id === userId || m.email === userEmail)
        );

        res.writeHead(200);
        res.end(JSON.stringify(userNidos));
        return;
      }

      // --- CREATE NIDO ---
      if (pathname === '/api/nidos' && req.method === 'POST') {
        const { name, subject, adminId, adminEmail, tentativeDeadline, finalDeadline, invitedMembers } = data;

        if (!name || !subject || !adminId) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Nombre, Materia y Administrador son requeridos.' }));
          return;
        }

        const membersList = [];
        // Add admin as a member automatically
        const adminUser = db.users.find(u => u.id === adminId);
        if (adminUser) {
          membersList.push({ id: adminUser.id, name: adminUser.name, email: adminUser.email, role: 'admin' });
        }

        // Add other invited members
        if (Array.isArray(invitedMembers)) {
          invitedMembers.forEach(email => {
            const user = db.users.find(u => u.email === email);
            if (user) {
              membersList.push({ id: user.id, name: user.name, email: user.email, role: 'member' });
            } else {
              // Add as a placeholder member if user doesn't exist yet
              membersList.push({ id: crypto.randomUUID(), name: email.split('@')[0], email: email, role: 'member' });
            }
          });
        }

        const newNido = {
          id: crypto.randomUUID(),
          name,
          subject,
          adminId,
          tentativeDeadline,
          finalDeadline,
          members: membersList,
          subtasks: []
        };

        db.nidos.push(newNido);
        saveDb();

        broadcast({ type: 'REFRESH_NIDOS', nidoId: newNido.id });

        res.writeHead(200);
        res.end(JSON.stringify(newNido));
        return;
      }

      // --- SUBTASK CREATE / ASSIGN ---
      if (pathname === '/api/nidos/tasks/assign' && req.method === 'POST') {
        const { nidoId, title, assignedTo } = data;
        const nido = db.nidos.find(n => n.id === nidoId);

        if (!nido) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Nido no encontrado.' }));
          return;
        }

        const newSubtask = {
          id: crypto.randomUUID(),
          title,
          assignedTo, // email address or classmate name
          completed: false,
          fileUrl: null,
          fileName: null,
          completedAt: null
        };

        nido.subtasks.push(newSubtask);
        saveDb();

        broadcast({ type: 'REFRESH_NIDOS', nidoId });

        res.writeHead(200);
        res.end(JSON.stringify(newSubtask));
        return;
      }

      // --- SUBTASK TOGGLE / SUBMIT ASSIGNMENT WITH FILE ---
      if (pathname === '/api/nidos/tasks/toggle' && req.method === 'POST') {
        const { nidoId, subtaskId, completed, fileContent, fileName } = data;
        const nido = db.nidos.find(n => n.id === nidoId);

        if (!nido) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Nido no encontrado.' }));
          return;
        }

        const subtask = nido.subtasks.find(s => s.id === subtaskId);
        if (!subtask) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Subtarea no encontrada.' }));
          return;
        }

        subtask.completed = completed;
        subtask.completedAt = completed ? new Date().toISOString() : null;

        if (completed && fileContent && fileName) {
          // File upload simulation (Base64 data)
          const base64Data = fileContent.replace(/^data:.*?;base64,/, "");
          const fileExt = path.extname(fileName);
          const localFileName = `upload_${subtaskId}_${Date.now()}${fileExt}`;
          const localFilePath = path.join(UPLOADS_DIR, localFileName);

          fs.writeFileSync(localFilePath, base64Data, 'base64');
          subtask.fileUrl = `/uploads/${localFileName}`;
          subtask.fileName = fileName;
        } else if (!completed) {
          subtask.fileUrl = null;
          subtask.fileName = null;
        }

        // Calculate progress percentage
        const completedCount = nido.subtasks.filter(s => s.completed).length;
        const totalCount = nido.subtasks.length;
        const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

        // If progress reached significant milestones, post an alert message to chat
        let milestoneMsg = '';
        if (completed && pct === 50 && totalCount > 1) {
          milestoneMsg = `🎉 ¡Buen trabajo! El Nido ha alcanzado el 50% de la meta general. ¡Sigan así!`;
        } else if (completed && pct === 100) {
          milestoneMsg = `🏆 ¡Excelente! Se ha completado el 100% de las subtareas en este Nido. ¡Trabajo terminado con éxito!`;
        }

        if (milestoneMsg) {
          db.chats.push({
            id: crypto.randomUUID(),
            nidoId: nido.id,
            senderName: 'StudyNest Bot 🦉',
            senderEmail: 'bot@studynest.edu',
            message: milestoneMsg,
            type: 'alert',
            timestamp: new Date().toISOString()
          });
        }

        saveDb();
        broadcast({ type: 'REFRESH_NIDOS', nidoId });

        res.writeHead(200);
        res.end(JSON.stringify({ success: true, progress: pct, subtask }));
        return;
      }

      // --- GET CHATS ---
      if (pathname === '/api/chats' && req.method === 'GET') {
        const nidoId = parsedUrl.searchParams.get('nidoId'); // 'global' or specific UUID
        const nidoChats = db.chats.filter(chat => chat.nidoId === nidoId);
        res.writeHead(200);
        res.end(JSON.stringify(nidoChats));
        return;
      }

      // --- SEND CHAT MESSAGE (WITH OPTIONAL MEDIA FILE) ---
      if (pathname === '/api/chats' && req.method === 'POST') {
        const { nidoId, senderName, senderEmail, message, fileContent, fileName } = data;

        if (!nidoId || !senderName || !senderEmail) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'NidoId, Nombre y Email son requeridos.' }));
          return;
        }

        let fileUrl = null;
        let localFileName = fileName;

        if (fileContent && fileName) {
          // Base64 file upload inside chats
          const base64Data = fileContent.replace(/^data:.*?;base64,/, "");
          const fileExt = path.extname(fileName);
          const uniqueId = crypto.randomBytes(8).toString('hex');
          const savedName = `chat_${uniqueId}_${Date.now()}${fileExt}`;
          const localFilePath = path.join(UPLOADS_DIR, savedName);

          fs.writeFileSync(localFilePath, base64Data, 'base64');
          fileUrl = `/uploads/${savedName}`;
        }

        const newChat = {
          id: crypto.randomUUID(),
          nidoId,
          senderName,
          senderEmail,
          message: message || '',
          type: fileUrl ? 'media' : 'text',
          fileUrl,
          fileName: localFileName,
          timestamp: new Date().toISOString()
        };

        db.chats.push(newChat);
        saveDb();

        broadcast({ type: 'NEW_CHAT_MESSAGE', chat: newChat });

        res.writeHead(200);
        res.end(JSON.stringify(newChat));
        return;
      }

      // --- GET NOTIFICATIONS ---
      if (pathname === '/api/notifications' && req.method === 'GET') {
        const userId = parsedUrl.searchParams.get('userId');
        const userNotifs = db.notifications.filter(n => n.userId === userId);
        res.writeHead(200);
        res.end(JSON.stringify(userNotifs));
        return;
      }

      // --- MARK NOTIFICATIONS AS READ ---
      if (pathname === '/api/notifications/read' && req.method === 'POST') {
        const { userId } = data;
        db.notifications.forEach(n => {
          if (n.userId === userId) n.read = true;
        });
        saveDb();
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // Route not found in API
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'API endpoint not found.' }));
    });
    return;
  }

  // Handle Static File Serving
  let filePath = path.join(PUBLIC_DIR, pathname);
  if (pathname === '/') {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  // Basic security check (prevent directory traversal)
  const relative = path.relative(PUBLIC_DIR, filePath);
  const isSafe = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  
  if (pathname !== '/' && !isSafe) {
    res.writeHead(403);
    res.end('Access Denied');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for Single Page Application router
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    
    const stream = fs.createReadStream(filePath);
    stream.on('error', (streamErr) => {
      res.writeHead(500);
      res.end('Server Error: ' + streamErr.message);
    });
    stream.pipe(res);
  });
});

// Seed mock data first
seedData();

server.listen(PORT, () => {
  console.log(`\n🚀 StudyNest Server running at: http://localhost:${PORT}`);
  console.log(`📂 Serviendo archivos estáticos desde: ${PUBLIC_DIR}`);
  console.log(`💡 Sin dependencias externas necesarias.`);
});
