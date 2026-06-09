/**
 * StudyNest - Core Client Application
 * Handles Auth, Dashboard Routing, Pomodoro, Kanban, Group Nidos, Chats & Firebase Cloud.
 * Stores images and document attachments directly in Cloud Firestore as Base64 (No billing/Storage required).
 */

// Global Application State
let state = {
  currentUser: null,
  activeTab: 'dashboard', 
  personalTasks: [],      
  nidos: [],              
  activeNido: null,       
  chats: {
    global: [],           
    nido: {}              
  },
  notifications: [],      
  emailLogs: [],          
  offlineMode: false,
  globalChatConnected: false
};

// Simulated Virtual Classmates Profiles
const virtualClassmates = {
  lucia: { name: 'Lucía Fernández', email: 'lucia@student.edu', avatar: 'LF' },
  sofia: { name: 'Sofía Martínez', email: 'sofia@student.edu', avatar: 'SM' },
  juan: { name: 'Juan Pérez', email: 'juan@student.edu', avatar: 'JP' }
};

// Synthetic Focus/Break Sound Generator using Web Audio API
function playBeep(type = 'focus') {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    if (type === 'focus') {
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); 
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.5);
    } else {
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(440, audioCtx.currentTime); 
      gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.8);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.8);
    }
  } catch (e) {
    console.warn('Web Audio API not supported', e);
  }
}

// 1. DUAL-MODE DETECTION & INITIALIZATION
let activeNidoChatUnsubscribe = null;

async function checkServerConnection() {
  // --- MODE A: FIREBASE CLOUD ACTIVE & INITIALIZED ---
  if (typeof USE_FIREBASE !== 'undefined' && USE_FIREBASE && typeof firebaseInitialized !== 'undefined' && firebaseInitialized) {
    state.offlineMode = false;
    console.log("🔥 [StudyNest] Modo Nube Activo: Conectado a Firebase Database.");
    initFirebaseListeners();
    loadLocalState(); 
    toggleSimulatorWidgetVisibility();
    updateConnectionStatusBadge();
    return;
  }

  // --- MODE B: SILENT FALLBACK TO LOCAL STORAGE SIMULATION ---
  state.offlineMode = true;
  console.log("🦉 [StudyNest] Modo Local Activo: Simulando base de datos local.");
  initOfflineStorage();
  loadLocalState();
  
  // RESTORE SAVED USER SESSION (AUTO LOGIN)
  const savedUser = localStorage.getItem('studynest_current_user');
  if (savedUser) {
    try {
      state.currentUser = JSON.parse(savedUser);
      onLoginSuccess(true); // silent auto login
    } catch (e) {
      console.warn("Could not restore user session", e);
      renderDashboardOverview();
    }
  } else {
    renderDashboardOverview();
  }
  
  toggleSimulatorWidgetVisibility();
  updateConnectionStatusBadge();
}

function toggleSimulatorWidgetVisibility() {
  const widget = document.getElementById('simulator-floating-widget');
  if (widget) {
    if (state.offlineMode) {
      widget.style.display = 'block';
    } else {
      widget.style.display = 'none'; // Ocultar widget de simulación si se conecta a Firebase real
    }
  }
}

function updateConnectionStatusBadge() {
  const badge = document.getElementById('connection-status-badge');
  const dot = document.getElementById('connection-status-dot');
  const text = document.getElementById('connection-status-text');
  
  if (!badge || !dot || !text) return;
  
  if (typeof firebaseInitialized !== 'undefined' && firebaseInitialized && !state.offlineMode) {
    badge.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
    badge.style.color = '#10b981';
    badge.style.borderColor = 'rgba(16, 185, 129, 0.15)';
    dot.style.backgroundColor = '#10b981';
    text.innerText = 'Nube Real (Firebase)';
  } else {
    badge.style.backgroundColor = 'rgba(245, 158, 11, 0.1)';
    badge.style.color = '#d97706';
    badge.style.borderColor = 'rgba(245, 158, 11, 0.15)';
    dot.style.backgroundColor = '#d97706';
    text.innerText = 'Modo Local (Simulado)';
  }
}

// Firebase Real-time Collection Listeners
function initFirebaseListeners() {
  firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
      let userData = { id: user.uid, name: user.displayName || user.email.split('@')[0], email: user.email };
      try {
        const userDoc = await dbFirestore.collection('users').doc(user.uid).get();
        if (userDoc.exists) {
          userData = userDoc.data();
        } else {
          await dbFirestore.collection('users').doc(user.uid).set(userData);
        }
      } catch (error) {
        console.warn("⚠️ Firestore user document fetch/write failed, using Auth state fallback:", error);
      }
      
      state.currentUser = userData;
      document.getElementById('landing-view').style.display = 'none';
      document.getElementById('app-view').style.display = 'grid';
      document.getElementById('profile-user-name').innerText = state.currentUser.name;
      document.getElementById('profile-user-email').innerText = state.currentUser.email;

      // Subscribe to Nidos in real-time
      dbFirestore.collection('nidos')
        .where('membersEmails', 'array-contains', state.currentUser.email)
        .onSnapshot(snapshot => {
          state.nidos = [];
          snapshot.forEach(doc => {
            state.nidos.push({ id: doc.id, ...doc.data() });
          });
          renderDashboardOverview();
          if (state.activeTab === 'nidos') {
            if (state.activeNido) {
              state.activeNido = state.nidos.find(n => n.id === state.activeNido.id);
            }
            renderNidosTab();
          }
        });

      // Subscribe to notifications
      dbFirestore.collection('notifications')
        .where('userId', '==', state.currentUser.id)
        .orderBy('timestamp', 'desc')
        .onSnapshot(snapshot => {
          state.notifications = [];
          snapshot.forEach(doc => {
            state.notifications.push({ id: doc.id, ...doc.data() });
          });
          renderAlertsTab();
          updateUnreadNotificationBadge();
        });

      showToast(`¡Hola, ${state.currentUser.name}!`, 'Conectado a Firebase Database.');
      logMockEmail('FIREBASE', 'Autenticación', state.currentUser.email, 'Sesión autenticada en Firebase Cloud Database.');
    } else {
      state.currentUser = null;
      state.globalChatConnected = false;
      document.getElementById('app-view').style.display = 'none';
      document.getElementById('landing-view').style.display = 'block';
    }
  });
}

function subscribeToActiveNidoChats() {
  if (activeNidoChatUnsubscribe) {
    activeNidoChatUnsubscribe();
    activeNidoChatUnsubscribe = null;
  }

  if (state.activeNido && typeof USE_FIREBASE !== 'undefined' && USE_FIREBASE && firebaseInitialized) {
    const nidoId = state.activeNido.id;
    activeNidoChatUnsubscribe = dbFirestore.collection('chats')
      .where('nidoId', '==', nidoId)
      .orderBy('timestamp', 'asc')
      .onSnapshot(snapshot => {
        state.chats.nido[nidoId] = [];
        snapshot.forEach(doc => {
          state.chats.nido[nidoId].push({ id: doc.id, ...doc.data() });
        });
        if (state.activeTab === 'nidos' && state.activeNido && state.activeNido.id === nidoId) {
          renderNidoDetailView();
        }
      });
  }
}

// 2. OFFLINE STORAGE & SIMULATOR DATABASE SEEDING
function initOfflineStorage() {
  if (!localStorage.getItem('studynest_db_seeded')) {
    const seedDb = {
      users: [
        { id: '1', email: 'lucia@student.edu', name: 'Lucía Fernández', password: 'password123' },
        { id: '2', email: 'sofia@student.edu', name: 'Sofía Martínez', password: 'password123' },
        { id: '3', email: 'juan@student.edu', name: 'Juan Pérez', password: 'password123' }
      ],
      nidos: [
        {
          id: 'nido-physics-101',
          name: 'Proyecto de Física Mecánica',
          subject: 'Física I',
          adminId: '1',
          code: 'PHYS12',
          tentativeDeadline: new Date(Date.now() + 3600 * 1000 * 20).toISOString().split('T')[0],
          finalDeadline: new Date(Date.now() + 3600 * 1000 * 48).toISOString().split('T')[0],
          members: [
            { id: '1', name: 'Lucía Fernández', email: 'lucia@student.edu', role: 'admin' },
            { id: '2', name: 'Sofía Martínez', email: 'sofia@student.edu', role: 'member' },
            { id: '3', name: 'Juan Pérez', email: 'juan@student.edu', role: 'member' }
          ],
          subtasks: [
            { id: 'st-1', title: 'Marco Teórico & Ecuaciones', assignedTo: 'sofia@student.edu', completed: false, fileUrl: null, fileName: null },
            { id: 'st-2', title: 'Simulaciones en Matlab', assignedTo: 'lucia@student.edu', completed: true, fileUrl: '#', fileName: 'lab_simulacion.pdf' },
            { id: 'st-3', title: 'Conclusiones y Referencias', assignedTo: 'juan@student.edu', completed: false, fileUrl: null, fileName: null }
          ]
        }
      ],
      chats: [
        { id: 'c1', nidoId: 'global', senderName: 'StudyNest Bot 🦉', senderEmail: 'bot@studynest.edu', message: '¡Bienvenidos al Canal Global de StudyNest! Aquí puedes chatear con compañeros de toda la universidad.', timestamp: new Date().toISOString(), type: 'text' },
        { id: 'c2', nidoId: 'nido-physics-101', senderName: 'Lucía Fernández', senderEmail: 'lucia@student.edu', message: 'Hola equipo! Ya subí mi archivo de Matlab. Revísenlo por favor.', timestamp: new Date(Date.now() - 3600 * 1000).toISOString(), type: 'text' }
      ]
    };
    localStorage.setItem('studynest_users', JSON.stringify(seedDb.users));
    localStorage.setItem('studynest_nidos', JSON.stringify(seedDb.nidos));
    localStorage.setItem('studynest_chats', JSON.stringify(seedDb.chats));
    localStorage.setItem('studynest_db_seeded', 'true');
  }
}

