// Firebase SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";

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

// Serviços que o aplicativo vai utilizar
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Disponibiliza os serviços para o restante do aplicativo
export { app, auth, db, storage };
