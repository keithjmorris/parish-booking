// firebase-config.js
//
// Fill this in with the values from your Firebase project:
// Firebase Console → Project settings → General → "Your apps" → SDK setup and configuration
//
// This file is safe to be public (it ships to the browser) — it is not a secret.
// Access control is enforced by firestore.rules / storage.rules, not by hiding this file.

export const firebaseConfig = {
  apiKey: "AIzaSyDFmaAk-FMY8HiXSEw0y31z6yZCZGUuDz0",
  authDomain: "parish-booking.firebaseapp.com",
  projectId: "parish-booking",
  storageBucket: "parish-booking.firebasestorage.app",
  messagingSenderId: "700533810713",
  appId: "1:700533810713:web:d0b940a11928c421d62c88"
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