function loadLocalState() {
  if (state.offlineMode) {
    state.nidos = JSON.parse(localStorage.getItem('studynest_nidos')) || [];
    const allChats = JSON.parse(localStorage.getItem('studynest_chats')) || [];
    state.chats.global = allChats.filter(c => c.nidoId === 'global');
    state.nidos.forEach(n => {
      state.chats.nido[n.id] = allChats.filter(c => c.nidoId === n.id);
    });
  }
  
  // Personal Kanban is saved locally for convenience
  state.personalTasks = JSON.parse(localStorage.getItem('studynest_personal_tasks')) || [
    { id: 'p1', title: 'Repasar para examen de Cálculo', desc: 'Capítulos 3 y 4 del libro guía.', subject: 'Cálculo II', status: 'pending' },
    { id: 'p2', title: 'Escribir boceto de ensayo', desc: 'Introducción del ensayo de filosofía.', subject: 'Filosofía', status: 'in-progress' }
  ];
  
  const quickNotes = localStorage.getItem('studynest_quick_notes') || '📝 Escribe tus notas rápidas aquí... Se guardan automáticamente al escribir.';
  const notesTextarea = document.getElementById('quick-notes-pad');
  if (notesTextarea) notesTextarea.value = quickNotes;
}

function saveLocalState() {
  if (state.offlineMode) {
    localStorage.setItem('studynest_nidos', JSON.stringify(state.nidos));
    const allChats = [...state.chats.global];
    Object.values(state.chats.nido).forEach(arr => allChats.push(...arr));
    localStorage.setItem('studynest_chats', JSON.stringify(allChats));
  }
  localStorage.setItem('studynest_personal_tasks', JSON.stringify(state.personalTasks));
}

// 3. AUTHENTICATION SERVICES
async function handleRegister(name, email, password) {
  if (typeof firebaseInitialized !== 'undefined' && firebaseInitialized) {
    const userCredential = await authFirebase.createUserWithEmailAndPassword(email, password);
    await userCredential.user.updateProfile({ displayName: name });
    const newUser = { id: userCredential.user.uid, name, email };
    try {
      await dbFirestore.collection('users').doc(userCredential.user.uid).set(newUser);
    } catch (error) {
      console.warn("⚠️ Error saving user document in Firestore:", error);
    }
    return;
  }

  if (state.offlineMode) {
    const users = JSON.parse(localStorage.getItem('studynest_users')) || [];
    if (users.some(u => u.email === email)) {
      throw new Error('El correo ya está registrado en la simulación.');
    }
    const newUser = { id: 'user-' + Date.now(), name, email, password };
    users.push(newUser);
    localStorage.setItem('studynest_users', JSON.stringify(users));
    state.currentUser = { id: newUser.id, name: newUser.name, email: newUser.email };
    onLoginSuccess();
  }
}

async function handleLogin(email, password) {
  if (typeof firebaseInitialized !== 'undefined' && firebaseInitialized) {
    await authFirebase.signInWithEmailAndPassword(email, password);
    return;
  }

  if (state.offlineMode) {
    const users = JSON.parse(localStorage.getItem('studynest_users')) || [];
    const user = users.find(u => u.email === email && u.password === password);
    if (!user) throw new Error('Credenciales incorrectas.');
    state.currentUser = { id: user.id, name: user.name, email: user.email };
    onLoginSuccess();
  }
}

async function handleForgotPassword(email) {
  email = email.trim();
  if (typeof firebaseInitialized !== 'undefined' && firebaseInitialized) {
    await authFirebase.sendPasswordResetEmail(email);
    return;
  }

  if (state.offlineMode) {
    const users = JSON.parse(localStorage.getItem('studynest_users')) || [];
    const exists = users.some(u => u.email === email);
    if (!exists) throw new Error('El correo no se encuentra registrado en el sistema local.');
    
    logMockEmail('SECURITY', 'Restablecer Clave', email, `Hola. Hemos recibido tu solicitud para restablecer tu contraseña en StudyNest. Haz clic aquí para definir una nueva contraseña: http://studynest.edu/reset?token=${Math.random().toString(36).substring(2)}`);
    showToast('Enviado con éxito 📧', 'Revisa el log de correos en la pestaña de Alertas.');
  }
}


function onLoginSuccess(silent = false) {
  document.getElementById('landing-view').style.display = 'none';
  const appView = document.getElementById('app-view');
  appView.style.display = 'grid';
  
  document.getElementById('profile-user-name').innerText = state.currentUser.name;
  document.getElementById('profile-user-email').innerText = state.currentUser.email;
  
  fetchNidos();
  switchTab('dashboard');
  
  // Save user session in simulation mode
  if (state.offlineMode) {
    localStorage.setItem('studynest_current_user', JSON.stringify(state.currentUser));
  }
  
  if (!silent) {
    showToast(`¡Hola, ${state.currentUser.name}!`, 'Bienvenido de vuelta a StudyNest.');
  }
  logMockEmail('SYSTEM', 'StudyNest Security', state.currentUser.email, 'Sesión iniciada con éxito. Dispositivo registrado: PC/SmartPhone.');
}

function handleLogout() {
  if (typeof firebaseInitialized !== 'undefined' && firebaseInitialized) {
    authFirebase.signOut();
    return;
  }

  state.currentUser = null;
  state.globalChatConnected = false; // Reset chat state
  localStorage.removeItem('studynest_current_user'); // Clear saved session
  document.getElementById('app-view').style.display = 'none';
  document.getElementById('landing-view').style.display = 'block';
  showToast('Sesión cerrada', 'Vuelve pronto para seguir estudiando.');
}

// 4. GROUP PROJECTS ("NIDOS") CONTROLLERS
async function fetchNidos() {
  if (typeof firebaseInitialized !== 'undefined' && firebaseInitialized) return;

  if (state.offlineMode) {
    state.nidos = JSON.parse(localStorage.getItem('studynest_nidos')) || [];
    renderDashboardOverview();
  }
}

function generateShortCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

let lastCreatedNidoCode = '';

async function createNido(name, subject, tentativeDeadline, finalDeadline, invitedEmails) {
  const code = generateShortCode();
  lastCreatedNidoCode = code;

  if (!state.currentUser) {
    showToast('⚠️ Inicia Sesión', 'Debes iniciar sesión para crear un Nido.', 'danger');
    return;
  }

  if (typeof firebaseInitialized !== 'undefined' && firebaseInitialized && !state.offlineMode) {
    try {
      const emailsList = [state.currentUser.email, ...invitedEmails];
      const membersList = [
        { id: state.currentUser.id, name: state.currentUser.name, email: state.currentUser.email, role: 'admin' }
      ];
      invitedEmails.forEach(email => {
        membersList.push({ id: 'm-' + Math.random(), name: email.split('@')[0], email, role: 'member' });
      });

      const newNido = {
        name,
        subject,
        adminId: state.currentUser.id,
        tentativeDeadline,
        finalDeadline,
        members: membersList,
        membersEmails: emailsList,
        subtasks: [],
        code: code
      };

      await dbFirestore.collection('nidos').add(newNido);
      
      // Muestra el código en el modal de éxito de creación
      document.getElementById('created-nido-code-display').innerText = code;
      openModalForm('nido-created-success');
      showToast('Nido Creado 🤝', `El nido "${name}" se guardó en Firestore con el código: ${code}`);
      return;
    } catch (error) {
      console.error("❌ Error guardando en Firestore (crear nido):", error);
      showToast('⚠️ Falló Firebase', 'Error de conexión o reglas vencidas. Guardando localmente...', 'danger');
      state.offlineMode = true;
      toggleSimulatorWidgetVisibility();
      updateConnectionStatusBadge();
      openModalForm('firebase-rules-error');
    }
  }

  if (state.offlineMode) {
    const newNido = {
      id: 'nido-' + Date.now(),
      name,
      subject,
      adminId: state.currentUser.id,
      tentativeDeadline,
      finalDeadline,
      members: [
        { id: state.currentUser.id, name: state.currentUser.name, email: state.currentUser.email, role: 'admin' }
      ],
      subtasks: [],
      code: code
    };

    invitedEmails.forEach(email => {
      const namePrefix = email.split('@')[0];
      newNido.members.push({ id: 'm-' + Math.random(), name: namePrefix, email, role: 'member' });
    });

    state.nidos.push(newNido);
    saveLocalState();
    fetchNidos();
  }
  
  // Muestra el código en el modal de éxito de creación
  document.getElementById('created-nido-code-display').innerText = code;
  openModalForm('nido-created-success');
  showToast('Nido Creado 🤝', `El nido "${name}" se configuró correctamente con el código: ${code}`);
}

