// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// TODO: Replace the following with your app's Firebase project configuration
export const firebaseConfig = {
  apiKey: "AIzaSyAAf5Tfvh0Ow-iusTMuvax5VlxBgjtVFeo",
  authDomain: "agua-para-todos-18167.firebaseapp.com",
  projectId: "agua-para-todos-18167",
  storageBucket: "agua-para-todos-18167.firebasestorage.app",
  messagingSenderId: "154424742994",
  appId: "1:154424742994:web:46f14ccf8fc781e8867b8b"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
