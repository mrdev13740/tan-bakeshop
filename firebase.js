import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";

import {
  getFirestore,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { getAuth } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyAudRe-ncgkb5M9ZxyDiv8namRBB4bAZc0",
    authDomain: "tan-bakeshop.firebaseapp.com",
    projectId: "tan-bakeshop",
    storageBucket: "tan-bakeshop.firebasestorage.app",
    messagingSenderId: "649495698154",
    appId: "1:649495698154:web:774ac757ea8aee76f81593",
    measurementId: "G-2Z4CWHCPQZ"
  };

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export const offlineReady = enableIndexedDbPersistence(db)
  .catch((error) => {
    console.warn("Offline persistence unavailable:", error.code);
  });