async function addSubtask(nidoId, title, assignedTo) {
  if (typeof firebaseInitialized !== 'undefined' && firebaseInitialized && !state.offlineMode) {
    try {
      const nidoDoc = await dbFirestore.collection('nidos').doc(nidoId).get();
      if (nidoDoc.exists) {
        const nidoData = nidoDoc.data();
        nidoData.subtasks = nidoData.subtasks || [];
        nidoData.subtasks.push({
          id: 'st-' + Date.now(),
          title,
          assignedTo,
          completed: false,
          fileUrl: null,
          fileName: null
        });
        await dbFirestore.collection('nidos').doc(nidoId).update({ subtasks: nidoData.subtasks });
      }
      return;
    } catch (error) {
      console.error("❌ Error guardando subtarea en Firestore:", error);
      showToast('⚠️ Falló Firebase', 'Error de conexión o reglas vencidas. Guardando localmente...', 'danger');
      state.offlineMode = true;
      toggleSimulatorWidgetVisibility();
      openModalForm('firebase-rules-error');
    }
  }

  if (state.offlineMode) {
    const nido = state.nidos.find(n => n.id === nidoId);
    if (nido) {
      nido.subtasks.push({
        id: 'st-' + Date.now(),
        title,
        assignedTo,
        completed: false,
        fileUrl: null,
        fileName: null
      });
      saveLocalState();
      renderNidoDetailView();
    }
  }
}

async function toggleSubtask(nidoId, subtaskId, completed, fileData = null) {
  if (typeof firebaseInitialized !== 'undefined' && firebaseInitialized && !state.offlineMode) {
    try {
      const nidoDoc = await dbFirestore.collection('nidos').doc(nidoId).get();
      if (nidoDoc.exists) {
        const nidoData = nidoDoc.data();
        const subtask = nidoData.subtasks.find(s => s.id === subtaskId);
        if (subtask) {
          subtask.completed = completed;
          if (completed && fileData) {
            // --- ALMACENAMIENTO BASE64 DIRECTO EN FIRESTORE (SIN COSTO / SIN STORAGE) ---
            subtask.fileUrl = fileData.content; // Almacena la cadena Base64 directamente
            subtask.fileName = fileData.name;
          } else {
            subtask.fileUrl = null;
            subtask.fileName = null;
          }

          const comp = nidoData.subtasks.filter(s => s.completed).length;
          const total = nidoData.subtasks.length;
          const pct = Math.round((comp / total) * 100);

          let milestoneMsg = '';
          if (completed && pct === 50 && total > 1) {
            milestoneMsg = `🎉 ¡Buen trabajo! El Nido ha alcanzado el 50% de la meta general. ¡Sigan así!`;
          } else if (completed && pct === 100) {
            milestoneMsg = `🏆 ¡Excelente! Se ha completado el 100% de las subtareas en este Nido. ¡Trabajo terminado con éxito!`;
          }

          if (milestoneMsg) {
            await dbFirestore.collection('chats').add({
              nidoId,
              senderName: 'StudyNest Bot 🦉',
              senderEmail: 'bot@studynest.edu',
              message: milestoneMsg,
              timestamp: new Date().toISOString(),
              type: 'alert'
            });
          }

          await dbFirestore.collection('nidos').doc(nidoId).update({ subtasks: nidoData.subtasks });
          showToast('Tarea Actualizada', completed ? 'Entrega cargada exitosamente en la base de datos Firestore.' : 'Entrega retirada.');
        }
      }
      return;
    } catch (error) {
      console.error("❌ Error actualizando subtarea en Firestore:", error);
      showToast('⚠️ Falló Firebase', 'Error de conexión o reglas vencidas. Guardando localmente...', 'danger');
      state.offlineMode = true;
      toggleSimulatorWidgetVisibility();
      openModalForm('firebase-rules-error');
    }
  }

  if (state.offlineMode) {
    const nido = state.nidos.find(n => n.id === nidoId);
    if (nido) {
      const subtask = nido.subtasks.find(s => s.id === subtaskId);
      if (subtask) {
        subtask.completed = completed;
        if (completed && fileData) {
          subtask.fileUrl = fileData.content;
          subtask.fileName = fileData.name;
        } else if (!completed) {
          subtask.fileUrl = null;
          subtask.fileName = null;
        }
        
        const comp = nido.subtasks.filter(s => s.completed).length;
        const total = nido.subtasks.length;
        const pct = Math.round((comp / total) * 100);
        
        let milestoneMsg = '';
        if (completed && pct === 50 && total > 1) {
          milestoneMsg = `🎉 ¡Buen trabajo! El Nido ha alcanzado el 50% de la meta general. ¡Sigan así!`;
        } else if (completed && pct === 100) {
          milestoneMsg = `🏆 ¡Excelente! Se ha completado el 100% de las subtareas en este Nido. ¡Trabajo terminado con éxito!`;
        }

        if (milestoneMsg) {
          state.chats.nido[nidoId] = state.chats.nido[nidoId] || [];
          state.chats.nido[nidoId].push({
            id: 'system-' + Date.now(),
            nidoId,
            senderName: 'StudyNest Bot 🦉',
            senderEmail: 'bot@studynest.edu',
            message: milestoneMsg,
            timestamp: new Date().toISOString(),
            type: 'alert'
          });
        }
        
        saveLocalState();
        renderNidoDetailView();
        showToast('Tarea Actualizada', completed ? 'Entrega cargada con éxito.' : 'Entrega retirada.');
      }
    }
  }
}

// 5. CHAT ENGINE
async function fetchChats(nidoId) {
  if (typeof firebaseInitialized !== 'undefined' && firebaseInitialized) return;

  if (state.offlineMode) {
    const all = JSON.parse(localStorage.getItem('studynest_chats')) || [];
    if (nidoId === 'global') {
      state.chats.global = all.filter(c => c.nidoId === 'global');
    } else {
      state.chats.nido[nidoId] = all.filter(c => c.nidoId === nidoId);
    }
  }
}

async function sendChatMessage(nidoId, messageText, fileData = null) {
  const senderName = state.currentUser.name;
  const senderEmail = state.currentUser.email;

  if (typeof firebaseInitialized !== 'undefined' && firebaseInitialized && !state.offlineMode) {
    try {
      const newChat = {
        nidoId,
        senderName,
        senderEmail,
        message: messageText || '',
        type: fileData ? 'media' : 'text',
        fileUrl: fileData ? fileData.content : null, // Guarda la cadena Base64 directamente
        fileName: fileData ? fileData.name : null,
        timestamp: new Date().toISOString()
      };

      await dbFirestore.collection('chats').add(newChat);
      return;
    } catch (error) {
      console.error("❌ Error enviando mensaje en Firestore:", error);
      showToast('⚠️ Falló Firebase', 'Error de conexión o reglas vencidas. Guardando localmente...', 'danger');
      state.offlineMode = true;
      toggleSimulatorWidgetVisibility();
      openModalForm('firebase-rules-error');
    }
  }

  if (state.offlineMode) {
    const newChat = {
      id: 'c-' + Date.now(),
      nidoId,
      senderName,
      senderEmail,
      message: messageText || '',
      type: fileData ? 'media' : 'text',
      fileUrl: fileData ? fileData.content : null,
      fileName: fileData ? fileData.name : null,
      timestamp: new Date().toISOString()
    };

    if (nidoId === 'global') {
      state.chats.global.push(newChat);
    } else {
      state.chats.nido[nidoId] = state.chats.nido[nidoId] || [];
      state.chats.nido[nidoId].push(newChat);
    }

    saveLocalState();
    if (nidoId === 'global') renderGlobalChat();
    else renderNidoDetailView();
  }
}

// 6. RECORDATORIO ALERTS & SCHEDULER
function runOfflineAlertCheck() {
  if (typeof firebaseInitialized !== 'undefined' && firebaseInitialized) {
    const now = new Date();
    state.nidos.forEach(async (nido) => {
      if (!nido.tentativeDeadline) return;
      const tentativeDate = new Date(nido.tentativeDeadline);
      const diffHours = (tentativeDate - now) / (1000 * 60 * 60);

      if (diffHours > 0 && diffHours <= 24) {
        nido.subtasks.forEach(async (subtask) => {
          if (!subtask.completed) {
            const notifKey = `pressure-${nido.id}-${subtask.id}`;
            const exists = state.notifications.some(n => n.id === notifKey);
            
            if (!exists) {
              const newNotif = {
                userId: state.currentUser.id,
                title: '⚠️ Recordatorio Presión: ¡Faltas Tú!',
                message: `El control en "${nido.name}" vence pronto. Tu tarea "${subtask.title}" está pendiente.`,
                type: 'pressure',
                timestamp: new Date().toISOString(),
                read: false
              };
              
              await dbFirestore.collection('notifications').doc(notifKey).set(newNotif);
              
              await dbFirestore.collection('chats').add({
                nidoId: nido.id,
                senderName: 'StudyNest Bot 🦉',
                senderEmail: 'bot@studynest.edu',
                message: `📢 Alerta de equipo: Quedan menos de 24 horas para el control y la subtarea "${subtask.title}" asignada a ${subtask.assignedTo} sigue pendiente.`,
                timestamp: new Date().toISOString(),
                type: 'alert'
              });

              logMockEmail(nido.name, subtask.assignedTo, subtask.assignedTo, `¡Faltas tú por subir tu parte al nido! Tu subtarea "${subtask.title}" está pendiente.`);
            }
          }
        });
      }
    });
    return;
  }

  if (!state.offlineMode) return;
  const now = new Date();
  let changed = false;

  state.nidos.forEach(nido => {
    if (!nido.tentativeDeadline) return;
    const tentativeDate = new Date(nido.tentativeDeadline);
    const diffHours = (tentativeDate - now) / (1000 * 60 * 60);

    if (diffHours > 0 && diffHours <= 24) {
      nido.subtasks.forEach(subtask => {
        if (!subtask.completed) {
          const notifKey = `pressure-${nido.id}-${subtask.id}`;
          const exists = state.notifications.some(n => n.id === notifKey);
          
          if (!exists) {
            const newNotif = {
              id: notifKey,
              title: '⚠️ Recordatorio Presión: ¡Faltas Tú!',
              message: `El control en "${nido.name}" vence pronto. Tu tarea "${subtask.title}" está pendiente.`,
              type: 'pressure',
              timestamp: new Date().toISOString(),
              read: false
            };
            state.notifications.unshift(newNotif);
            changed = true;

            logMockEmail(nido.name, subtask.assignedTo, subtask.assignedTo, `¡Faltas tú por subir tu parte al nido! Tu subtarea "${subtask.title}" está pendiente.`);

            state.chats.nido[nido.id] = state.chats.nido[nido.id] || [];
            state.chats.nido[nido.id].push({
              id: 'system-alert-' + Date.now(),
              nidoId: nido.id,
              senderName: 'StudyNest Bot 🦉',
              senderEmail: 'bot@studynest.edu',
              message: `📢 Alerta de equipo: Quedan menos de 24 horas para el control y la subtarea "${subtask.title}" asignada a ${subtask.assignedTo} sigue pendiente.`,
              timestamp: new Date().toISOString(),
              type: 'alert'
            });

            showToast('⚠️ Presión de Control', `Alerta de control enviada al chat del Nido y correo de ${subtask.assignedTo}.`, 'warning');
          }
        }
      });
    }
  });

  if (changed) {
    saveLocalState();
    renderAlertsTab();
    updateUnreadNotificationBadge();
    if (state.activeTab === 'nidos' && state.activeNido) {
      renderNidoDetailView();
    }
  }
}

