/**
 * StudyNest - Configuración Real de Firebase Cloud
 * 
 * Conectado con éxito a tu proyecto en vivo de Firebase: `studynest-ad41f`.
 * Toda la base de datos funciona en tiempo real desde tu navegador.
 */

const USE_FIREBASE = true; // 100% Conectado a la nube real
const DATABASE_TYPE = "realtime"; // Cambiado a "realtime" para usar Realtime Database, o "firestore"

const firebaseConfig = {
  apiKey: "AIzaSyBBMzjB0yaxlQH5l0hSqAXJ7WWE09R8pOE",
  authDomain: "studynest-ad41f.firebaseapp.com",
  projectId: "studynest-ad41f",
  storageBucket: "studynest-ad41f.firebasestorage.app",
  messagingSenderId: "13607588340",
  appId: "1:13607588340:web:47a976aaf2fd3768d329a1",
  // Si tu Realtime Database está en Europa u otra región, cambia esta URL:
  databaseURL: "https://studynest-ad41f-default-rtdb.firebaseio.com"
};

// Configuración de EmailJS para el envío de correos reales a Gmail (gratuito)
// Regístrate en https://www.emailjs.com/ para obtener tus credenciales
const EMAILJS_CONFIG = {
  publicKey: "YOUR_PUBLIC_KEY",     // Clave pública (Account -> API Keys)
  serviceId: "YOUR_SERVICE_ID",     // ID del servicio de correo (e.g. gmail)
  templateId: "YOUR_TEMPLATE_ID"    // ID de la plantilla de correo
};

// ============================================================================
// 🔌 WRAPPER DE COMPATIBILIDAD FIRESTORE -> REALTIME DATABASE
// ============================================================================
class FirestoreQueryWrapper {
  constructor(ref, queries = [], ordering = null) {
    this.ref = ref;
    this.queries = queries;
    this.ordering = ordering;
  }

  where(field, op, value) {
    return new FirestoreQueryWrapper(this.ref, [...this.queries, { field, op, value }], this.ordering);
  }

  orderBy(field, direction = 'asc') {
    return new FirestoreQueryWrapper(this.ref, this.queries, { field, direction });
  }

  onSnapshot(onNext, onError) {
    const callback = (snapshot) => {
      try {
        const docs = [];
        snapshot.forEach((childSnapshot) => {
          const val = childSnapshot.val();
          const docId = childSnapshot.key;
          
          let match = true;
          for (const q of this.queries) {
            const fieldValue = val ? val[q.field] : undefined;
            if (q.op === '==') {
              if (fieldValue !== q.value) {
                match = false;
                break;
              }
            } else if (q.op === 'array-contains') {
              if (!Array.isArray(fieldValue) || !fieldValue.includes(q.value)) {
                match = false;
                break;
              }
            }
          }
          
          if (match && val) {
            docs.push({
              id: docId,
              exists: true,
              data: () => val,
              ...val
            });
          }
        });

        if (this.ordering) {
          const { field, direction } = this.ordering;
          docs.sort((a, b) => {
            const dataA = a.data();
            const dataB = b.data();
            const valA = dataA[field];
            const valB = dataB[field];
            
            if (valA === undefined && valB === undefined) return 0;
            if (valA === undefined) return direction === 'desc' ? 1 : -1;
            if (valB === undefined) return direction === 'desc' ? -1 : 1;

            if (valA < valB) return direction === 'desc' ? 1 : -1;
            if (valA > valB) return direction === 'desc' ? -1 : 1;
            return 0;
          });
        }

        const querySnapshot = {
          docs,
          forEach: (cb) => docs.forEach(cb),
          empty: docs.length === 0,
          size: docs.length
        };
        
        onNext(querySnapshot);
      } catch (err) {
        if (onError) onError(err);
        else console.error("Error en el wrapper de onSnapshot:", err);
      }
    };

    this.ref.on('value', callback, (err) => {
      if (onError) onError(err);
    });

    return () => {
      this.ref.off('value', callback);
    };
  }

