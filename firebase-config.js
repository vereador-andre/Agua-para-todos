// Firebase SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";

import {
  getAuth,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

import {
  getStorage
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";


// Configuração do projeto Água para Todos
const firebaseConfig = {
  apiKey: "AIzaSyBuftlms0LcdZrM9dpcf5wIk7eWjK3_o4A",
  authDomain: "agua-para-todos-19454.firebaseapp.com",
  projectId: "agua-para-todos-19454",
  storageBucket: "agua-para-todos-19454.firebasestorage.app",
  messagingSenderId: "799145802902",
  appId: "1:799145802902:web:b40f090db609b71c3696b7"
};


// Inicializa Firebase
const app = initializeApp(firebaseConfig);


// Firebase Authentication
const auth = getAuth(app);


// Mantém a sessão do usuário no navegador
// mesmo depois de fechar a página.
setPersistence(
  auth,
  browserLocalPersistence
).catch((error) => {
  console.error(
    "Erro ao configurar persistência do login:",
    error
  );
});


// Firestore
const db = getFirestore(app);


// Storage
const storage = getStorage(app);


// Disponibiliza os serviços para o restante do aplicativo
export {
  app,
  auth,
  db,
  storage
};