function logMockEmail(nidoName, recipientName, recipientEmail, content) {
  const timestamp = new Date().toLocaleTimeString();
  const rawLog = `[${timestamp}] 📧 EMAIL ENVIADO A: ${recipientEmail} (${recipientName})\n` +
                 `Asunto: [StudyNest] Control Tentativo - ${nidoName}\n` +
                 `Mensaje: ${content}\n` +
                 `Status: 250 OK (Simulado)\n` +
                 `----------------------------------------------------`;
  state.emailLogs.unshift(rawLog);
  renderEmailLogs();
}

function renderEmailLogs() {
  // Las alertas de correo se imprimen en la consola del navegador como logs internos
  console.log("📬 Historial de correos enviado (interno):", state.emailLogs);
}

// 7. POMODORO TIMER CORE CONTROLS
let pomodoroInterval = null;
let pomodoroSeconds = 25 * 60; 
let isTimerRunning = false;
let isBreakMode = false;

function initPomodoro() {
  const playPauseBtn = document.getElementById('pomo-play');
  const resetBtn = document.getElementById('pomo-reset');
  const pomoTimeDisplay = document.getElementById('pomo-time-display');
  const pomoModeLabel = document.getElementById('pomo-mode-label');
  const pomoCircle = document.getElementById('pomo-circle');

  const PLAY_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  const PAUSE_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;

  function updateTimerUI() {
    const mins = Math.floor(pomodoroSeconds / 60).toString().padStart(2, '0');
    const secs = (pomodoroSeconds % 60).toString().padStart(2, '0');
    pomoTimeDisplay.innerText = `${mins}:${secs}`;
  }

  playPauseBtn.addEventListener('click', () => {
    if (isTimerRunning) {
      clearInterval(pomodoroInterval);
      playPauseBtn.innerHTML = PLAY_ICON;
      playPauseBtn.classList.remove('active');
    } else {
      playBeep('focus');
      pomodoroInterval = setInterval(() => {
        if (pomodoroSeconds > 0) {
          pomodoroSeconds--;
          updateTimerUI();
        } else {
          clearInterval(pomodoroInterval);
          isTimerRunning = false;
          playPauseBtn.innerHTML = PLAY_ICON;
          playPauseBtn.classList.remove('active');
          
          if (!isBreakMode) {
            isBreakMode = true;
            pomodoroSeconds = 5 * 60; 
            pomoModeLabel.innerText = 'Descanso';
            pomoCircle.classList.add('break');
            showToast('💪 Sesión terminada', '¡Excelente trabajo! Tómate un respiro de 5 minutos.', 'info');
            playBeep('break');
          } else {
            isBreakMode = false;
            pomodoroSeconds = 25 * 60;
            pomoModeLabel.innerText = 'Enfoque Activo';
            pomoCircle.classList.remove('break');
            showToast('🎯 Volvamos al estudio', '¡Hora de enfocarse de nuevo!', 'info');
            playBeep('focus');
          }
          updateTimerUI();
        }
      }, 1000);
      playPauseBtn.innerHTML = PAUSE_ICON;
      playPauseBtn.classList.add('active');
    }
    isTimerRunning = !isTimerRunning;
  });

  resetBtn.addEventListener('click', () => {
    clearInterval(pomodoroInterval);
    isTimerRunning = false;
    isBreakMode = false;
    pomodoroSeconds = 25 * 60;
    pomoModeLabel.innerText = 'Enfoque Activo';
    pomoCircle.classList.remove('break');
    playPauseBtn.innerHTML = PLAY_ICON;
    playPauseBtn.classList.remove('active');
    updateTimerUI();
    showToast('Temporizador Reiniciado', 'Listo para comenzar tu próxima sesión de estudio.');
  });

  updateTimerUI();
}