  async get() {
    const snapshot = await this.ref.once('value');
    const docs = [];
    snapshot.forEach((childSnapshot) => {
      const val = childSnapshot.val();
      const docId = childSnapshot.key;
      
      let match = true;
      for (const q of this.queries) {
        const fieldValue = val ? val[q.field] : undefined;
        if (q.op === '==') {
          if (fieldValue !== q.value) {
            match = false;
            break;
          }
        } else if (q.op === 'array-contains') {
          if (!Array.isArray(fieldValue) || !fieldValue.includes(q.value)) {
            match = false;
            break;
          }
        }
      }
      
      if (match && val) {
        docs.push({
          id: docId,
          exists: true,
          data: () => val,
          ...val
        });
      }
    });

    if (this.ordering) {
      const { field, direction } = this.ordering;
      docs.sort((a, b) => {
        const dataA = a.data();
        const dataB = b.data();
        const valA = dataA[field];
        const valB = dataB[field];
        
        if (valA === undefined && valB === undefined) return 0;
        if (valA === undefined) return direction === 'desc' ? 1 : -1;
        if (valB === undefined) return direction === 'desc' ? -1 : 1;

        if (valA < valB) return direction === 'desc' ? 1 : -1;
        if (valA > valB) return direction === 'desc' ? -1 : 1;
        return 0;
      });
    }

    return {
      docs,
      forEach: (cb) => docs.forEach(cb),
      empty: docs.length === 0,
      size: docs.length
    };
  }
}

class FirestoreDocWrapper {
  constructor(ref) {
    this.ref = ref;
    this.id = ref.key;
  }

  async get() {
    const snapshot = await this.ref.once('value');
    const val = snapshot.val();
    return {
      id: this.id,
      exists: val !== null,
      data: () => val,
      ...val
    };
  }

  async set(data, options) {
    if (options && options.merge) {
      const snapshot = await this.ref.once('value');
      const val = snapshot.val() || {};
      const merged = { ...val, ...data };
      await this.ref.set(merged);
    } else {
      await this.ref.set(data);
    }
  }

  async update(data) {
    await this.ref.update(data);
  }

  async delete() {
    await this.ref.remove();
  }
}

class FirestoreCollectionWrapper {
  constructor(ref) {
    this.ref = ref;
  }

  doc(id) {
    if (!id) {
      const newRef = this.ref.push();
      return new FirestoreDocWrapper(newRef);
    }
    return new FirestoreDocWrapper(this.ref.child(id));
  }

  where(field, op, value) {
    return new FirestoreQueryWrapper(this.ref, [{ field, op, value }]);
  }

  orderBy(field, direction = 'asc') {
    return new FirestoreQueryWrapper(this.ref, [], { field, direction });
  }

  onSnapshot(onNext, onError) {
    return new FirestoreQueryWrapper(this.ref).onSnapshot(onNext, onError);
  }

  async add(data) {
    const newRef = this.ref.push();
    await newRef.set(data);
    return new FirestoreDocWrapper(newRef);
  }

  async get() {
    return new FirestoreQueryWrapper(this.ref).get();
  }
}

class FirestoreWrapper {
  constructor(db) {
    this.db = db;
  }

  collection(name) {
    return new FirestoreCollectionWrapper(this.db.ref(name));
  }
}

// Variables globales de servicios de Firebase
let dbFirestore = null;
let authFirebase = null;
let firebaseInitialized = false;

// Inicialización automática y en tiempo real
if (USE_FIREBASE && typeof firebase !== 'undefined') {
  try {
    firebase.initializeApp(firebaseConfig);
    authFirebase = firebase.auth();
    
    if (DATABASE_TYPE === "realtime") {
      const rtdb = firebase.database();
      dbFirestore = new FirestoreWrapper(rtdb);
      console.log("🔥 [StudyNest] Conectado exitosamente a Firebase Realtime Database!");
    } else {
      dbFirestore = firebase.firestore();
      console.log("🔥 [StudyNest] Conectado exitosamente a Cloud Firestore!");
    }
    
    // Configurar persistencia de la sesión en LOCAL explícitamente
    authFirebase.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
      .then(() => {
        console.log("🔥 [StudyNest] Persistencia de Firebase Auth configurada en LOCAL.");
      })
      .catch((err) => {
        console.warn("⚠️ Error configurando persistencia de Firebase Auth:", err);
      });
      
    firebaseInitialized = true;
  } catch (error) {
    console.error("❌ [StudyNest] Error inicializando Firebase:", error);
  }
}
