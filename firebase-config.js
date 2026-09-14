import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBuftlms0LcdZrM9dpcf5wIk7eWjK3_o4A",
  authDomain: "agua-para-todos-19454.firebaseapp.com",
  projectId: "water-for-all-19454",
  storageBucket: "agua-para-todos-19454.firebasestorage.app",
  messagingSenderId: "799145802902",
  appId: "1:799145802902:web:b40f090db609b71c3696b7"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { app, db };