// 8. PERSONAL KANBAN INTERACTIVITY
function renderKanban() {
  const todoCol = document.getElementById('col-pending');
  const progressCol = document.getElementById('col-progress');
  const completedCol = document.getElementById('col-completed');

  if (!todoCol || !progressCol || !completedCol) return;

  todoCol.innerHTML = '';
  progressCol.innerHTML = '';
  completedCol.innerHTML = '';

  state.personalTasks.forEach(task => {
    const card = document.createElement('div');
    card.className = 'task-card';
    card.draggable = true;
    card.innerHTML = `
      <h4>${task.title}</h4>
      <p>${task.desc}</p>
      <div class="task-card-meta">
        <span class="subject-tag">${task.subject}</span>
        <button onclick="deletePersonalTask('${task.id}')" style="background:none; border:none; color:#dc2626; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; padding:4px;" title="Eliminar Actividad">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        </button>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') {
        cycleTaskStatus(task.id);
      }
    });

    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', task.id);
    });

    if (task.status === 'pending') todoCol.appendChild(card);
    else if (task.status === 'in-progress') progressCol.appendChild(card);
    else completedCol.appendChild(card);
  });
}

function cycleTaskStatus(taskId) {
  const task = state.personalTasks.find(t => t.id === taskId);
  if (task) {
    if (task.status === 'pending') task.status = 'in-progress';
    else if (task.status === 'in-progress') task.status = 'completed';
    else task.status = 'pending';
    saveLocalState();
    renderKanban();
  }
}

function addPersonalTask(title, desc, subject) {
  state.personalTasks.push({
    id: 'pt-' + Date.now(),
    title,
    desc,
    subject,
    status: 'pending'
  });
  saveLocalState();
  renderKanban();
  showToast('Tarea Registrada 📋', `"${title}" añadida a tus pendientes.`);
}

function deletePersonalTask(taskId) {
  state.personalTasks = state.personalTasks.filter(t => t.id !== taskId);
  saveLocalState();
  renderKanban();
}

// 9. COLLABORATIVE CLASSMATE SIMULATION TRIGGERS
function runClassmateSimulationAction(actionId) {
  if (!state.activeNido) {
    showToast('⚠️ Sin Nido Activo', 'Entra primero a un Nido para simular las acciones de tus compañeros.');
    return;
  }
  const nidoId = state.activeNido.id;

  if (actionId === 'lucia-chat') {
    const sampleMessage = '¡Hola equipo! ¿Cómo van con las diapositivas? Les comparto mis apuntes rápidos de la clase pasada para ir armando el marco teórico.';
    const sampleImageBase64 = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="100%" height="100%" fill="%23fdf6e3"/><text x="10" y="30" fill="%23586e75" font-family="Courier" font-size="14">Apuntes de Lucia:</text><line x1="10" y1="40" x2="280" y2="40" stroke="%2393a1a1" stroke-width="2"/><text x="10" y="70" fill="%23268bd2" font-family="sans-serif" font-size="12">1. Formula de aceleracion a = dv/dt</text><text x="10" y="100" fill="%23268bd2" font-family="sans-serif" font-size="12">2. Coeficiente de friccion estatica</text><text x="10" y="130" fill="%23268bd2" font-family="sans-serif" font-size="12">3. Grafica fuerza vs posicion</text><circle cx="200" cy="120" r="25" fill="none" stroke="%23859900" stroke-width="2"/></svg>';
    
    simulateClassmateMessage('Lucía Fernández', 'lucia@student.edu', sampleMessage, {
      name: 'apuntes_fisica_lucia.png',
      content: sampleImageBase64
    });
    showToast('💬 Mensaje de Lucía', 'Lucía envió una foto de sus apuntes al chat del grupo.');
  } 
  
  else if (actionId === 'sofia-task') {
    const subtask = state.activeNido.subtasks.find(s => s.assignedTo === 'sofia@student.edu' || s.title.includes('Marco'));
    if (subtask) {
      if (subtask.completed) {
        showToast('ℹ️ Tarea ya completada', 'Sofía ya completó su subtarea.');
        return;
      }
      const fileData = {
        name: 'Marco_Teorico_Sofia.pdf',
        content: 'data:application/pdf;base64,JVBERi0xLjQKJ...'
      };
      
      toggleSubtask(nidoId, subtask.id, true, fileData).then(() => {
        simulateClassmateMessage('Sofía Martínez', 'sofia@student.edu', '¡Listo! Ya subí mi archivo PDF con el borrador del Marco Teórico. ¿Lo pueden revisar?');
        showToast('✨ Sofía completó su tarea', 'La barra de progreso general se actualizó.');
      });
    } else {
      showToast('⚠️ Tarea no encontrada', 'Asegúrate de que el nido tenga una subtarea asignada a Sofía.');
    }
  } 
  
  else if (actionId === 'juan-complain') {
    simulateClassmateMessage('Juan Pérez', 'juan@student.edu', 'Hola compañeros, disculpen. Hoy mi red ha estado intermitente y lenta en casa, pero ya casi termino mi parte de las conclusiones y lo subo. ¡No me maten!');
  } 
  
  else if (actionId === 'juan-task') {
    const subtask = state.activeNido.subtasks.find(s => s.assignedTo === 'juan@student.edu' || s.title.includes('Conclusiones'));
    if (subtask) {
      if (subtask.completed) {
        showToast('ℹ️ Tarea ya completada', 'Juan ya cargó sus conclusiones.');
        return;
      }
      const fileData = {
        name: 'Conclusiones_Juan_Borrador.docx',
        content: 'data:text/plain;base64,Q29uY2x1c2lvbmVz...'
      };
      toggleSubtask(nidoId, subtask.id, true, fileData).then(() => {
        simulateClassmateMessage('Juan Pérez', 'juan@student.edu', '¡Acabo de subir las conclusiones! El avance grupal ya debería estar al 100%. Quedo atento a la entrega final.');
      });
    } else {
      showToast('⚠️ Tarea no encontrada', 'Asegúrate de que el nido tenga una subtarea asignada a Juan.');
    }
  } 
  
  else if (actionId === 'trigger-alerts') {
    if (typeof firebaseInitialized !== 'undefined' && firebaseInitialized) {
      dbFirestore.collection('nidos').doc(nidoId).update({
        tentativeDeadline: new Date(Date.now() + 3600 * 1000 * 2).toISOString()
      }).then(() => {
        runOfflineAlertCheck();
      });
      return;
    }
    state.activeNido.tentativeDeadline = new Date(Date.now() + 3600 * 1000 * 2).toISOString();
    saveLocalState();
    runOfflineAlertCheck();
  }
}

function simulateClassmateMessage(senderName, senderEmail, text, fileData = null) {
  const nidoId = state.activeNido.id;
  
  if (typeof firebaseInitialized !== 'undefined' && firebaseInitialized) {
    sendChatMessage(nidoId, text, fileData);
    return;
  }

  const newMsg = {
    id: 'sim-' + Date.now(),
    nidoId,
    senderName,
    senderEmail,
    message: text,
    type: fileData ? 'media' : 'text',
    fileUrl: fileData ? fileData.content : null,
    fileName: fileData ? fileData.content ? fileData.name : null : null,
    timestamp: new Date().toISOString()
  };
  
  state.chats.nido[nidoId] = state.chats.nido[nidoId] || [];
  state.chats.nido[nidoId].push(newMsg);
  saveLocalState();
  renderNidoDetailView();
}

// 10. RENDERING FUNCTIONS FOR DASHBOARD / APP LAYOUTS
function switchTab(tabId) {
  state.activeTab = tabId;
  
  document.querySelectorAll('.sidebar-menu-item').forEach(li => {
    li.classList.remove('active');
  });
  const activeLi = document.querySelector(`.sidebar-menu-item[data-tab="${tabId}"]`);
  if (activeLi) activeLi.classList.add('active');

  // Synchronize mobile bottom navigation items
  document.querySelectorAll('.mobile-nav-item').forEach(item => {
    item.classList.remove('active');
  });
  const activeMobileItem = document.querySelector(`.mobile-nav-item[data-tab="${tabId}"]`);
  if (activeMobileItem) activeMobileItem.classList.add('active');

  document.querySelectorAll('.glass-panel-content').forEach(p => {
    p.style.display = 'none';
  });

  const targetPanel = document.getElementById(`panel-${tabId}`);
  if (targetPanel) targetPanel.style.display = 'block';

  // Actualizar dinámicamente el título del encabezado
  const titleEl = document.getElementById('current-tab-title');
  if (titleEl) {
    if (tabId === 'dashboard') {
      titleEl.innerText = 'Tablero de Inicio';
    } else if (tabId === 'productivity') {
      titleEl.innerText = 'Enfoque & Actividades';
    } else if (tabId === 'nidos') {
      titleEl.innerText = state.activeNido ? `Nido: ${state.activeNido.name}` : 'Nidos de Estudio';
    } else if (tabId === 'alerts') {
      titleEl.innerText = 'Alertas & Notificaciones';
    }
  }

  if (tabId === 'dashboard') {
    renderDashboardOverview();
    const gcPlaceholder = document.getElementById('global-chat-placeholder');
    const gcActiveView = document.getElementById('global-chat-active-view');
    if (state.globalChatConnected) {
      if (gcPlaceholder) gcPlaceholder.style.display = 'none';
      if (gcActiveView) gcActiveView.style.display = 'flex';
      fetchChats('global');
      renderGlobalChat();
    } else {
      if (gcPlaceholder) gcPlaceholder.style.display = 'flex';
      if (gcActiveView) gcActiveView.style.display = 'none';
    }
  } else if (tabId === 'productivity') {
    renderKanban();
  } else if (tabId === 'nidos') {
    renderNidosTab();
  } else if (tabId === 'alerts') {
    renderAlertsTab();
    renderEmailLogs();
  }
}

function renderDashboardOverview() {
  const upcomingList = document.getElementById('upcoming-deadlines-list');
  if (!upcomingList) return;
  upcomingList.innerHTML = '';

  const activeNidosList = document.getElementById('dashboard-active-nidos');
  if (activeNidosList) activeNidosList.innerHTML = '';

  if (state.nidos.length === 0) {
    upcomingList.innerHTML = '<p class="text-secondary" style="font-size:13px;">No hay fechas límites próximas.</p>';
    if (activeNidosList) activeNidosList.innerHTML = '<p class="text-secondary" style="font-size:13px;">Aún no perteneces a ningún Nido de estudio.</p>';
    return;
  }

  state.nidos.forEach(nido => {
    const compCount = nido.subtasks ? nido.subtasks.filter(s => s.completed).length : 0;
    const totalCount = nido.subtasks ? nido.subtasks.length : 0;
    const pct = totalCount > 0 ? Math.round((compCount / totalCount) * 100) : 0;

    if (nido.tentativeDeadline) {
      const li = document.createElement('div');
      li.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid var(--color-border); font-size:13px;';
      li.innerHTML = `
        <div>
          <strong>${nido.name}</strong> - ${nido.subject}<br>
          <span style="color:var(--color-text-muted);">Control: ${new Date(nido.tentativeDeadline).toLocaleDateString()}</span>
        </div>
        <span style="font-weight:700; color:${pct === 100 ? 'var(--color-emerald)' : 'var(--color-gold)'}">${pct}%</span>
      `;
      upcomingList.appendChild(li);
    }

    if (activeNidosList) {
      const card = document.createElement('div');
      card.className = 'glass-panel';
      card.style.cssText = 'padding:16px; margin-bottom:12px; cursor:pointer;';
      card.innerHTML = `
        <h4 style="font-weight:700; color:var(--color-emerald);">${nido.name}</h4>
        <p style="font-size:12px; color:var(--color-text-secondary); margin-bottom:8px;">${nido.subject} ${nido.code ? `• Código: <strong>${nido.code}</strong>` : ''}</p>
        <div class="collective-progress-container" style="height:6px; margin-top:4px;">
          <div class="collective-progress-bar" style="width:${pct}%"></div>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:11px; margin-top:6px; color:var(--color-text-muted);">
          <span>${nido.members ? nido.members.length : 1} Integrantes</span>
          <span>${pct}% Completado</span>
        </div>
      `;
      card.onclick = () => {
        state.activeNido = nido;
        switchTab('nidos');
        subscribeToActiveNidoChats();
        renderNidoDetailView();
      };
      activeNidosList.appendChild(card);
    }
  });
}

function renderGlobalChat() {
  if (!state.globalChatConnected) return; // Evitar renderizar si no está conectado
  const msgContainer = document.getElementById('global-chat-messages');
  if (!msgContainer) return;
  msgContainer.innerHTML = '';

  state.chats.global.forEach(msg => {
    const isSelf = msg.senderEmail === state.currentUser.email;
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isSelf ? 'right' : 'left'}`;
    bubble.innerHTML = `
      <span class="chat-sender-name">${msg.senderName}</span>
      <div class="chat-bubble-inner">${msg.message}</div>
      <div class="chat-meta">
        <span>${new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
      </div>
    `;
    msgContainer.appendChild(bubble);
  });
  msgContainer.scrollTop = msgContainer.scrollHeight;
}

