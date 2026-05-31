/**
 * StudyNest - Configuración Real de Firebase Cloud
 * 
 * Conectado con éxito a tu proyecto en vivo de Firebase: `studynest-ad41f`.
 * Toda la base de datos funciona en tiempo real desde tu navegador.
 */

const USE_FIREBASE = true; // 100% Conectado a la nube real

const firebaseConfig = {
  apiKey: "AIzaSyBBMzjB0yaxlQH5l0hSqAXJ7WWE09R8pOE",
  authDomain: "studynest-ad41f.firebaseapp.com",
  projectId: "studynest-ad41f",
  storageBucket: "studynest-ad41f.firebasestorage.app",
  messagingSenderId: "13607588340",
  appId: "1:13607588340:web:47a976aaf2fd3768d329a1"
};

// Variables globales de servicios de Firebase
let dbFirestore = null;
let authFirebase = null;
let firebaseInitialized = false;

// Inicialización automática y en tiempo real
if (USE_FIREBASE && typeof firebase !== 'undefined') {
  try {
    firebase.initializeApp(firebaseConfig);
    dbFirestore = firebase.firestore();
    authFirebase = firebase.auth();
    
    // Configurar persistencia de la sesión en LOCAL explícitamente
    authFirebase.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
      .then(() => {
        console.log("🔥 [StudyNest] Persistencia de Firebase Auth configurada en LOCAL.");
      })
      .catch((err) => {
        console.warn("⚠️ Error configurando persistencia de Firebase Auth:", err);
      });
      
    firebaseInitialized = true;
    console.log("🔥 [StudyNest] Conectado exitosamente a Firebase Database en tiempo real!");
  } catch (error) {
    console.error("❌ [StudyNest] Error inicializando Firebase:", error);
  }
}