function connectAndEnterGlobalChat() {
  state.globalChatConnected = true;
  
  const gcPlaceholder = document.getElementById('global-chat-placeholder');
  const gcActiveView = document.getElementById('global-chat-active-view');
  
  if (gcPlaceholder) gcPlaceholder.style.display = 'none';
  if (gcActiveView) gcActiveView.style.display = 'flex';
  
  if (typeof firebaseInitialized !== 'undefined' && firebaseInitialized) {
    dbFirestore.collection('chats')
      .where('nidoId', '==', 'global')
      .orderBy('timestamp', 'asc')
      .onSnapshot(snapshot => {
        state.chats.global = [];
        snapshot.forEach(doc => {
          state.chats.global.push({ id: doc.id, ...doc.data() });
        });
        if (state.activeTab === 'dashboard') {
          renderGlobalChat();
        }
      });
  } else {
    fetchChats('global').then(() => {
      renderGlobalChat();
    });
  }
  
  showToast('Chat Universitario', 'Te has unido al canal en tiempo real.', 'info');
}

function renderNidosTab() {
  const panel = document.getElementById('panel-nidos');
  if (!panel) return;

  if (!state.activeNido) {
    let html = `
      <div class="panel-header">
        <h3>Nidos de Estudio Activos</h3>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-secondary" onclick="openJoinNidoModal()" style="display:inline-flex; align-items:center; gap:6px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"></path><path d="M10 14L21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></svg> Unirse por Código</button>
          <button class="btn btn-primary" onclick="openCreateNidoModal()" style="display:inline-flex; align-items:center; gap:6px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Crear Nido</button>
        </div>
      </div>
      <div class="nidos-grid">
    `;

    if (state.nidos.length === 0) {
      html += `<p style="grid-column: span 2; color:var(--color-text-secondary); text-align:center; padding:40px;">No estás registrado en ningún nido. Crea un nido e invita a tus compañeros.</p>`;
    } else {
      state.nidos.forEach(n => {
        const comp = n.subtasks ? n.subtasks.filter(s => s.completed).length : 0;
        const total = n.subtasks ? n.subtasks.length : 0;
        const pct = total > 0 ? Math.round((comp / total) * 100) : 0;
        html += `
          <div class="glass-panel" style="cursor:pointer;" onclick="selectNido('${n.id}')">
            <h4 style="font-size:18px; color:var(--color-emerald); font-weight:700;">${n.name}</h4>
            <p style="font-size:13px; color:var(--color-text-secondary); margin-bottom:12px;">Materia: ${n.subject} ${n.code ? `• Código: <strong>${n.code}</strong>` : ''}</p>
            <div class="collective-progress-container">
              <div class="collective-progress-bar" style="width:${pct}%"></div>
            </div>
            <div style="display:flex; justify-content:space-between; margin-top:8px; font-size:12px; font-weight:600; color:var(--color-text-secondary);">
              <span>${n.members ? n.members.length : 1} Alumnos</span>
              <span>${pct}% de Logro</span>
            </div>
          </div>
        `;
      });
    }

    html += `</div>`;
    panel.innerHTML = html;
  } else {
    renderNidoDetailView();
  }
}

function selectNido(nidoId) {
  state.activeNido = state.nidos.find(n => n.id === nidoId);
  fetchChats(nidoId);
  subscribeToActiveNidoChats();
  renderNidoDetailView();
}

function exitNidoView() {
  state.activeNido = null;
  if (activeNidoChatUnsubscribe) {
    activeNidoChatUnsubscribe();
    activeNidoChatUnsubscribe = null;
  }
  
  // Restablecer título del encabezado dinámicamente
  const titleEl = document.getElementById('current-tab-title');
  if (titleEl) {
    titleEl.innerText = 'Nidos de Estudio';
  }
  
  renderNidosTab();
}

function renderNidoDetailView() {
  const panel = document.getElementById('panel-nidos');
  if (!panel || !state.activeNido) return;

  const nido = state.activeNido;
  const subtasksList = nido.subtasks || [];
  const compCount = subtasksList.filter(s => s.completed).length;
  const totalCount = subtasksList.length;
  const pct = totalCount > 0 ? Math.round((compCount / totalCount) * 100) : 0;

  let membersHtml = '';
  if (nido.members) {
    nido.members.forEach(m => {
      const initials = m.name.split(' ').map(x => x[0]).join('').substring(0, 2).toUpperCase();
      membersHtml += `
        <div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #f3f4f6;">
          <div class="avatar-circle">${initials}</div>
          <div>
            <div style="font-size:13px; font-weight:600;">${m.name}</div>
            <div style="font-size:11px; color:var(--color-text-muted);">${m.role === 'admin' ? 'Administrador 👑' : 'Miembro'}</div>
          </div>
        </div>
      `;
    });
  }

  let subtasksRowsHtml = '';
  if (subtasksList.length === 0) {
    subtasksRowsHtml = `<tr><td colspan="4" style="text-align:center; color:var(--color-text-secondary);">No hay subtareas desglosadas. Agrega una subtarea más abajo.</td></tr>`;
  } else {
    subtasksList.forEach(s => {
      const isSelfAssigned = s.assignedTo === state.currentUser.email;
      const isCompleted = s.completed;
      subtasksRowsHtml += `
        <tr>
          <td data-label="Subtarea"><strong>${s.title}</strong></td>
          <td data-label="Asignado a">
            <div class="member-badge">
              <span style="font-size:13px; font-weight:500;">${s.assignedTo}</span>
            </div>
          </td>
          <td data-label="Estado">
            <span class="status-badge ${isCompleted ? 'completed' : 'pending'}">${isCompleted ? 'Completado' : 'Pendiente'}</span>
            ${s.fileUrl ? `<br><a href="${s.fileUrl}" target="_blank" download="${s.fileName}" style="font-size:11px; color:var(--color-turquoise); font-weight:600; text-decoration:none; margin-top:2px; display:inline-flex; align-items:center; gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Descargar: ${s.fileName}</a>` : ''}
          </td>
          <td data-label="Mi Acción">
            ${isSelfAssigned ? `
              <label class="custom-check-wrapper">
                <input type="checkbox" class="custom-check-input" ${isCompleted ? 'checked' : ''} onchange="handleSubtaskToggleClick('${nido.id}', '${s.id}', this.checked)">
                <span class="custom-check-box">✓</span>
                <span style="font-size:12px; font-weight:600;">${isCompleted ? 'Completado' : 'Subir Borrador'}</span>
              </label>
            ` : `<span style="font-size:11px; color:var(--color-text-muted);">Asignado a compañero</span>`}
          </td>
        </tr>
      `;
    });
  }

  let chatHtml = '';
  const messages = state.chats.nido[nido.id] || [];
  messages.forEach(msg => {
    const isSelf = msg.senderEmail === state.currentUser.email;
    const isSystem = msg.type === 'alert';
    
    if (isSystem) {
      chatHtml += `
        <div class="chat-bubble system">
          <div class="chat-bubble-inner">${msg.message}</div>
        </div>
      `;
    } else {
      chatHtml += `
        <div class="chat-bubble ${isSelf ? 'right' : 'left'}">
          <span class="chat-sender-name">${msg.senderName}</span>
          <div class="chat-bubble-inner">
            ${msg.message}
            ${msg.fileUrl ? `<img src="${msg.fileUrl}" class="chat-attachment-img" onclick="window.open('${msg.fileUrl}', '_blank')">` : ''}
          </div>
          <div class="chat-meta">
            <span>${new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            ${msg.fileUrl ? `<span style="font-weight:600; display:inline-flex; align-items:center; gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg> ${msg.fileName}</span>` : ''}
          </div>
        </div>
      `;
    }
  });

  // Actualizar título del encabezado dinámicamente al entrar a un Nido
  const titleEl = document.getElementById('current-tab-title');
  if (titleEl) {
    titleEl.innerText = `Nido: ${nido.name}`;
  }

  panel.innerHTML = `
    <button class="btn btn-secondary" onclick="exitNidoView()" style="margin-bottom:20px; padding:8px 16px; font-size:13px;">⬅ Volver a Nidos</button>
    
    <div class="nido-view-layout">
      <div>
        <div class="glass-panel">
          <div class="nido-header-panel">
            <div class="nido-meta">
              <span class="nido-subject">${nido.subject}</span>
              <div style="display:flex; align-items:center; gap:12px; margin-top:4px; flex-wrap:wrap;">
                <h3 style="margin:0;">${nido.name}</h3>
                ${nido.code ? `<span class="nido-code-badge" onclick="copyNidoCode('${nido.code}')" title="Copiar código al portapapeles">Código: ${nido.code}</span>` : ''}
              </div>
              <p style="font-size:12px; color:var(--color-text-muted); margin-top:6px;">Entregable Final: <strong>${nido.finalDeadline || 'Sin definir'}</strong></p>
            </div>
            <div style="text-align:right;">
              <div style="font-size:13px; font-weight:700; color:#dc2626; display:inline-flex; align-items:center; gap:4px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                ${nido.tentativeDeadline ? new Date(nido.tentativeDeadline).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'No programado'}
              </div>
            </div>
          </div>
          
          <h4 style="font-size:14px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:var(--color-text-secondary);">Métrica de Progreso Colectivo</h4>
          <div class="collective-progress-container">
            <div class="collective-progress-bar" style="width:${pct}%"></div>
          </div>
          <div class="progress-text">Llevan el ${pct}% de la tarea</div>
        </div>

        <div class="glass-panel">
          <div class="panel-header">
            <h3>Asignación de Subtareas</h3>
            ${nido.adminId === state.currentUser.id ? `<button class="btn btn-secondary" onclick="openAddSubtaskModal()" style="padding:6px 12px; font-size:12px; display:inline-flex; align-items:center; gap:6px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Asignar Subtarea</button>` : ''}
          </div>
          <div style="overflow-x:auto;">
            <table class="nido-tasks-table">
              <thead>
                <tr>
                  <th>Subtarea / Entregable</th>
                  <th>Responsable</th>
                  <th>Estado / Archivo</th>
                  <th>Mi Acción</th>
                </tr>
              </thead>
              <tbody>
                ${subtasksRowsHtml}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div>
        <div class="glass-panel nido-chat-panel" style="padding:0; overflow:hidden;">
          <div class="chat-header">
            <div class="avatar-circle" style="background-color:var(--color-emerald-light); color:var(--color-emerald); display:flex; align-items:center; justify-content:center;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
            </div>
            <div>
              <div style="font-weight:700; font-size:14px;">Chat Grupal Interno</div>
              <div style="font-size:11px; color:var(--color-text-muted);">Debate y envíos multimedia</div>
            </div>
          </div>
          
          <div class="chat-messages" id="nido-chat-messages">
            ${chatHtml}
          </div>
          
          <div class="chat-input-bar">
            <input type="file" id="nido-chat-file-input" style="display:none;" onchange="handleChatFileUpload(this)">
            
            <button class="chat-attach-btn" onclick="document.getElementById('nido-chat-file-input').click()" style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
            </button>
            <input type="text" class="chat-input-field" id="nido-chat-text-input" placeholder="Pregunta algo al equipo..." onkeydown="if(event.key==='Enter') sendNidoChatMessage()">
            <button class="btn btn-primary" onclick="sendNidoChatMessage()" style="width:36px; height:36px; padding:0; border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(45deg);"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </button>
            
            <div class="chat-file-preview" id="nido-chat-file-preview" style="display:none;">
              <span>Archivo seleccionado</span>
              <button class="chat-file-remove" onclick="clearNidoChatFile()">✕</button>
            </div>
          </div>
        </div>

        <div class="glass-panel">
          <h4 style="font-size:14px; font-weight:700; margin-bottom:10px;">Compañeros de Apoyo</h4>
          <div style="display:flex; flex-direction:column; gap:6px;">
            ${membersHtml}
          </div>
        </div>
      </div>
    </div>
  `;

  const msgs = document.getElementById('nido-chat-messages');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

// 11. FILE AND INTERACTION HANDLERS FOR FRONTEND
let activeNidoChatFile = null;

function handleChatFileUpload(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    activeNidoChatFile = {
      name: file.name,
      content: e.target.result 
    };
    
    const preview = document.getElementById('nido-chat-file-preview');
    preview.style.display = 'flex';
    preview.querySelector('span').innerText = `Archivo: ${file.name.substring(0, 16)}...`;
  };
  reader.readAsDataURL(file);
}

function clearNidoChatFile() {
  activeNidoChatFile = null;
  document.getElementById('nido-chat-file-preview').style.display = 'none';
  document.getElementById('nido-chat-file-input').value = '';
}

function sendNidoChatMessage() {
  const input = document.getElementById('nido-chat-text-input');
  const text = input.value.trim();
  if (!text && !activeNidoChatFile) return;

  sendChatMessage(state.activeNido.id, text, activeNidoChatFile).then(() => {
    input.value = '';
    clearNidoChatFile();
  });
}

let currentUploadSubtaskId = null;
let currentUploadNidoId = null;
let modalUploadedFileContent = null;

function handleSubtaskToggleClick(nidoId, subtaskId, checked) {
  if (checked) {
    currentUploadSubtaskId = subtaskId;
    currentUploadNidoId = nidoId;
    clearModalFile();
    openModalForm('upload-file');
  } else {
    toggleSubtask(nidoId, subtaskId, false);
  }
}

function handleModalFileSelect(input) {
  const file = input.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    modalUploadedFileContent = {
      name: file.name,
      content: e.target.result
    };
    
    // Update UI preview
    document.getElementById('modal-file-name').innerText = file.name;
    const sizeKB = Math.round(file.size / 1024);
    document.getElementById('modal-file-size').innerText = `${sizeKB} KB`;
    document.getElementById('modal-file-preview').style.display = 'flex';
    document.getElementById('upload-file-dropzone').style.display = 'none';
    document.getElementById('btn-submit-upload-file').disabled = false;
  };
  reader.readAsDataURL(file);
}

function clearModalFile() {
  modalUploadedFileContent = null;
  document.getElementById('modal-file-preview').style.display = 'none';
  document.getElementById('upload-file-dropzone').style.display = 'flex';
  document.getElementById('modal-file-input').value = '';
  document.getElementById('btn-submit-upload-file').disabled = true;
}

function submitModalUploadFile() {
  if (currentUploadNidoId && currentUploadSubtaskId && modalUploadedFileContent) {
    toggleSubtask(currentUploadNidoId, currentUploadSubtaskId, true, modalUploadedFileContent).then(() => {
      closeModalForm('upload-file');
      currentUploadSubtaskId = null;
      currentUploadNidoId = null;
    });
  }
}

function sendGlobalChatMessage() {
  const input = document.getElementById('global-chat-text-input');
  const text = input.value.trim();
  if (!text) return;
  sendChatMessage('global', text).then(() => {
    input.value = '';
  });
}

// 12. NOTIFICATION AND POPUP MODAL HANDLERS
function renderAlertsTab() {
  const list = document.getElementById('panel-alerts-list');
  if (!list) return;

  list.innerHTML = '';
  if (state.notifications.length === 0) {
    list.innerHTML = '<p style="color:var(--color-text-secondary); text-align:center; padding:30px; font-size:13px;">No hay alertas pendientes.</p>';
    return;
  }

  state.notifications.forEach(n => {
    const el = document.createElement('div');
    el.className = `alert-item ${n.type}`;
    el.innerHTML = `
      <div class="alert-icon">${n.type === 'pressure' ? '⚠️' : '🔔'}</div>
      <div class="alert-info">
        <h4>${n.title}</h4>
        <p>${n.message}</p>
        <div class="alert-time">${new Date(n.timestamp).toLocaleString()}</div>
      </div>
    `;
    list.appendChild(el);
  });
}

function updateUnreadNotificationBadge() {
  const badge = document.getElementById('unread-notif-badge');
  const mobileBadge = document.getElementById('mobile-unread-notif-badge');
  const unreadCount = state.notifications.filter(n => !n.read).length;

  if (badge) {
    if (unreadCount > 0) {
      badge.innerText = unreadCount;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  if (mobileBadge) {
    if (unreadCount > 0) {
      mobileBadge.innerText = unreadCount;
      mobileBadge.style.display = 'flex';
    } else {
      mobileBadge.style.display = 'none';
    }
  }
}

function markAllNotificationsAsRead() {
  state.notifications.forEach(n => n.read = true);
  updateUnreadNotificationBadge();
  if (typeof firebaseInitialized !== 'undefined' && firebaseInitialized && !state.offlineMode) {
    state.notifications.forEach(async (n) => {
      if (n.id) {
        try {
          await dbFirestore.collection('notifications').doc(n.id).update({ read: true });
        } catch (error) {
          console.warn("⚠️ Error updating notification in Firestore:", error);
        }
      }
    });
    return;
  }
}

// Helper functions for custom interactive modals
function openModalForm(type) {
  const modal = document.getElementById(`modal-${type}`);
  if (modal) modal.classList.add('active');
}

function closeModalForm(type) {
  const modal = document.getElementById(`modal-${type}`);
  if (modal) modal.classList.remove('active');
  
  // If we closed the upload modal, restore the checkbox state!
  if (type === 'upload-file' && currentUploadNidoId && currentUploadSubtaskId) {
    renderNidoDetailView();
    currentUploadSubtaskId = null;
    currentUploadNidoId = null;
  }
}

function openCreateNidoModal() {
  document.getElementById('form-create-nido').reset();
  const tomorrow = new Date(Date.now() + 3600 * 1000 * 24).toISOString().split('T')[0];
  document.getElementById('nido-deadline-input').value = tomorrow;
  openModalForm('create-nido');
}

function submitCreateNidoForm() {
  const name = document.getElementById('nido-name-input').value.trim();
  const subject = document.getElementById('nido-subject-input').value.trim();
  const deadlineDate = document.getElementById('nido-deadline-input').value;
  const emailsInput = document.getElementById('nido-members-input').value.trim();
  
  if (!name || !subject || !deadlineDate) return;
  
  const emails = emailsInput ? emailsInput.split(',').map(e => e.trim()).filter(e => e.length > 0) : [];
  const tentative = new Date(deadlineDate).toISOString();
  const final = new Date(new Date(deadlineDate).getTime() + 3600 * 1000 * 24).toISOString().split('T')[0];
  
  createNido(name, subject, tentative, final, emails).then(() => {
    closeModalForm('create-nido');
  });
}

function openAddSubtaskModal() {
  if (!state.activeNido) return;
  document.getElementById('form-create-subtask').reset();
  
  const select = document.getElementById('subtask-assignee-select');
  if (select) {
    select.innerHTML = '';
    if (state.activeNido.members) {
      state.activeNido.members.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.email;
        opt.innerText = `${m.name} (${m.email})`;
        select.appendChild(opt);
      });
    } else {
      const opt = document.createElement('option');
      opt.value = state.currentUser.email;
      opt.innerText = `${state.currentUser.name} (${state.currentUser.email})`;
      select.appendChild(opt);
    }
  }
  openModalForm('create-subtask');
}

function submitCreateSubtaskForm() {
  const title = document.getElementById('subtask-title-input').value.trim();
  const assignedTo = document.getElementById('subtask-assignee-select').value;
  
  if (!title || !assignedTo) return;
  
  addSubtask(state.activeNido.id, title, assignedTo).then(() => {
    closeModalForm('create-subtask');
  });
}

// Kanban Form Modal submit handlers
function triggerAddNewKanbanTaskModal() {
  document.getElementById('form-create-kanban-task').reset();
  openModalForm('create-kanban-task');
}

function submitCreateKanbanTaskForm() {
  const title = document.getElementById('kanban-title-input').value.trim();
  const desc = document.getElementById('kanban-desc-input').value.trim();
  const subject = document.getElementById('kanban-subject-input').value.trim();
  
  if (!title || !desc || !subject) return;
  
  addPersonalTask(title, desc, subject);
  closeModalForm('create-kanban-task');
}

// Drag & Drop event bindings for the file upload dropzone
function initUploadDropzoneDragAndDrop() {
  const dropzone = document.getElementById('upload-file-dropzone');
  if (!dropzone) return;
  
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    }, false);
  });
  
  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    }, false);
  });
  
  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      const fileInput = document.getElementById('modal-file-input');
      if (fileInput) {
        fileInput.files = files;
        handleModalFileSelect(fileInput);
      }
    }
  }, false);
}

function showToast(title, text, type = 'success') {
  const container = document.getElementById('toast-box');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type === 'warning' ? 'warning' : type === 'info' ? 'info' : ''}`;
  toast.innerHTML = `
    <span style="font-size:16px;">${type === 'warning' ? '⚠️' : type === 'info' ? '☕' : '✨'}</span>
    <div>
      <strong style="display:block; font-size:13px; font-weight:700;">${title}</strong>
      <span style="font-size:12px; color:var(--color-text-secondary);">${text}</span>
    </div>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function toggleSimulatorPanel() {
  const panel = document.getElementById('sim-control-panel');
  if (panel) {
    panel.classList.toggle('active');
  }
}

// Background checking
setInterval(() => {
  if (state.currentUser) {
    runOfflineAlertCheck();
  }
}, 15000);

// Copy code helper
function copyNidoCode(code) {
  navigator.clipboard.writeText(code).then(() => {
    showToast('Código Copiado', `El código "${code}" ha sido copiado al portapapeles.`);
  }).catch(err => {
    console.error('No se pudo copiar el código: ', err);
  });
}

// Join Nido helper
async function joinNidoByCode(code) {
  code = code.trim().toUpperCase();
  if (code.length !== 6) {
    throw new Error('El código debe tener exactamente 6 caracteres.');
  }

  if (typeof firebaseInitialized !== 'undefined' && firebaseInitialized && !state.offlineMode) {
    try {
      // Firebase Cloud Mode
      const querySnapshot = await dbFirestore.collection('nidos').where('code', '==', code).get();
      if (querySnapshot.empty) {
        throw new Error('No se encontró ningún Nido con ese código.');
      }
      
      const doc = querySnapshot.docs[0];
      const nidoId = doc.id;
      const nidoData = doc.data();
      
      // Check if already a member
      if (nidoData.membersEmails && nidoData.membersEmails.includes(state.currentUser.email)) {
        throw new Error('Ya eres miembro de este Nido.');
      }
      
      const currentMembersEmails = nidoData.membersEmails || [];
      const currentMembers = nidoData.members || [];
      
      const updatedMembersEmails = [...currentMembersEmails, state.currentUser.email];
      const updatedMembers = [
        ...currentMembers,
        { id: state.currentUser.id, name: state.currentUser.name, email: state.currentUser.email, role: 'member' }
      ];
      
      await dbFirestore.collection('nidos').doc(nidoId).update({
        members: updatedMembers,
        membersEmails: updatedMembersEmails
      });
      
      // Welcome message in Nido chat
      await dbFirestore.collection('chats').add({
        nidoId,
        senderName: 'StudyNest Bot 🦉',
        senderEmail: 'bot@studynest.edu',
        message: `🎉 ¡Un caluroso aplauso para ${state.currentUser.name} que se ha unido al Nido usando el código de acceso!`,
        timestamp: new Date().toISOString(),
        type: 'alert'
      });
      
      showToast('Unido con éxito 🤝', `Te has unido al nido "${nidoData.name}".`);
      return nidoId;
    } catch (error) {
      if (error.message && (error.message.includes('No se encontró') || error.message.includes('Ya eres miembro') || error.message.includes('código'))) {
        throw error;
      }
      console.error("❌ Error uniéndose a nido en Firestore:", error);
      showToast('⚠️ Falló Firebase', 'Error de conexión o reglas vencidas. Uniéndose localmente...', 'danger');
      state.offlineMode = true;
      toggleSimulatorWidgetVisibility();
      openModalForm('firebase-rules-error');
    }
  }
  
  if (state.offlineMode) {
    // Offline / Simulation Mode
    const nidos = JSON.parse(localStorage.getItem('studynest_nidos')) || [];
    const nido = nidos.find(n => n.code === code);
    if (!nido) {
      throw new Error('No se encontró ningún Nido con ese código.');
    }
    
    // Check if already a member
    const isMember = nido.members && nido.members.some(m => m.email === state.currentUser.email);
    if (isMember) {
      throw new Error('Ya eres miembro de este Nido.');
    }
    
    // Add to members
    nido.members = nido.members || [];
    nido.members.push({
      id: state.currentUser.id,
      name: state.currentUser.name,
      email: state.currentUser.email,
      role: 'member'
    });
    
    // Update local state and save
    const stateNidoIdx = state.nidos.findIndex(n => n.id === nido.id);
    if (stateNidoIdx !== -1) {
      state.nidos[stateNidoIdx] = nido;
    } else {
      state.nidos.push(nido);
    }
    
    // Update offline localStorage database
    const allNidos = JSON.parse(localStorage.getItem('studynest_nidos')) || [];
    const dbNidoIdx = allNidos.findIndex(n => n.id === nido.id);
    if (dbNidoIdx !== -1) {
      allNidos[dbNidoIdx] = nido;
    } else {
      allNidos.push(nido);
    }
    localStorage.setItem('studynest_nidos', JSON.stringify(allNidos));
    
    // System welcome message
    state.chats.nido[nido.id] = state.chats.nido[nido.id] || [];
    state.chats.nido[nido.id].push({
      id: 'system-' + Date.now(),
      nidoId: nido.id,
      senderName: 'StudyNest Bot 🦉',
      senderEmail: 'bot@studynest.edu',
      message: `🎉 ¡Un caluroso aplauso para ${state.currentUser.name} que se ha unido al Nido usando el código de acceso!`,
      timestamp: new Date().toISOString(),
      type: 'alert'
    });
    
    saveLocalState();
    showToast('Unido con éxito 🤝', `Te has unido al nido "${nido.name}".`);
    return nido.id;
  }
}

// Modal open/close joining controls
function openJoinNidoModal() {
  document.getElementById('form-join-nido').reset();
  document.getElementById('join-nido-error-msg').style.display = 'none';
  openModalForm('join-nido');
}

function submitJoinNidoForm() {
  const code = document.getElementById('nido-code-input').value.trim().toUpperCase();
  if (!code) return;
  
  const errorMsg = document.getElementById('join-nido-error-msg');
  errorMsg.style.display = 'none';
  
  joinNidoByCode(code).then((nidoId) => {
    closeModalForm('join-nido');
    // Go to newly joined nido
    const joinedNido = state.nidos.find(n => n.id === nidoId);
    if (joinedNido) {
      state.activeNido = joinedNido;
      switchTab('nidos');
      subscribeToActiveNidoChats();
      renderNidoDetailView();
    } else {
      switchTab('nidos');
    }
  }).catch(err => {
    errorMsg.innerText = err.message;
    errorMsg.style.display = 'block';
  });
}

// satisfying "tac" tactile audio sweep pop generator using Web Audio API
function playTapSound() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.type = 'sine';
    // Start at a sharp higher frequency and drop fast to make a "tac" pop
    osc.frequency.setValueAtTime(1400, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(150, audioCtx.currentTime + 0.04);
    
    gainNode.gain.setValueAtTime(0.06, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.045);
    
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.05);
  } catch (e) {
    console.warn('Web Audio tap failure', e);
  }
}

// Global Satisfying Tap Acoustic Listener
document.addEventListener('click', (e) => {
  // Target interactive nodes: buttons, tabs, menu items, interactive badges, modal closers, sidebar lists, task cards
  const target = e.target.closest('button, .sidebar-menu-item, .mobile-nav-item, .nav-links a, .logo, .nido-code-badge, .task-card, .btn, .modal-close, .logout-btn, .simulator-toggle-btn, .sim-action-btn, .custom-check-wrapper');
  if (target) {
    playTapSound();
  }
});

// Initialize everything on DOM Loaded
window.addEventListener('DOMContentLoaded', () => {
  checkServerConnection();
  initPomodoro();
  initUploadDropzoneDragAndDrop();
  
  const notePad = document.getElementById('quick-notes-pad');
  if (notePad) {
    notePad.addEventListener('input', (e) => {
      localStorage.setItem('studynest_quick_notes', e.target.value);
    });
  }
});
